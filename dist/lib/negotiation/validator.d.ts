/**
 * Post-redaction validator. Step E of
 * docs/link-agent/plan-split-negotiate.md.
 *
 * Pure function that inspects the redactor's body against the decided
 * `Action` + known agreed state, and returns a list of issues. The
 * orchestrator (step F) decides whether to regenerate once or drop the send.
 *
 * What we check:
 *   1. Prices named in the body equal `action.price` (when the action has one).
 *      If the action has no price, the body must name no price at all.
 *   2. Dates named in the body equal `agreedDate` (when one is set). When no
 *      date is agreed, any date is accepted — logistics flows often propose
 *      one.
 *   3. No protickets.com / hellotickets.com URL anywhere in the body.
 *   4. Body is non-empty.
 */
import type { Action } from "./decisor";
export interface ValidatorInput {
    body: string | null;
    action: Action;
    agreedDate: string | null;
}
export interface ValidatorResult {
    ok: boolean;
    issues: string[];
}
export declare function validate({ body, action, agreedDate }: ValidatorInput): ValidatorResult;
//# sourceMappingURL=validator.d.ts.map