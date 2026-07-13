/**
 * Deterministic rejection guardrail — runs before the LLM sees an inbound.
 *
 * Purpose: some inbound messages are unambiguous rejections ("we don't do
 * collaborations", "please unsubscribe"). Letting the LLM decide on these is
 * both wasteful and risky: the April 2026 molaviajar incident showed that a
 * single content-extraction failure can flip a clear rejection into a
 * follow-up. When the signal is obvious, stop early and save the prospect
 * from getting spammed.
 *
 * Must be called on a dequoted, footer-stripped body (see
 * `extractLatestInboundBody` in agentmail.ts). Running on raw `text` would
 * match our own outbound unsubscribe footer that the prospect quotes back.
 */
export interface GuardrailResult {
    rejected: boolean;
    /** The regex that matched, for logging/debugging. */
    matchedPattern?: string;
    /** The snippet of body that matched, for logging/audit. */
    matchedSnippet?: string;
}
/**
 * Check whether a dequoted inbound body is an unambiguous rejection.
 * The body MUST already be stripped of quoted replies and our own footer.
 */
export declare function detectRejection(dequotedBody: string): GuardrailResult;
//# sourceMappingURL=rejection-guardrail.d.ts.map