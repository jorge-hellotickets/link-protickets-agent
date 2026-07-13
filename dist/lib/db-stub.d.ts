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
export declare const db: any;
export type PrismaClientLike = typeof db;
//# sourceMappingURL=db-stub.d.ts.map