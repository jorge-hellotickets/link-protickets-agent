/**
 * DB stub for standalone package.
 *
 * In @fintmedia/link-protickets-agent the I/O heavy parts (LinkBudget, LinkDeal,
 * LinkProspect, LinkTarget reads/writes, mirroring) are host-specific.
 *
 * When consumed by Protickets, the host replaces this import (via build alias or
 * pre-publish transform, or the decide/hooks are called after host wires a real
 * prisma instance into a closure).
 *
 * For now this provides the minimal shape so the package typechecks in isolation.
 */
export const db = {
    // Used in cutover paths inside decide/hooks. Real impl supplied by host.
    linkTarget: { findMany: async () => [], findUnique: async () => null },
    linkProspect: { findMany: async () => [], update: async () => ({}) },
    linkDeal: {
        findUnique: async () => null,
        upsert: async () => ({}),
        update: async () => ({}),
        aggregate: async () => ({ _sum: { agreedPriceCents: 0 } }),
    },
    linkBudget: { findFirst: async () => null },
    agentLead: { update: async () => ({}) },
    agentThread: { findFirst: async () => null },
    $transaction: async (fn) => fn(db),
};
//# sourceMappingURL=db-stub.js.map