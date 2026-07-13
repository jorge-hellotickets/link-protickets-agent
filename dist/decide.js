import { callAIGateway, parseGatewayJSON } from "./lib/ai/gateway";
import { SCORING_THRESHOLDS } from "./lib/config";
import { detectRejection } from "./lib/rejection-guardrail";
import { getHeadroom } from "./lib/budget";
import { getLocaleConfig } from "./lib/locale-config";
import { getLinkAgentRuntimeConfig } from "./lib/runtime-config";
import { computeReplySendAt } from "./lib/timing";
import { extractSignals } from "./lib/negotiation/extractor";
import { decide as runDecisor, emptyThreadState, } from "./lib/negotiation/decisor";
import { redact } from "./lib/negotiation/redactor";
import { composePostDealReply } from "./lib/post-deal";
import { detectPaymentTransition, } from "./lib/payment-detector";
import { nextFollowUp } from "./lib/negotiation-state";
import { composeFollowUpEmail } from "./lib/email-composer";
import { auditPublication, summarizeAuditIssuesEs, } from "./lib/publication-audit";
import { toComposerSubtype, derivePreviousAngles, } from "./follow-up-planner";
// NOTE: db usage below is host-specific (protickets Link* models + AgentLead).
// In standalone consumption these reads are driven from lead.data or the host
// wires platform adapters. For cutover compatibility the original queries are kept.
import { db } from "./lib/db-stub"; // replaced at integration time by host prisma client re-export or adapter
/**
 * link-protickets state machine entry point.
 *
 * Statuses (legacy LinkProspect.status → AgentLead.status, same strings):
 *   prospect → contacted → negotiating → waiting_for_invoice
 *     → waiting_for_payment → paid → (close: deal_closed)
 *   plus terminal side-exits: rejected, discarded, stalled.
 *
 * decide() is the single entrypoint for the new runtime.
 *
 * Initial cold outreach for "prospect" is now handled here (port of the legacy
 * composeOutreachEmail). Follow-ups and negotiation use the extractor/redactor
 * + follow-up-planner.
 *
 * decide() does not touch core tables or AgentMail — the core's
 * applyDecision() executes those side effects.
 */
export async function decide(ctx) {
    const { lead } = ctx;
    const hasInbound = latestInbound(ctx.messages) !== null;
    switch (lead.status) {
        case "prospect":
            return decideOnProspect(ctx);
        case "contacted":
            return hasInbound ? decideOnNegotiating(ctx) : planFollowUp(ctx, "contacted");
        case "negotiating":
            return hasInbound ? decideOnNegotiating(ctx) : planFollowUp(ctx, "negotiating");
        case "waiting_for_invoice":
            return decideOnWaitingInvoice(ctx);
        case "waiting_for_payment":
            return decideOnWaitingPayment(ctx);
        case "paid":
            return decideOnPaid(ctx);
        case "rejected":
        case "discarded":
        case "stalled":
            return { kind: "noop" };
        default:
            return { kind: "noop" };
    }
}
async function decideOnProspect(ctx) {
    const { lead, now, prompts } = ctx;
    const data = lead.data ?? {};
    const promptTemplate = prompts["outreach"];
    if (!promptTemplate) {
        // Prompt not available — wait and retry later (surfaces in admin)
        return { kind: "wait", wakeAt: new Date(now.getTime() + 24 * 3600_000) };
    }
    // Best-effort site snapshot for personalization in the outreach prompt.
    // If not pre-enriched at lead creation time, fetch a lightweight summary
    // from the homepage (title + leading text). Failures are non-fatal.
    let siteSnapshot = data.siteSnapshot;
    if (!siteSnapshot || siteSnapshot === "(not available)") {
        const dom = data.domain ?? lead.contactRef;
        if (dom && typeof dom === "string") {
            siteSnapshot = await fetchSiteSnapshot(dom);
        }
    }
    // The template in ctx.prompts already has {{persona}} etc substituted by the core.
    // Fill the per-prospect variables that remain as {{...}}.
    const localeCfg = getLocaleConfig(lead.locale ?? "es-es");
    const rendered = promptTemplate
        .replaceAll("{{prospectDomain}}", data.domain ?? lead.contactRef ?? "unknown")
        .replaceAll("{{targetKeywords}}", Array.isArray(data.targetKeywords) ? data.targetKeywords.join(", ") : (data.targetKeywords ?? ""))
        .replaceAll("{{category}}", data.category ?? "general")
        .replaceAll("{{siteSnapshot}}", siteSnapshot ?? "(not available)")
        .replaceAll("{{localeSettings}}", localeCfg.localeSettings ?? "");
    // Call LLM expecting JSON {subject, body}
    let draft;
    try {
        const text = await callAIGateway(rendered, {
            temperature: 0.7,
            model: (await getLinkAgentRuntimeConfig()).negotiationModel,
            responseFormat: {
                name: "LinkAgentEmailDraft",
                strict: true,
                schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                        subject: { type: "string" },
                        body: { type: "string" },
                    },
                    required: ["subject", "body"],
                },
            },
        });
        draft = parseGatewayJSON(text);
    }
    catch (err) {
        const domain = data.domain ?? lead.contactRef ?? "unknown";
        console.warn(`[link-protickets:first-send] outreach compose failed for lead ${lead.id} domain=${domain}: ${err.message}`);
        // Shorter backoff for cold first-send than generic waits. Will be retried by tick.
        return { kind: "wait", wakeAt: new Date(now.getTime() + 5 * 60 * 1000) };
    }
    if (!draft?.body) {
        const domain = data.domain ?? lead.contactRef ?? "unknown";
        console.warn(`[link-protickets:first-send] outreach compose returned no body for lead ${lead.id} domain=${domain}`);
        return { kind: "wait", wakeAt: new Date(now.getTime() + 5 * 60 * 1000) };
    }
    // Use immediate send (scheduleAt <= now) for the very first cold outreach.
    // This routes to sendMessage() (not scheduleDraft) in applyDecision so that
    // a real send failure prevents advancing status to "contacted" and firing
    // onTransition mirroring. The actual delivery happens before the DB state
    // change for the first send.
    const scheduleAt = now;
    return {
        kind: "send",
        body: draft.body.trim(),
        subject: draft.subject,
        scheduleAt,
        nextStatus: "contacted",
        wakeAt: new Date(now.getTime() + 3 * 86_400_000), // first follow-up window
        stateUpdate: {
            firstOutboundAt: now.toISOString(),
            lastOutboundAt: now.toISOString(),
        },
    };
}
/**
 * Cold follow-up planning. Mirrors outbound-worker.ts:planDueFollowUps for the
 * subset that decide() owns: given a lead waking up at nextWakeAt, decide
 * whether to send the next angle, wait, or stall out.
 *
 * The legacy outreach wave (initial send that flips prospect→contacted) stays
 * in outbound-worker.ts; we only port silence-driven follow-ups here.
 */
async function planFollowUp(ctx, statusForKind) {
    const { lead, now } = ctx;
    const data = lead.data ?? {};
    const state = lead.state ?? {};
    if (latestInbound(ctx.messages)) {
        return { kind: "noop" };
    }
    const localeStr = lead.locale ?? "es-es";
    const localeCfg = getLocaleConfig(localeStr);
    const followUpState = {
        silenceFollowUpCount: state.silenceFollowUpCount ?? 0,
        firstOutboundAt: state.firstOutboundAt,
        lastOutboundAt: state.lastOutboundAt,
        followUpNotBeforeAt: state.followUpNotBeforeAt,
    };
    const instruction = nextFollowUp(statusForKind, followUpState, localeCfg.timezone);
    if (!instruction) {
        return { kind: "close", outcomeKind: "stalled" };
    }
    if (instruction.sendNotBefore.getTime() > now.getTime()) {
        return { kind: "wait", wakeAt: instruction.sendNotBefore };
    }
    if (data.targetId === undefined) {
        return { kind: "noop" };
    }
    const target = await db.linkTarget.findUnique({
        where: { id: data.targetId },
        select: { url: true, keywords: true, locale: true },
    });
    if (!target)
        return { kind: "noop" };
    const emailHistory = formatEmailHistory(ctx.messages);
    const subtype = toComposerSubtype(instruction.kind, statusForKind, followUpState.silenceFollowUpCount);
    const draft = await composeFollowUpEmail({
        mode: "follow_up",
        subtype,
        prospectDomain: data.domain ?? lead.contactRef ?? "",
        emailHistory,
        targetKeywords: target.keywords,
        targetUrl: target.url,
        locale: target.locale,
        previousAngles: derivePreviousAngles(followUpState.silenceFollowUpCount),
    });
    // Clamp scheduling identically to legacy: ≥3d after last outbound, ≥1min from now.
    const lastOut = followUpState.lastOutboundAt
        ? new Date(followUpState.lastOutboundAt).getTime()
        : 0;
    const scheduleAt = new Date(Math.max(instruction.sendNotBefore.getTime(), lastOut + 3 * 86_400_000, now.getTime() + 60_000));
    const nextCount = followUpState.silenceFollowUpCount + 1;
    const stateUpdate = {
        silenceFollowUpCount: nextCount,
        lastOutboundAt: scheduleAt.toISOString(),
        followUpNotBeforeAt: undefined,
        firstOutboundAt: followUpState.firstOutboundAt ?? scheduleAt.toISOString(),
    };
    const isBreakup = instruction.kind === "breakup";
    return {
        kind: "send",
        body: draft.body,
        subject: draft.subject,
        scheduleAt,
        // Don't transition to stalled here — the breakup hasn't been sent yet
        // (scheduleAt is ≥1min in the future). Wake the lead the day after the
        // scheduled send; planFollowUp() will see silenceFollowUpCount === max
        // and emit close(stalled). If a reply arrives in the meantime the
        // inbound webhook re-routes to decideOnNegotiating.
        stateUpdate,
        wakeAt: isBreakup
            ? new Date(scheduleAt.getTime() + 86_400_000)
            : computeNextWakeForFollowUp(scheduleAt, nextCount, statusForKind),
    };
}
function computeNextWakeForFollowUp(scheduleAt, newCount, status) {
    const nextInstruction = nextFollowUp(status, { silenceFollowUpCount: newCount, firstOutboundAt: scheduleAt.toISOString(), lastOutboundAt: scheduleAt.toISOString() }, "Europe/Madrid");
    return nextInstruction?.sendNotBefore ?? null;
}
// ─── Post-deal: waiting_for_invoice ───
async function decideOnWaitingInvoice(ctx) {
    return postDealReply(ctx, "waiting_for_invoice");
}
async function decideOnWaitingPayment(ctx) {
    return postDealReply(ctx, "waiting_for_payment");
}
async function postDealReply(ctx, status) {
    const { lead, messages, now } = ctx;
    const inbound = latestInbound(messages);
    if (!inbound)
        return { kind: "noop" };
    const data = lead.data ?? {};
    const localeStr = lead.locale ?? "es-es";
    const localeCfg = getLocaleConfig(localeStr);
    const legacyProspectId = data.legacyProspectId;
    if (legacyProspectId === undefined)
        return { kind: "noop" };
    const deal = await db.linkDeal.findUnique({
        where: { prospectId: legacyProspectId },
        select: {
            id: true,
            agreedPriceCents: true,
            agreedDate: true,
            linkUrl: true,
            anchorText: true,
            paidAt: true,
        },
    });
    if (!deal)
        return { kind: "noop" };
    const runtimeConfig = await getLinkAgentRuntimeConfig();
    const model = runtimeConfig.negotiationModel;
    // Classify the inbound (skip if already paid — nothing more to transition).
    let invoiceType = "none";
    let paymentEvidence = null;
    if (!deal.paidAt) {
        const detection = await detectPaymentTransition({
            prospectDomain: data.domain ?? lead.contactRef ?? "",
            inboundBody: inbound.body,
            inboundSubject: inbound.subject ?? "",
        });
        if (detection.invoiceClassification) {
            invoiceType = detection.invoiceClassification.invoiceType;
            paymentEvidence = detection.invoiceClassification.evidence;
        }
    }
    const stateObj = lead.state ?? {};
    const finalInvoicePending = stateObj.finalInvoicePending === true;
    const reply = await composePostDealReply({
        prospectDomain: data.domain ?? lead.contactRef ?? "",
        emailHistory: formatEmailHistory(messages),
        inboundBody: inbound.body,
        inboundSubject: inbound.subject ?? "",
        agreedPriceCents: deal.agreedPriceCents,
        agreedDate: deal.agreedDate,
        linkUrl: deal.linkUrl,
        anchorText: deal.anchorText,
        status,
        finalInvoicePending,
        invoiceType,
        locale: localeStr,
    }, model);
    // Track pending-final flag off the latest classification (mirrors legacy).
    const stateUpdate = {};
    if (invoiceType === "proforma")
        stateUpdate.finalInvoicePending = true;
    else if (invoiceType === "final")
        stateUpdate.finalInvoicePending = false;
    // Promotion to waiting_for_payment requires:
    //   - status=waiting_for_invoice (transition is illegal otherwise),
    //   - final invoice classification with non-empty evidence found in inbound.
    const promote = status === "waiting_for_invoice" &&
        invoiceType === "final" &&
        paymentEvidence !== null &&
        normalizeForEvidenceMatch(inbound.body).includes(normalizeForEvidenceMatch(paymentEvidence));
    // Body may be null (post-deal composer goes silent on no-new-info inbounds).
    if (!reply.replyBody) {
        if (promote) {
            return {
                kind: "transition",
                nextStatus: "waiting_for_payment",
                stateUpdate,
                transitionPayload: {
                    domain: data.domain ?? lead.contactRef ?? "",
                    locale: localeStr,
                    priceCents: deal.agreedPriceCents,
                    evidence: paymentEvidence ?? "",
                },
            };
        }
        // Even on a silent reply we may have flipped finalInvoicePending — pass
        // that through stateUpdate so the next inbound sees the latest classification.
        return Object.keys(stateUpdate).length
            ? { kind: "noop", stateUpdate }
            : { kind: "noop" };
    }
    const scheduleAt = computeReplySendAt(now, localeCfg.timezone, false, undefined, {
        minMinutes: runtimeConfig.replyDelayMinMinutes,
        maxMinutes: runtimeConfig.replyDelayMaxMinutes,
        bh: runtimeConfig.businessHours,
    });
    return {
        kind: "send",
        body: reply.replyBody,
        subject: reply.replySubject ?? undefined,
        scheduleAt,
        inReplyTo: inbound.externalId,
        nextStatus: promote ? "waiting_for_payment" : undefined,
        stateUpdate,
        transitionPayload: promote
            ? {
                domain: data.domain ?? lead.contactRef ?? "",
                locale: localeStr,
                priceCents: deal.agreedPriceCents,
                evidence: paymentEvidence ?? "",
            }
            : undefined,
    };
}
function normalizeForEvidenceMatch(s) {
    return s
        .toLowerCase()
        .replace(/[‘’‚‛]/g, "'")
        .replace(/[“”„‟]/g, '"')
        .replace(/[–—]/g, "-")
        .replace(/\s+/g, " ")
        .trim();
}
// ─── Paid: publication audit + nudge ───
async function decideOnPaid(ctx) {
    const { lead, now } = ctx;
    const data = lead.data ?? {};
    const legacyProspectId = data.legacyProspectId;
    if (legacyProspectId === undefined)
        return { kind: "noop" };
    const deal = await db.linkDeal.findUnique({
        where: { prospectId: legacyProspectId },
        select: {
            id: true,
            agreedDate: true,
            linkUrl: true,
            anchorText: true,
            verifiedAt: true,
            remindersSent: true,
            prospect: {
                select: { domain: true, contactEmail: true, target: { select: { url: true, keywords: true, locale: true } } },
            },
        },
    });
    if (!deal)
        return { kind: "noop" };
    if (deal.verifiedAt)
        return { kind: "close", outcomeKind: "deal_closed" };
    // Don't run before the agreed publication date.
    if (deal.agreedDate.getTime() > now.getTime()) {
        return { kind: "wait", wakeAt: new Date(deal.agreedDate.getTime() + 48 * 3600_000) };
    }
    // If we know the link URL, audit it. A clean audit closes the deal; a
    // failing audit switches from a generic nudge to a specific fix request
    // (unless the only issue is that the link is missing — then a plain nudge
    // is still appropriate).
    let audit = null;
    if (deal.linkUrl) {
        try {
            audit = await auditPublication({
                linkUrl: deal.linkUrl,
                targetUrl: deal.prospect.target.url,
                expectedAnchorText: deal.anchorText,
            });
            if (audit.ok) {
                await db.linkDeal.update({
                    where: { id: deal.id },
                    data: { audit: audit, verifiedAt: now },
                });
                return { kind: "close", outcomeKind: "deal_closed" };
            }
            // Persist failing audit for visibility; fall through to nudge.
            await db.linkDeal.update({
                where: { id: deal.id },
                data: { audit: audit },
            });
        }
        catch (err) {
            audit = null;
            console.warn(`[link-protickets] decideOnPaid audit failed for ${deal.prospect.domain}: ${err.message}`);
        }
    }
    // Stop nudging after 3 reminders; the human takes over.
    if (deal.remindersSent >= 3)
        return { kind: "noop" };
    const emailHistory = formatEmailHistory(ctx.messages);
    const useFixRequest = audit !== null && audit.issues[0] !== "missing";
    const subtype = useFixRequest
        ? "link_fix_request"
        : "publication_nudge";
    const draft = await composeFollowUpEmail({
        mode: "follow_up",
        subtype,
        prospectDomain: deal.prospect.domain,
        emailHistory,
        targetKeywords: deal.prospect.target.keywords,
        targetUrl: deal.prospect.target.url,
        locale: deal.prospect.target.locale,
        linkFixBrief: useFixRequest ? summarizeAuditIssuesEs(audit) : undefined,
        linkFixTargetUrl: useFixRequest ? deal.prospect.target.url : undefined,
        linkFixAnchorText: useFixRequest ? deal.anchorText ?? undefined : undefined,
        linkFixPriorAsks: useFixRequest ? deal.remindersSent : undefined,
    });
    const scheduleAt = new Date(now.getTime() + 2 * 3600_000);
    // Increment remindersSent in onTransition (after the send actually persists),
    // not here — pre-incrementing means transient mail failures permanently
    // exhaust the 3-reminder cap on retry.
    return {
        kind: "send",
        body: draft.body,
        subject: draft.subject,
        scheduleAt,
        wakeAt: new Date(now.getTime() + 7 * 86_400_000),
        transitionPayload: { kind: "publication_nudge", dealId: deal.id },
    };
}
async function decideOnNegotiating(ctx) {
    const { lead, messages, now } = ctx;
    const inbound = latestInbound(messages);
    if (!inbound) {
        // No inbound to react to — legacy follow-up scheduling lives elsewhere
        // and will be ported in its own step.
        return { kind: "noop" };
    }
    const data = lead.data ?? {};
    const locale = lead.locale ?? "es-es";
    const localeCfg = getLocaleConfig(locale);
    const rounds = data.emailRoundsSent ?? 0;
    // Existing deal gates rejection + max-rounds: once we've closed, a stray
    // "please stop" or the Nth invoice follow-up must not demote the lead.
    const legacyProspectId = data.legacyProspectId;
    const existingDeal = legacyProspectId !== undefined
        ? await db.linkDeal.findUnique({
            where: { prospectId: legacyProspectId },
            select: { id: true, agreedPriceCents: true, paidAt: true },
        })
        : null;
    const hasClosedDeal = existingDeal !== null;
    if (!hasClosedDeal && rounds >= SCORING_THRESHOLDS.maxRounds) {
        return { kind: "close", outcomeKind: "max_rounds" };
    }
    if (!hasClosedDeal) {
        const guardrail = detectRejection(inbound.body);
        if (guardrail.rejected) {
            return {
                kind: "close",
                outcomeKind: "rejected",
                outcomeData: {
                    reason: "guardrail",
                    matchedPattern: guardrail.matchedPattern,
                    matchedSnippet: guardrail.matchedSnippet,
                },
            };
        }
    }
    const headroom = await getHeadroom(locale);
    const maxPriceCents = Math.round(headroom.avgPerLinkCents * 1.3);
    const budget = toBudgetCtx(maxPriceCents);
    const emailHistory = formatEmailHistory(messages);
    const runtimeConfig = await getLinkAgentRuntimeConfig();
    const model = runtimeConfig.negotiationModel;
    const { signals } = await extractSignals({
        emailHistory,
        inboundBody: inbound.body,
        model,
        promptOverride: ctx.prompts["negotiation.extractor"],
    });
    const state = (lead.state ?? {}).thread ?? emptyThreadState();
    const { action, nextState } = runDecisor(state, signals, budget);
    return actionToDecision({
        action,
        nextThreadState: nextState,
        ctx,
        inbound,
        emailHistory,
        localeCfg,
        model,
        now,
        runtimeConfig,
        maxPriceCents,
    });
}
async function actionToDecision(args) {
    const { action, nextThreadState } = args;
    const stateUpdate = { thread: nextThreadState };
    // Non-sendable terminals — no LLM call, no outbound.
    if (action.kind === "terminal") {
        // unsubscribe / bounce — close the lead.
        return {
            kind: "close",
            outcomeKind: action.reason === "unsubscribe" ? "rejected" : "bounce",
            outcomeData: { reason: action.reason },
            stateUpdate,
        };
    }
    if (action.kind === "stall") {
        // Two consecutive no-new-info inbounds: park the thread.
        return { kind: "close", outcomeKind: "stalled", stateUpdate };
    }
    if (action.kind === "decline") {
        // decline is sendable (polite "no") but terminal — send + stalled.
        return sendableToDecision(action, args, "stalled", /*close*/ true);
    }
    // Sendable actions that continue the negotiation.
    const nextStatus = action.kind === "accept" ? "waiting_for_invoice" : "negotiating";
    return sendableToDecision(action, args, nextStatus, /*close*/ false);
}
async function sendableToDecision(action, args, nextStatus, shouldClose) {
    const { subject, body } = await redact({
        emailHistory: args.emailHistory,
        inboundBody: args.inbound.body,
        inboundSubject: args.inbound.subject ?? "",
        action,
        locale: args.localeCfg,
        model: args.model,
        promptOverride: args.ctx.prompts["negotiation.redactor"],
    });
    const stateUpdate = { thread: args.nextThreadState };
    if (!body) {
        // Redactor returned null (validator dropped, short-circuit, etc). Treat as
        // a noop — legacy behaviour was to skip scheduling the draft and carry on.
        if (shouldClose) {
            return { kind: "close", outcomeKind: nextStatus, stateUpdate };
        }
        return { kind: "noop" };
    }
    const scheduleAt = computeReplySendAt(args.now, args.localeCfg.timezone, false, undefined, {
        minMinutes: args.runtimeConfig.replyDelayMinMinutes,
        maxMinutes: args.runtimeConfig.replyDelayMaxMinutes,
        bh: args.runtimeConfig.businessHours,
    });
    let transitionPayload;
    if (action.kind === "accept") {
        transitionPayload = {
            agreedPriceCents: action.price * 100,
            redirectToArticle: action.redirectToArticle,
            linkAttribute: action.linkAttribute,
        };
    }
    const send = {
        kind: "send",
        body,
        subject: subject ?? undefined,
        scheduleAt,
        inReplyTo: args.inbound.externalId,
        nextStatus,
        stateUpdate,
        transitionPayload,
    };
    // When the action closes the thread (decline), still express the side-effect
    // via `send` — PR4 will split into send+close. For PR3 the test cases cover
    // kind/nextStatus semantics; `shouldClose` is reflected by nextStatus only.
    void shouldClose;
    return send;
}
// ─── Helpers ───
function latestInbound(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].direction === "inbound")
            return messages[i];
    }
    return null;
}
function formatEmailHistory(messages) {
    return messages
        .map((m) => {
        const tag = m.direction === "inbound" ? "FROM PROSPECT" : "FROM US";
        const subjectLine = m.subject ? `Subject: ${m.subject}\n` : "";
        return `[${tag}]\n${subjectLine}${m.body}`;
    })
        .join("\n\n---\n\n");
}
function toBudgetCtx(maxPriceCents) {
    const round10 = (v) => Math.round(v / 10) * 10;
    return {
        targetPrice: round10(maxPriceCents / 100),
        hardCap: round10((maxPriceCents * 1.5) / 100),
        smallGapCap: round10((maxPriceCents * 1.1) / 100),
        bigGapThreshold: round10((maxPriceCents * 1.8) / 100),
    };
}
/**
 * Lightweight homepage fetch for the outreach prompt's {{siteSnapshot}}.
 * Extracts <title> + a prefix of de-tagged body text. Hard timeout, best-effort.
 * Never throws — returns a short fallback string on any failure.
 */
async function fetchSiteSnapshot(domain) {
    const fallback = "(not available)";
    try {
        const url = domain.startsWith("http") ? domain : `https://${domain}`;
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 4500);
        const res = await fetch(url, {
            headers: { "User-Agent": "Protickets-LinkBot/1.0 (outreach personalization)" },
            signal: controller.signal,
            redirect: "follow",
        });
        clearTimeout(t);
        if (!res.ok)
            return fallback;
        const html = await res.text();
        const titleMatch = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
        const title = titleMatch ? titleMatch[1].trim() : "";
        // crude de-tag + collapse; take a useful prefix for the LLM
        const text = html
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 450);
        const combined = [title, text].filter((s) => s && s.length > 3).join(" — ").slice(0, 600);
        return combined || fallback;
    }
    catch {
        return fallback;
    }
}
//# sourceMappingURL=decide.js.map