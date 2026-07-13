// AgentLead / AgentThread are host prisma models (from @prisma/client in the consuming app).
// We use structural typing so the package does not force @prisma/client as a hard dep.
type AgentLead = any;
type AgentThread = any;

// ─── Identity / config ───

export interface AgentIdentity {
  persona: string;
  brandUrl: string;
  inboxes: Record<string, string>; // { locale: inboxId }
}

// ─── Decisions ───

export type Decision =
  | {
      kind: "send";
      body: string;
      subject?: string;
      scheduleAt?: Date; // if future, becomes a scheduled draft; otherwise send now
      inReplyTo?: string; // AgentMail messageId we're replying to
      nextStatus?: string;
      wakeAt?: Date | null; // when to call decide() again; null clears
      /** Shallow-merged into AgentLead.state when the decision is applied. */
      stateUpdate?: Record<string, unknown>;
      /** Opaque payload the instance's onTransition() can consume. */
      transitionPayload?: unknown;
    }
  | {
      kind: "wait";
      wakeAt: Date;
      nextStatus?: string;
      stateUpdate?: Record<string, unknown>;
    }
  | {
      kind: "transition";
      nextStatus: string;
      wakeAt?: Date | null;
      stateUpdate?: Record<string, unknown>;
      transitionPayload?: unknown;
    }
  | {
      kind: "close";
      outcomeKind: string;
      outcomeData?: unknown;
      stateUpdate?: Record<string, unknown>;
    }
  | {
      kind: "noop";
      stateUpdate?: Record<string, unknown>;
    };

// ─── Mail context passed to decide() ───

export interface MailMessage {
  externalId: string;
  direction: "inbound" | "outbound";
  from: string;
  to: string;
  subject?: string;
  body: string; // cleaned (stripQuotedReplies / stripOurFooter applied)
  sentAt: Date;
}

// ─── Contexts ───

export interface DecideCtx {
  lead: AgentLead;
  thread: AgentThread | null;
  messages: MailMessage[];
  prompts: Record<string, string>; // rendered prompt body by kind
  agentConfig: Record<string, unknown>; // Agent.config (validated for core keys)
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

// ─── Admin UI descriptors (consumed in PR5) ───

export interface ColumnDef {
  key: string;
  label: string;
  render?: (lead: AgentLead) => string;
}

export interface AdminPanelDef {
  key: string;
  label: string;
  path: string; // route segment under /admin/agents/[key]/
}

// ─── Agent definition ───

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
