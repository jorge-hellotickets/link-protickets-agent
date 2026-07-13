import { addBusinessDays } from "./timing";
import type { NegotiationState } from "./negotiation/types";

// Cold follow-up: day 4, day 11, day 24 (breakup)
const COLD_FOLLOW_UP_DAYS = [4, 11, 24];

export function initState(sentAt: Date): NegotiationState {
  return {
    silenceFollowUpCount: 0,
    firstOutboundAt: sentAt.toISOString(),
    lastOutboundAt: sentAt.toISOString(),
    followUpNotBeforeAt: new Date(sentAt.getTime() + COLD_FOLLOW_UP_DAYS[0] * 86_400_000).toISOString(),
  };
}

export function onInbound(state: NegotiationState, at: Date): NegotiationState {
  return {
    ...state,
    lastInboundAt: at.toISOString(),
    silenceFollowUpCount: 0,
    followUpNotBeforeAt: undefined,
    agentmailDraft: undefined,
  };
}

export function onOutbound(state: NegotiationState, at: Date): NegotiationState {
  return {
    ...state,
    lastOutboundAt: at.toISOString(),
    agentmailDraft: undefined,
  };
}

export type FollowUpKind = "follow_up" | "breakup";

/**
 * Compute next follow-up. Returns null if max follow-ups reached.
 * Cold (status=contacted): 3 touchpoints at day 4, 11, 24
 * Active (status=negotiating): nudge after 5 biz days, max 2
 */
export function nextFollowUp(
  status: string,
  state: NegotiationState,
  timezone: string,
): { kind: FollowUpKind; sendNotBefore: Date } | null {
  const count = state.silenceFollowUpCount;

  if (status === "contacted") {
    // Cold sequence — days relative to first outreach email
    if (count >= COLD_FOLLOW_UP_DAYS.length) return null;
    const firstSent = state.firstOutboundAt ? new Date(state.firstOutboundAt) : new Date();
    const days = COLD_FOLLOW_UP_DAYS[count];
    const sendAt = new Date(firstSent.getTime() + days * 86_400_000);
    const kind: FollowUpKind = count === COLD_FOLLOW_UP_DAYS.length - 1 ? "breakup" : "follow_up";
    return { kind, sendNotBefore: sendAt };
  }

  if (status === "negotiating") {
    // Active: max 2 follow-ups, 5 biz days apart
    if (count >= 2) return null;
    const baseDate = state.lastOutboundAt ? new Date(state.lastOutboundAt) : new Date();
    const sendAt = addBusinessDays(baseDate, 5, timezone);
    const kind: FollowUpKind = count === 1 ? "breakup" : "follow_up";
    return { kind, sendNotBefore: sendAt };
  }

  return null;
}
