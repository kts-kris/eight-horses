# API Contract: Preview Preflight

## POST /api/create-stream

### Description

Existing creation endpoint with explicit open-profile readiness enforcement.

### Authentication

Existing create-stream authentication rules.

### Request Addition

`videoProvider` accepts `wan22` and `hunyuan-video-15`.

### Error Response

**Service Unavailable (503):**

```json
{
  "error": "selected open-video worker is not ready",
  "code": "open_video_worker_not_ready",
  "provider": "wan22",
  "reason": "backend_unavailable | unauthorized | profile_missing | model_missing"
}
```

No creation pipeline job exists when this response is returned.

### AC Coverage

- AC-1, AC-2.

