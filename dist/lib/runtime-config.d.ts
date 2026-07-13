/**
 * Runtime configuration loaded from the `LinkAgentConfig` DB singleton.
 *
 * Returns resolved values (never null) by merging DB overrides with the
 * hardcoded defaults — so callers never need to know about the null/default
 * split. Used by `negotiate()` to pick the model and by `timing.ts` /
 * `computeReplySendAt` to pick the reply delay range and business hours.
 */
import { type BusinessHoursWindow } from "./types";
export declare const DEFAULT_REPLY_DELAY_MIN_MINUTES = 10;
export declare const DEFAULT_REPLY_DELAY_MAX_MINUTES = 90;
export interface LinkAgentRuntimeConfig {
    negotiationModel: string;
    businessHours: BusinessHoursWindow;
    replyDelayMinMinutes: number;
    replyDelayMaxMinutes: number;
}
export declare const DEFAULT_RUNTIME_CONFIG: LinkAgentRuntimeConfig;
export declare function getLinkAgentRuntimeConfig(): Promise<LinkAgentRuntimeConfig>;
//# sourceMappingURL=runtime-config.d.ts.map