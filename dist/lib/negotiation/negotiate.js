import { callAIGateway, parseGatewayJSON } from "../ai/gateway";
import { getLinkAgentRuntimeConfig } from "../runtime-config";
import { getLocaleConfig } from "../locale-config";
import { db } from "../db-stub";
import { DEFAULT_NEGOTIATION_PROMPT, renderPrompt, } from "./prompt-template";
const BRAND_ANCHOR_FALLBACK = "Protickets.com";
const NEGOTIATION_RESPONSE_FORMAT = {
    name: "LinkAgentNegotiationResponse",
    strict: true,
    schema: {
        type: "object",
        additionalProperties: false,
        properties: {
            reasoning: { type: "string" },
            terminal: { type: "boolean" },
            subject: {
                anyOf: [{ type: "string" }, { type: "null" }],
            },
            body: {
                anyOf: [{ type: "string" }, { type: "null" }],
            },
            deal: {
                anyOf: [
                    {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                            priceCents: { type: "integer" },
                            date: { type: "string" },
                            linkUrl: {
                                anyOf: [{ type: "string" }, { type: "null" }],
                            },
                            anchorText: { type: "string" },
                            placementType: { type: "string" },
                            placementSurface: {
                                anyOf: [{ type: "string" }, { type: "null" }],
                            },
                        },
                        required: [
                            "priceCents",
                            "date",
                            "linkUrl",
                            "anchorText",
                            "placementType",
                            "placementSurface",
                        ],
                    },
                    { type: "null" },
                ],
            },
        },
        required: ["reasoning", "terminal", "subject", "body", "deal"],
    },
};
function sanitizeLinkUrl(rawLinkUrl, prospectDomain) {
    if (!rawLinkUrl)
        return null;
    const trimmed = rawLinkUrl.trim();
    if (!trimmed)
        return null;
    let parsed;
    try {
        parsed = new URL(trimmed);
    }
    catch {
        return null;
    }
    const host = parsed.host.toLowerCase();
    // The model sometimes echoes our target URL as linkUrl. linkUrl must be on
    // the PROSPECT's site (where the paid anchor will live), not ours. Anything
    // on protickets.com or hellotickets.com is a model mistake — drop it so the
    // post-publication audit isn't aimed at our own site.
    if (/(^|\.)protickets\.com$/i.test(host))
        return null;
    if (/(^|\.)hellotickets\.com$/i.test(host))
        return null;
    // Also require the URL to live on the prospect's own domain. Strip `www.`
    // on both sides for loose comparison.
    const strip = (h) => h.replace(/^www\./, "");
    if (strip(host) !== strip(prospectDomain.toLowerCase()))
        return null;
    return trimmed;
}
function logFailure(tag, domain, extra) {
    const suffix = extra ? ` ${extra}` : "";
    console.warn(`[link-agent:negotiate] ${tag} domain=${domain}${suffix}`);
}
function normalizeAnchor(value) {
    return value.trim().toLowerCase().replace(/\s+/g, " ");
}
function isValidLLMResponse(raw) {
    if (typeof raw !== "object" || raw === null)
        return false;
    const r = raw;
    const subjectOk = r.subject === null || typeof r.subject === "string";
    const bodyOk = r.body === null || typeof r.body === "string";
    const terminalOk = typeof r.terminal === "boolean";
    const reasoningOk = typeof r.reasoning === "string";
    const dealOk = r.deal === null ||
        r.deal === undefined ||
        (typeof r.deal === "object" && r.deal !== null);
    return subjectOk && bodyOk && terminalOk && reasoningOk && dealOk;
}
/**
 * True when the anchor text matches one of the target keyword chunks verbatim
 * (case-insensitive, whitespace-normalized). The prompt bans exact-match SEO
 * anchors, but the model occasionally returns them. Enforced server-side so
 * the rule does not rely on prompt compliance alone.
 */
function isExactMatchKeyword(anchor, targetKeywords) {
    const normalized = normalizeAnchor(anchor);
    if (!normalized)
        return false;
    return targetKeywords
        .split(",")
        .map((kw) => normalizeAnchor(kw))
        .filter((kw) => kw.length > 0)
        .some((kw) => kw === normalized);
}
async function loadPromptTemplate() {
    try {
        const row = await db.linkAgentConfig.findUnique({
            where: { id: "singleton" },
            select: { systemPrompt: true },
        });
        return row?.systemPrompt ?? DEFAULT_NEGOTIATION_PROMPT;
    }
    catch {
        return DEFAULT_NEGOTIATION_PROMPT;
    }
}
export async function negotiate(input) {
    const startMs = Date.now();
    const locale = getLocaleConfig(input.locale);
    const roundToTens = (value) => Math.round(value / 10) * 10;
    const targetPrice = roundToTens(input.maxPriceCents / 100);
    const hardCap = roundToTens((input.maxPriceCents * 1.5) / 100);
    const midpoint = roundToTens((targetPrice + hardCap) / 2);
    const smallGapCap = roundToTens((input.maxPriceCents * 1.1) / 100);
    const bigGapThreshold = roundToTens((input.maxPriceCents * 1.8) / 100);
    const headroom = input.headroomCents / 100;
    const fullTargetUrl = `https://www.protickets.com${input.targetUrl}`;
    const todayDate = new Date();
    const today = todayDate.toISOString().slice(0, 10);
    const todayDayOfWeek = todayDate.toLocaleDateString("en-US", { weekday: "long" });
    const [template, runtimeConfig] = await Promise.all([
        input.promptOverride
            ? Promise.resolve(input.promptOverride)
            : loadPromptTemplate(),
        getLinkAgentRuntimeConfig(),
    ]);
    const systemPrompt = renderPrompt(template, {
        prospectDomain: input.prospectDomain,
        targetKeywords: input.targetKeywords,
        targetUrl: fullTargetUrl,
        round: input.round,
        today,
        todayDayOfWeek,
        targetPrice,
        hardCap,
        midpoint,
        smallGapCap,
        bigGapThreshold,
        headroom,
        headroomWarning: headroom < targetPrice
            ? " — low: if a deal closes, suggest scheduling publication for next month"
            : "",
        currency: locale.currency,
        emailHistory: input.emailHistory,
        inboundBody: input.inboundBody,
        localeSettings: locale.localeSettings,
        closingExamples: locale.closingExamples,
        // `anchorType` is kept rendered-blank for admin-overridden templates that
        // still reference {{anchorType}}; the default template no longer uses it
        // (the model picks brand vs descriptive from context).
        anchorType: "",
    });
    const userContent = `EMAIL THREAD (oldest first):\n${input.emailHistory}\n\nLATEST INBOUND:\n${input.inboundBody}`;
    const model = runtimeConfig.negotiationModel;
    let text;
    try {
        text = await callAIGateway(userContent, {
            model,
            system: systemPrompt,
            temperature: 0.4,
            maxTokens: 1200,
            // Request schema-valid JSON. Runtime checks below stay as belt and
            // suspenders because gateway/provider support can still vary by model.
            responseFormat: NEGOTIATION_RESPONSE_FORMAT,
        });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logFailure("GATEWAY_ERROR", input.prospectDomain, `msg=${JSON.stringify(msg)}`);
        throw err;
    }
    let raw;
    try {
        raw = parseGatewayJSON(text);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logFailure("PARSE_FAILURE", input.prospectDomain, `msg=${JSON.stringify(msg)} preview=${JSON.stringify(text.slice(0, 200))}`);
        throw err;
    }
    if (!isValidLLMResponse(raw)) {
        logFailure("SHAPE_MISMATCH", input.prospectDomain, `keys=${JSON.stringify(Object.keys(raw ?? {}))}`);
        throw new Error("LLM response missing required fields");
    }
    const durationMs = Date.now() - startMs;
    // Guard: if deal price exceeds hard cap (1.5× target), don't send
    if (raw.deal && raw.deal.priceCents > Math.round(input.maxPriceCents * 1.5)) {
        logFailure("PRICE_CAP_VIOLATION", input.prospectDomain, `proposed=${raw.deal.priceCents} cap=${Math.round(input.maxPriceCents * 1.5)}`);
        return { replySubject: null, replyBody: null, terminal: false, deal: null, reasoning: "price exceeds max", model, durationMs };
    }
    const terminal = raw.terminal === true;
    let deal = null;
    if (raw.deal) {
        const parsedDate = new Date(raw.deal.date);
        if (isNaN(parsedDate.getTime())) {
            logFailure("INVALID_DEAL_DATE", input.prospectDomain, `raw=${JSON.stringify(raw.deal.date)}`);
            return { replySubject: null, replyBody: null, terminal: false, deal: null, reasoning: "invalid deal date", model, durationMs };
        }
        const rawAnchor = raw.deal.anchorText?.trim();
        let anchorText;
        if (!rawAnchor) {
            logFailure("MISSING_ANCHOR", input.prospectDomain);
            anchorText = BRAND_ANCHOR_FALLBACK;
        }
        else if (isExactMatchKeyword(rawAnchor, input.targetKeywords)) {
            logFailure("EXACT_MATCH_ANCHOR", input.prospectDomain, `anchor=${JSON.stringify(rawAnchor)}`);
            anchorText = BRAND_ANCHOR_FALLBACK;
        }
        else {
            anchorText = rawAnchor;
        }
        const sanitizedLinkUrl = sanitizeLinkUrl(raw.deal.linkUrl, input.prospectDomain);
        if (raw.deal.linkUrl && !sanitizedLinkUrl) {
            logFailure("LINK_URL_IS_TARGET", input.prospectDomain, `raw=${JSON.stringify(raw.deal.linkUrl)}`);
        }
        deal = {
            agreedPriceCents: raw.deal.priceCents,
            agreedDate: parsedDate,
            linkUrl: sanitizedLinkUrl,
            anchorText,
            placementCategory: raw.deal.placementType ?? "article",
            placementSurfaceRaw: raw.deal.placementSurface ?? null,
        };
    }
    return { replySubject: raw.subject, replyBody: raw.body, terminal, deal, reasoning: raw.reasoning, model, durationMs };
}
//# sourceMappingURL=negotiate.js.map