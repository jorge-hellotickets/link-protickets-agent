/**
 * Dedicated "has the invoice arrived?" detector.
 *
 * This used to be one bullet in the big negotiation prompt. It was too easy
 * for the negotiation LLM to miss it: by the time the invoice lands the
 * thread is long, the pricing logic dominates the prompt, and a
 * "te adjunto la factura" line buried in a 19-message thread slipped
 * through. Running a second, narrowly-scoped call on just the latest
 * inbound gives us a clean yes/no with explicit evidence.
 *
 * Scope: only ever promotes waiting_for_invoice → waiting_for_payment. Never
 * proposes paid (that's the manual Mark-Paid button) and never moves
 * backwards. The caller is expected to gate on (dealExists &&
 * status === "waiting_for_invoice" && !paidAt).
 */
import { callAIGateway, parseGatewayJSON } from "./ai/gateway";
import { db } from "./db-stub";
import { getLinkAgentRuntimeConfig } from "./runtime-config";
const PAYMENT_DETECTION_RESPONSE_FORMAT = {
    name: "LinkAgentPaymentDetection",
    strict: true,
    schema: {
        type: "object",
        additionalProperties: false,
        properties: {
            invoiceDelivered: { type: "boolean" },
            invoiceType: {
                type: "string",
                enum: ["none", "proforma", "final"],
            },
            evidence: { type: "string" },
        },
        required: ["invoiceDelivered", "invoiceType", "evidence"],
    },
};
export const DEFAULT_PAYMENT_DETECTOR_PROMPT = `You classify a single inbound email and decide whether the prospect is delivering an invoice RIGHT NOW, and if so, what kind of invoice.

The conversation already reached a closed deal. Two independent questions:
  1. Is an invoice being delivered in THIS message? (invoiceDelivered)
  2. If so, is it a proforma (pro-forma / pre-payment / quote-style) or the final (definitive / post-payment) invoice? (invoiceType)

Output strict JSON:
{
  "invoiceDelivered": boolean,
  "invoiceType": "none" | "proforma" | "final",
  "evidence": string        // short LITERAL quote copied verbatim from the inbound. Empty string if invoiceDelivered is false.
}

invoiceDelivered = true ONLY when the inbound is actually delivering an invoice:
- Prospect attaches an invoice file (and mentions it in the text).
- Prospect pastes an invoice/factura with an invoice number or line items / totals.
- Prospect writes a sentence clearly stating they are sending it now ("te adjunto la factura", "here is the invoice", "aquí va la factura", "attached you will find the invoice", "adjunto factura", "envío factura", "te adjunto la factura proforma").

invoiceDelivered = false in every other case, including:
- Promises: "te la mandaré pronto", "I'll send it next week", "la enviamos tras publicación".
- Requests for our invoicing data: "can you send me your invoicing details", "¿cuál es tu NIF?".
- Announcements about how they invoice without delivering: "we'll invoice you after publication", "solemos facturar a 30 días".
- Any inbound not about the invoice at all (publication date, link check, thank-yous, etc.).

invoiceType classification rules:
- "proforma" when the inbound explicitly calls the document a proforma / pro-forma / pro forma / factura proforma / presupuesto / quote / provisional, OR the inbound describes a pre-payment workflow where this document is a payment commitment and a "final" / "definitiva" invoice will follow after payment ("te adjunto la factura proforma para que la abones, cuando se haga la transferencia te paso la factura final").
- "final" when the inbound calls the document the final/definitive/official invoice, OR the deal is already paid and they are now sending the receipt-style invoice, OR nothing in the message signals proforma and it reads as a standard post-delivery invoice.
- "none" when invoiceDelivered is false. NEVER return a non-"none" value when invoiceDelivered is false.

When genuinely ambiguous (no proforma/final keywords, no pre/post-payment context) default to "final" — a standard invoice is the common case.

The "evidence" field MUST be a short literal substring from the inbound that proves invoiceDelivered=true. Do not paraphrase, do not translate. If invoiceDelivered is false, evidence must be "" and invoiceType must be "none".`;
async function loadSystemPrompt() {
    try {
        const row = await db.linkAgentConfig.findUnique({
            where: { id: "singleton" },
            select: { paymentDetectorPrompt: true },
        });
        return row?.paymentDetectorPrompt ?? DEFAULT_PAYMENT_DETECTOR_PROMPT;
    }
    catch {
        return DEFAULT_PAYMENT_DETECTOR_PROMPT;
    }
}
function isValidResponse(raw) {
    if (typeof raw !== "object" || raw === null)
        return false;
    const r = raw;
    const invoiceTypeOk = r.invoiceType === "none" ||
        r.invoiceType === "proforma" ||
        r.invoiceType === "final";
    return (typeof r.invoiceDelivered === "boolean" &&
        typeof r.evidence === "string" &&
        invoiceTypeOk);
}
export async function detectPaymentTransition(input) {
    const startMs = Date.now();
    const [runtimeConfig, systemPrompt] = await Promise.all([
        getLinkAgentRuntimeConfig(),
        loadSystemPrompt(),
    ]);
    const model = runtimeConfig.negotiationModel;
    const userContent = `SUBJECT: ${input.inboundSubject}\n\nINBOUND:\n${input.inboundBody}`;
    let text;
    try {
        text = await callAIGateway(userContent, {
            model,
            system: systemPrompt,
            temperature: 0,
            maxTokens: 200,
            responseFormat: PAYMENT_DETECTION_RESPONSE_FORMAT,
        });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[link-agent:payment-detector] GATEWAY_ERROR domain=${input.prospectDomain} msg=${JSON.stringify(msg)}`);
        return { invoiceClassification: null, paymentTransition: null, model, durationMs: Date.now() - startMs };
    }
    let raw;
    try {
        raw = parseGatewayJSON(text);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[link-agent:payment-detector] PARSE_FAILURE domain=${input.prospectDomain} msg=${JSON.stringify(msg)} preview=${JSON.stringify(text.slice(0, 200))}`);
        return { invoiceClassification: null, paymentTransition: null, model, durationMs: Date.now() - startMs };
    }
    if (!isValidResponse(raw)) {
        console.warn(`[link-agent:payment-detector] SHAPE_MISMATCH domain=${input.prospectDomain} keys=${JSON.stringify(Object.keys(raw ?? {}))}`);
        return { invoiceClassification: null, paymentTransition: null, model, durationMs: Date.now() - startMs };
    }
    const durationMs = Date.now() - startMs;
    // Log EVERY decision so we can audit misclassifications after the fact.
    // "not delivered" is the common case — we still log a compact one-liner
    // with a truncated inbound preview so we can grep for missed invoices.
    const preview = input.inboundBody.replace(/\s+/g, " ").trim().slice(0, 200);
    if (!raw.invoiceDelivered) {
        console.log(`[link-agent:payment-detector] NOT_DELIVERED domain=${input.prospectDomain} durationMs=${durationMs} preview=${JSON.stringify(preview)}`);
        return { invoiceClassification: null, paymentTransition: null, model, durationMs };
    }
    const evidence = raw.evidence.trim();
    if (evidence.length === 0) {
        console.warn(`[link-agent:payment-detector] EMPTY_EVIDENCE domain=${input.prospectDomain} — invoiceDelivered=true but no evidence, preview=${JSON.stringify(preview)}`);
        return { invoiceClassification: null, paymentTransition: null, model, durationMs };
    }
    // invoiceDelivered=true implies invoiceType must be proforma|final. If the
    // model returns "none" here it contradicts itself — default to "final" (the
    // common case) rather than drop the classification.
    const invoiceType = raw.invoiceType === "proforma" ? "proforma" : "final";
    if (raw.invoiceType === "none") {
        console.warn(`[link-agent:payment-detector] TYPE_CONTRADICTION domain=${input.prospectDomain} — invoiceDelivered=true but invoiceType=none, defaulting to final`);
    }
    console.log(`[link-agent:payment-detector] DELIVERED domain=${input.prospectDomain} type=${invoiceType} durationMs=${durationMs} evidence=${JSON.stringify(evidence.slice(0, 120))}`);
    // Finance policy: a proforma does NOT authorise payment. Stay at
    // waiting_for_invoice until a definitive (final) invoice arrives, so the
    // finance team always has the document they need to issue the transfer.
    const paymentTransition = invoiceType === "final"
        ? { nextStatus: "waiting_for_payment", evidence }
        : null;
    return {
        invoiceClassification: { invoiceType, evidence },
        paymentTransition,
        model,
        durationMs,
    };
}
//# sourceMappingURL=payment-detector.js.map