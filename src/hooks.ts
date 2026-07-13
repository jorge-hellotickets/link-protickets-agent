import type { TransitionCtx } from "./core/types";
import { getHeadroom } from "./lib/budget";
import {
  composePaidNotificationEmail,
  DEFAULT_PAID_NOTIFICATION_PROMPT,
  resolvePaidNotificationLocale,
} from "./lib/paid-notification";  // will be ported or stubbed by host
import { getLinkAgentRuntimeConfig } from "./lib/runtime-config";
import { loadAgentConfig } from "./core/registry-stub"; // provided by @fintmedia/agent-core
import { replyToMessage, loadThreadMessages } from "./core/mail-channel-stub"; // provided by host core
import type { LinkProticketsDealTerms } from "./decide";

// NOTE: direct db + paid-notification + mail-channel are host/platform specific during cutover.
// The onTransition side effects (deal tx, mirroring, Slack, paid emails) stay agent-owned
// but delegate I/O to the consuming host (protickets) via adapters or shared prisma models.
import { db } from "./lib/db-stub";

/**
 * link-protickets onTransition — side effects the core fires after a Decision
 * mutates status.
 *
 * PR4a / PR4b:
 *   - waiting_for_invoice: deal creation + budget tx (mirrors legacy)
 *   - waiting_for_payment: Slack notify
 *   - paid: sends paid notification email via handlePaidTransition
 *   - deal_closed: handled in decideOnPaid (audit + close)
 *   - Terminal states: noop (close is handled by core)
 *
 * Mirroring to legacy LinkProspect is kept for backward compat during cutover.
 */
export async function onTransition(ctx: TransitionCtx): Promise<void> {
  const { prevStatus, nextStatus, lead, decision, now } = ctx;

  // Mirror AgentLead status/closure into LinkProspect so legacy consumers
  // (outbound cron planDueFollowUps, admin listMailThreads) stay in sync with
  // the new runtime. No-op when the lead has no linked LinkProspect.
  if (prevStatus !== nextStatus || decision.kind === "close") {
    await mirrorStatusToLinkProspect(lead, nextStatus, decision, now);
  }

  if (prevStatus !== "waiting_for_invoice" && nextStatus === "waiting_for_invoice") {
    await handleAcceptTransition(ctx);
    return;
  }

  if (prevStatus !== "waiting_for_payment" && nextStatus === "waiting_for_payment") {
    const data = (lead.data as LinkLeadData | null) ?? {};
    const payload = readWaitingForPaymentPayload(decision);
    const domain = payload?.domain ?? data.domain ?? lead.contactRef ?? "unknown";
    const priceCents = payload?.priceCents ?? readPriceFromState(lead.state) ?? 0;
    const evidence = payload?.evidence ?? "";
    await notifyLinkBuildingWaitingForPayment({
      domain,
      locale: lead.locale ?? "",
      priceCents,
      evidence,
    });
  }

  if (prevStatus !== "paid" && nextStatus === "paid") {
    await handlePaidTransition(ctx);
    await schedulePaidWake(ctx);
  }

  // Same-status payload hooks: fired by persistence when decision carries a
  // transitionPayload but no status change (e.g. publication_nudge sent).
  if (prevStatus === nextStatus && decision.kind === "send") {
    const payload = decision.transitionPayload as
      | { kind?: string; dealId?: number }
      | undefined;
    if (payload?.kind === "publication_nudge" && typeof payload.dealId === "number") {
      try {
        await db.linkDeal.update({
          where: { id: payload.dealId },
          data: { remindersSent: { increment: 1 } },
        });
      } catch (err) {
        console.warn(
          `[link-protickets] publication_nudge increment failed for deal ${payload.dealId}: ${(err as Error).message}`,
        );
      }
    }
  }

  void now;
}

interface WaitingForPaymentPayload {
  domain?: string;
  locale?: string;
  priceCents?: number;
  evidence?: string;
}

function readWaitingForPaymentPayload(
  decision: TransitionCtx["decision"],
): WaitingForPaymentPayload | null {
  if (decision.kind !== "send" && decision.kind !== "transition") return null;
  const payload = decision.transitionPayload;
  if (!payload || typeof payload !== "object") return null;
  return payload as WaitingForPaymentPayload;
}

/**
 * When a lead enters `paid`, arm nextWakeAt so decideOnPaid (publication audit
 * + nudge) fires. Wake just after agreedDate when it's still in the future; if
 * the agreed date already passed, wake within the next tick. Replaces the
 * legacy planPublicationFollowUps cron which scanned LinkDeal directly.
 */
async function schedulePaidWake(ctx: TransitionCtx): Promise<void> {
  const { lead, now } = ctx;
  const data = (lead.data as LinkLeadData | null) ?? {};
  const legacyProspectId = data.legacyProspectId;
  if (legacyProspectId === undefined) return;

  const deal = await db.linkDeal.findUnique({
    where: { prospectId: legacyProspectId },
    select: { agreedDate: true },
  });

  const agreedDate = deal?.agreedDate ?? now;
  // Wake 48h after max(agreedDate, now) to give the publisher a grace window
  // before we audit / nudge. decideOnPaid() only applies its own 48h deferral
  // when it fires *before* agreedDate — so waking earlier than this would
  // bypass the grace period for future-dated deals and audit too soon.
  const wakeAt = new Date(
    Math.max(agreedDate.getTime(), now.getTime()) + 48 * 3_600_000,
  );

  try {
    await db.agentLead.update({
      where: { id: lead.id },
      data: { nextWakeAt: wakeAt },
    });
  } catch (err) {
    console.warn(
      `[link-protickets] schedulePaidWake failed for lead ${lead.id}: ${(err as Error).message}`,
    );
  }
}

async function handlePaidTransition(ctx: TransitionCtx): Promise<void> {
  const { lead, now } = ctx;
  const data = (lead.data as LinkLeadData | null) ?? {};
  const legacyProspectId = data.legacyProspectId;
  if (legacyProspectId === undefined) return;

  const deal = await db.linkDeal.findUnique({
    where: { prospectId: legacyProspectId },
    select: {
      agreedPriceCents: true,
      agreedDate: true,
      prospect: { select: { domain: true, target: { select: { keywords: true } } } },
    },
  });
  if (!deal) return;

  const cfg = await loadAgentConfig("link-protickets");
  if (!cfg) return;

  const localeStr = lead.locale ?? "es-es";
  const localeCfg = resolvePaidNotificationLocale(localeStr);
  const runtime = await getLinkAgentRuntimeConfig();

  let composed: { body: string };
  try {
    composed = await composePaidNotificationEmail(
      {
        prospectDomain: deal.prospect.domain,
        targetKeywords: deal.prospect.target.keywords,
        priceAmount: (deal.agreedPriceCents / 100).toFixed(0),
        publicationDate: deal.agreedDate.toISOString().slice(0, 10),
        locale: localeCfg,
      },
      DEFAULT_PAID_NOTIFICATION_PROMPT,
      runtime.negotiationModel,
    );
  } catch (err) {
    console.warn(
      `[link-protickets] paid notification compose failed for lead ${lead.id}: ${(err as Error).message}`,
    );
    return;
  }

  if (!composed.body?.trim()) return;

  // replyToMessage() needs a *message* id, not a thread id. Fetch the thread's
  // messages and pick the latest — prefer the most recent inbound, fall back
  // to the most recent message if the thread is outbound-only.
  const thread = await db.agentThread.findFirst({
    where: { leadId: lead.id },
    orderBy: { lastInboundAt: "desc" },
  });
  if (!thread) return;

  let inReplyTo: string | undefined;
  try {
    const messages = await loadThreadMessages(cfg.config, localeStr, thread.externalId);
    const latestInbound = [...messages].reverse().find((m) => m.direction === "inbound");
    inReplyTo = latestInbound?.externalId ?? messages.at(-1)?.externalId;
  } catch (err) {
    console.warn(
      `[link-protickets] paid notification thread fetch failed for lead ${lead.id}: ${(err as Error).message}`,
    );
    return;
  }
  if (!inReplyTo) return;

  try {
    await replyToMessage({
      config: cfg.config,
      locale: localeStr,
      inReplyTo,
      body: composed.body,
    });
  } catch (err) {
    console.warn(
      `[link-protickets] paid notification send failed for lead ${lead.id}: ${(err as Error).message}`,
    );
  }
  void now;
}

interface LinkLeadData {
  legacyProspectId?: number;
  domain?: string;
  targetId?: number;
}

async function mirrorStatusToLinkProspect(
  lead: TransitionCtx["lead"],
  nextStatus: string,
  _decision: TransitionCtx["decision"],
  _now: Date,
): Promise<void> {
  const data = (lead.data as LinkLeadData | null) ?? {};
  const legacyProspectId = data.legacyProspectId;
  if (legacyProspectId === undefined) return;

  try {
    await db.linkProspect.update({
      where: { id: legacyProspectId },
      data: { status: nextStatus },
    });
  } catch (err) {
    console.warn(
      `[link-protickets] LinkProspect mirror failed for lead ${lead.id} (prospectId=${legacyProspectId}): ${(err as Error).message}`,
    );
  }
}

function readPriceFromState(state: unknown): number | null {
  if (!state || typeof state !== "object") return null;
  const thread = (state as Record<string, unknown>).thread;
  if (!thread || typeof thread !== "object") return null;
  const accepted = (thread as Record<string, unknown>).acceptedPrice;
  if (typeof accepted === "number") return Math.round(accepted * 100);
  return null;
}

async function handleAcceptTransition(ctx: TransitionCtx): Promise<void> {
  const { lead, decision, now } = ctx;
  const data = (lead.data as LinkLeadData | null) ?? {};
  const legacyProspectId = data.legacyProspectId;
  if (legacyProspectId === undefined) {
    console.warn(
      `[link-protickets] onTransition(waiting_for_invoice): lead ${lead.id} has no legacyProspectId — skipping deal creation`,
    );
    return;
  }

  const terms = readTerms(decision);
  if (!terms) {
    console.warn(
      `[link-protickets] onTransition(waiting_for_invoice): lead ${lead.id} decision carries no transitionPayload — skipping deal creation`,
    );
    return;
  }

  const locale = lead.locale ?? "";
  const headroom = await getHeadroom(locale);

  const dealResult = await db.$transaction(async (tx: any) => {
    const txThisMonthBudget = headroom.thisMonth.str
      ? await tx.linkBudget.findFirst({
          where: { locale, month: headroom.thisMonth.str },
        })
      : null;
    const txNextMonthBudget = headroom.nextMonth.str
      ? await tx.linkBudget.findFirst({
          where: { locale, month: headroom.nextMonth.str },
        })
      : null;

    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const monthAfterStart = new Date(now.getFullYear(), now.getMonth() + 2, 1);

    const [thisCommitted, nextCommitted] = await Promise.all([
      tx.linkDeal.aggregate({
        where: {
          paidAt: null,
          prospect: { target: { locale } },
          agreedDate: { gte: thisMonthStart, lt: nextMonthStart },
        },
        _sum: { agreedPriceCents: true },
      }),
      tx.linkDeal.aggregate({
        where: {
          paidAt: null,
          prospect: { target: { locale } },
          agreedDate: { gte: nextMonthStart, lt: monthAfterStart },
        },
        _sum: { agreedPriceCents: true },
      }),
    ]);

    const txThisCommitted = thisCommitted._sum.agreedPriceCents ?? 0;
    const txNextCommitted = nextCommitted._sum.agreedPriceCents ?? 0;

    const txThisHeadroom = txThisMonthBudget
      ? Math.max(
          0,
          txThisMonthBudget.limitCents -
            txThisMonthBudget.spentCents -
            txThisCommitted,
        )
      : 0;
    const txNextHeadroom = txNextMonthBudget
      ? Math.max(0, txNextMonthBudget.limitCents - txNextCommitted)
      : 0;

    const priceCents = terms.agreedPriceCents;
    if (txThisHeadroom + txNextHeadroom < priceCents) {
      return { status: "budget_exhausted" as const };
    }

    const isForwardCommitment = txThisHeadroom < priceCents;
    const agreedDate = isForwardCommitment ? nextMonthStart : now;

    const deal = await tx.linkDeal.upsert({
      where: { prospectId: legacyProspectId },
      create: {
        prospectId: legacyProspectId,
        agreedPriceCents: priceCents,
        agreedDate,
        linkUrl: null,
        anchorText: null,
        placementCategory: "article",
        placementSurfaceRaw: null,
      },
      update: {},
    });

    return { status: "accepted" as const, deal, isForwardCommitment, agreedDate };
  });

  if (dealResult.status === "budget_exhausted") {
    console.warn(
      `[link-protickets] Budget exhausted for ${locale} — demoting lead ${lead.id} to rejected`,
    );
    await db.agentLead.update({
      where: { id: lead.id },
      data: {
        status: "rejected",
        outcomeKind: "budget_exhausted",
        closedAt: now,
        nextWakeAt: null,
      },
    });
    return;
  }

  console.log(
    `[link-protickets] Deal created for lead ${lead.id}: ${dealResult.deal.agreedPriceCents}c (forward=${dealResult.isForwardCommitment})`,
  );
}

function readTerms(decision: TransitionCtx["decision"]): LinkProticketsDealTerms | null {
  if (decision.kind !== "send" && decision.kind !== "transition") return null;
  const payload = decision.transitionPayload;
  if (!payload || typeof payload !== "object") return null;
  const price = (payload as Record<string, unknown>).agreedPriceCents;
  if (typeof price !== "number") return null;
  return payload as LinkProticketsDealTerms;
}

async function notifyLinkBuildingWaitingForPayment(args: {
  domain: string;
  locale: string;
  priceCents: number;
  evidence: string;
}): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_LINK_BUILDING ?? "";
  if (!url) return;
  try {
    const price = (args.priceCents / 100).toFixed(2);
    const quote =
      args.evidence.length > 160 ? `${args.evidence.slice(0, 160)}…` : args.evidence;
    const text = `:moneybag: *Waiting for payment* — ${args.domain} (${args.locale}) · €${price}${quote ? `\n> ${quote}` : ""}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      console.warn(`[link-protickets] Slack notify failed: ${res.status}`);
    }
  } catch (err) {
    console.warn(`[link-protickets] Slack notify error: ${(err as Error).message}`);
  }
}
