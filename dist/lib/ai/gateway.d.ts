/** Test hook: clear the per-process rejection cache between cases. */
export declare function __resetResponseFormatRejectionCache(): void;
interface GatewayOptions {
    model?: string;
    maxTokens?: number;
    temperature?: number;
    /**
     * Optional fixed instructions sent as a role=system message. Use this to
     * separate trusted instructions from untrusted content (user-provided text,
     * third-party email bodies, etc.). When present, the `prompt` argument is
     * sent as role=user. Mitigates prompt-injection risk from hostile input
     * concatenated into a monolithic user message.
     */
    system?: string;
    /**
     * When set, requests a structured JSON response from the model.
     * - `"json_object"`: forces valid JSON output (no schema).
     * - `{ name, schema, strict? }`: forces output matching the JSON Schema.
     *   Strict mode requires the gateway/model to support it (verify per provider).
     */
    responseFormat?: "json_object" | {
        name: string;
        schema: Record<string, unknown>;
        strict?: boolean;
    };
    /**
     * Per-call timeout in ms. Defaults to 120s — appropriate for request-path
     * callers (link-agent, i18n, admin chat). Offline tooling that calls a
     * reasoning model (e.g. seat-quality rubric generation with zai/glm-5.2,
     * which emits a long CoT before the final answer) should pass a larger
     * value (e.g. 600_000) so the call doesn't abort mid-reasoning.
     */
    timeoutMs?: number;
    /**
     * When true, request a streaming response (SSE chunks) and accumulate the
     * content client-side. Required for long-running calls against the gateway:
     * Vercel AI Gateway kills non-streaming requests that take more than ~300s
     * server-side, so a reasoning model like zai/glm-5.2 on a 70-section venue
     * will hit a socket close mid-response. Streaming keeps the connection alive
     * with incremental bytes and bypasses that limit. Response shape is the same
     * as the non-streaming path (a single concatenated string).
     */
    stream?: boolean;
    /**
     * When true, ask the gateway to disable the model's thinking/reasoning phase
     * (`reasoning: { enabled: false }`). For hybrid reasoning models (zai/glm-5.x)
     * this switches to direct-answer mode: latency drops from minutes to seconds
     * on classification tasks where step-by-step CoT adds cost but no accuracy.
     * No-op on models without a reasoning phase.
     */
    disableReasoning?: boolean;
}
/**
 * Call the AI Gateway (OpenAI-compatible chat completions endpoint).
 * Shared across link-agent LLM review, email composer, and any future callers.
 */
export declare function callAIGateway(prompt: string, opts?: GatewayOptions): Promise<string>;
/**
 * Parse JSON from LLM response, stripping markdown code fences if present.
 */
export declare function parseGatewayJSON<T>(text: string): T;
export {};
//# sourceMappingURL=gateway.d.ts.map