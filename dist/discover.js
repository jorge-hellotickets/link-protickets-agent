import { getLocaleConfig } from "./lib/locale-config";
import { linkProticketsAgent } from "./index";
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
export async function discover(ctx) {
    // In the standalone package this is intentionally a no-op stub.
    // Protickets continues to drive discovery via its /admin/link-agent/discovery
    // endpoint + scoring-pipeline (which creates the mirrored AgentLeads).
    // Future hosts can implement full discovery using the same SERP/LLM patterns
    // and call the agent with seeds.
    console.log("[link-protickets:discover] stub called (no-op in standalone package)");
    void ctx;
    void getLocaleConfig; // keep import for future
    void linkProticketsAgent;
    return [];
}
//# sourceMappingURL=discover.js.map