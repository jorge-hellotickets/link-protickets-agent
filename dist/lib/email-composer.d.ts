import type { FollowUpComposerContext } from "./types";
interface OutreachEmailResult {
    subject: string;
    body: string;
}
interface OutreachContext {
    prospectDomain: string;
    targetKeywords: string;
    /**
     * Retained for interface back-compat with callers; no longer surfaced to
     * the LLM. The prompt now deliberately never references how we found the
     * site, so this field has no effect on output.
     */
    discoverySource?: string;
    category: string;
    locale?: string;
    siteSnapshot?: string;
    priorEmailHistory?: string;
}
export declare function composeOutreachEmail(ctx: OutreachContext, model?: string): Promise<OutreachEmailResult>;
export declare function composeFollowUpEmail(ctx: FollowUpComposerContext, model?: string): Promise<OutreachEmailResult>;
export {};
//# sourceMappingURL=email-composer.d.ts.map