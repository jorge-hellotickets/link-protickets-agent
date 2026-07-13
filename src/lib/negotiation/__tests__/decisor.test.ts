import { describe, it, expect } from "vitest";
import {
  decide,
  emptyThreadState,
  type BudgetCtx,
  type InboundSignals,
  type ThreadState,
} from "../decisor";

// maxPriceCents = 20000 → target 200, smallGapCap 220, hardCap 300, bigGap 360
const BUDGET: BudgetCtx = {
  targetPrice: 200,
  smallGapCap: 220,
  hardCap: 300,
  bigGapThreshold: 360,
};

function sig(overrides: Partial<InboundSignals> = {}): InboundSignals {
  return {
    inboundPrice: null,
    intent: "other",
    addedNewInfo: true,
    askedQuestions: [],
    assumedWeWriteArticle: false,
    mentionedPlacementType: "unknown",
    linkAttribute: "unknown",
    ...overrides,
  };
}

function state(overrides: Partial<ThreadState> = {}): ThreadState {
  return { ...emptyThreadState(), ...overrides };
}

describe("decisor — terminal intents", () => {
  it("unsubscribe → terminal + marks state terminal", () => {
    const { action, nextState } = decide(state(), sig({ intent: "unsubscribe" }), BUDGET);
    expect(action).toEqual({ kind: "terminal", reason: "unsubscribe" });
    expect(nextState.terminal).toBe(true);
  });

  it("bounce → terminal", () => {
    const { action } = decide(state(), sig({ intent: "bounce" }), BUDGET);
    expect(action).toEqual({ kind: "terminal", reason: "bounce" });
  });

  it("already-terminal state → stall no-op", () => {
    const { action } = decide(state({ terminal: true }), sig({ intent: "price_offer", inboundPrice: 200 }), BUDGET);
    expect(action.kind).toBe("stall");
  });
});

describe("decisor — post-deal flows", () => {
  it("proforma_sent after deal → request_definitive_invoice", () => {
    const { action } = decide(
      state({ acceptedPrice: 200 }),
      sig({ intent: "proforma_sent" }),
      BUDGET,
    );
    expect(action.kind).toBe("request_definitive_invoice");
  });

  it("price_offer after deal is ignored — logistics only (never reopen)", () => {
    const { action } = decide(
      state({ acceptedPrice: 200 }),
      sig({ intent: "price_offer", inboundPrice: 500 }),
      BUDGET,
    );
    expect(action.kind).toBe("logistics");
  });

  it("question after deal → logistics", () => {
    const { action } = decide(
      state({ acceptedPrice: 200 }),
      sig({ intent: "question" }),
      BUDGET,
    );
    expect(action.kind).toBe("logistics");
  });
});

describe("decisor — stall rule", () => {
  it("consecutiveNoNewInfo reaches threshold → stall", () => {
    const { action } = decide(
      state({ consecutiveNoNewInfo: 1 }),
      sig({ addedNewInfo: false, intent: "other" }),
      BUDGET,
    );
    expect(action.kind).toBe("stall");
  });

  it("addedNewInfo resets the counter", () => {
    const { nextState } = decide(
      state({ consecutiveNoNewInfo: 1 }),
      sig({ addedNewInfo: true, intent: "logistics" }),
      BUDGET,
    );
    expect(nextState.consecutiveNoNewInfo).toBe(0);
  });
});

describe("decisor — tier 1: price ≤ smallGapCap → accept", () => {
  it("accepts at 210 (under smallGapCap)", () => {
    const { action, nextState } = decide(state(), sig({ intent: "price_offer", inboundPrice: 210 }), BUDGET);
    expect(action).toMatchObject({ kind: "accept", price: 210 });
    expect(nextState.acceptedPrice).toBe(210);
  });

  it("accepts exactly at smallGapCap", () => {
    const { action } = decide(state(), sig({ intent: "price_offer", inboundPrice: 220 }), BUDGET);
    expect(action.kind).toBe("accept");
  });

  it("rounds the accepted price to tens", () => {
    const { action } = decide(state(), sig({ intent: "price_offer", inboundPrice: 217 }), BUDGET);
    expect(action).toMatchObject({ kind: "accept", price: 220 });
  });
});

describe("decisor — tier 2: smallGapCap < price ≤ hardCap", () => {
  it("first encounter → counter at target", () => {
    const { action, nextState } = decide(state(), sig({ intent: "price_offer", inboundPrice: 280 }), BUDGET);
    expect(action).toMatchObject({ kind: "counter", price: 200 });
    expect(nextState.countersMade).toEqual([200]);
  });

  it("target already countered → accept inbound price", () => {
    const { action } = decide(
      state({ countersMade: [200] }),
      sig({ intent: "price_offer", inboundPrice: 280 }),
      BUDGET,
    );
    expect(action).toMatchObject({ kind: "accept", price: 280 });
  });
});

describe("decisor — tier 3: hardCap < price ≤ bigGapThreshold", () => {
  it("first encounter → counter at target", () => {
    const { action } = decide(state(), sig({ intent: "price_offer", inboundPrice: 350 }), BUDGET);
    expect(action).toMatchObject({ kind: "counter", price: 200 });
  });

  it("target already countered → decline (never accept above hardCap)", () => {
    const { action } = decide(
      state({ countersMade: [200] }),
      sig({ intent: "price_offer", inboundPrice: 350 }),
      BUDGET,
    );
    expect(action.kind).toBe("decline");
  });
});

describe("decisor — tier 4: price > bigGapThreshold", () => {
  it("first encounter → counter at midpoint of target+inbound", () => {
    // midpoint((200 + 500)/2) = 350 > hardCap 300 → clamped out → target (200)
    const { action } = decide(state(), sig({ intent: "price_offer", inboundPrice: 500 }), BUDGET);
    // since midpoint exceeds hardCap, decisor falls through to target counter
    expect(action).toMatchObject({ kind: "counter", price: 200 });
  });

  it("midpoint fits under hardCap → uses it", () => {
    // target 200, inbound 400 → midpoint 300 == hardCap → allowed
    const { action } = decide(state(), sig({ intent: "price_offer", inboundPrice: 400 }), BUDGET);
    expect(action).toMatchObject({ kind: "counter", price: 300 });
  });

  it("after midpoint counter, next round → counter at target", () => {
    const { action } = decide(
      state({ countersMade: [300] }),
      sig({ intent: "price_offer", inboundPrice: 400 }),
      BUDGET,
    );
    expect(action).toMatchObject({ kind: "counter", price: 200 });
  });

  it("after midpoint + target countered → decline", () => {
    const { action } = decide(
      state({ countersMade: [300, 200] }),
      sig({ intent: "price_offer", inboundPrice: 400 }),
      BUDGET,
    );
    expect(action.kind).toBe("decline");
  });
});

describe("decisor — invariants", () => {
  it("never proposes a counter above hardCap, for any input", () => {
    // exhaustive sweep of inbound prices from 0 to 2000 in steps of 10,
    // with 0 / 1 / 2 priors, over all intents that can trigger a counter
    const priors: number[][] = [[], [200], [300], [300, 200]];
    const intents: InboundSignals["intent"][] = ["price_offer", "logistics", "other"];
    for (const countersMade of priors) {
      for (const intent of intents) {
        for (let p = 0; p <= 2000; p += 10) {
          const { action } = decide(
            state({ countersMade }),
            sig({ intent, inboundPrice: p }),
            BUDGET,
          );
          if (action.kind === "counter") {
            expect(action.price).toBeLessThanOrEqual(BUDGET.hardCap);
            expect(countersMade).not.toContain(action.price);
          }
          if (action.kind === "accept") {
            // Accept is only allowed when the inbound itself is ≤ hardCap.
            expect(p).toBeLessThanOrEqual(BUDGET.hardCap);
          }
        }
      }
    }
  });

  it("never makes more than 2 counters total", () => {
    const { action } = decide(
      state({ countersMade: [300, 200] }),
      sig({ intent: "price_offer", inboundPrice: 400 }),
      BUDGET,
    );
    expect(action.kind).not.toBe("counter");
  });

  it("never counters at the same price twice", () => {
    const { action } = decide(
      state({ countersMade: [200] }),
      sig({ intent: "price_offer", inboundPrice: 350 }),
      BUDGET,
    );
    // tier 3, target 200 already countered → decline (not counter at 200 again)
    expect(action.kind).toBe("decline");
  });
});

describe("decisor — soft-accept + logistics fall-through", () => {
  it("soft_accept with a price → logistics (don't re-haggle)", () => {
    const { action } = decide(state(), sig({ intent: "soft_accept", inboundPrice: 200 }), BUDGET);
    expect(action.kind).toBe("logistics");
  });

  it("null price + logistics intent → logistics", () => {
    const { action } = decide(state(), sig({ intent: "logistics", inboundPrice: null }), BUDGET);
    expect(action.kind).toBe("logistics");
  });

  it("null price + question intent → logistics", () => {
    const { action } = decide(state(), sig({ intent: "question", inboundPrice: null }), BUDGET);
    expect(action.kind).toBe("logistics");
  });

  it("rejection intent → decline", () => {
    const { action } = decide(state(), sig({ intent: "rejection" }), BUDGET);
    expect(action.kind).toBe("decline");
  });

  it("price_offer with no parseable price → ask_clarification", () => {
    const { action } = decide(
      state(),
      sig({ intent: "price_offer", inboundPrice: null }),
      BUDGET,
    );
    expect(action.kind).toBe("ask_clarification");
  });

  it("null price + 'other' intent → logistics (no clarification needed)", () => {
    const { action } = decide(state(), sig({ intent: "other", inboundPrice: null }), BUDGET);
    expect(action.kind).toBe("logistics");
  });
});

describe("decisor — sitewide redirect flag", () => {
  it("propagates redirectToArticle on accept", () => {
    const { action } = decide(
      state(),
      sig({ intent: "price_offer", inboundPrice: 210, mentionedPlacementType: "sitewide" }),
      BUDGET,
    );
    expect(action).toMatchObject({ kind: "accept", redirectToArticle: true });
  });

  it("propagates redirectToArticle on counter", () => {
    const { action } = decide(
      state(),
      sig({ intent: "price_offer", inboundPrice: 280, mentionedPlacementType: "sitewide" }),
      BUDGET,
    );
    expect(action).toMatchObject({ kind: "counter", redirectToArticle: true });
  });

  it("article placement leaves flag false", () => {
    const { action } = decide(
      state(),
      sig({ intent: "price_offer", inboundPrice: 210, mentionedPlacementType: "article" }),
      BUDGET,
    );
    expect(action).toMatchObject({ redirectToArticle: false });
  });
});

describe("decisor — linkAttribute propagation", () => {
  it("carries nofollow from signals into accept", () => {
    const { action } = decide(
      state(),
      sig({ intent: "price_offer", inboundPrice: 210, linkAttribute: "nofollow" }),
      BUDGET,
    );
    expect(action).toMatchObject({ kind: "accept", linkAttribute: "nofollow" });
  });

  it("carries dofollow from signals into counter", () => {
    const { action } = decide(
      state(),
      sig({ intent: "price_offer", inboundPrice: 280, linkAttribute: "dofollow" }),
      BUDGET,
    );
    expect(action).toMatchObject({ kind: "counter", linkAttribute: "dofollow" });
  });

  it("defaults to unknown when the prospect didn't name the rel", () => {
    const { action } = decide(state(), sig({ intent: "price_offer", inboundPrice: 210 }), BUDGET);
    expect(action).toMatchObject({ kind: "accept", linkAttribute: "unknown" });
  });
});

describe("decisor — state updates", () => {
  it("records lastInboundPrice when signals carry one", () => {
    const { nextState } = decide(state(), sig({ intent: "price_offer", inboundPrice: 280 }), BUDGET);
    expect(nextState.lastInboundPrice).toBe(280);
  });

  it("preserves lastInboundPrice when inbound has none", () => {
    const { nextState } = decide(
      state({ lastInboundPrice: 200 }),
      sig({ intent: "logistics", inboundPrice: null }),
      BUDGET,
    );
    expect(nextState.lastInboundPrice).toBe(200);
  });

  it("records accepted price + preserves countersMade", () => {
    const { nextState } = decide(
      state({ countersMade: [200] }),
      sig({ intent: "price_offer", inboundPrice: 250 }),
      BUDGET,
    );
    expect(nextState.acceptedPrice).toBe(250);
    expect(nextState.countersMade).toEqual([200]);
  });
});
