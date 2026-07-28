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
| schemaVersion | integer | `1` | Payload compatibility |
| projectId | string | required | Project ID |
| sourceProjectUpdatedAt | ISO timestamp | required | Frozen project revision |
| provider | string | required | Preferred final provider |
| targetQuality | string | `native-4k` | Honest quality class |
| aspectRatio | string | supported project aspect | Final frame shape |
| concurrency | integer | 1–4 | Bounded provider calls |
| estimateCny | number | non-negative | Pre-submit estimate |
| shots | FilmRerenderShot[] | non-empty, unique shot numbers | Frozen work list |

### FilmRerenderShot

| Field | Type | Constraints | Description |
|---|---|---|---|
| shotNumber | integer | >=1, unique | Shot slot |
| prompt | string | 1–2450 characters | Approved visual prompt |
| durationSec | integer | 1–15 | Approved duration |
| firstFrameUrl | string | required for final I2V | Approved storyboard/anchor |
| lastFrameUrl | string or null | optional | Approved tail frame |
| referenceImages | string[] | bounded | Approved scene/style refs |
| subjectReferences | object[] | bounded | Approved character refs |
| sourceVideoAssetId | string | required | Compare-and-swap target |
| sourceVideoVersion | integer | >=1 | Revision guard |
| sourcePreviewUrl | string | required | Fallback and provenance |

### PipelineJobEvent

Backed by existing `pipeline_job_events`.

| Event type | Data | Description |
|---|---|---|
| `filmRerenderQueued` | estimate, shot list | Accepted work |
| `shotStarted` | shot, provider | Provider attempt |
| `shotProgress` | shot, percent, status | Polling |
| `shotCompleted` | shot, output, elapsed | Persisted and replaced |
| `shotFailed` | shot, code, retryable, message | Incomplete shot |
| `shotConflict` | shot, expected/current version | Source edit guard |
| `recomposeStarted` | resolution | Final composition |
| `recomposeCompleted` | final URL, duration | Persisted final |
| `filmRerenderPartial` | completed, failed | Partial terminal |
| `filmRerenderCompleted` | completed | Complete terminal |

### ProjectAsset

Backed by existing `project_assets`.

For successful final shot assets, `data` is replaced with merged metadata containing:

| Field | Type | Description |
|---|---|---|
| duration | number | Approved shot duration |
| quality | `4k` | User-facing quality |
| qualityClass | `provider-native` | Honest source class |
| engine | string | Actual provider |
| model | string | Actual model/profile when returned |
| finalRerenderJobId | string | Resume/idempotency marker |
| sourcePreviewUrl | string | Original preview |
| sourceAssetVersion | integer | Frozen source version |
| sourceProjectUpdatedAt | ISO timestamp | Frozen project revision |
| regeneratedAt | ISO timestamp | Completion time |

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

