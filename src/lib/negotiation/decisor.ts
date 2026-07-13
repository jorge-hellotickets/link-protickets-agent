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

export function emptyThreadState(): ThreadState {
  return {
    countersMade: [],
    acceptedPrice: null,
    agreedDate: null,
    agreedAnchor: null,
    agreedLinkUrl: null,
    lastInboundPrice: null,
    consecutiveNoNewInfo: 0,
    terminal: false,
  };
}

export type InboundIntent =
  | "price_offer"
  | "soft_accept"
  | "rejection"
  | "logistics"
  | "question"
  | "proforma_sent"
  | "unsubscribe"
  | "bounce"
  | "other";

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

export type Action =
  | { kind: "accept"; price: number; redirectToArticle: boolean; linkAttribute: LinkAttribute }
  | { kind: "counter"; price: number; redirectToArticle: boolean; linkAttribute: LinkAttribute }
  | { kind: "decline" }
  | { kind: "stall" }
  | { kind: "logistics" }
  | { kind: "request_definitive_invoice" }
  | { kind: "ask_clarification" }
  | { kind: "terminal"; reason: "unsubscribe" | "bounce" };

export interface DecisionResult {
  action: Action;
  nextState: ThreadState;
}

const round10 = (v: number) => Math.round(v / 10) * 10;

const MAX_COUNTERS = 2;
const STALL_THRESHOLD = 2;

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
export function decide(
  state: ThreadState,
  signals: InboundSignals,
  budget: BudgetCtx,
): DecisionResult {
  const baseNext: ThreadState = {
    ...state,
    lastInboundPrice: signals.inboundPrice ?? state.lastInboundPrice,
    consecutiveNoNewInfo: signals.addedNewInfo ? 0 : state.consecutiveNoNewInfo + 1,
  };
  const redirectToArticle = signals.mentionedPlacementType === "sitewide";
  const linkAttribute = signals.linkAttribute;

  if (state.terminal) {
    return { action: { kind: "stall" }, nextState: baseNext };
  }

  if (signals.intent === "unsubscribe" || signals.intent === "bounce") {
    return {
      action: { kind: "terminal", reason: signals.intent },
      nextState: { ...baseNext, terminal: true },
    };
  }

  if (state.acceptedPrice !== null) {
    if (signals.intent === "proforma_sent") {
      return { action: { kind: "request_definitive_invoice" }, nextState: baseNext };
    }
    return { action: { kind: "logistics" }, nextState: baseNext };
  }

  if (baseNext.consecutiveNoNewInfo >= STALL_THRESHOLD) {
    return { action: { kind: "stall" }, nextState: baseNext };
  }

  if (signals.intent === "rejection") {
    return { action: { kind: "decline" }, nextState: baseNext };
  }

  const price = signals.inboundPrice;

  // No price on the table yet → answer intent, don't rush price.
  if (price === null) {
    // Extractor classified as price_offer but couldn't parse a number → ask
    // the prospect to confirm the figure rather than guess or move to
    // logistics (which would bury the price question).
    if (signals.intent === "price_offer") {
      return { action: { kind: "ask_clarification" }, nextState: baseNext };
    }
    return { action: { kind: "logistics" }, nextState: baseNext };
  }

  // Soft-accept with no objection to the price → logistics (plan rule).
  if (signals.intent === "soft_accept") {
    return {
      action: { kind: "logistics" },
      nextState: baseNext,
    };
  }

  const countersCount = state.countersMade.length;
  const alreadyCountered = (p: number) => state.countersMade.includes(p);
  const canCounter = countersCount < MAX_COUNTERS;

  const propose = (proposed: number): Action | null => {
    const safe = round10(proposed);
    if (safe > budget.hardCap) return null;        // hard cap invariant
    if (alreadyCountered(safe)) return null;        // never same price twice
    if (!canCounter) return null;
    return { kind: "counter", price: safe, redirectToArticle, linkAttribute };
  };

  // Tier 1: price <= smallGapCap → accept.
  if (price <= budget.smallGapCap) {
    return {
      action: {
        kind: "accept",
        price: round10(price),
        redirectToArticle,
        linkAttribute,
      },
      nextState: {
        ...baseNext,
        acceptedPrice: round10(price),
      },
    };
  }

  // Tier 2: smallGapCap < price <= hardCap → counter at target ONCE, then accept.
  if (price <= budget.hardCap) {
    const counter = propose(budget.targetPrice);
    if (counter) {
      return {
        action: counter,
        nextState: {
          ...baseNext,
          countersMade: [...state.countersMade, (counter as { price: number }).price],
        },
      };
    }
    return {
      action: {
        kind: "accept",
        price: round10(price),
        redirectToArticle,
        linkAttribute,
      },
      nextState: { ...baseNext, acceptedPrice: round10(price) },
    };
  }

  // Tier 3: hardCap < price <= bigGapThreshold → counter at target ONCE, else decline.
  if (price <= budget.bigGapThreshold) {
    const counter = propose(budget.targetPrice);
    if (counter) {
      return {
        action: counter,
        nextState: {
          ...baseNext,
          countersMade: [...state.countersMade, (counter as { price: number }).price],
        },
      };
    }
    return { action: { kind: "decline" }, nextState: baseNext };
  }

  // Tier 4: price > bigGapThreshold → midpoint, then target, then decline.
  const midpoint = round10((budget.targetPrice + price) / 2);
  const firstTry = propose(midpoint);
  if (firstTry) {
    return {
      action: firstTry,
      nextState: {
        ...baseNext,
        countersMade: [...state.countersMade, (firstTry as { price: number }).price],
      },
    };
  }
  const secondTry = propose(budget.targetPrice);
  if (secondTry) {
    return {
      action: secondTry,
      nextState: {
        ...baseNext,
        countersMade: [...state.countersMade, (secondTry as { price: number }).price],
      },
    };
  }
  return { action: { kind: "decline" }, nextState: baseNext };
}
