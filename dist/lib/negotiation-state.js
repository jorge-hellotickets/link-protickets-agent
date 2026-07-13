import { addBusinessDays } from "./timing";
// Cold follow-up: day 4, day 11, day 24 (breakup)
const COLD_FOLLOW_UP_DAYS = [4, 11, 24];
export function initState(sentAt) {
    return {
        silenceFollowUpCount: 0,
        firstOutboundAt: sentAt.toISOString(),
        lastOutboundAt: sentAt.toISOString(),
        followUpNotBeforeAt: new Date(sentAt.getTime() + COLD_FOLLOW_UP_DAYS[0] * 86_400_000).toISOString(),
    };
}
export function onInbound(state, at) {
    return {
        ...state,
        lastInboundAt: at.toISOString(),
        silenceFollowUpCount: 0,
        followUpNotBeforeAt: undefined,
        agentmailDraft: undefined,
    };
}
export function onOutbound(state, at) {
    return {
        ...state,
        lastOutboundAt: at.toISOString(),
        agentmailDraft: undefined,
    };
}
/**
 * Compute next follow-up. Returns null if max follow-ups reached.
 * Cold (status=contacted): 3 touchpoints at day 4, 11, 24
 * Active (status=negotiating): nudge after 5 biz days, max 2
 */
export function nextFollowUp(status, state, timezone) {
    const count = state.silenceFollowUpCount;
    if (status === "contacted") {
        // Cold sequence — days relative to first outreach email
        if (count >= COLD_FOLLOW_UP_DAYS.length)
            return null;
        const firstSent = state.firstOutboundAt ? new Date(state.firstOutboundAt) : new Date();
        const days = COLD_FOLLOW_UP_DAYS[count];
        const sendAt = new Date(firstSent.getTime() + days * 86_400_000);
        const kind = count === COLD_FOLLOW_UP_DAYS.length - 1 ? "breakup" : "follow_up";
        return { kind, sendNotBefore: sendAt };
    }
    if (status === "negotiating") {
        // Active: max 2 follow-ups, 5 biz days apart
        if (count >= 2)
            return null;
        const baseDate = state.lastOutboundAt ? new Date(state.lastOutboundAt) : new Date();
        const sendAt = addBusinessDays(baseDate, 5, timezone);
        const kind = count === 1 ? "breakup" : "follow_up";
        return { kind, sendNotBefore: sendAt };
    }
    return null;
}
//# sourceMappingURL=negotiation-state.js.map