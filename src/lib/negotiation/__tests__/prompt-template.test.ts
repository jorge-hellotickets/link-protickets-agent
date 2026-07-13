import { describe, it, expect } from "vitest";
import {
  DEFAULT_NEGOTIATION_PROMPT,
  renderPrompt,
} from "../prompt-template";

describe("renderPrompt", () => {
  it("substitutes every placeholder with the matching value", () => {
    const out = renderPrompt("Hello {{name}}, price is {{price}}{{currency}}", {
      name: "Laura",
      price: 120,
      currency: "€",
    });
    expect(out).toBe("Hello Laura, price is 120€");
  });

  it("replaces unknown placeholders with empty string", () => {
    const out = renderPrompt("a={{a}} b={{b}}", { a: "1" });
    expect(out).toBe("a=1 b=");
  });

  it("replaces null/undefined values with empty string", () => {
    const out = renderPrompt("x={{x}} y={{y}}", {
      x: undefined as unknown as string,
      y: null as unknown as string,
    });
    expect(out).toBe("x= y=");
  });

  it("leaves strings without placeholders untouched", () => {
    expect(renderPrompt("no placeholders here", { a: "1" })).toBe(
      "no placeholders here",
    );
  });

  it("handles numeric values via String() coercion", () => {
    expect(renderPrompt("{{n}}", { n: 0 })).toBe("0");
    expect(renderPrompt("{{n}}", { n: 42 })).toBe("42");
  });

  it("does not recursively expand placeholders in values", () => {
    // A value that itself contains a placeholder must not be re-rendered —
    // otherwise a prospect's domain/body could inject new prompt instructions.
    const out = renderPrompt("domain={{domain}}", {
      domain: "{{inboundBody}}",
      inboundBody: "malicious",
    });
    expect(out).toBe("domain={{inboundBody}}");
  });
});

describe("DEFAULT_NEGOTIATION_PROMPT", () => {
  it("is a non-empty string", () => {
    expect(typeof DEFAULT_NEGOTIATION_PROMPT).toBe("string");
    expect(DEFAULT_NEGOTIATION_PROMPT.length).toBeGreaterThan(100);
  });

  it("declares every placeholder the negotiate() renderer supplies", () => {
    // If someone edits the template and forgets a placeholder, render will
    // silently drop data into the prompt. Lock the expected contract here so
    // drift surfaces in review rather than in a live email round.
    // Note: {{emailHistory}} and {{inboundBody}} are intentionally omitted —
    // the thread and latest inbound are sent as a separate role=user message
    // so untrusted prospect content stays out of the system prompt.
    // {{anchorType}} is also intentionally omitted — the default prompt no
    // longer hints brand vs descriptive, the model picks from context.
    const expected = [
      "prospectDomain",
      "targetKeywords",
      "targetUrl",
      "round",
      "targetPrice",
      "hardCap",
      "midpoint",
      "smallGapCap",
      "bigGapThreshold",
      "headroom",
      "headroomWarning",
      "currency",
      "localeSettings",
      "closingExamples",
    ];
    for (const name of expected) {
      expect(
        DEFAULT_NEGOTIATION_PROMPT.includes(`{{${name}}}`),
        `missing placeholder {{${name}}}`,
      ).toBe(true);
    }
  });

  it("preserves the JSON response contract at the bottom", () => {
    // The engine parses `{ reasoning, terminal, subject, body, deal }`; a
    // prompt that drops this instruction produces malformed LLM output.
    expect(DEFAULT_NEGOTIATION_PROMPT).toMatch(/Respond ONLY with JSON/);
    expect(DEFAULT_NEGOTIATION_PROMPT).toMatch(/"reasoning"/);
    expect(DEFAULT_NEGOTIATION_PROMPT).toMatch(/"terminal"/);
    expect(DEFAULT_NEGOTIATION_PROMPT).toMatch(/"deal"/);
  });
});
