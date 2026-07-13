import type { TransitionCtx } from "./core/types";
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
export declare function onTransition(ctx: TransitionCtx): Promise<void>;
//# sourceMappingURL=hooks.d.ts.map