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
import {
  decide,
  emptyThreadState,
  type Action,
  type BudgetCtx,
  type ThreadState,
} from "./decisor";
import { extractSignals } from "./extractor";
import { redact } from "./redactor";
import { validate } from "./validator";

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

function isSendableAction(action: Action): boolean {
  switch (action.kind) {
    case "stall":
    case "terminal":
      return false;
    default:
      return true;
  }
}

export async function negotiateSplit(
  input: NegotiateSplitInput,
): Promise<NegotiateSplitResult> {
  const startMs = Date.now();
  const state = input.threadState ?? emptyThreadState();

  const { signals } = await extractSignals({
    emailHistory: input.emailHistory,
    inboundBody: input.inboundBody,
    model: input.model,
    promptOverride: input.extractorPrompt,
  });

  const { action, nextState } = decide(state, signals, input.budget);

  if (!isSendableAction(action)) {
    return {
      action,
      nextState,
      subject: null,
      body: null,
      validatorIssues: [],
      dropped: false,
      model: input.model,
      durationMs: Date.now() - startMs,
    };
  }

  const first = await redact({
    emailHistory: input.emailHistory,
    inboundBody: input.inboundBody,
    inboundSubject: input.inboundSubject,
    action,
    locale: input.locale,
    model: input.model,
    promptOverride: input.redactorPrompt,
  });

  const firstCheck = validate({
    body: first.body,
    action,
    agreedDate: nextState.agreedDate,
  });

  if (firstCheck.ok) {
    return {
      action,
      nextState,
      subject: first.subject,
      body: first.body,
      validatorIssues: [],
      dropped: false,
      model: input.model,
      durationMs: Date.now() - startMs,
    };
  }

  console.warn(
    `[link-agent:negotiate-split] validator rejected first attempt — regenerating once. issues=${JSON.stringify(firstCheck.issues)}`,
  );

  const retry = await redact({
    emailHistory: input.emailHistory,
    inboundBody: input.inboundBody,
    inboundSubject: input.inboundSubject,
    action,
    locale: input.locale,
    model: input.model,
    promptOverride: input.redactorPrompt,
  });

  const secondCheck = validate({
    body: retry.body,
    action,
    agreedDate: nextState.agreedDate,
  });

  if (secondCheck.ok) {
    return {
      action,
      nextState,
      subject: retry.subject,
      body: retry.body,
      validatorIssues: firstCheck.issues,
      dropped: false,
      model: input.model,
      durationMs: Date.now() - startMs,
    };
  }

  console.warn(
    `[link-agent:negotiate-split] validator rejected retry — dropping send. issues=${JSON.stringify(secondCheck.issues)}`,
  );

  return {
    action,
    nextState,
    subject: null,
    body: null,
    validatorIssues: [...firstCheck.issues, ...secondCheck.issues],
    dropped: true,
    model: input.model,
    durationMs: Date.now() - startMs,
  };
}
