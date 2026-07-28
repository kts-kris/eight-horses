# Data Model: Hybrid Preview and Final Render Pipeline

## Spec Reference

Implements: `specs/hybrid-render-pipeline/spec.md`

## Reused Entities

### PipelineJob

Backed by existing `pipeline_jobs`.

| Field | Type | Constraints | Feature use |
|---|---|---|---|
| id | text | primary key | Whole-film rerender job ID |
| type | text | `film-rerender` | Runner dispatch |
| project_id | text | required, indexed | Project ownership scope |
| user_id | text | required for new jobs | Tenant and retry ownership |
| state | text | queued/running/done/partial/failed | Durable terminal state |
| step | text | max 60 characters | snapshot/render/recompose marker |
| payload | JSON text | immutable after enqueue | Frozen `FilmRerenderPayload` |
| attempts | integer | max automatic attempts inherited from queue | Resume policy |
| last_error | text | bounded length | Terminal/retry explanation |
| heartbeat_at | timestamp text | required while running | Orphan recovery |
| created_at | timestamp text | required | Audit |
| updated_at | timestamp text | required | Polling |

### FilmRerenderPayload

Stored inside `PipelineJob.payload`.

| Field | Type | Constraints | Description |
|---|---|---|---|
| version | integer | `1` | Payload compatibility |
| fingerprint | string | 24-char digest | Deduplication and resume identity |
| projectId | string | required | Project ID |
| provider | string | `kling` | Final provider |
| resolution | string | `2160p` | Native final target |
| aspectRatio | string | supported project aspect | Final frame shape |
| publicBaseUrl | string | public HTTP(S) origin | Resolves persisted media for external lip-sync |
| concurrency | integer | 1–3 | Bounded provider calls |
| referenceAssets | object[] | bounded | Frozen character/scene/style asset IDs, versions and URLs |
| shots | FilmRerenderShot[] | non-empty, unique shot numbers | Frozen work list |
| createdAt | ISO timestamp | required | Snapshot time |

### FilmRerenderShot

| Field | Type | Constraints | Description |
|---|---|---|---|
| shotNumber | integer | >=1, unique | Shot slot |
| prompt | string | 1–2450 characters | Approved visual prompt |
| dialogue | string or null | optional | Chinese subtitle/lip-sync intent |
| audioUrl | string or null | required for dialogue shots | Frozen public voice track |
| durationSec | integer | 1–15 | Approved duration |
| firstFrameUrl | string | required for final I2V | Approved storyboard/anchor |
| lastFrameUrl | string or null | optional | Approved tail frame |
| videoAssetId | string | required | Compare-and-swap target |
| expectedVersion | integer | >=1 | Revision guard |
| sourceVideoUrl | string | required | Fallback and provenance |

### PipelineJobEvent

Backed by existing `pipeline_job_events`.

| Event type | Data | Description |
|---|---|---|
| `filmRerenderStarted` | total, fingerprint, quality | Accepted work |
| `filmRerenderShot` | shot, state, error | Per-shot lifecycle |
| `filmRerenderProgress` | shot, percent, status | Provider polling |
| `filmLipSync` | shot, state, error | Post-4K Chinese lip-sync lifecycle |
| `filmLipSyncProgress` | shot, percent, status | Lip-sync provider polling |
| `filmRecompose` | state, resolution | Final composition |
| `filmRecomposeProgress` | percent, status | Composer progress |
| `filmRerenderCompleted` | complete/partial result | Durable terminal result |

### ProjectAsset

Backed by existing `project_assets`.

For successful final shot assets, `data` is replaced with merged metadata containing:

| Field | Type | Description |
|---|---|---|
| duration | number | Approved shot duration |
| quality | `4k` | User-facing quality |
| qualityClass | `provider-native-4k` | Honest source class |
| engine | string | Actual provider |
| model | string | Actual model/profile when returned |
| finalRerenderJobId | string | Resume/idempotency marker |
| sourceVideoUrl | string | Original preview |
| sourceRevision | integer | Frozen source version |
| finalRerenderFingerprint | string | Frozen job revision identity |
| finalRerenderVisualFingerprint | string | Preserves paid 4K visual if lip-sync must resume |
| lipSyncApplied | boolean | Whether final dialogue motion passed lip-sync |
| lipSyncPending | boolean | Retry resumes lip-sync without regenerating 4K |
| lipSyncProvider | string or null | Actual lip-sync provider |
| finalRerenderAt | ISO timestamp | Completion time |

For final film assets, metadata additionally includes `renderState`,
`targetResolution`, `completedShots`, `failedShots`, and `sourceJobId`.

## Indexes

No new indexes. Existing indexes satisfy the feature:

| Table | Columns | Rationale |
|---|---|---|
| pipeline_jobs | state, created_at | Worker claim |
| pipeline_jobs | project_id | Equivalent job/status lookup |
| pipeline_job_events | job_id, at, ord | Ordered progress replay |
| project_assets | existing project/type/shot access | Shot lookup |

## Constraints

- `film-rerender` jobs created by this feature always have `user_id`.
- Shot numbers in a payload are unique and sorted.
- Asset replacement is conditional on expected asset ID and version.
- A matching `finalRerenderJobId` is idempotent success.
- `partial` is a terminal state eligible for manual retry.

## Migrations

No schema migration is required. The existing text state column accepts `partial`, and
feature-specific structure is stored in versioned JSON payload/metadata.
