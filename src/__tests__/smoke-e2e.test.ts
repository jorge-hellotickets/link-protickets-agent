import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentLead, AgentThread } from "@prisma/client";

/**
 * PR4a smoke test: end-to-end through decide() → applyDecision() → onTransition()
 * with DB + AgentMail mocked. Verifies that:
 *
 *   - A negotiating inbound that extracts as a price_offer within the headroom
 *     produces a `send` Decision that transitions the lead to
 *     waiting_for_invoice.
 *   - onTransition() runs the deal-creation + budget-gating transaction
 *     against LinkDeal using the transitionPayload (agreedPriceCents).
 *   - A deterministic rejection guardrail closes the lead with outcome
 *     `rejected` without calling the LLM and without creating a deal.
 */

const dbState = {
  agentLead: {} as Record<string, AgentLead>,
  agentThread: {} as Record<string, AgentThread>,
  linkDealByProspectId: {} as Record<number, { id: number; agreedPriceCents: number; agreedDate: Date }>,
  linkBudgets: [] as Array<{
    locale: string;
    month: string;
    limitCents: number;
    spentCents: number;
  }>,
};

vi.mock("@/src/lib/db", () => {
  let dealId = 1;
  return {
    db: {
      linkDeal: {
        findUnique: vi.fn(async ({ where }: { where: { prospectId: number } }) => {
          return dbState.linkDealByProspectId[where.prospectId] ?? null;
        }),
        aggregate: vi.fn(async () => ({ _sum: { agreedPriceCents: 0 } })),
        upsert: vi.fn(async ({ where, create }: { where: { prospectId: number }; create: { prospectId: number; agreedPriceCents: number; agreedDate: Date } }) => {
          const existing = dbState.linkDealByProspectId[where.prospectId];
          if (existing) return existing;
          const created = { id: dealId++, ...create };
          dbState.linkDealByProspectId[where.prospectId] = created;
          return created;
        }),
        update: vi.fn(async () => ({})),
      },
      linkTarget: {
        findUnique: vi.fn(async () => ({
          id: 42,
          url: "https://www.protickets.com/madonna-tickets",
          keywords: "madonna tour",
          locale: "es-es",
        })),
      },
      linkBudget: {
        findFirst: vi.fn(async ({ where }: { where: { locale: string; month: string } }) => {
          return (
            dbState.linkBudgets.find(
              (b) => b.locale === where.locale && b.month === where.month,
            ) ?? null
          );
        }),
      },
      agentLead: {
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const existing = dbState.agentLead[where.id];
          if (!existing) throw new Error(`No lead ${where.id}`);
          const next: AgentLead = { ...existing };
          for (const [k, v] of Object.entries(data)) {
            if (v === undefined) continue;
            (next as unknown as Record<string, unknown>)[k] = v;
          }
          dbState.agentLead[where.id] = next;
          return next;
        }),
      },
      agentThread: {
        findFirst: vi.fn(async () => null),
        update: vi.fn(async () => ({}) as AgentThread),
        create: vi.fn(async ({ data }: { data: { agentKey: string; leadId: string; externalId: string } }) => {
          const t = { id: `thread_${Object.keys(dbState.agentThread).length + 1}`, ...data } as AgentThread;
          dbState.agentThread[t.id] = t;
          return t;
        }),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => {
        // `tx` uses the same mocked db; reuse the module export.
        const mod = await import("@/src/lib/db");
        return fn(mod.db);
      }),
    },
  };
});

vi.mock("@/src/lib/link-agent/budget", () => ({
  getHeadroom: vi.fn(async () => ({
    headroomCents: 200_000,
    thisMonth: { str: "2026-04", limitCents: 500_000, spentCents: 0, committedCents: 0 },
    nextMonth: { str: "2026-05", limitCents: 500_000, committedCents: 0 },
    avgPerLinkCents: 10_000,
  })),
}));

vi.mock("@/src/lib/link-agent/runtime-config", () => ({
  getLinkAgentRuntimeConfig: vi.fn(async () => ({
    negotiationModel: "test-model",
    businessHours: { dayOfWeek: [1, 2, 3, 4, 5], startHour: 9, endHour: 18 },
    replyDelayMinMinutes: 10,
    replyDelayMaxMinutes: 90,
  })),
}));

vi.mock("@/src/lib/link-agent/negotiation/extractor", () => ({
  extractSignals: vi.fn(),
}));

vi.mock("@/src/lib/link-agent/negotiation/redactor", () => ({
  redact: vi.fn(async () => ({
    subject: "Re: colaboración",
    body: "Perfecto, te confirmo el precio y avanzamos con factura.",
    model: "test-model",
    durationMs: 1,
  })),
}));

vi.mock("@/src/lib/link-agent/post-deal", () => ({
  composePostDealReply: vi.fn(async () => ({
    replySubject: "Re: factura",
    replyBody: "Recibida, procedemos con el pago.",
    reasoning: "final",
    ruleApplied: "final",
    model: "test-model",
    durationMs: 1,
  })),
}));

vi.mock("@/src/lib/link-agent/payment-detector", () => ({
  detectPaymentTransition: vi.fn(async () => ({
    invoiceClassification: { invoiceType: "final", evidence: "te adjunto la factura" },
    paymentTransition: { nextStatus: "waiting_for_payment", evidence: "te adjunto la factura" },
    model: "test-model",
    durationMs: 1,
  })),
}));

vi.mock("@/src/lib/link-agent/email-composer", () => ({
  composeFollowUpEmail: vi.fn(async () => ({
    subject: "follow-up",
    body: "¿alguna noticia?",
  })),
}));

vi.mock("@/src/lib/link-agent/publication-audit", () => ({
  auditPublication: vi.fn(),
  summarizeAuditIssuesEs: vi.fn(() => ""),
}));

// Agent mail calls — persistence.ts uses these when decision.kind === "send".
vi.mock("@/src/lib/agents/core/mail-channel", () => ({
  sendMessage: vi.fn(async () => ({ messageId: "m1", threadId: "t1" })),
  replyToMessage: vi.fn(async () => ({ messageId: "m1", threadId: "t1" })),
  scheduleDraft: vi.fn(async () => ({ draftId: "draft_1" })),
  loadThreadMessages: vi.fn(async () => []),
  cancelDraft: vi.fn(async () => true),
}));

import { linkProticketsAgent } from "../index";
import { applyDecision } from "@/src/lib/agents/core/persistence";
import { decide } from "../decide";
import type { DecideCtx, MailMessage } from "@/src/lib/agents/core/types";
import { extractSignals } from "@/src/lib/link-agent/negotiation/extractor";
import { CoreAgentConfigSchema } from "@/src/lib/agents/core/config-schema";

const extractSignalsMock = vi.mocked(extractSignals);

function seedLead(overrides: Partial<AgentLead> = {}): AgentLead {
  const lead: AgentLead = {
    id: "lead_smoke",
    agentKey: "link-protickets",
    dedupeKey: "example.com#42",
    contactRef: "owner@example.com",
    locale: "es-es",
    status: "negotiating",
    score: null,
    data: {
      legacyProspectId: 7_777,
      domain: "example.com",
      targetId: 42,
      emailRoundsSent: 2,
    },
    state: {},
    outcomeKind: null,
    outcomeData: null,
    closedAt: null,
    nextWakeAt: null,
    createdAt: new Date("2026-04-01T09:00:00Z"),
    updatedAt: new Date("2026-04-22T10:00:00Z"),
    ...overrides,
  } as AgentLead;
  dbState.agentLead[lead.id] = lead;
  return lead;
}

function inbound(body: string): MailMessage {
  return {
    externalId: "msg_in_1",
    direction: "inbound",
    from: "owner@example.com",
    to: "laura.penalver@fintmedia.com",
    subject: "Re: colaboración",
    body,
    sentAt: new Date("2026-04-22T10:00:00Z"),
  };
}

function makeCtx(lead: AgentLead): DecideCtx {
  return {
    lead,
    thread: null,
    messages: [inbound("Nos viene bien a 100€.")],
    prompts: {},
    agentConfig: {},
    now: new Date("2026-04-22T10:05:00Z"),
  };
}

const coreConfig = CoreAgentConfigSchema.parse({
  identity: {
    persona: "Laura Peñalver",
    brandUrl: "https://www.protickets.com",
    inboxes: { "es-es": "laura.penalver@fintmedia.com" },
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  dbState.agentLead = {};
  dbState.agentThread = {};
  dbState.linkDealByProspectId = {};
  dbState.linkBudgets = [
    { locale: "es-es", month: "2026-04", limitCents: 500_000, spentCents: 0 },
    { locale: "es-es", month: "2026-05", limitCents: 500_000, spentCents: 0 },
  ];
});

describe("PR4a smoke — decide → applyDecision → onTransition", () => {
  it("accept path: writes AgentLead.status=waiting_for_invoice and creates LinkDeal", async () => {
    const lead = seedLead();
    extractSignalsMock.mockResolvedValue({
      signals: {
        inboundPrice: 100,
        intent: "price_offer",
        addedNewInfo: true,
        askedQuestions: [],
        assumedWeWriteArticle: false,
        mentionedPlacementType: "unknown",
        linkAttribute: "unknown",
      },
      model: "test-model",
      durationMs: 1,
    });

    const ctx = makeCtx(lead);
    const decision = await decide(ctx);
    expect(decision.kind).toBe("send");
    if (decision.kind !== "send") throw new Error("unreachable");
    expect(decision.nextStatus).toBe("waiting_for_invoice");
    expect(decision.transitionPayload).toMatchObject({ agreedPriceCents: 10_000 });

    await applyDecision({
      agent: linkProticketsAgent,
      config: coreConfig,
      lead,
      thread: null,
      decision,
      now: ctx.now,
    });

    const after = dbState.agentLead[lead.id]!;
    expect(after.status).toBe("waiting_for_invoice");
    expect(dbState.linkDealByProspectId[7_777]).toMatchObject({
      agreedPriceCents: 10_000,
    });
  });

  it("rejection guardrail: closes as rejected, no deal, no LLM call", async () => {
    const lead = seedLead();
    const ctx: DecideCtx = {
      ...makeCtx(lead),
      messages: [inbound("Please unsubscribe me from your list.")],
    };

    const decision = await decide(ctx);
    expect(decision.kind).toBe("close");
    if (decision.kind !== "close") throw new Error("unreachable");
    expect(decision.outcomeKind).toBe("rejected");
    expect(extractSignalsMock).not.toHaveBeenCalled();

    await applyDecision({
      agent: linkProticketsAgent,
      config: coreConfig,
      lead,
      thread: null,
      decision,
      now: ctx.now,
    });

    const after = dbState.agentLead[lead.id]!;
    expect(after.outcomeKind).toBe("rejected");
    expect(after.closedAt).toBeInstanceOf(Date);
    expect(dbState.linkDealByProspectId[7_777]).toBeUndefined();
  });

  it("budget_exhausted in onTransition demotes lead to rejected", async () => {
    const lead = seedLead();
    dbState.linkBudgets = [
      { locale: "es-es", month: "2026-04", limitCents: 500, spentCents: 500 },
      { locale: "es-es", month: "2026-05", limitCents: 500, spentCents: 500 },
    ];
    extractSignalsMock.mockResolvedValue({
      signals: {
        inboundPrice: 100,
        intent: "price_offer",
        addedNewInfo: true,
        askedQuestions: [],
        assumedWeWriteArticle: false,
        mentionedPlacementType: "unknown",
        linkAttribute: "unknown",
      },
      model: "test-model",
      durationMs: 1,
    });

    const ctx = makeCtx(lead);
    const decision = await decide(ctx);
    await applyDecision({
      agent: linkProticketsAgent,
      config: coreConfig,
      lead,
      thread: null,
      decision,
      now: ctx.now,
    });

    const after = dbState.agentLead[lead.id]!;
    expect(after.status).toBe("rejected");
    expect(after.outcomeKind).toBe("budget_exhausted");
    expect(dbState.linkDealByProspectId[7_777]).toBeUndefined();
  });
});

describe("PR4b smoke — post-deal + follow-up + audit handlers", () => {
  it("waiting_for_invoice + final invoice → send + transition to waiting_for_payment", async () => {
    dbState.linkDealByProspectId[7_777] = {
      id: 99,
      agreedPriceCents: 10_000,
      agreedDate: new Date("2026-04-22"),
    };
    const lead = seedLead({ status: "waiting_for_invoice" });
    const ctx: DecideCtx = {
      ...makeCtx(lead),
      messages: [inbound("Te adjunto la factura definitiva.")],
    };

    const decision = await decide(ctx);
    expect(decision.kind).toBe("send");
    if (decision.kind !== "send") throw new Error("unreachable");
    expect(decision.nextStatus).toBe("waiting_for_payment");
    expect(decision.transitionPayload).toMatchObject({ priceCents: 10_000 });
  });

  it("waiting_for_invoice + proforma → send, no transition", async () => {
    const { detectPaymentTransition } = await import("@/src/lib/link-agent/payment-detector");
    vi.mocked(detectPaymentTransition).mockResolvedValueOnce({
      invoiceClassification: { invoiceType: "proforma", evidence: "factura proforma" },
      paymentTransition: null,
      model: "test-model",
      durationMs: 1,
    });
    dbState.linkDealByProspectId[7_777] = {
      id: 99,
      agreedPriceCents: 10_000,
      agreedDate: new Date("2026-04-22"),
    };
    const lead = seedLead({ status: "waiting_for_invoice" });
    const ctx: DecideCtx = {
      ...makeCtx(lead),
      messages: [inbound("Aquí va la factura proforma para el pago.")],
    };

    const decision = await decide(ctx);
    expect(decision.kind).toBe("send");
    if (decision.kind !== "send") throw new Error("unreachable");
    expect(decision.nextStatus).toBeUndefined();
    expect(decision.stateUpdate).toMatchObject({ finalInvoicePending: true });
  });

  it("waiting_for_payment inbound → send, never transitions (human Mark Paid)", async () => {
    dbState.linkDealByProspectId[7_777] = {
      id: 99,
      agreedPriceCents: 10_000,
      agreedDate: new Date("2026-04-22"),
    };
    const lead = seedLead({ status: "waiting_for_payment" });
    const ctx: DecideCtx = {
      ...makeCtx(lead),
      messages: [inbound("Recordad pagar antes de viernes, gracias.")],
    };

    const decision = await decide(ctx);
    expect(decision.kind).toBe("send");
    if (decision.kind !== "send") throw new Error("unreachable");
    expect(decision.nextStatus).toBeUndefined();
  });

  it("paid + clean audit → close deal_closed", async () => {
    const { auditPublication } = await import("@/src/lib/link-agent/publication-audit");
    vi.mocked(auditPublication).mockResolvedValueOnce({
      ok: true,
      checkedAt: new Date().toISOString(),
      linkUrl: "https://example.com/post",
      targetUrl: "https://www.protickets.com/madonna-tickets",
      expectedAnchorText: "madonna",
      anchors: [],
      issues: [],
    });
    dbState.linkDealByProspectId[7_777] = {
      id: 99,
      agreedPriceCents: 10_000,
      agreedDate: new Date("2026-04-15"),
    };
    // Inject extra fields the handler reads via Prisma.
    Object.assign(dbState.linkDealByProspectId[7_777], {
      linkUrl: "https://example.com/post",
      anchorText: "madonna",
      verifiedAt: null,
      remindersSent: 0,
      prospect: {
        domain: "example.com",
        contactEmail: "owner@example.com",
        target: { url: "https://www.protickets.com/madonna-tickets", keywords: "madonna", locale: "es-es" },
      },
    });
    const lead = seedLead({ status: "paid" });
    const ctx: DecideCtx = { ...makeCtx(lead), messages: [] };

    const decision = await decide(ctx);
    expect(decision.kind).toBe("close");
    if (decision.kind !== "close") throw new Error("unreachable");
    expect(decision.outcomeKind).toBe("deal_closed");
  });

  it("contacted with no inbound and follow-up due → send cold follow-up", async () => {
    const lead = seedLead({
      status: "contacted",
      state: {
        silenceFollowUpCount: 0,
        firstOutboundAt: "2026-04-10T09:00:00Z",
        lastOutboundAt: "2026-04-10T09:00:00Z",
        followUpNotBeforeAt: "2026-04-14T09:00:00Z",
      },
    });
    const ctx: DecideCtx = { ...makeCtx(lead), messages: [] };

    const decision = await decide(ctx);
    expect(decision.kind).toBe("send");
    if (decision.kind !== "send") throw new Error("unreachable");
    expect(decision.scheduleAt).toBeInstanceOf(Date);
    expect(decision.stateUpdate?.silenceFollowUpCount).toBe(1);
  });

  it("contacted + breakup angle does NOT pre-stall the lead before the send fires", async () => {
    const lead = seedLead({
      status: "contacted",
      state: {
        silenceFollowUpCount: 2, // next angle is breakup (day 24 from firstOutboundAt)
        firstOutboundAt: "2026-03-01T09:00:00Z", // > 24 days ago → breakup is due
        lastOutboundAt: "2026-04-15T09:00:00Z",
      },
    });
    const ctx: DecideCtx = { ...makeCtx(lead), messages: [] };

    const decision = await decide(ctx);
    expect(decision.kind).toBe("send");
    if (decision.kind !== "send") throw new Error("unreachable");
    // Critical: nextStatus must NOT be "stalled" — the send is in the future,
    // and a stalled status would silence inbound replies during the gap.
    expect(decision.nextStatus).toBeUndefined();
    // wakeAt should be after the scheduled send so planFollowUp closes later.
    expect(decision.wakeAt).toBeInstanceOf(Date);
  });

  it("waiting_for_invoice silent reply still persists finalInvoicePending", async () => {
    const { detectPaymentTransition } = await import("@/src/lib/link-agent/payment-detector");
    vi.mocked(detectPaymentTransition).mockResolvedValueOnce({
      invoiceClassification: { invoiceType: "proforma", evidence: "proforma" },
      paymentTransition: null,
      model: "test-model",
      durationMs: 1,
    });
    const { composePostDealReply } = await import("@/src/lib/link-agent/post-deal");
    vi.mocked(composePostDealReply).mockResolvedValueOnce({
      replySubject: null,
      replyBody: null,
      reasoning: "silent",
      ruleApplied: "silent",
      model: "test-model",
      durationMs: 1,
    });
    dbState.linkDealByProspectId[7_777] = {
      id: 99,
      agreedPriceCents: 10_000,
      agreedDate: new Date("2026-04-22"),
    };
    const lead = seedLead({ status: "waiting_for_invoice" });
    const ctx: DecideCtx = {
      ...makeCtx(lead),
      messages: [inbound("Aquí va la factura proforma.")],
    };

    const decision = await decide(ctx);
    expect(decision.kind).toBe("noop");
    if (decision.kind !== "noop") throw new Error("unreachable");
    expect(decision.stateUpdate).toMatchObject({ finalInvoicePending: true });

    await applyDecision({
      agent: linkProticketsAgent,
      config: coreConfig,
      lead,
      thread: null,
      decision,
      now: ctx.now,
    });
    const after = dbState.agentLead[lead.id]!;
    expect((after.state as Record<string, unknown>).finalInvoicePending).toBe(true);
  });

  it("contacted + max follow-ups exhausted → close stalled", async () => {
    const lead = seedLead({
      status: "contacted",
      state: {
        silenceFollowUpCount: 3,
        firstOutboundAt: "2026-04-01T09:00:00Z",
        lastOutboundAt: "2026-04-15T09:00:00Z",
      },
    });
    const ctx: DecideCtx = { ...makeCtx(lead), messages: [] };

    const decision = await decide(ctx);
    expect(decision.kind).toBe("close");
    if (decision.kind !== "close") throw new Error("unreachable");
    expect(decision.outcomeKind).toBe("stalled");
  });
});
