export interface NegotiateInput {
    prospectDomain: string;
    emailHistory: string;
    inboundBody: string;
    inboundSubject: string;
    maxPriceCents: number;
    targetUrl: string;
    targetKeywords: string;
    locale: string;
    timezone: string;
    headroomCents: number;
    round: number;
    /**
     * Optional prompt template override. When provided, skips the DB load and
     * renders this template instead — used by the Settings "rewrite preview"
     * feature to test a candidate prompt without saving it.
     */
    promptOverride?: string;
}
export interface NegotiateResult {
    replySubject: string | null;
    replyBody: string | null;
    terminal: boolean;
    deal: {
        agreedPriceCents: number;
        agreedDate: Date;
        linkUrl: string | null;
        anchorText: string;
        placementCategory: string;
        placementSurfaceRaw: string | null;
    } | null;
    reasoning: string;
    model: string;
    durationMs: number;
}
export declare function negotiate(input: NegotiateInput): Promise<NegotiateResult>;
//# sourceMappingURL=negotiate.d.ts.map