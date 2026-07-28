# Assumptions: Hybrid Preview and Final Render Pipeline

Status: Confirmed for autonomous implementation
Last updated: 2026-07-28

The user approved continuous implementation without further intermediate stops. The
following assumptions make that authorization concrete.

## 1. User roles and permissions

- Only a signed-in project owner or editor can start preview generation, request a
  paid final rerender, retry failed shots, or replace project video assets.
- Viewers may inspect progress and outputs but cannot trigger paid or mutating work.
- Existing subscription and budget rules continue to apply.

## 2. Data ownership

- Scripts, storyboards, reference images, prompts, audio, subtitles, preview clips,
  final clips, and job records belong to the Wind Comic project.
- A final-render job uses a frozen snapshot of the project revision that was approved
  when the job was submitted.
- Completed final clips are versioned replacements; the source preview URL and source
  asset version remain recorded for audit and retry.

## 3. Error behaviour

- A missing or unhealthy open-video worker blocks open-model preview generation with
  an actionable configuration error; it does not silently spend money on a closed
  provider.
- A failed final shot does not invalidate successful final shots. The job becomes
  partial, the preview clip remains usable for that shot, and retry targets only
  incomplete shots.
- Provider authentication, moderation, validation, timeout, rate-limit, and budget
  failures remain distinguishable in progress events and API responses.

## 4. Integration

- Preview models integrate through the existing video-provider registry.
- Whole-film final rerender integrates through the existing durable pipeline queue,
  asset repository, plan/budget guards, progress events, and recomposition endpoint.
- Voiceover, subtitle rendering, music, duration, shot order, and Chinese font handling
  reuse the existing deterministic composition pipeline.
- The first deployment target is the owner's existing Tencent HAI A10 24 GB worker.
  The worker contract remains portable to another Linux NVIDIA GPU host.

## 5. Scope boundaries

- Preview profiles are Wan2.2 TI2V-5B and HunyuanVideo-1.5, with 720p as the target
  review resolution.
- “One click” means one user action creates one durable whole-film job; it does not
  mean one upstream API request.
- The default final profile is provider-native Kling 4K when configured. A closed
  provider that cannot produce native 4K is not labelled native 4K.
- Cross-model rerendering is regeneration, not deterministic super-resolution. Exact
  pixel or motion identity between preview and final is not guaranteed.
- Automatic purchase, resizing, migration, or spot-market bidding for cloud instances
  is excluded. The portable worker may be installed on an already-authorized host.

## 6. Performance and volume

- The target film is about 90 seconds and normally contains 12–24 shots.
- Preview and final provider calls use configurable bounded concurrency, defaulting to
  one open-GPU generation and two closed-provider generations.
- A final job survives browser disconnect and application restart. At most three
  automatic attempts are made; completed shots are not regenerated on retry.
- API validation and estimate responses complete within 2 seconds at p95, excluding
  database or infrastructure outages. Media generation is asynchronous and has no
  request-lifecycle completion promise.

