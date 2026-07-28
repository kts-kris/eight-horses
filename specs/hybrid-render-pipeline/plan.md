# Technical Plan: Hybrid Preview and Final Render Pipeline

## Spec Reference

Implements: `specs/hybrid-render-pipeline/spec.md`

## Architecture Overview

The preview path adds two adapters to the existing video-provider registry. Both call
a vendor-neutral authenticated Open Video Worker, which wraps an existing ComfyUI
backend and compiles official workflow templates at runtime. Explicit selection of an
open profile activates the plugin path even when the global plugin experiment is off,
while preserving an explicit operator `off`.

The final path creates a `film-rerender` durable pipeline job containing a frozen shot
snapshot. The worker dispatches bounded closed-provider calls, persists successful
media, uses compare-and-swap asset versions, and calls a reusable project recomposition
service at native 2160p. Existing pipeline job events provide durable progress and
resume information; existing asset metadata records per-shot completion and
provenance, so no new table is required.

## Component Breakdown

### Open Video Worker Client

- **Responsibility:** Validate worker readiness, submit open-model jobs, poll results,
  normalize errors, and return provider metadata.
- **Location:** `services/open-video-worker.service.ts`
- **Accepts:** Model profile, prompt, image, aspect, duration, resolution, progress
  callback.
- **Returns:** Stable video result or typed readiness/generation error.
- **AC Coverage:** AC-1, AC-2, AC-13, AC-E4.

### Open Preview Providers

- **Responsibility:** Register Wan2.2 and HunyuanVideo-1.5 capabilities and route an
  explicitly selected preview profile through the provider chain.
- **Location:** `lib/video-providers/builtins.ts`,
  `lib/video-providers/types.ts`, `lib/plugin-chain-router.ts`
- **Accepts:** Existing `VideoGenerateInput` plus explicit preferred provider.
- **Returns:** Existing `VideoGenerateResult`.
- **AC Coverage:** AC-1, AC-2, AC-11.

### Portable GPU Worker

- **Responsibility:** Expose authenticated readiness, generation, polling, and signed
  output endpoints on an authorized GPU host; compile official ComfyUI workflows and
  patch prompt/image/dimensions/frame count/seed.
- **Location:** `workers/open-video/`
- **Accepts:** Open Video Worker HTTP contract.
- **Returns:** Job state and signed output URL.
- **AC Coverage:** AC-1, AC-2, AC-13, AC-15, AC-E4.

### Preview Entry and Preflight

- **Responsibility:** Offer the two open profiles in create surfaces and reject an
  unavailable selected worker before the main pipeline is queued.
- **Location:** `app/dashboard/create/page.tsx`, `app/create/page.tsx`,
  `app/api/create-stream/route.ts`
- **Accepts:** Selected video provider.
- **Returns:** Existing creation stream or a readiness error.
- **AC Coverage:** AC-1, AC-2.

### Film Rerender Snapshot and Estimate

- **Responsibility:** Read project/script/storyboard/video assets, validate requested
  shots, freeze source versions and references, calculate duration/cost, and detect an
  equivalent active job.
- **Location:** `lib/film-rerender.ts`
- **Accepts:** Project ID, optional shot selection, provider, target quality.
- **Returns:** Immutable job payload and conservative estimate.
- **AC Coverage:** AC-5, AC-6, AC-11, AC-E1, AC-E2.

### Film Rerender API

- **Responsibility:** Authenticate project access, apply plan/budget/provider guards,
  return estimates/status, and enqueue exactly one durable job.
- **Location:** `app/api/projects/[id]/rerender-film/route.ts`
- **Accepts:** GET status/estimate queries and POST submission.
- **Returns:** Estimate, job state/progress, or queued job ID.
- **AC Coverage:** AC-6, AC-7, AC-10, AC-12, AC-E1, AC-E2.

### Film Rerender Runner

- **Responsibility:** Process incomplete shots with bounded concurrency, dispatch native
  4K generation, persist media, compare source versions, emit per-shot events, and
  trigger recomposition.
- **Location:** `lib/film-rerender.ts`, `lib/pipeline-worker.ts`
- **Accepts:** Frozen job payload and job ID.
- **Returns:** Complete or partial terminal result.
- **AC Coverage:** AC-7 through AC-13, AC-E3 through AC-E5.

### Native-Resolution Recomposition

- **Responsibility:** Rebuild the project film from versioned shot assets while reusing
  dialogue, voiceover, subtitles, music, order, duration, and aspect; compose directly
  at 2160p for the final path.
- **Location:** `lib/project-recompose.ts`, `services/video-composer.ts`,
  `lib/video-reframe.ts`
- **Accepts:** Project ID, aspect, target resolution, provenance metadata.
- **Returns:** Persisted final-video asset and film metadata.
- **AC Coverage:** AC-3, AC-4, AC-9, AC-10, AC-11, AC-E5.

### Whole-Film Rerender UI

- **Responsibility:** Display estimate/readiness, confirm the paid action, poll durable
  progress, show per-shot failures, and retry only partial/failed work.
- **Location:** `components/project/film-rerender-panel.tsx`,
  `components/project/shot-workshop-tab.tsx`
- **Accepts:** Project ID, project video list, plan tier.
- **Returns:** User actions and visible job state.
- **AC Coverage:** AC-6, AC-7, AC-10, AC-12, AC-14.

## Technology Choices

| Decision | Choice | Rationale |
|---|---|---|
| Preview integration | Existing video-provider registry | Preserves provider capability filtering, health and fallback semantics |
| GPU backend contract | Authenticated REST facade over ComfyUI | Portable across existing GPU hosts and isolates workflow differences |
| Workflow source | Official ComfyUI workflow templates | Avoids custom model graph drift and records upstream source |
| Final orchestration | Existing `pipeline_jobs` queue | Already durable, retryable, tenant-owned and event-backed |
| Shot completion state | Versioned `project_assets.data` metadata | Supports resume without a new schema or duplicate asset table |
| Final provider | Existing provider registry, Kling native 4K default | Reuses configured closed providers and actual native 4K mode |
| Final composition | Existing FFmpeg composer with resolution parameter | Preserves deterministic audio/subtitle timeline without downscaling |
| Concurrency | Existing bounded pool helper | Prevents GPU/provider overload and matches established batch pattern |

## Integration Points

- Open Video Worker: health, submit, poll, and signed output retrieval.
- ComfyUI: `/system_stats`, `/object_info`, `/prompt`, `/history/{id}`,
  `/upload/image`, and `/view`.
- Video provider registry: explicit preferred-provider selection and normal dispatch.
- Pipeline queue: new `film-rerender` type and partial terminal state.
- Kling: native `mode=4k` through the existing provider adapter.
- Asset storage/repository: persistent media, source-version compare-and-swap, and
  final-video provenance.
- Video composer: existing CJK subtitle, voiceover, BGM, transition, and film-health
  compatible output.

## AC Coverage Map

| AC | Component(s) | Contract(s) |
|---|---|---|
| AC-1 | Open Video Worker Client, Open Preview Providers, Preview Entry | `contracts/open-video-worker.md` |
| AC-2 | Worker Client, Portable Worker, Preview Preflight | `contracts/open-video-worker.md`, `contracts/preview-preflight.md` |
| AC-3 | Native-Resolution Recomposition | `contracts/film-rerender-api.md` |
| AC-4 | Native-Resolution Recomposition | `contracts/film-rerender-api.md` |
| AC-5 | Snapshot and Estimate | `contracts/film-rerender-api.md` |
| AC-6 | Snapshot and Estimate, API, UI | `contracts/film-rerender-api.md` |
| AC-7 | API, Runner | `contracts/film-rerender-api.md` |
| AC-8 | Runner, Provider Registry | `contracts/film-rerender-api.md` |
| AC-9 | Runner, Recomposition | `contracts/film-rerender-api.md` |
| AC-10 | Runner, API, UI | `contracts/film-rerender-api.md` |
| AC-11 | Providers, Runner, Recomposition | Both contracts |
| AC-12 | API | `contracts/film-rerender-api.md` |
| AC-13 | Worker, Runner | Both contracts |
| AC-E1 | Snapshot and Estimate, API | `contracts/film-rerender-api.md` |
| AC-E2 | Snapshot and Estimate, API | `contracts/film-rerender-api.md` |
| AC-E3 | Runner | `contracts/film-rerender-api.md` |
| AC-E4 | Worker Client, Runner | Both contracts |
| AC-E5 | Runner, Recomposition | `contracts/film-rerender-api.md` |

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Official workflow schema changes | Medium | High | Compile against live `/object_info`, cache source URL/revision, fail readiness with missing-node details |
| Required model files absent on HAI | High | High | Health reports exact missing loader values; deployment script checks disk and downloads only on owner-authorized host |
| Cross-model visual drift | High | Medium | Freeze all available anchors, retain preview URL, surface review warning and comparison entry |
| Closed provider rate limits | Medium | High | Bounded concurrency, transient retry, persisted per-shot state, provider health cache |
| App restart during final work | Medium | High | Existing heartbeat/orphan recovery plus asset-based completed-shot resume |
| Source edited during final work | Medium | High | Compare-and-swap on source asset version before replacement |
| 4K composition CPU/disk pressure | Medium | High | One composition per job, persistent output, explicit 2160p setting, cleanup temporary files |
| Recomposition fails after paid shots | Low | High | Preserve shot assets, mark partial, retry composition without regenerating shots |
| Worker output URL expires | Medium | High | Persist every successful shot into Wind Comic storage before asset replacement |

## Out of Scope (Technical)

- Cloud marketplace bidding or instance lifecycle automation.
- Replacing the existing TTS, lip-sync, subtitle, BGM, or health systems.
- Training or fine-tuning either open model.
- Generic distributed queue replacement.

