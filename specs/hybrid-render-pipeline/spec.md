# Hybrid Preview and Final Render Pipeline

Status: Approved for implementation
Version: 1.0
Last updated: 2026-07-28

## Overview

Wind Comic will generate an inexpensive, fully playable 720p review film with an
open-weight video model, then let an editor submit the approved film once for a
durable, shot-by-shot, closed-model 4K final rerender. The final path preserves the
approved story, timing, voiceover, subtitles, music, references, and edit structure.

## User Stories

### Primary

As a project editor, I want to produce a complete low-cost preview film before paying
for premium generation so that I can approve story, pacing, Chinese text, voiceover,
and mouth-sync quality economically.

### Secondary

As a project editor, I want one action to rerender every approved shot at final
quality, automatically retry failures, and recompose the film so that I do not repeat
the current per-shot 4K workflow manually.

## Boundaries

**Always do:**

- Freeze the approved source revision before paid final generation.
- Preserve shot order, intended duration, dialogue, voiceover, subtitles, music,
  aspect ratio, and reference assets during final rerender and recomposition.
- Label the actual provider, model profile, resolution class, source revision,
  degradation state, and cost estimate on generated assets and jobs.
- Keep provider concurrency bounded and make retries idempotent.
- Keep critical Chinese text, subtitles, logos, and UI in deterministic composition,
  not inside model-generated pixels.

**Ask first (do not proceed unilaterally):**

- Purchasing, resizing, replacing, reinstalling, or migrating a cloud GPU instance.
- Sending a paid final job whose estimate exceeds the user's configured budget.
- Adding a new paid provider not already configured by the operator.

**Never do:**

- Silently switch an open-model preview request to a paid provider.
- Mark a preview, animatic, or software-upscaled clip as provider-native 4K.
- Regenerate a successfully completed final shot during retry.
- Replace assets from a project revision newer than the job's frozen source revision.
- Expose provider credentials, worker tokens, signed media credentials, or another
  tenant's job details.

## Acceptance Criteria

### AC-1: Selectable open preview profile [MUST]

Given an editor creates or reruns a project with an available open-video worker
When the editor selects Wan2.2 or HunyuanVideo-1.5 as the video profile
Then every eligible generated shot is sent to that profile at the requested aspect
ratio and 720p review target, and the resulting asset records the actual profile.

### AC-2: Preview worker readiness [MUST]

Given an open preview profile is selected
When the worker is unreachable, unauthenticated, missing the selected profile, or
lacks its required model files
Then generation is rejected before any shot is queued, with a specific readiness
reason, and no paid provider is called as a fallback.

### AC-3: Complete review film [MUST]

Given all preview shots and the project's deterministic media assets are available
When preview composition completes
Then Wind Comic produces one playable review MP4 in the project aspect ratio with the
approved shot order, full timeline, supplied or generated voiceover, music when
configured, and deterministic Chinese subtitles.

### AC-4: Chinese text, voice, and mouth-sync integrity [MUST]

Given a project contains Chinese dialogue or captions
When the review film is composed and inspected
Then captions use an available CJK font with no missing-glyph boxes, dialogue remains
audible, critical Chinese text is not model-rendered, and existing mouth-sync status
and warnings remain visible in film health results.

### AC-5: Frozen final source revision [MUST]

Given an editor has approved the preview
When the editor requests a final rerender
Then the system snapshots each selected shot's number, prompt, duration, first frame,
optional last frame, reference assets, preview URL, and source asset version before
queuing paid work.

### AC-6: Costed one-click submission [MUST]

Given at least one eligible shot and a configured final provider
When the editor opens the whole-film final action
Then the UI displays selected shot count, total source duration, target quality,
provider, and conservative cost estimate, and one confirmation creates exactly one
durable final-render job.

### AC-7: Durable whole-film final job [MUST]

Given a final-render job has been accepted
When the browser disconnects or the application process restarts
Then the job remains queryable, resumes from durable state, emits per-shot progress,
and never repeats a shot already completed by the same job.

### AC-8: Provider-native 4K generation [MUST]

Given the selected closed provider declares provider-native 4K support
When an eligible shot is processed
Then the provider receives the approved prompt, aspect ratio, duration, first frame,
available references, and optional last frame at the native 4K quality setting, and
the asset is labelled native 4K only after a successful provider result.

### AC-9: Automatic replacement and recomposition [MUST]

Given one or more final shots completed successfully
When all selected shots reach a terminal state
Then successful final clips replace only their matching shot slots using versioned
asset updates, the deterministic voice/subtitle/music timeline is reused, and Wind
Comic automatically produces an updated final film.

### AC-10: Partial completion and targeted retry [MUST]

Given some final shots fail while others succeed
When the job reaches the end of its current attempt
Then the job is labelled partial, failed shots retain their usable preview clips, the
updated film is labelled partial, and retry queues only failed or incomplete shots.

### AC-11: Provenance and honest quality labels [MUST]

Given any preview or final shot has been generated
When an editor or API client inspects it
Then its metadata distinguishes open preview, provider-native final, and software
upscale; includes provider/profile, job ID, source revision, duration, and generation
time; and retains the source preview URL for final clips.

### AC-12: Authorization and budget protection [MUST]

Given a user lacks project edit access, the required plan, provider configuration, or
budget allowance
When the user attempts to start or retry final generation
Then the request is rejected before paid work is queued with the existing
authorization, plan, or budget error semantics.

### AC-13: Bounded concurrency [MUST]

Given a project contains 12–24 shots
When preview or final generation runs
Then active requests never exceed the configured positive concurrency limit, whose
defaults are one open-worker request and two closed-provider requests.

### AC-14: Final visual-drift warning [SHOULD]

Given final clips were generated by a different model from the preview
When the updated final film is ready
Then the result states that cross-model visual equivalence is not guaranteed and
surfaces the existing comparison or film-health entry points for editorial review.

### AC-15: Portable worker deployment [SHOULD]

Given an authorized Linux NVIDIA GPU host already runs a supported video backend
When an operator deploys the supplied worker package and configures its URL and token
Then Wind Comic can use the worker without cloud-vendor-specific application code.

### AC-16: Automatic cloud purchasing [WONT]

This feature will NOT purchase, resize, replace, migrate, or bid for GPU instances.
Reason: cloud billing and destructive infrastructure changes require separate,
provider-specific authorization.

### AC-E1: Invalid final selection [MUST]

Given the request contains no eligible shots, duplicate shot numbers, unknown shot
numbers, an unsupported provider, or an invalid concurrency value
When the request is validated
Then it returns a non-success response with a stable machine-readable error code and
does not create a job.

### AC-E2: Duplicate submission [MUST]

Given an equivalent non-terminal final job already exists for the same project and
source revision
When the editor submits the same request again
Then the existing job is returned and no duplicate paid job is created.

### AC-E3: Source revision conflict [MUST]

Given a shot asset changed after the final job snapshot
When the job attempts to replace that shot
Then the replacement is rejected for that shot, the newer asset is preserved, and the
job reports a revision conflict.

### AC-E4: Worker or provider timeout [MUST]

Given the selected worker or provider exceeds its configured timeout
When the attempt expires
Then the shot records a retryable timeout, active capacity is released, and the job
continues or retries according to its bounded retry policy.

### AC-E5: Recomposition failure [MUST]

Given shot generation reached terminal states but deterministic recomposition fails
When the job finalizes
Then completed shot assets remain versioned and recoverable, the job is partial rather
than complete, and retry may run recomposition without regenerating successful shots.

## Out of Scope

- Pixel-identical or motion-identical output across different video models.
- Model training, fine-tuning, LoRA creation, or automated character dataset creation.
- Automatic selection and purchase of the cheapest live cloud listing.
- AI generation of exact Chinese captions, logos, legal copy, or application UI.
- Replacing the existing voice, subtitle, lip-sync, music, or film-health subsystems.

## Open Questions

- [RESOLVED] Which open models are required? → Decision: Wan2.2 TI2V-5B and
  HunyuanVideo-1.5.
- [RESOLVED] What is the first GPU deployment target? → Decision: reuse the owner's
  existing Tencent HAI A10 24 GB instance; keep the worker contract portable.
- [RESOLVED] What does one-click final mean? → Decision: one durable whole-film job
  with per-shot execution, retry, replacement, and automatic recomposition.
- [RESOLVED] How is 4K labelled? → Decision: provider-native 4K and software upscale
  are separate provenance states.

## Non-Functional Requirements

- Performance: estimate/readiness APIs complete within 2 seconds at p95 under normal
  database and network conditions.
- Durability: a queued or running final job survives client disconnect and application
  restart with no duplicate completed-shot charge.
- Security: all project and job reads are tenant-scoped; all mutations require edit
  access; secrets remain environment-backed.
- Accessibility: new interactive controls expose labels, disabled state, progress
  text, and keyboard activation consistent with existing project controls.
- Internationalization: Simplified Chinese and English labels are provided for new
  user-visible states; generated captions continue to use deterministic CJK rendering.
- Observability: every final job emits queued, started, per-shot progress, succeeded,
  failed, recomposing, partial/completed, and retry events.
