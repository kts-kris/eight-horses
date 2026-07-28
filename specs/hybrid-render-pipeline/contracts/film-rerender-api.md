# API Contract: Whole-Film Final Rerender

## GET /api/projects/:id/rerender-film

### Description

Returns estimate/readiness and optionally one job's durable progress.

### Authentication

Project view access required. Estimate fields that expose paid action availability are
returned to viewers, but only editors may POST.

### Query Parameters

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| jobId | string | no | none | Include one project-owned job and its progress |
| provider | string | no | kling | Estimate provider |
| shots | comma-separated integers | no | all | Estimate selection |

### Success (200)

```json
{
  "estimate": {
    "provider": "kling",
    "targetQuality": "native-4k",
    "shotCount": 18,
    "totalDurationSec": 90,
    "estimateCny": 108,
    "ready": true,
    "reason": ""
  },
  "job": {
    "id": "pj_x",
    "state": "queued | running | done | partial | failed",
    "step": "render:7/18",
    "attempts": 1,
    "lastError": "",
    "events": []
  }
}
```

## POST /api/projects/:id/rerender-film

### Description

Freezes the selected source revision and queues one durable paid final job.

### Authentication

Project edit access and Pro plan required.

### Request Body

```json
{
  "provider": "kling",
  "targetQuality": "native-4k",
  "shotNumbers": [1, 2, 3],
  "concurrency": 2
}
```

### Success (202)

```json
{
  "jobId": "pj_x",
  "deduplicated": false,
  "workerActive": true,
  "estimate": {
    "shotCount": 3,
    "totalDurationSec": 15,
    "estimateCny": 18
  }
}
```

Equivalent active jobs return the same shape with `deduplicated: true`.

### Error Codes

| Status | Code | When |
|---|---|---|
| 400 | INVALID_SELECTION | Empty, duplicate, unknown shots or invalid concurrency |
| 401 | UNAUTHORIZED | Not signed in |
| 402 | PLAN_REQUIRED | Below Pro plan |
| 402 | BUDGET_EXCEEDED | Estimate violates budget guard |
| 403 | FORBIDDEN | No project edit access |
| 409 | SOURCE_CONFLICT | Source cannot be snapshotted consistently |
| 422 | PROVIDER_UNAVAILABLE | Final provider or native 4K mode is not configured |

## POST /api/pipeline-jobs/:id/retry

### Description

Existing retry endpoint extended to accept project-owned `partial` jobs. The runner
skips completed shot metadata and retries only incomplete shots/recomposition.

### Success (200)

```json
{
  "requeued": true,
  "workerActive": true
}
```

### AC Coverage

- AC-3 through AC-14 and AC-E1 through AC-E5.

