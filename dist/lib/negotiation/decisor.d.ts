/**
 * Pure decision function for negotiation. Reads `ThreadState` + extracted
 * `InboundSignals`, returns the next `Action` + updated state. No LLM, no
 * I/O — fully deterministic and unit-testable.
 *
 * This is step B of docs/link-agent/plan-split-negotiate.md. The extractor
 * (LLM) feeds this, and the redactor (LLM) consumes the resulting action.
 *
 * Scope: **pre-deal.** The split pipeline is only invoked while the prospect
 * status is still in negotiation. Once a deal closes and status flips to
 * waiting_for_invoice / waiting_for_payment, `process-inbound.ts` routes to
 * `composePostDealReply` and this decisor is not called. The post-deal
 * branches below (acceptedPrice !== null, request_definitive_invoice) exist
 * as a safety net for the rare turn that arrives before the status flip.
 */
export interface ThreadState {
    /** Prices (in € units, already rounded to tens) that WE have countered at, in order. */
    countersMade: number[];
    /** € units, set once a deal closes. */
    acceptedPrice: number | null;
    /** ISO date (YYYY-MM-DD). */
    agreedDate: string | null;
    agreedAnchor: string | null;
    agreedLinkUrl: string | null;
    /** € units. Last price the prospect named. */
    lastInboundPrice: number | null;
    /** How many consecutive inbounds added no new info (for stall rule). */
    consecutiveNoNewInfo: number;
    /** True once the conversation should never be re-opened. */
    terminal: boolean;
}
export declare function emptyThreadState(): ThreadState;
export type InboundIntent = "price_offer" | "soft_accept" | "rejection" | "logistics" | "question" | "proforma_sent" | "unsubscribe" | "bounce" | "other";
export interface InboundSignals {
    /** € units, or null if none detected. Extractor resolves "unos 200" → 200. */
    inboundPrice: number | null;
    intent: InboundIntent;
    addedNewInfo: boolean;
    askedQuestions: string[];
    assumedWeWriteArticle: boolean;
    mentionedPlacementType: "article" | "sitewide" | "homepage" | "dedicated" | "unknown";
    /**
     * Link rel attribute named by the prospect. "unknown" when not mentioned.
     * Propagated through Action to the redactor so the close mentions the rel
     * attribute the prospect named. Discount logic for nofollow is deferred.
     */
    linkAttribute: "dofollow" | "nofollow" | "unknown";
}
export interface BudgetCtx {
    /** All values in € units, already rounded to tens. */
    targetPrice: number;
    hardCap: number;
    smallGapCap: number;
    bigGapThreshold: number;
}
export type LinkAttribute = "dofollow" | "nofollow" | "unknown";
export type Action = {
    kind: "accept";
    price: number;
    redirectToArticle: boolean;
    linkAttribute: LinkAttribute;
} | {
    kind: "counter";
    price: number;
    redirectToArticle: boolean;
    linkAttribute: LinkAttribute;
} | {
    kind: "decline";
} | {
    kind: "stall";
} | {
    kind: "logistics";
} | {
    kind: "request_definitive_invoice";
} | {
    kind: "ask_clarification";
} | {
    kind: "terminal";
    reason: "unsubscribe" | "bounce";
};
export interface DecisionResult {
    action: Action;
    nextState: ThreadState;
}
/**
 * Decide next action given current state, extracted signals, and budget.
 *
 * Ordering of rules matters:
 *  1. Already terminal → stall (no-op, should not be called, belt-and-braces).
 *  2. Hard terminals from signals (unsubscribe/bounce).
 *  3. Post-deal flows (acceptedPrice !== null): proforma → request invoice,
 *     everything else → logistics (never reopen price).
 *  4. Stall rule: consecutiveNoNewInfo >= 2 → stall.
 *  5. Pricing table driven by inboundPrice + countersMade.
 *  6. Fallback to logistics when no price decision is needed.
 */
export declare function decide(state: ThreadState, signals: InboundSignals, budget: BudgetCtx): DecisionResult;
//# sourceMappingURL=decisor.d.ts.map