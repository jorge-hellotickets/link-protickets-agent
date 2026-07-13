import type { DiscoverCtx, LeadSeed } from "./core/types";
/**
 * link-protickets discover()
 *
 * STANDALONE PACKAGE NOTE:
 *   The full discovery pipeline (SERP via DataForSEO + enrichment + LLM review +
 *   scoring + contact scrape + dual persist to LinkProspect + AgentLead) is deeply
 *   coupled to Protickets DB schema, admin scoring pipeline, and wave/legacy UI.
 *
 *   In the independent package we expose a stub. Hosts (Protickets during cutover,
 *   or future projects) run their own discovery and feed LeadSeed[] via the core
 *   upsert or call a host-specific discover wrapper that then invokes this for
 *   any agent-owned post-processing.
 *
 *   See README for cutover status and integration notes.
 */
export declare function discover(ctx: DiscoverCtx): Promise<LeadSeed[]>;
//# sourceMappingURL=discover.d.ts.map