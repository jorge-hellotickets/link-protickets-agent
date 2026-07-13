import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_REDACTOR_PROMPT, redact } from "../redactor";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LinkAgentLocale } from "../../locale-config";
import type { Action } from "../decisor";

vi.mock("@/src/lib/ai/gateway", () => ({
  callAIGateway: vi.fn(),
  parseGatewayJSON: vi.fn(),
}));

import { callAIGateway, parseGatewayJSON } from "@/src/lib/ai/gateway";

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
  localeSettings: "Spanish Spain, informal tú",
  closingExamples: "Un saludo",
  subjectExamples: "Re: X",
};

const BASE_INPUT = {
  emailHistory: "Laura: propuesta\nProspect: 280€",
  inboundBody: "280€",
  inboundSubject: "Re: Artículo",
  locale: LOCALE,
  model: "openai/gpt-5.5",
};

describe("redactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCall.mockResolvedValue("{}");
  });

  it("short-circuits on stall without hitting the gateway", async () => {
    const out = await redact({ ...BASE_INPUT, action: { kind: "stall" } });
    expect(out).toEqual(expect.objectContaining({ subject: null, body: null }));
    expect(mockCall).not.toHaveBeenCalled();
  });

  it("short-circuits on terminal without hitting the gateway", async () => {
    const out = await redact({
      ...BASE_INPUT,
      action: { kind: "terminal", reason: "unsubscribe" },
    });
    expect(out.subject).toBeNull();
    expect(out.body).toBeNull();
    expect(mockCall).not.toHaveBeenCalled();
  });

  it("returns subject + body on happy path", async () => {
    mockParse.mockReturnValue({ subject: "Re: Artículo", body: "Podríamos cerrar en 200€." });
    const out = await redact({
      ...BASE_INPUT,
      action: { kind: "counter", price: 200, redirectToArticle: false, linkAttribute: "unknown" },
    });
    expect(out.subject).toBe("Re: Artículo");
    expect(out.body).toBe("Podríamos cerrar en 200€.");
  });

  it("passes action as structured JSON inside user content", async () => {
    mockParse.mockReturnValue({ subject: "x", body: "y" });
    await redact({
      ...BASE_INPUT,
      action: { kind: "counter", price: 200, redirectToArticle: true, linkAttribute: "unknown" },
    });
    const userContent = mockCall.mock.calls[0][0];
    expect(userContent).toContain('"kind":"counter"');
    expect(userContent).toContain('"price":200');
    expect(userContent).toContain('"redirectToArticle":true');
  });

  it("omits redirectToArticle from action payload when false", async () => {
    mockParse.mockReturnValue({ subject: "x", body: "y" });
    await redact({
      ...BASE_INPUT,
      action: { kind: "accept", price: 180, redirectToArticle: false, linkAttribute: "unknown" },
    });
    const userContent = mockCall.mock.calls[0][0];
    expect(userContent).not.toContain("redirectToArticle");
  });

  it("emits linkAttribute in action payload when named", async () => {
    mockParse.mockReturnValue({ subject: "x", body: "y" });
    await redact({
      ...BASE_INPUT,
      action: { kind: "accept", price: 200, redirectToArticle: false, linkAttribute: "nofollow" },
    });
    const userContent = mockCall.mock.calls[0][0];
    expect(userContent).toContain('"linkAttribute":"nofollow"');
  });

  it("omits linkAttribute from action payload when unknown", async () => {
    mockParse.mockReturnValue({ subject: "x", body: "y" });
    await redact({
      ...BASE_INPUT,
      action: { kind: "accept", price: 200, redirectToArticle: false, linkAttribute: "unknown" },
    });
    const userContent = mockCall.mock.calls[0][0];
    expect(userContent).not.toContain("linkAttribute");
  });

  it("uses promptOverride when provided", async () => {
    mockParse.mockReturnValue({ subject: "x", body: "y" });
    await redact({
      ...BASE_INPUT,
      action: { kind: "decline" },
      promptOverride: "CUSTOM",
    });
    expect(mockCall.mock.calls[0][1]!.system).toBe("CUSTOM");
  });

  it("rejects malformed shape (missing body)", async () => {
    mockParse.mockReturnValue({ subject: "x" });
    await expect(
      redact({ ...BASE_INPUT, action: { kind: "decline" } }),
    ).rejects.toThrow(/required fields/);
  });

  it("rejects non-string subject", async () => {
    mockParse.mockReturnValue({ subject: 123, body: "y" });
    await expect(
      redact({ ...BASE_INPUT, action: { kind: "decline" } }),
    ).rejects.toThrow(/required fields/);
  });

  it("surfaces gateway errors", async () => {
    mockCall.mockRejectedValueOnce(new Error("gateway 500"));
    await expect(
      redact({ ...BASE_INPUT, action: { kind: "decline" } }),
    ).rejects.toThrow("gateway 500");
  });

  it("temperature stays at 0.4 for natural tone", async () => {
    mockParse.mockReturnValue({ subject: "x", body: "y" });
    await redact({ ...BASE_INPUT, action: { kind: "logistics" } });
    expect(mockCall.mock.calls[0][1]!.temperature).toBe(0.4);
  });

  it("requests a strict response schema", async () => {
    mockParse.mockReturnValue({ subject: "x", body: "y" });
    await redact({ ...BASE_INPUT, action: { kind: "logistics" } });
    expect(mockCall.mock.calls[0][1]!.responseFormat).toMatchObject({
      name: "LinkAgentRedactorResponse",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
      },
    });
  });
});

describe("DEFAULT_REDACTOR_PROMPT", () => {
  it("allows the agreed Protickets target URL when closing logistics require it", () => {
    expect(DEFAULT_REDACTOR_PROMPT).not.toContain(
      "NEVER link to protickets.com or hellotickets.com",
    );
    expect(DEFAULT_REDACTOR_PROMPT).toContain(
      "You may include the exact Protickets.com target URL",
    );
  });

  it("keeps the filesystem prompt aligned with the code default", () => {
    const markdownPrompt = readFileSync(
      join(
        process.cwd(),
        "src/lib/agents/instances/link-protickets/prompts/redactor.md",
      ),
      "utf8",
    );
    expect(markdownPrompt.trimEnd()).toBe(
      DEFAULT_REDACTOR_PROMPT.replaceAll("Laura Peñalver", "{{persona}}"),
    );
  });
});
