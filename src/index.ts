import type {
  AdminPanelDef,
  AgentDefinition,
  ColumnDef,
} from "./core/types";
import { decide } from "./decide";
import { onTransition } from "./hooks";
import { discover } from "./discover";

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

const leadColumns: ColumnDef[] = [
  { key: "contactRef", label: "Domain" },
  { key: "locale", label: "Locale" },
  { key: "status", label: "Status" },
  {
    key: "da",
    label: "DA",
    render: (lead) => {
      const data = (lead.data ?? {}) as { da?: number };
      return data.da != null ? String(data.da) : "—";
    },
  },
  {
    key: "traffic",
    label: "Traffic",
    render: (lead) => {
      const data = (lead.data ?? {}) as { traffic?: number };
      return data.traffic != null ? data.traffic.toLocaleString() : "—";
    },
  },
  {
    key: "updatedAt",
    label: "Updated",
    render: (lead) => lead.updatedAt.toISOString().slice(0, 10),
  },
];

const customPanels: AdminPanelDef[] = [
  { key: "targets", label: "Targets", path: "targets" },
  { key: "budgets", label: "Budgets", path: "budgets" },
  { key: "discovery", label: "Discovery", path: "discovery" },
  { key: "waves", label: "Waves", path: "waves" },
  { key: "deals", label: "Deals", path: "deals" },
];

export const linkProticketsAgent: AgentDefinition = {
  key: "link-protickets",

  identity: {
    persona: "Laura Peñalver",
    brandUrl: "https://www.protickets.com",
    inboxes: {
      "es-es": "laura.penalver@fintmedia.com",
      "es-mx": "laura.penalver@fintmedia.com",
      "en-us": "laura.penalver@fintmedia.com",
    },
  },

  dedupeKey(data: unknown): string {
    const d = (data ?? {}) as Partial<LinkProspectDedupeInput>;
    if (!d.domain || d.targetId === undefined || d.targetId === null) {
      throw new Error(
        "link-protickets dedupeKey requires { domain, targetId }",
      );
    }
    const domain = String(d.domain).toLowerCase().trim();
    return `${domain}#${d.targetId}`;
  },

  decide,
  discover,
  onTransition,
  leadColumns,
  customPanels,
};
