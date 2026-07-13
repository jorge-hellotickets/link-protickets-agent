export interface LinkAgentLocale {
    locationCode: number;
    languageCode: string;
    currency: string;
    priceMultiplier: number;
    timezone: string;
    inbox: string;
    signatureTitle: string;
    signatureUnsubscribe: string;
    localeSettings: string;
    closingExamples: string;
    subjectExamples: string;
}
export declare const LOCALE_CONFIGS: Record<string, LinkAgentLocale>;
export declare function getLocaleConfig(locale: string): LinkAgentLocale;
//# sourceMappingURL=locale-config.d.ts.map