# link-protickets prompts

Files in this folder are read by the core composer (`src/lib/agents/core/composer.ts`). Convention: `<kind>.md` is the default, `<kind>.<locale>.md` overrides per locale.

Placeholders: `{{persona}}`, `{{brand}}`, `{{brandUrl}}` expand from `Agent.config.identity`.

## Ported so far (code → filesystem)

- `extractor.md` — negotiation inbound classifier (was `DEFAULT_EXTRACTOR_PROMPT` in `src/lib/link-agent/negotiation/extractor.ts`)
- `redactor.md` — negotiation email writer (was `DEFAULT_REDACTOR_PROMPT` in `src/lib/link-agent/negotiation/redactor.ts`)

## Still in DB (`LinkAgentConfig` singleton)

Editable from admin UI today. A follow-up commit adds a DB-override path to `composer.loadPrompt()` so these move here too with zero UX loss:

- `systemPrompt` → will become `negotiation.md` (legacy monolithic negotiator; replaced by extractor+redactor when the split flag is on)
- `postDealPrompt` → `post-deal.md`
- `paymentDetectorPrompt` → `payment-detector.md`
- `paidNotificationPrompt` → `paid-notification.md`

## Ported

- outreach (first cold) — moved to `outreach.md` (and locale variants). Used by decide() for status="prospect".
- follow-up (silence soft_reminder / friction_reduction / clean_breakup) — already in follow-up-planner + core composer.

## Still in code (to be moved)

- Some locale-specific templating still lives in `email-composer.ts` for backward compat with legacy paths. The new runtime uses the filesystem prompts via `renderPrompt`.
