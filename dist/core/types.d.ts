type AgentLead = any;
type AgentThread = any;
export interface AgentIdentity {
    persona: string;
    brandUrl: string;
    inboxes: Record<string, string>;
}
export type Decision = {
    kind: "send";
    body: string;
    subject?: string;
    scheduleAt?: Date;
    inReplyTo?: string;
    nextStatus?: string;
    wakeAt?: Date | null;
    /** Shallow-merged into AgentLead.state when the decision is applied. */
    stateUpdate?: Record<string, unknown>;
    /** Opaque payload the instance's onTransition() can consume. */
    transitionPayload?: unknown;
} | {
    kind: "wait";
    wakeAt: Date;
    nextStatus?: string;
    stateUpdate?: Record<string, unknown>;
} | {
    kind: "transition";
    nextStatus: string;
    wakeAt?: Date | null;
    stateUpdate?: Record<string, unknown>;
    transitionPayload?: unknown;
} | {
    kind: "close";
    outcomeKind: string;
    outcomeData?: unknown;
    stateUpdate?: Record<string, unknown>;
} | {
    kind: "noop";
    stateUpdate?: Record<string, unknown>;
};
export interface MailMessage {
    externalId: string;
    direction: "inbound" | "outbound";
    from: string;
    to: string;
    subject?: string;
    body: string;
    sentAt: Date;
}
export interface DecideCtx {
    lead: AgentLead;
    thread: AgentThread | null;
    messages: MailMessage[];
    prompts: Record<string, string>;
    agentConfig: Record<string, unknown>;
    now: Date;
}
export interface LeadSeed {
    dedupeKey: string;
    status: string;
    contactRef?: string;
    locale?: string;
    score?: number;
    data?: unknown;
    state?: unknown;
    nextWakeAt?: Date | null;
}
export interface DiscoverCtx {
    agentConfig: Record<string, unknown>;
    now: Date;
}
export interface TransitionCtx {
    lead: AgentLead;
    prevStatus: string;
    nextStatus: string;
    decision: Decision;
    now: Date;
}
export interface ColumnDef {
    key: string;
    label: string;
    render?: (lead: AgentLead) => string;
}
export interface AdminPanelDef {
    key: string;
    label: string;
    path: string;
}
export interface AgentDefinition {
    key: string;
    /** Default identity. Overridable via Agent.config.identity at runtime. */
    identity: AgentIdentity;
    /** Stable key used to dedupe incoming leads (@@unique([agentKey, dedupeKey])). */
    dedupeKey(data: unknown): string;
    /** The only brain: given context, decide what happens next. */
    decide(ctx: DecideCtx): Promise<Decision>;
    /** Optional: produce seeds for new leads. */
    discover?(ctx: DiscoverCtx): Promise<LeadSeed[]>;
    /** Optional: side effects on status transitions (audit, handoff, notify). */
    onTransition?(ctx: TransitionCtx): Promise<void>;
    leadColumns?: ColumnDef[];
    customPanels?: AdminPanelDef[];
}
export {};
//# sourceMappingURL=types.d.ts.map