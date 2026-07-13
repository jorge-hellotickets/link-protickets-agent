// ─── Business Hours ───

export interface BusinessHoursWindow {
  dayOfWeek: number[]; // 1=Mon ... 5=Fri
  startHour: number;   // 9
  endHour: number;     // 18
}

export const DEFAULT_BUSINESS_HOURS: BusinessHoursWindow = {
  dayOfWeek: [1, 2, 3, 4, 5],
  startHour: 9,
  endHour: 18,
};

// ─── Composer Extensions ───

export type FollowUpSubtype =
  | "cold_follow_up_1"
  | "cold_follow_up_2"
  | "cold_breakup"
  | "negotiation_nudge"
  | "negotiation_breakup"
  | "publication_nudge"
  | "link_fix_request";

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
  // For subtype=link_fix_request: human-readable description of what's wrong
  // with the published link, plus the agreed target URL and anchor text.
  linkFixBrief?: string;
  linkFixTargetUrl?: string;
  linkFixAnchorText?: string | null;
  // For subtype=link_fix_request: how many times we've already pinged them
  // about this fix. 0 = first ask, >=1 = repeat ask (adjust tone).
  linkFixPriorAsks?: number;
}
