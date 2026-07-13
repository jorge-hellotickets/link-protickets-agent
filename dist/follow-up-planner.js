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
export const COLD_ANGLES = ["soft_reminder", "friction_reduction", "clean_breakup"];
/**
 * Map FollowUpKind + prospect status + silence count to the FollowUpSubtype
 * expected by the email composer.
 */
export function toComposerSubtype(kind, status, silenceFollowUpCount) {
    if (kind === "breakup") {
        return status === "contacted" ? "cold_breakup" : "negotiation_breakup";
    }
    if (status === "contacted") {
        // count 0 → cold_follow_up_1, count 1 → cold_follow_up_2
        return silenceFollowUpCount === 0 ? "cold_follow_up_1" : "cold_follow_up_2";
    }
    return "negotiation_nudge";
}
/**
 * Derive previous follow-up angles from the silence follow-up count.
 * E.g. if count is 2, angles 0 and 1 ("soft_reminder", "friction_reduction") were already used.
 */
export function derivePreviousAngles(silenceFollowUpCount) {
    return COLD_ANGLES.slice(0, silenceFollowUpCount);
}
//# sourceMappingURL=follow-up-planner.js.map