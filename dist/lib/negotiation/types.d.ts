import type { ThreadState } from "./decisor";
export interface NegotiationState {
    /** Follow-up worker fields */
    silenceFollowUpCount: number;
    followUpNotBeforeAt?: string;
    firstOutboundAt?: string;
    agentmailDraft?: {
        draftId: string;
        kind: "follow-up" | "breakup";
        sendAt?: string;
    };
    /** Timestamps for timing */
    lastInboundAt?: string;
    lastOutboundAt?: string;
    /**
     * Post-deal: true when the prospect has sent a proforma (payment-commitment
     * invoice) but not the final/definitive invoice yet. Set by the payment
     * detector on proforma detection, cleared on final detection. Used by the
     * post-deal prompt to know whether to chase the final invoice after payment.
     */
    finalInvoicePending?: boolean;
    /**
     * Split-negotiation state (see docs/link-agent/plan-split-negotiate.md).
     * Only populated when the split negotiator runs. Absent on legacy rows and
     * on threads still handled by the monolithic negotiator — the decisor
     * treats missing fields as fresh (empty countersMade, no acceptedPrice).
     */
    thread?: ThreadState;
}
/**
 * Migrate legacy V1/V2/V3 rows to the flat NegotiationState on read.
 * No DB migration needed — old rows are normalized on first access,
 * new rows are written in the flat format.
 *
 * @param raw - The raw JSON from the database (could be V1, V2, V3, or flat)
 * @param prospectCreatedAt - Fallback for firstOutboundAt on legacy rows
 */
export declare function normalizeState(raw: unknown, prospectCreatedAt?: string): NegotiationState;
//# sourceMappingURL=types.d.ts.map