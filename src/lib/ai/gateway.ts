import { GATEWAY_BASE_URL, MODEL_FAST } from "./models";

// Process-local cache of model slugs that returned 400 when response_format
// was set. Some gateway-routed models (e.g. certain openai/gpt-5.x routes)
// reject response_format outright; without caching, every call pays the
// retry round-trip. First failure teaches subsequent calls to skip it.
const modelsRejectingResponseFormat = new Set<string>();

/** Test hook: clear the per-process rejection cache between cases. */
export function __resetResponseFormatRejectionCache(): void {
  modelsRejectingResponseFormat.clear();
}

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
  responseFormat?:
    | "json_object"
    | { name: string; schema: Record<string, unknown>; strict?: boolean };
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
export async function callAIGateway(
  prompt: string,
  opts: GatewayOptions = {},
): Promise<string> {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) throw new Error("AI_GATEWAY_API_KEY not configured");

  const messages = opts.system
    ? [
        { role: "system" as const, content: opts.system },
        { role: "user" as const, content: prompt },
      ]
    : [{ role: "user" as const, content: prompt }];

  const body: Record<string, unknown> = {
    model: opts.model ?? MODEL_FAST,
    max_completion_tokens: opts.maxTokens ?? 1000,
    temperature: opts.temperature ?? 0,
    messages,
    ...(opts.stream ? { stream: true } : {}),
    ...(opts.disableReasoning ? { reasoning: { enabled: false } } : {}),
  };

  const modelKey = String(body.model);
  const skipResponseFormat = modelsRejectingResponseFormat.has(modelKey);

  if (!skipResponseFormat) {
    if (opts.responseFormat === "json_object") {
      body.response_format = { type: "json_object" };
    } else if (typeof opts.responseFormat === "object" && opts.responseFormat) {
      body.response_format = {
        type: "json_schema",
        json_schema: {
          name: opts.responseFormat.name,
          schema: opts.responseFormat.schema,
          ...(opts.responseFormat.strict ? { strict: true } : {}),
        },
      };
    }
  }

  const callTimeoutMs = opts.timeoutMs ?? 120_000;
  // NOTE for long calls (>300s): use stream:true. undici (Node's fetch) has a
  // 300s headers timeout, and the gateway kills silent non-streaming requests
  // server-side at ~5min. With SSE streaming, headers arrive immediately and
  // bytes flow continuously, so neither limit triggers.

  const postBody = async () =>
    fetch(`${GATEWAY_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(callTimeoutMs),
    });

  let res = await postBody();

  // One-shot retry on 400 when we sent response_format. Some gateway-routed
  // models reject response_format (or reject json_object when messages don't
  // contain the word "json"); without this fallback the whole call hard-fails
  // instead of degrading to best-effort JSON output that parseGatewayJSON can
  // still recover from.
  if (res.status === 400 && "response_format" in body) {
    const errText = await res.text().catch(() => "");
    console.warn(
      `[ai-gateway] 400 with response_format — retrying without. model=${modelKey} body=${JSON.stringify(errText.slice(0, 300))}`,
    );
    modelsRejectingResponseFormat.add(modelKey);
    delete body.response_format;
    res = await postBody();
  }

  if (!res.ok) {
    // Surface the gateway's error body so 4xx failures are debuggable.
    // Without this, a 400 from a rejected model slug or other validation
    // failure is indistinguishable from any other 400.
    let detail = "";
    try {
      const errText = await res.text();
      detail = errText ? ` — ${errText.slice(0, 500)}` : "";
    } catch {
      // ignore — the status alone is still better than silently swallowing
    }
    throw new Error(`AI Gateway error: ${res.status}${detail}`);
  }

  // Streaming path: parse SSE chunks and accumulate delta.content. The
  // gateway sends `data: {…}\n\n` lines terminated by `data: [DONE]`. We
  // don't need full SSE framing — just split on newlines and JSON.parse any
  // line starting with "data:" that isn't [DONE].
  if (opts.stream) {
    if (!res.body) throw new Error("AI Gateway stream: no response body");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let content = "";
    let finishReason = "unknown";
    let usage: unknown = undefined;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line || !line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const chunk = JSON.parse(payload);
          const delta = chunk.choices?.[0]?.delta?.content;
          if (typeof delta === "string") content += delta;
          // Reasoning deltas are accumulated nowhere but their arrival keeps
          // the connection alive (the gateway kills silent connections at
          // ~300s). Do not disable reasoning visibility on long stream calls.
          const fr = chunk.choices?.[0]?.finish_reason;
          if (fr) finishReason = fr;
          if (chunk.usage) usage = chunk.usage;
        } catch {
          // Partial JSON across chunk boundaries is rare but possible; the
          // next iteration will append more to buf and retry.
        }
      }
    }
    content = content.trim();
    if (usage) {
      // Cost visibility for offline tooling: reasoning models bill CoT tokens
      // as completion tokens, so usage is the only honest cost signal.
      console.log(`[ai-gateway] usage model=${modelKey} ${JSON.stringify(usage)}`);
    }
    if (!content) {
      console.warn(
        `[ai-gateway] empty stream content. model=${modelKey} finish_reason=${finishReason}${usage ? ` usage=${JSON.stringify(usage)}` : ""}`,
      );
      throw new Error(`Empty stream response from AI Gateway — finish_reason=${finishReason}`);
    }
    return content;
  }

  const json = await res.json();
  const content = json.choices?.[0]?.message?.content?.trim();
  if (!content) {
    // Surface why content was empty so we don't have to guess. Reasoning models
    // (e.g. deepseek-v4-pro, gpt-5.x) count CoT tokens against max_completion_tokens;
    // when the budget is too small, finish_reason="length" with empty content.
    // Also include usage so it's obvious when reasoning_tokens consumed the budget.
    const finishReason = json.choices?.[0]?.finish_reason ?? "unknown";
    const refusal = json.choices?.[0]?.message?.refusal;
    const usage = json.usage
      ? ` usage=${JSON.stringify(json.usage)}`
      : "";
    const refusalDetail = refusal ? ` refusal=${JSON.stringify(refusal)}` : "";
    const detail = ` finish_reason=${finishReason}${refusalDetail}${usage}`;
    console.warn(
      `[ai-gateway] empty content. model=${modelKey}${detail}`,
    );
    throw new Error(`Empty response from AI Gateway —${detail}`);
  }

  return content;
}

/**
 * Parse JSON from LLM response, stripping markdown code fences if present.
 */
export function parseGatewayJSON<T>(text: string): T {
  const cleaned = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  return JSON.parse(cleaned) as T;
}
