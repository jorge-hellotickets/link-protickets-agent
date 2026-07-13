/**
 * Runtime configuration loaded from the `LinkAgentConfig` DB singleton.
 *
 * Returns resolved values (never null) by merging DB overrides with the
 * hardcoded defaults — so callers never need to know about the null/default
 * split. Used by `negotiate()` to pick the model and by `timing.ts` /
 * `computeReplySendAt` to pick the reply delay range and business hours.
 */
// MODEL_DEFAULT and full runtime config live in host during cutover (LinkAgentConfig singleton).
// Provide a sane default here for standalone.
const MODEL_DEFAULT = "openai/gpt-5.5";
import { DEFAULT_BUSINESS_HOURS, } from "./types";
export const DEFAULT_REPLY_DELAY_MIN_MINUTES = 10;
export const DEFAULT_REPLY_DELAY_MAX_MINUTES = 90;
export const DEFAULT_RUNTIME_CONFIG = {
    negotiationModel: MODEL_DEFAULT,
    businessHours: DEFAULT_BUSINESS_HOURS,
    replyDelayMinMinutes: DEFAULT_REPLY_DELAY_MIN_MINUTES,
    replyDelayMaxMinutes: DEFAULT_REPLY_DELAY_MAX_MINUTES,
};
export async function getLinkAgentRuntimeConfig() {
    // Standalone / cutover: always return defaults. Host (protickets) overrides via
    // its own getLinkAgentRuntimeConfig wrapper or by monkey-patching at registration.
    return DEFAULT_RUNTIME_CONFIG;
}
//# sourceMappingURL=runtime-config.js.map