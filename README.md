# @fintmedia/link-protickets-agent

Autonomous link-building agent ("Laura") — the `link-protickets` instance expressed as a reusable `AgentDefinition`.

This package contains the decide / onTransition / follow-up logic, prompts, and deduping rules that power Protickets' link outreach and negotiation pipeline.

It is designed to be consumed by a host that provides:
- The agent runtime / core tick (`@fintmedia/agent-core` or equivalent)
- Persistence (AgentLead, AgentThread, and host-specific models like budgets/deals during cutover)
- Mail channel (AgentMail send/reply/schedule)
- LLM gateway access

## Installation

```bash
pnpm add @fintmedia/link-protickets-agent
# or
npm install @fintmedia/link-protickets-agent
```

Peer dependency (when the core package is published):

```json
"peerDependencies": {
  "@fintmedia/agent-core": ">=0.1.0"
}
```

## Basic usage (registration)

```ts
import { linkProticketsAgent } from "@fintmedia/link-protickets-agent";
import { registerAgent } from "@fintmedia/agent-core/registry"; // or your host equivalent

registerAgent(linkProticketsAgent);
```

The agent is registered by its `key: "link-protickets"`.

## Configuration

The default identity (persona, brand, inboxes) lives in the package:

```ts
identity: {
  persona: "Laura Peñalver",
  brandUrl: "https://www.protickets.com",
  inboxes: { "es-es": "...", "es-mx": "...", "en-us": "..." },
}
```

Hosts can override at runtime via the `Agent` row `config.identity` (see core config schema). Locale-specific inboxes are resolved by the host mail channel.

### Dedupe key

```ts
dedupeKey({ domain: "example.com", targetId: 42 }) // => "example.com#42"
```

This deliberately matches the legacy `LinkProspect` unique constraint during the cutover.

## Prompts

Prompts are shipped inside the package under `dist/prompts/` (and source `src/prompts/`):

- `outreach.md` — cold first outreach
- `extractor.md` — inbound signal extraction
- `redactor.md` — action → email body

They are loaded by the host composer using the agent key. Locale variants (`<kind>.<locale>.md`) are supported.

## Provided surfaces

- `decide(ctx)` — the main state machine (prospect → contacted → negotiating → ... paid / closed)
- `onTransition(ctx)` — side effects (deal creation + budget tx, mirroring, paid notifications, publication nudges)
- `discover(ctx)` — **stub in standalone package**. Full SERP+enrich+LLM discovery + dual-persist is host-specific today (see below).

Also exports UI descriptors (`leadColumns`, `customPanels`) used by Protickets admin during cutover. Other hosts can ignore them.

## Cutover status & legacy LinkProspect

This agent is the "new runtime" in the ongoing migration from the v1 `LinkProspect` + `runOutreach` / `outbound-worker` system.

Key points (see the original Protickets `docs/link-agent/README.md` for the full authoritative table):

- Waves still create `AgentLead` rows (and mirror to legacy `LinkProspect`).
- `onTransition` mirrors status/closure back to `LinkProspect` so legacy UIs, GHAs, and daily summaries continue to work.
- Inbound webhook prefers the agent path (`handleAgentsInbound` + this agent's decide).
- Legacy crons for outreach/outbound are disabled; the 5-min `agents/tick` drives the agent.
- Many supporting pieces (email-composer follow-ups, negotiation decisor/extractor/redactor, timing, publication audit, etc.) have been moved into this package.

**Nothing in this package depends on internal Protickets source.** All Protickets-specific I/O (Link* tables, specific admin panels, DataForSEO discovery pipeline) is either stubbed, driven from `lead.data`, or explicitly noted as host-supplied.

## Discovery

In the current cutover the discovery run (SERP → enrich → classify → score → contacts) still lives in Protickets (`/api/admin/link-agent/discovery` + `src/lib/admin/link-agent/scoring-pipeline.ts` etc). It creates both legacy prospects and `AgentLead` seeds.

The `discover()` exported here is a deliberate no-op stub. When a future host wants fully self-contained discovery it can implement its own pipeline and produce `LeadSeed[]` (or extend this package).

## How Protickets will consume this package (future)

1. Add `@fintmedia/link-protickets-agent` (and eventually `@fintmedia/agent-core`) as dependency.
2. In `src/lib/agents/index.ts` (or equivalent bootstrap):

   ```ts
   import { linkProticketsAgent } from "@fintmedia/link-protickets-agent";
   registerAgent(linkProticketsAgent);
   ```

3. Wire any remaining platform adapters (db client for the few reads that still query host models, mail channel, gateway) via the core or by providing a thin host wrapper around decide/onTransition if needed.
4. Remove or alias the local `src/lib/agents/instances/link-protickets/` copy.
5. Keep mirroring + legacy surfaces until the cutover is declared complete.
6. At that point, delete the v1 LinkProspect surfaces and the mirroring code inside the agent's onTransition.

Until that integration lands, the code in this repo is the source of truth for the agent's brain and prompts. Changes here should be ported (or the package version bumped in Protickets).

## Development of the package

```bash
pnpm install
pnpm build
```

Tests are currently in the monorepo (they exercise the full host stack). Unit tests for pure pieces (decisor, redactor, follow-up planner) can be moved here later.

## License

Internal — Fint Media.

## Status

Extracted 2026-07. See Protickets `docs/link-agent/README.md` "Cutover Status" for the live state of mirroring, disabled crons, and admin surfaces.

---

**Target repository:** `fintmedia/link-protickets-agent`

The git remote in this checkout is already set to `https://github.com/fintmedia/link-protickets-agent.git`.

**Current status (as of 2026-07-13):**
- All code, prompts, history and package configuration are ready.
- GitHub CLI cannot create the repo under `fintmedia` because the organization either does not exist yet or the token lacks `admin:org` permissions.

### Pasos para terminar (hazlo manualmente en GitHub):

1. Ve a https://github.com/organizations/new y crea la organización llamada **`fintmedia`** (si todavía no existe).
2. Dentro de la organización `fintmedia`, crea un nuevo repositorio:
   - Nombre: **`link-protickets-agent`**
   - Visibilidad: **Public**
3. Una vez creado el repo, ejecuta desde este directorio:

```bash
git push -u origin main
```

Todo lo demás (package `@fintmedia/link-protickets-agent`, estructura, prompts, etc.) ya está preparado correctamente.
