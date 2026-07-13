import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentLead } from "@prisma/client";

vi.mock("@/src/lib/db", () => ({
  db: {
    linkDeal: { findUnique: vi.fn() },
  },
}));

vi.mock("@/src/lib/link-agent/budget", () => ({
  getHeadroom: vi.fn(),
}));

vi.mock("@/src/lib/link-agent/runtime-config", () => ({
  getLinkAgentRuntimeConfig: vi.fn(),
}));

vi.mock("@/src/lib/link-agent/negotiation/extractor", () => ({
  extractSignals: vi.fn(),
}));

vi.mock("@/src/lib/link-agent/negotiation/redactor", () => ({
  redact: vi.fn(),
}));

import { decide } from "../decide";
import type { DecideCtx, MailMessage } from "@/src/lib/agents/core/types";
import { db } from "@/src/lib/db";
import { getHeadroom } from "@/src/lib/link-agent/budget";
import { getLinkAgentRuntimeConfig } from "@/src/lib/link-agent/runtime-config";
import { extractSignals } from "@/src/lib/link-agent/negotiation/extractor";
import { redact } from "@/src/lib/link-agent/negotiation/redactor";
import type { InboundSignals } from "@/src/lib/link-agent/negotiation/decisor";

const findUniqueMock = vi.mocked(db.linkDeal.findUnique);
const getHeadroomMock = vi.mocked(getHeadroom);
const getRuntimeConfigMock = vi.mocked(getLinkAgentRuntimeConfig);
const extractSignalsMock = vi.mocked(extractSignals);
const redactMock = vi.mocked(redact);

function makeLead(overrides: Partial<AgentLead> = {}): AgentLead {
  return {
    id: "lead_1",
    agentKey: "link-protickets",
    dedupeKey: "example.com#42",
    contactRef: "owner@example.com",
    locale: "es-es",
    status: "negotiating",
    score: null,
    data: { legacyProspectId: 101, domain: "example.com", targetId: 42, emailRoundsSent: 1 },
    state: {},
    outcomeKind: null,
    outcomeData: null,
    closedAt: null,
    nextWakeAt: null,
    createdAt: new Date("2026-04-01T09:00:00Z"),
    updatedAt: new Date(),
    ...overrides,
  } as AgentLead;
}

function inboundMsg(body: string, subject = "Re: colaboración"): MailMessage {
  return {
    externalId: "msg_in_1",
    direction: "inbound",
    from: "owner@example.com",
    to: "laura.penalver@fintmedia.com",
    subject,
    body,
    sentAt: new Date("2026-04-22T10:00:00Z"),
  };
}

function makeCtx(overrides: Partial<DecideCtx> = {}): DecideCtx {
  return {
    lead: makeLead(),
    thread: null,
    messages: [inboundMsg("Nos podría interesar. ¿Qué propones?")],
    prompts: {},
    agentConfig: {},
    now: new Date("2026-04-22T10:05:00Z"),
    ...overrides,
  } satisfies DecideCtx;
}

function signals(overrides: Partial<InboundSignals> = {}): InboundSignals {
  return {
    inboundPrice: null,
    intent: "logistics",
    addedNewInfo: true,
    askedQuestions: [],
    assumedWeWriteArticle: false,
    mentionedPlacementType: "unknown",
    linkAttribute: "unknown",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  findUniqueMock.mockResolvedValue(null);
  getHeadroomMock.mockResolvedValue({
    headroomCents: 200_000,
    thisMonth: { str: "2026-04", limitCents: 500_000, spentCents: 0, committedCents: 0 },
    nextMonth: { str: "2026-05", limitCents: 500_000, committedCents: 0 },
    avgPerLinkCents: 10_000, // 100€ target
  });
  getRuntimeConfigMock.mockResolvedValue({
    negotiationModel: "test-model",
    businessHours: { dayOfWeek: [1, 2, 3, 4, 5], startHour: 9, endHour: 18 },
    replyDelayMinMinutes: 10,
    replyDelayMaxMinutes: 90,
  });
  redactMock.mockResolvedValue({
    subject: "Re: colaboración",
    body: "Gracias por tu respuesta. Te propongo continuar así…",
    model: "test-model",
    durationMs: 1,
  });
});

describe("decideOnNegotiating — Decision semantics", () => {
  it("soft_accept → send + negotiating (logistics action)", async () => {
    extractSignalsMock.mockResolvedValue({
      signals: signals({ intent: "soft_accept", inboundPrice: 120 }),
      model: "test-model",
      durationMs: 1,
    });

    const decision = await decide(makeCtx());

    expect(decision.kind).toBe("send");
    expect(decision.kind === "send" && decision.nextStatus).toBe("negotiating");
  });

  it("price_offer within hardCap → accept → send + waiting_for_invoice", async () => {
    // hardCap = round10(10_000 * 1.5 / 100 / 100 * 100) = 190; price=110 ≤ smallGapCap=140 → accept
    extractSignalsMock.mockResolvedValue({
      signals: signals({ intent: "price_offer", inboundPrice: 110 }),
      model: "test-model",
      durationMs: 1,
    });

    const decision = await decide(makeCtx());

    expect(decision.kind).toBe("send");
    expect(decision.kind === "send" && decision.nextStatus).toBe("waiting_for_invoice");
  });

  it("price_offer far above cap with counters exhausted → decline → send + stalled", async () => {
    // bigGapThreshold = 180; price=500 > bigGap, state has MAX_COUNTERS already used.
    extractSignalsMock.mockResolvedValue({
      signals: signals({ intent: "price_offer", inboundPrice: 500 }),
      model: "test-model",
      durationMs: 1,
    });

    const lead = makeLead({
      state: {
        thread: {
          countersMade: [130, 170],
          acceptedPrice: null,
          agreedDate: null,
          agreedAnchor: null,
          agreedLinkUrl: null,
          lastInboundPrice: null,
          consecutiveNoNewInfo: 0,
          terminal: false,
        },
      },
    });
    const decision = await decide(makeCtx({ lead }));

    expect(decision.kind).toBe("send");
    expect(decision.kind === "send" && decision.nextStatus).toBe("stalled");
  });

  it("rejection guardrail (deterministic) → close rejected (no LLM)", async () => {
    const ctx = makeCtx({
      messages: [inboundMsg("Please unsubscribe me from your list.")],
    });
    const decision = await decide(ctx);

    expect(decision.kind).toBe("close");
    expect(decision.kind === "close" && decision.outcomeKind).toBe("rejected");
    expect(extractSignalsMock).not.toHaveBeenCalled();
  });

  it("logistics post soft_accept (acceptedPrice set) → send + negotiating", async () => {
    extractSignalsMock.mockResolvedValue({
      signals: signals({ intent: "logistics" }),
      model: "test-model",
      durationMs: 1,
    });

    const lead = makeLead({
      state: {
        thread: {
          countersMade: [],
          acceptedPrice: 120,
          agreedDate: "2026-05-15",
          agreedAnchor: null,
          agreedLinkUrl: null,
          lastInboundPrice: null,
          consecutiveNoNewInfo: 0,
          terminal: false,
        },
      },
    });
    const decision = await decide(makeCtx({ lead }));

    expect(decision.kind).toBe("send");
    expect(decision.kind === "send" && decision.nextStatus).toBe("negotiating");
  });

  it("unsubscribe intent (via extractor) → close rejected", async () => {
    extractSignalsMock.mockResolvedValue({
      signals: signals({ intent: "unsubscribe" }),
      model: "test-model",
      durationMs: 1,
    });

    const decision = await decide(makeCtx());

    expect(decision.kind).toBe("close");
    expect(decision.kind === "close" && decision.outcomeKind).toBe("rejected");
  });

  it("bounce intent → close bounce", async () => {
    extractSignalsMock.mockResolvedValue({
      signals: signals({ intent: "bounce" }),
      model: "test-model",
      durationMs: 1,
    });

    const decision = await decide(makeCtx());

    expect(decision.kind).toBe("close");
    expect(decision.kind === "close" && decision.outcomeKind).toBe("bounce");
  });

  it("max-rounds reached without deal → close max_rounds", async () => {
    const lead = makeLead({
      data: {
        legacyProspectId: 101,
        domain: "example.com",
        targetId: 42,
        emailRoundsSent: 10,
      },
    });
    const decision = await decide(makeCtx({ lead }));

    expect(decision.kind).toBe("close");
    expect(decision.kind === "close" && decision.outcomeKind).toBe("max_rounds");
    expect(extractSignalsMock).not.toHaveBeenCalled();
  });
});
