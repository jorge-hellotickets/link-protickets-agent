export declare const SERP_DEPTH = 100;
/** Max original SERP queries per discovery run */
export declare const MAX_ORIGINAL_QUERIES = 60;
export declare const SCORING_THRESHOLDS: {
    readonly minAuthority: 15;
    readonly maxAuthority: 95;
    readonly minTraffic: 500;
    readonly maxRounds: 10;
    readonly maxReminders: 2;
    readonly maxOutboundLinks: 50;
};
/** Min prospects with status "prospect" before triggering runDiscovery() */
export declare const PIPELINE_MIN_THRESHOLD = 50;
/** Domains to never consider as competitors or prospects */
export declare const COMPETITOR_EXCLUSIONS: string[];
/** Fixed wave sizes by wave number (wave 1 = calibration) */
export declare const WAVE_SIZES: Record<number, number>;
/** Default wave size for wave 2+ */
export declare const WAVE_SIZE_DEFAULT = 40;
/** Days after last send before observation period ends and next wave starts */
export declare const WAVE_OBSERVATION_DAYS = 7;
//# sourceMappingURL=config.d.ts.map