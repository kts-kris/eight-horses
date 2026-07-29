# Eight-Horses Project Constitution

Version: 1.0.0
Last updated: 2026-07-28

## Purpose

Eight-Horses turns a creative brief into an editable, traceable, finished video. New
features must preserve the complete production chain: project-owned source assets,
durable generation jobs, reviewable intermediate results, and an honestly labelled
final export.

## Architecture Principles

- Keep the existing Next.js App Router structure. Route handlers authenticate,
  validate, and delegate; reusable generation, orchestration, and persistence logic
  belongs under `lib/` or `services/`.
- Use the existing provider registries for model integrations. A new model provider
  must declare capabilities, availability, health behaviour, and failure semantics
  instead of adding provider-specific branches throughout the UI or orchestrator.
- Long-running or paid generation must run as a durable pipeline job outside the
  request lifecycle. Jobs must be idempotent, resumable after process failure, and
  observable through persisted progress events.
- Preserve SQLite and PostgreSQL compatibility. New shared persistence logic uses
  `getDbDriver()` and repository modules; route handlers must not introduce direct
  SQLite-only queries.
- Keep media provenance. Generated assets record their project, shot, model/provider,
  quality, duration, source revision, and degradation state. Replacing an asset must
  use the existing version-aware asset repository.
- Concurrency against external generation providers must be explicitly bounded.
  Provider retries must distinguish transient failures from permanent validation or
  configuration failures.
- A fallback result must be labelled as a fallback. Preview, animatic, upscaled, and
  provider-native ultra-high-definition outputs are different states and must never
  be reported as equivalent.
- Prefer incremental changes that reuse the current job queue, provider registry,
  asset repository, budget guard, health reporting, and composition pipeline.

## Technology Stack

| Layer | Locked choice | Notes |
|---|---|---|
| Language | TypeScript 5.9.x | Strict mode for application code |
| Runtime | Node.js 20+ | Long-running media work executes outside request lifecycles |
| Web framework | Next.js 16.2.x App Router | React 19.2.x |
| UI | React, Tailwind CSS 4, Radix UI | Client components only when browser state or interaction requires them |
| Database | SQLite and PostgreSQL | Accessed through the existing dual-driver repositories |
| Authentication | Existing JWT request authentication | Project access uses `requireProjectAccess()` |
| Media | FFmpeg / FFprobe | Preserve current composition and inspection pipeline |
| Unit/integration tests | Vitest 4.1.x | Behaviour assertions, including failure paths |
| Browser tests | Playwright 1.61.x | Critical user journeys and accessibility checks |

## Security Constraints

- Every project-scoped endpoint requires an authenticated user and the appropriate
  `view` or `edit` permission through `requireProjectAccess()`.
- Every external request body, path parameter, query parameter, URL, numeric limit,
  model identifier, and enum is validated at the route boundary before paid work is
  queued.
- API keys, cloud credentials, provider tokens, signed URLs, and database credentials
  are read from environment-backed configuration only. They are never stored in
  project payloads, returned to clients, or written to logs.
- Error responses never expose stack traces, raw provider responses containing
  credentials, internal filesystem paths, or another tenant's project/job metadata.
- User-controlled URLs are never treated as trusted network destinations. Remote
  worker and provider base URLs are administrator configuration; media URLs must pass
  the project's existing URL and egress safeguards before server-side fetching.
- Paid generation requires both project edit access and the existing budget/plan
  guard. A retry or resumed job must not charge twice for an already completed shot.
- Cross-origin access remains allow-list based in production. No wildcard CORS policy
  may be introduced for project, job, media, or provider endpoints.
- Logs may include opaque project, job, shot, and provider identifiers, but never
  prompts containing private user data, tokens, cloned voice material, or full signed
  media URLs.

## Code Quality and Error Handling

- Match the existing kebab-case file naming, camelCase values/functions, PascalCase
  types/components, and `SCREAMING_SNAKE_CASE` environment variable conventions.
- Keep one responsibility per exported function or class and reuse existing helpers
  before adding wrappers.
- Public functions and route behaviours added by a feature require tests. New modules
  target at least 80% coverage, including invalid input, provider failure, timeout,
  retry, concurrency, authorization, and partial-completion cases.
- Provider timeouts, cancellations, rate limits, and terminal errors are surfaced as
  explicit job/shot states. No catch block may convert a paid-generation failure into
  a successful final result.
- New external integrations must degrade gracefully without preventing unrelated
  providers or existing projects from working.

## Banned Patterns

- No anonymous fallback to a database user, owner, or project.
- No project-scoped route without `requireProjectAccess()`.
- No hardcoded or client-exposed provider credentials.
- No direct `better-sqlite3` access in new routes or cross-driver feature logic.
- No unbounded `Promise.all()` over paid model calls or GPU jobs.
- No long-running paid batch implemented only as an SSE request that is lost when the
  client disconnects.
- No silent substitution of an animatic, preview clip, or software-upscaled source for
  a provider-generated final while marking the job complete.
- No overwrite of another project revision or of an approved source snapshot.
- No destructive edit of an existing schema migration; schema evolution is additive
  and rollback-aware.
- No unrelated refactor, dependency, or feature added while implementing a scoped
  acceptance criterion.

## File Structure Rules

```text
app/
  api/                 # App Router endpoints; auth + validation + delegation
  projects/            # Project-facing pages
components/
  project/             # Project workflow UI
lib/
  repos/               # Dual-driver persistence repositories
  video-providers/     # Provider contracts, registry, and built-ins
  *.ts                 # Domain orchestration and reusable logic
services/              # External model/media service adapters
tests/                 # Vitest unit and integration tests
e2e/                   # Playwright user-journey tests
specs/                 # SDD feature specifications and contracts
scripts/               # Operational, migration, and verification scripts
```

## Delivery Rules

- Study at least three relevant existing patterns before modifying a subsystem.
- Add tests before or alongside implementation and run targeted tests after each
  incremental change.
- Before handoff, run the full relevant test suite, TypeScript typecheck, and production
  build. Report any environment-dependent live-provider test that could not be run.
- Stage and commit only files created or modified for the active task, with concise
  Chinese commit messages.

## Open Questions / Deferred Decisions

None.
