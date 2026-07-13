// ─── Flat Negotiation State (replaces V1/V2/V3) ───

import type { ThreadState } from "./decisor";

export interface NegotiationState {
  /** Follow-up worker fields */
  silenceFollowUpCount: number;
  followUpNotBeforeAt?: string;     // ISO datetime
  firstOutboundAt?: string;         // ISO datetime — when first email was sent (for cold follow-up timing)
  agentmailDraft?: { draftId: string; kind: "follow-up" | "breakup"; sendAt?: string };
  /** Timestamps for timing */
  lastInboundAt?: string;
  lastOutboundAt?: string;
  /**
   * Post-deal: true when the prospect has sent a proforma (payment-commitment
   * invoice) but not the final/definitive invoice yet. Set by the payment
   * detector on proforma detection, cleared on final detection. Used by the
   * post-deal prompt to know whether to chase the final invoice after payment.
   */
  finalInvoicePending?: boolean;

  /**
   * Split-negotiation state (see docs/link-agent/plan-split-negotiate.md).
   * Only populated when the split negotiator runs. Absent on legacy rows and
   * on threads still handled by the monolithic negotiator — the decisor
   * treats missing fields as fresh (empty countersMade, no acceptedPrice).
   */
  thread?: ThreadState;
}

/**
 * Migrate legacy V1/V2/V3 rows to the flat NegotiationState on read.
 * No DB migration needed — old rows are normalized on first access,
 * new rows are written in the flat format.
 *
 * @param raw - The raw JSON from the database (could be V1, V2, V3, or flat)
 * @param prospectCreatedAt - Fallback for firstOutboundAt on legacy rows
 */
export function normalizeState(raw: unknown, prospectCreatedAt?: string): NegotiationState {
  if (!raw || typeof raw !== "object") {
    return { silenceFollowUpCount: 0 };
  }
  const obj = raw as Record<string, unknown>;
  return {
    silenceFollowUpCount: (obj.silenceFollowUpCount as number) ?? 0,
    followUpNotBeforeAt: obj.followUpNotBeforeAt as string | undefined,
    // For legacy rows, firstOutboundAt doesn't exist. Fall back to
    // prospect.createdAt (passed by caller) — close enough for cold timing.
    // Do NOT use lastOutboundAt — it shifts on every follow-up send.
    firstOutboundAt: (obj.firstOutboundAt as string | undefined) ?? prospectCreatedAt,
    agentmailDraft: obj.agentmailDraft as NegotiationState["agentmailDraft"],
    lastInboundAt: obj.lastInboundAt as string | undefined,
    lastOutboundAt: obj.lastOutboundAt as string | undefined,
    finalInvoicePending: obj.finalInvoicePending as boolean | undefined,
    thread: normalizeThread(obj.thread),
  };
}

function normalizeThread(raw: unknown): NegotiationState["thread"] {
  if (!raw || typeof raw !== "object") return undefined;
  const t = raw as Record<string, unknown>;
  const countersMade = Array.isArray(t.countersMade)
    ? (t.countersMade as unknown[]).filter((v): v is number => typeof v === "number")
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
