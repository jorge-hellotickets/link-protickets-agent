import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LinkAgentLocale } from "../../locale-config";

vi.mock("@/src/lib/ai/gateway", () => ({
  callAIGateway: vi.fn(),
  parseGatewayJSON: vi.fn(),
}));

import { callAIGateway, parseGatewayJSON } from "@/src/lib/ai/gateway";
import { negotiateSplit } from "../negotiate-split";

const mockCall = vi.mocked(callAIGateway);
const mockParse = vi.mocked(parseGatewayJSON);

const LOCALE: LinkAgentLocale = {
  locationCode: 2724,
  languageCode: "es",
  currency: "€",
  priceMultiplier: 1.0,
  timezone: "Europe/Madrid",
  inbox: "x@y.com",
  signatureTitle: "t",
  signatureUnsubscribe: "baja",
  localeSettings: "Spanish",
  closingExamples: "Un saludo",
  subjectExamples: "Re: X",
};

const BASE = {
  emailHistory: "Laura: propuesta\nProspect: 280€",
  inboundBody: "280€",
  inboundSubject: "Re: X",
  budget: { targetPrice: 200, smallGapCap: 220, hardCap: 300, bigGapThreshold: 360 },
  locale: LOCALE,
  model: "openai/gpt-5.5",
};

const SIG_PRICE_OFFER_280 = {
  inboundPrice: 280,
  intent: "price_offer" as const,
  addedNewInfo: true,
  askedQuestions: [],
  assumedWeWriteArticle: false,
  mentionedPlacementType: "unknown" as const,
  linkAttribute: "unknown" as const,
};

describe("negotiateSplit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCall.mockResolvedValue("{}");
  });

  it("tier-2 price → counter at target, body passes validator", async () => {
    mockParse
      .mockReturnValueOnce(SIG_PRICE_OFFER_280) // extractor
      .mockReturnValueOnce({ subject: "Re: X", body: "Podríamos en 200€." }); // redactor

    const out = await negotiateSplit({ ...BASE, threadState: null });

    expect(out.action).toMatchObject({ kind: "counter", price: 200 });
    expect(out.body).toBe("Podríamos en 200€.");
    expect(out.dropped).toBe(false);
    expect(out.validatorIssues).toEqual([]);
    expect(out.nextState.countersMade).toEqual([200]);
  });

  it("regenerates once when validator fails, then ships on retry success", async () => {
    mockParse
      .mockReturnValueOnce(SIG_PRICE_OFFER_280)
      .mockReturnValueOnce({ subject: "Re: X", body: "Bajamos a 180€." })  // wrong price → invalid
      .mockReturnValueOnce({ subject: "Re: X", body: "Cerramos en 200€." }); // valid retry

    const out = await negotiateSplit({ ...BASE, threadState: null });

    expect(out.body).toBe("Cerramos en 200€.");
    expect(out.dropped).toBe(false);
    expect(out.validatorIssues.length).toBeGreaterThan(0);
    // extractor + first redactor + retry redactor = 3 gateway calls
    expect(mockCall).toHaveBeenCalledTimes(3);
  });

  it("drops the send when retry also fails validation", async () => {
    mockParse
      .mockReturnValueOnce(SIG_PRICE_OFFER_280)
      .mockReturnValueOnce({ subject: "Re: X", body: "A 180€." })
      .mockReturnValueOnce({ subject: "Re: X", body: "A 150€." });

    const out = await negotiateSplit({ ...BASE, threadState: null });

    expect(out.dropped).toBe(true);
    expect(out.body).toBeNull();
    expect(out.validatorIssues.length).toBeGreaterThan(0);
    // nextState still reflects the decided action (counter at 200) even
    // though we didn't send — the caller may choose not to persist on drop
    expect(out.action).toMatchObject({ kind: "counter", price: 200 });
  });

  it("short-circuits stall without calling the redactor", async () => {
    mockParse.mockReturnValueOnce({
      ...SIG_PRICE_OFFER_280,
      intent: "other",
      addedNewInfo: false,
      inboundPrice: null,
    });

    const out = await negotiateSplit({
      ...BASE,
      threadState: {
        countersMade: [],
        acceptedPrice: null,
        agreedDate: null,
        agreedAnchor: null,
        agreedLinkUrl: null,
        lastInboundPrice: null,
        consecutiveNoNewInfo: 1, // with no new info → 2 → stall
        terminal: false,
      },
    });

    expect(out.action.kind).toBe("stall");
    expect(out.subject).toBeNull();
    expect(out.body).toBeNull();
    // extractor only — no redactor call
    expect(mockCall).toHaveBeenCalledTimes(1);
  });

  it("short-circuits terminal (unsubscribe) without calling the redactor", async () => {
    mockParse.mockReturnValueOnce({
      ...SIG_PRICE_OFFER_280,
      intent: "unsubscribe",
      inboundPrice: null,
    });

    const out = await negotiateSplit({ ...BASE, threadState: null });

    expect(out.action).toMatchObject({ kind: "terminal", reason: "unsubscribe" });
    expect(out.nextState.terminal).toBe(true);
    expect(out.body).toBeNull();
    expect(mockCall).toHaveBeenCalledTimes(1);
  });

  it("passes extractor + redactor prompt overrides through", async () => {
    mockParse
      .mockReturnValueOnce(SIG_PRICE_OFFER_280)
      .mockReturnValueOnce({ subject: "Re: X", body: "Cerramos en 200€." });

    await negotiateSplit({
      ...BASE,
      threadState: null,
      extractorPrompt: "EXTRACTOR_CUSTOM",
      redactorPrompt: "REDACTOR_CUSTOM",
    });

    expect(mockCall.mock.calls[0][1]!.system).toBe("EXTRACTOR_CUSTOM");
    expect(mockCall.mock.calls[1][1]!.system).toBe("REDACTOR_CUSTOM");
  });

  it("carries prior countersMade into the decision", async () => {
    mockParse
      .mockReturnValueOnce({ ...SIG_PRICE_OFFER_280, inboundPrice: 280 })
      .mockReturnValueOnce({ subject: "Re: X", body: "Podemos cerrar en 280€." });

    const out = await negotiateSplit({
      ...BASE,
      threadState: {
        countersMade: [200], // already countered once at 200
        acceptedPrice: null,
        agreedDate: null,
        agreedAnchor: null,
        agreedLinkUrl: null,
        lastInboundPrice: 280,
        consecutiveNoNewInfo: 0,
        terminal: false,
      },
    });

    // tier 2 + target already countered → accept their price
    expect(out.action).toMatchObject({ kind: "accept", price: 280 });
    expect(out.nextState.acceptedPrice).toBe(280);
  });
});
