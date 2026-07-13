// ─── Flat Negotiation State (replaces V1/V2/V3) ───
/**
 * Migrate legacy V1/V2/V3 rows to the flat NegotiationState on read.
 * No DB migration needed — old rows are normalized on first access,
 * new rows are written in the flat format.
 *
 * @param raw - The raw JSON from the database (could be V1, V2, V3, or flat)
 * @param prospectCreatedAt - Fallback for firstOutboundAt on legacy rows
 */
export function normalizeState(raw, prospectCreatedAt) {
    if (!raw || typeof raw !== "object") {
        return { silenceFollowUpCount: 0 };
    }
    const obj = raw;
    return {
        silenceFollowUpCount: obj.silenceFollowUpCount ?? 0,
        followUpNotBeforeAt: obj.followUpNotBeforeAt,
        // For legacy rows, firstOutboundAt doesn't exist. Fall back to
        // prospect.createdAt (passed by caller) — close enough for cold timing.
        // Do NOT use lastOutboundAt — it shifts on every follow-up send.
        firstOutboundAt: obj.firstOutboundAt ?? prospectCreatedAt,
        agentmailDraft: obj.agentmailDraft,
        lastInboundAt: obj.lastInboundAt,
        lastOutboundAt: obj.lastOutboundAt,
        finalInvoicePending: obj.finalInvoicePending,
        thread: normalizeThread(obj.thread),
    };
}
function normalizeThread(raw) {
    if (!raw || typeof raw !== "object")
        return undefined;
    const t = raw;
    const countersMade = Array.isArray(t.countersMade)
        ? t.countersMade.filter((v) => typeof v === "number")
        : [];
    return {
        countersMade,
        acceptedPrice: typeof t.acceptedPrice === "number" ? t.acceptedPrice : null,
        agreedDate: typeof t.agreedDate === "string" ? t.agreedDate : null,
        agreedAnchor: typeof t.agreedAnchor === "string" ? t.agreedAnchor : null,
        agreedLinkUrl: typeof t.agreedLinkUrl === "string" ? t.agreedLinkUrl : null,
        lastInboundPrice: typeof t.lastInboundPrice === "number" ? t.lastInboundPrice : null,
        consecutiveNoNewInfo: typeof t.consecutiveNoNewInfo === "number" ? t.consecutiveNoNewInfo : 0,
        terminal: t.terminal === true,
    };
}
//# sourceMappingURL=types.js.map