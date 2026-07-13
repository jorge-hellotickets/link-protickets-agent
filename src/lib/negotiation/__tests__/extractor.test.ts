import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractSignals } from "../extractor";

vi.mock("@/src/lib/ai/gateway", () => ({
  callAIGateway: vi.fn(),
  parseGatewayJSON: vi.fn(),
}));

import { callAIGateway, parseGatewayJSON } from "@/src/lib/ai/gateway";

const mockCall = vi.mocked(callAIGateway);
const mockParse = vi.mocked(parseGatewayJSON);

const BASE_INPUT = {
  emailHistory: "Laura: proposal\nProspect: interested",
  inboundBody: "200€ and we publish next week",
  model: "openai/gpt-5.5",
};

const VALID_SIGNALS = {
  inboundPrice: 200,
  intent: "price_offer" as const,
  addedNewInfo: true,
  askedQuestions: [],
  assumedWeWriteArticle: false,
  mentionedPlacementType: "article" as const,
  linkAttribute: "unknown" as const,
};

describe("extractor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCall.mockResolvedValue("{}");
  });

  it("returns parsed signals on happy path", async () => {
    mockParse.mockReturnValue(VALID_SIGNALS);
    const { signals, model } = await extractSignals(BASE_INPUT);
    expect(signals).toEqual(VALID_SIGNALS);
    expect(model).toBe("openai/gpt-5.5");
  });

  it("passes the thread + inbound as user content, not system", async () => {
    mockParse.mockReturnValue(VALID_SIGNALS);
    await extractSignals(BASE_INPUT);
    const userContent = mockCall.mock.calls[0][0];
    expect(userContent).toContain("Laura: proposal");
    expect(userContent).toContain("200€ and we publish next week");
    const opts = mockCall.mock.calls[0][1]!;
    expect(opts.temperature).toBe(0);
    expect(opts.responseFormat).toMatchObject({
      name: "LinkAgentInboundSignals",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
      },
    });
  });

  it("uses promptOverride when provided", async () => {
    mockParse.mockReturnValue(VALID_SIGNALS);
    await extractSignals({ ...BASE_INPUT, promptOverride: "CUSTOM PROMPT" });
    expect(mockCall.mock.calls[0][1]!.system).toBe("CUSTOM PROMPT");
  });

  it("rejects invalid intent", async () => {
    mockParse.mockReturnValue({ ...VALID_SIGNALS, intent: "nope" });
    await expect(extractSignals(BASE_INPUT)).rejects.toThrow(/invalid intent/);
  });

  it("rejects non-number inboundPrice", async () => {
    mockParse.mockReturnValue({ ...VALID_SIGNALS, inboundPrice: "200" });
    await expect(extractSignals(BASE_INPUT)).rejects.toThrow(/inboundPrice/);
  });

  it("accepts null inboundPrice", async () => {
    mockParse.mockReturnValue({ ...VALID_SIGNALS, inboundPrice: null, intent: "logistics" });
    const { signals } = await extractSignals(BASE_INPUT);
    expect(signals.inboundPrice).toBeNull();
  });

  it("rejects non-boolean addedNewInfo", async () => {
    mockParse.mockReturnValue({ ...VALID_SIGNALS, addedNewInfo: "yes" });
    await expect(extractSignals(BASE_INPUT)).rejects.toThrow(/addedNewInfo/);
  });

  it("rejects non-string askedQuestions entries", async () => {
    mockParse.mockReturnValue({ ...VALID_SIGNALS, askedQuestions: [1, 2] });
    await expect(extractSignals(BASE_INPUT)).rejects.toThrow(/askedQuestions/);
  });

  it("rejects invalid mentionedPlacementType", async () => {
    mockParse.mockReturnValue({ ...VALID_SIGNALS, mentionedPlacementType: "banner" });
    await expect(extractSignals(BASE_INPUT)).rejects.toThrow(/mentionedPlacementType/);
  });

  it("accepts linkAttribute nofollow / dofollow / unknown", async () => {
    for (const v of ["dofollow", "nofollow", "unknown"] as const) {
      mockParse.mockReturnValueOnce({ ...VALID_SIGNALS, linkAttribute: v });
      const { signals } = await extractSignals(BASE_INPUT);
      expect(signals.linkAttribute).toBe(v);
    }
  });

  it("defaults linkAttribute to 'unknown' when the field is missing", async () => {
    const { linkAttribute: _omit, ...rest } = VALID_SIGNALS;
    mockParse.mockReturnValue(rest);
    const { signals } = await extractSignals(BASE_INPUT);
    expect(signals.linkAttribute).toBe("unknown");
  });

  it("rejects invalid linkAttribute", async () => {
    mockParse.mockReturnValue({ ...VALID_SIGNALS, linkAttribute: "sponsored" });
    await expect(extractSignals(BASE_INPUT)).rejects.toThrow(/linkAttribute/);
  });

  it("surfaces gateway errors", async () => {
    mockCall.mockRejectedValueOnce(new Error("gateway 500"));
    await expect(extractSignals(BASE_INPUT)).rejects.toThrow("gateway 500");
  });

  it("surfaces parse errors", async () => {
    mockParse.mockImplementationOnce(() => {
      throw new Error("not json");
    });
    await expect(extractSignals(BASE_INPUT)).rejects.toThrow("not json");
  });
});
