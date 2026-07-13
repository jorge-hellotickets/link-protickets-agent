import type { DecideCtx, Decision } from "./core/types";
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
export declare function decide(ctx: DecideCtx): Promise<Decision>;
/**
 * Payload attached to Decision.transitionPayload when accept → waiting_for_invoice.
 * onTransition() reads this to run the LinkDeal creation + budget-gating
 * transaction (this was previously done inside legacy process-inbound.ts).
 */
export interface LinkProticketsDealTerms {
    agreedPriceCents: number;
    redirectToArticle: boolean;
    linkAttribute: "dofollow" | "nofollow" | "unknown";
}
//# sourceMappingURL=decide.d.ts.map