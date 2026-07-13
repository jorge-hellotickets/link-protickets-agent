import type { FollowUpKind } from "./lib/negotiation-state";
import type { FollowUpSubtype } from "./lib/types";
/**
 * link-protickets follow-up helpers.
 *
 * Owned by the instance — decide.ts imports these to plan the silence-driven
 * follow-up sequence. The legacy `outbound-worker.ts` re-exports them so its
 * own planner path and the admin rewrite flow stay on the same implementation
 * until the legacy runtime is fully retired.
 *
 * Kept as pure functions (no I/O) so both the legacy cron and the new decide()
 * produce byte-identical subtype/angle decisions for the same lead state.
 */
/** Angles used in the cold follow-up sequence, indexed by silenceFollowUpCount. */
export declare const COLD_ANGLES: string[];
/**
 * Map FollowUpKind + prospect status + silence count to the FollowUpSubtype
 * expected by the email composer.
 */
export declare function toComposerSubtype(kind: FollowUpKind, status: string, silenceFollowUpCount: number): FollowUpSubtype;
/**
 * Derive previous follow-up angles from the silence follow-up count.
 * E.g. if count is 2, angles 0 and 1 ("soft_reminder", "friction_reduction") were already used.
 */
export declare function derivePreviousAngles(silenceFollowUpCount: number): string[];
//# sourceMappingURL=follow-up-planner.d.ts.map