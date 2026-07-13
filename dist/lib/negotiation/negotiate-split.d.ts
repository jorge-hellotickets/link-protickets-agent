/**
 * Orchestrator for the split negotiation pipeline. Step F of
 * docs/link-agent/plan-split-negotiate.md.
 *
 *   thread + threadState ──► extractor (LLM) ──► signals
 *   state + signals + budget ──► decisor (pure) ──► action + nextState
 *   thread + action + locale ──► redactor (LLM) ──► subject, body
 *   action + body + agreedDate ──► validator (pure)
 *     on failure: regen once, then drop (null body)
 *   persist nextState
 *
 * This function is side-effect free with respect to the DB — it reads and
 * returns state. The caller (`process-inbound.ts`, once wired) persists
 * `nextState` back into `LinkProspect.negotiationState.thread`.
 *
 * Not wired yet: the `LINK_AGENT_SPLIT_NEGOTIATE` env flag decides whether
 * process-inbound.ts calls this or the legacy monolithic negotiator.
 */
import type { LinkAgentLocale } from "../locale-config";
import { type Action, type BudgetCtx, type ThreadState } from "./decisor";
export interface NegotiateSplitInput {
    emailHistory: string;
    inboundBody: string;
    inboundSubject: string;
    budget: BudgetCtx;
    locale: LinkAgentLocale;
    threadState: ThreadState | null;
    model: string;
    extractorPrompt?: string;
    redactorPrompt?: string;
}
export interface NegotiateSplitResult {
    action: Action;
    nextState: ThreadState;
    subject: string | null;
    body: string | null;
    /** Populated when the validator rejected at least once. Useful for logs. */
    validatorIssues: string[];
    /** True when the validator ultimately failed and we decided to drop the send. */
    dropped: boolean;
    model: string;
    durationMs: number;
}
export declare function negotiateSplit(input: NegotiateSplitInput): Promise<NegotiateSplitResult>;
//# sourceMappingURL=negotiate-split.d.ts.map