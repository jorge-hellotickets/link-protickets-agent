import type { NegotiationState } from "./negotiation/types";
export declare function initState(sentAt: Date): NegotiationState;
export declare function onInbound(state: NegotiationState, at: Date): NegotiationState;
export declare function onOutbound(state: NegotiationState, at: Date): NegotiationState;
export type FollowUpKind = "follow_up" | "breakup";
/**
 * Compute next follow-up. Returns null if max follow-ups reached.
 * Cold (status=contacted): 3 touchpoints at day 4, 11, 24
 * Active (status=negotiating): nudge after 5 biz days, max 2
 */
export declare function nextFollowUp(status: string, state: NegotiationState, timezone: string): {
    kind: FollowUpKind;
    sendNotBefore: Date;
} | null;
//# sourceMappingURL=negotiation-state.d.ts.map