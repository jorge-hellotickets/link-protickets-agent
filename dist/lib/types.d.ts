export interface BusinessHoursWindow {
    dayOfWeek: number[];
    startHour: number;
    endHour: number;
}
export declare const DEFAULT_BUSINESS_HOURS: BusinessHoursWindow;
export type FollowUpSubtype = "cold_follow_up_1" | "cold_follow_up_2" | "cold_breakup" | "negotiation_nudge" | "negotiation_breakup" | "publication_nudge" | "link_fix_request";
export interface FollowUpComposerContext {
    mode: "follow_up";
    subtype: FollowUpSubtype;
    prospectDomain: string;
    emailHistory: string;
    targetKeywords: string;
    targetUrl: string;
    locale?: string;
    previousAngles?: string[];
    promiseText?: string;
    linkFixBrief?: string;
    linkFixTargetUrl?: string;
    linkFixAnchorText?: string | null;
    linkFixPriorAsks?: number;
}
//# sourceMappingURL=types.d.ts.map