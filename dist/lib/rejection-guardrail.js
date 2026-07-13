/**
 * Deterministic rejection guardrail — runs before the LLM sees an inbound.
 *
 * Purpose: some inbound messages are unambiguous rejections ("we don't do
 * collaborations", "please unsubscribe"). Letting the LLM decide on these is
 * both wasteful and risky: the April 2026 molaviajar incident showed that a
 * single content-extraction failure can flip a clear rejection into a
 * follow-up. When the signal is obvious, stop early and save the prospect
 * from getting spammed.
 *
 * Must be called on a dequoted, footer-stripped body (see
 * `extractLatestInboundBody` in agentmail.ts). Running on raw `text` would
 * match our own outbound unsubscribe footer that the prospect quotes back.
 */
const PATTERNS = [
    // ─── Spanish ───
    // "no (estamos|están|hacemos) (realizando) colaboraciones"
    /no\s+(est(amos|án)|hacemos|aceptamos|realizamos)\s+(\w+\s+){0,3}colaboraci[oó]n/i,
    // "no nos interesa la colaboración/propuesta/oferta"
    /no\s+(me|nos)\s+interesa\s+(la\s+|su\s+|vuestra\s+|tu\s+)?(colaboraci[oó]n|propuesta|oferta|enlace)/i,
    // "no me escriban/mandes más"
    /no\s+(me|nos)\s+(escrib|mand|contact)\w+\s+m[aá]s/i,
    // "dejen/deja de escribir"
    /deja?(d|n)?\s+de\s+(escribir|mandar|contactar)/i,
    // "dar(me|nos) de baja" or imperative "da(me|nos) de baja" — standalone
    // "baja" token is too risky (appears in our own footer quoted back), so
    // require the verb-phrase context.
    /\b(dar?)(me|nos|le|lo)\s+de\s+baja\b/i,
    // ─── English ───
    // "we don't/do not do (any) link/content/collaborations"
    /\bwe\s+(don'?t|do\s+not)\s+(do|accept|offer|take|engage\s+in)\s+(any\s+)?(link|content|paid|sponsored|collaboration|guest|backlink)/i,
    // "not interested in this/the/your collaboration/offer/link"
    /\bnot\s+interested\s+in\s+(this|the|your|any)\s+(collaboration|proposal|offer|link|content|partnership)/i,
    // "please unsubscribe" / "unsubscribe me"
    /\b(please\s+)?unsubscribe\s+(me|us)/i,
    // "stop contacting/emailing/writing (me|us)"
    /\bstop\s+(contact|email|writ|messag)\w*\s+(me|us)/i,
    // "remove me/us from your list"
    /\bremove\s+(me|us)\s+from\s+(your\s+)?(list|mailing)/i,
];
// If the body contains explicit pricing signals, it is negotiation, not
// rejection. Price talk overrides the guardrail — we must let the LLM decide.
const PRICING_SIGNALS = [
    /(€|\$|£|USD|EUR|GBP)\s*\d/,
    /\d+\s*(€|\$|£|USD|EUR|GBP)/,
    /\b(precio|tarifa|coste|cuesta|cobramos|cobra|cotizamos|nuestra\s+tarifa)\b/i,
    /\b(price|cost|fee|rate|quote|charge|pricing)\b/i,
];
/**
 * Check whether a dequoted inbound body is an unambiguous rejection.
 * The body MUST already be stripped of quoted replies and our own footer.
 */
export function detectRejection(dequotedBody) {
    if (!dequotedBody || dequotedBody.length === 0) {
        return { rejected: false };
    }
    // Prospect is quoting pricing — treat as negotiation, let the LLM decide.
    for (const p of PRICING_SIGNALS) {
        if (p.test(dequotedBody))
            return { rejected: false };
    }
    for (const pattern of PATTERNS) {
        const match = dequotedBody.match(pattern);
        if (match) {
            const start = Math.max(0, (match.index ?? 0) - 20);
            const end = Math.min(dequotedBody.length, (match.index ?? 0) + match[0].length + 40);
            return {
                rejected: true,
                matchedPattern: pattern.source,
                matchedSnippet: dequotedBody.slice(start, end).trim(),
            };
        }
    }
    return { rejected: false };
}
//# sourceMappingURL=rejection-guardrail.js.map