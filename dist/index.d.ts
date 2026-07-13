import type { AgentDefinition } from "./core/types";
/**
 * link-protickets — the original link-agent expressed as an AgentDefinition.
 *
 * CUTOVER: dedupeKey = `${domain}#${targetId}` deliberately matches the
 * old LinkProspect constraint so that waves + migration + mirroring can
 * maintain 1:1 correspondence. See docs/link-agent/README.md Cutover Status.
 */
export interface LinkProspectDedupeInput {
    domain: string;
    targetId: number | string;
}
export declare const linkProticketsAgent: AgentDefinition;
//# sourceMappingURL=index.d.ts.map