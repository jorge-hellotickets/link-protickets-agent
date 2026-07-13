export type PublicationAuditIssue = "missing" | "http_not_https" | "redirect" | "wrong_host" | "wrong_target" | "raw_url_anchor" | "wrong_anchor_text" | "nofollow" | "sponsored" | "fetch_failed";
export interface PublicationAuditAnchor {
    href: string;
    finalUrl: string | null;
    anchorText: string;
    rel: string | null;
    issues: PublicationAuditIssue[];
}
export interface PublicationAudit {
    ok: boolean;
    checkedAt: string;
    linkUrl: string;
    targetUrl: string;
    expectedAnchorText: string | null;
    anchors: PublicationAuditAnchor[];
    issues: PublicationAuditIssue[];
    error?: string;
}
export declare function auditPublication(params: {
    linkUrl: string;
    targetUrl: string;
    expectedAnchorText: string | null;
}): Promise<PublicationAudit>;
export declare function summarizeAuditIssuesEs(audit: PublicationAudit): string;
//# sourceMappingURL=publication-audit.d.ts.map