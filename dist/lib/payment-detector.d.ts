export declare const DEFAULT_PAYMENT_DETECTOR_PROMPT = "You classify a single inbound email and decide whether the prospect is delivering an invoice RIGHT NOW, and if so, what kind of invoice.\n\nThe conversation already reached a closed deal. Two independent questions:\n  1. Is an invoice being delivered in THIS message? (invoiceDelivered)\n  2. If so, is it a proforma (pro-forma / pre-payment / quote-style) or the final (definitive / post-payment) invoice? (invoiceType)\n\nOutput strict JSON:\n{\n  \"invoiceDelivered\": boolean,\n  \"invoiceType\": \"none\" | \"proforma\" | \"final\",\n  \"evidence\": string        // short LITERAL quote copied verbatim from the inbound. Empty string if invoiceDelivered is false.\n}\n\ninvoiceDelivered = true ONLY when the inbound is actually delivering an invoice:\n- Prospect attaches an invoice file (and mentions it in the text).\n- Prospect pastes an invoice/factura with an invoice number or line items / totals.\n- Prospect writes a sentence clearly stating they are sending it now (\"te adjunto la factura\", \"here is the invoice\", \"aqu\u00ED va la factura\", \"attached you will find the invoice\", \"adjunto factura\", \"env\u00EDo factura\", \"te adjunto la factura proforma\").\n\ninvoiceDelivered = false in every other case, including:\n- Promises: \"te la mandar\u00E9 pronto\", \"I'll send it next week\", \"la enviamos tras publicaci\u00F3n\".\n- Requests for our invoicing data: \"can you send me your invoicing details\", \"\u00BFcu\u00E1l es tu NIF?\".\n- Announcements about how they invoice without delivering: \"we'll invoice you after publication\", \"solemos facturar a 30 d\u00EDas\".\n- Any inbound not about the invoice at all (publication date, link check, thank-yous, etc.).\n\ninvoiceType classification rules:\n- \"proforma\" when the inbound explicitly calls the document a proforma / pro-forma / pro forma / factura proforma / presupuesto / quote / provisional, OR the inbound describes a pre-payment workflow where this document is a payment commitment and a \"final\" / \"definitiva\" invoice will follow after payment (\"te adjunto la factura proforma para que la abones, cuando se haga la transferencia te paso la factura final\").\n- \"final\" when the inbound calls the document the final/definitive/official invoice, OR the deal is already paid and they are now sending the receipt-style invoice, OR nothing in the message signals proforma and it reads as a standard post-delivery invoice.\n- \"none\" when invoiceDelivered is false. NEVER return a non-\"none\" value when invoiceDelivered is false.\n\nWhen genuinely ambiguous (no proforma/final keywords, no pre/post-payment context) default to \"final\" \u2014 a standard invoice is the common case.\n\nThe \"evidence\" field MUST be a short literal substring from the inbound that proves invoiceDelivered=true. Do not paraphrase, do not translate. If invoiceDelivered is false, evidence must be \"\" and invoiceType must be \"none\".";
export interface DetectPaymentInput {
    prospectDomain: string;
    inboundBody: string;
    inboundSubject: string;
}
export type PaymentNextStatus = "waiting_for_payment";
export type InvoiceType = "none" | "proforma" | "final";
export interface DetectPaymentResult {
    /**
     * Populated whenever an invoice (proforma or final) was delivered in this
     * inbound. Use this to drive content decisions (e.g. ask the prospect for
     * the definitive invoice if a proforma arrived).
     */
    invoiceClassification: {
        invoiceType: Exclude<InvoiceType, "none">;
        evidence: string;
    } | null;
    /**
     * Only populated when invoiceType === "final". Finance requires the
     * definitive invoice before issuing payment, so a proforma does NOT move
     * the prospect out of waiting_for_invoice — Laura is expected to request
     * the final invoice first.
     */
    paymentTransition: {
        nextStatus: PaymentNextStatus;
        evidence: string;
    } | null;
    model: string;
    durationMs: number;
}
export declare function detectPaymentTransition(input: DetectPaymentInput): Promise<DetectPaymentResult>;
//# sourceMappingURL=payment-detector.d.ts.map