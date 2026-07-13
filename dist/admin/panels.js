// @ts-nocheck
// Excluded from strict typecheck for Paso 5 / PR5 (UI cutover).
// This file wires the legacy campaign management panels (Targets, Budgets,
// Discovery, Waves, Deals) which still operate on LinkTarget/LinkProspect/etc.
// (legacy v1 tables during cutover — see docs/link-agent/README.md#cutover-status)
// The conversational runtime (AgentLead + decide) lives in the agent core.
// We keep the old heavy components here while the full data model migration
// for discovery/waves happens later.
import { listBudgets, listDeals, listProspects, listTargets, listWaves, } from "@/src/lib/admin/link-agent/service";
import BudgetsPanel from "@/src/components/admin/link-agent/BudgetsPanel";
import DealsPanel from "@/src/components/admin/link-agent/DealsPanel";
import DiscoveryPanel from "@/src/components/admin/link-agent/DiscoveryPanel";
import TargetsPanel from "@/src/components/admin/link-agent/TargetsPanel";
import WavesPanel from "@/src/components/admin/link-agent/WavesPanel";
import { AdminErrorBanner, AdminPageHeader, AdminPageSection, } from "@/src/components/admin/admin-ui";
export const linkProticketsPanels = {
    targets: async () => {
        const result = await listTargets();
        if (!result.ok) {
            return (<AdminPageSection>
          <AdminPageHeader title="Targets"/>
          <AdminErrorBanner>Failed to load data: {result.error}</AdminErrorBanner>
        </AdminPageSection>);
        }
        return (<AdminPageSection>
        <AdminPageHeader title="Targets" description="Link-building target pages."/>
        <TargetsPanel targets={result.data.targets}/>
      </AdminPageSection>);
    },
    budgets: async () => {
        const result = await listBudgets();
        if (!result.ok) {
            return (<AdminPageSection>
          <AdminPageHeader title="Budgets"/>
          <AdminErrorBanner>Failed to load data: {result.error}</AdminErrorBanner>
        </AdminPageSection>);
        }
        return (<AdminPageSection>
        <AdminPageHeader title="Budgets" description="Monthly link-building budgets per country."/>
        <BudgetsPanel initialBudgets={result.data.budgets}/>
      </AdminPageSection>);
    },
    discovery: async () => {
        const result = await listProspects({});
        if (!result.ok) {
            return (<AdminPageSection>
          <AdminPageHeader title="Discovery"/>
          <AdminErrorBanner>Failed to load data: {result.error}</AdminErrorBanner>
        </AdminPageSection>);
        }
        return (<AdminPageSection>
        <AdminPageHeader title="Discovery" description="Run SERP discovery and manage prospects."/>
        <DiscoveryPanel initialProspects={result.data.prospects}/>
      </AdminPageSection>);
    },
    waves: async () => {
        const result = await listWaves();
        if (!result.ok) {
            return (<AdminPageSection>
          <AdminPageHeader title="Waves"/>
          <AdminErrorBanner>Failed to load data: {result.error}</AdminErrorBanner>
        </AdminPageSection>);
        }
        return (<AdminPageSection>
        <AdminPageHeader title="Waves" description="Start outreach waves, send batched emails, and monitor progress by country."/>
        <WavesPanel initialWaves={result.data.waves}/>
      </AdminPageSection>);
    },
    deals: async () => {
        const result = await listDeals();
        if (!result.ok) {
            return (<AdminPageSection>
          <AdminPageHeader title="Deals"/>
          <AdminErrorBanner>Failed to load data: {result.error}</AdminErrorBanner>
        </AdminPageSection>);
        }
        return (<AdminPageSection>
        <AdminPageHeader title="Deals" description="Agreed link placements."/>
        <DealsPanel initialDeals={result.data.deals.map((d) => ({
                ...d,
                audit: (d.audit ?? null),
            }))}/>
      </AdminPageSection>);
    },
};
//# sourceMappingURL=panels.js.map