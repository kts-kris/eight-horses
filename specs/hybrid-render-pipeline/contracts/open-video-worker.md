# API Contract: Open Video Worker

## GET /health

### Description

Returns backend readiness and supported open-model profiles.

### Authentication

Bearer worker token required.

### Response

**Success (200):**

```json
{
  "ok": true,
  "backend": "comfyui",
  "gpu": { "name": "NVIDIA A10", "vramMb": 23028 },
  "profiles": {
    "wan2.2-ti2v-5b": { "ready": true, "missing": [] },
    "hunyuan-video-1.5": { "ready": false, "missing": ["model-file-name"] }
  }
}
```

**Error Codes:**

| Status | Code | When |
|---|---|---|
| 401 | UNAUTHORIZED | Token absent or invalid |
| 503 | BACKEND_UNAVAILABLE | ComfyUI is unreachable |

## POST /v1/video/generations

### Description

Compiles and queues one official open-video workflow.

### Authentication

Bearer worker token required.

### Request Body

```json
{
  "model": "wan2.2-ti2v-5b | hunyuan-video-1.5",
  "prompt": "string, 1..2450",
  "negative_prompt": "optional string",
  "image_url": "optional http(s) URL",
  "width": 1280,
  "height": 720,
  "duration_seconds": 5,
  "fps": 24,
  "seed": 123456
}
```

### Response

**Accepted (202):**

```json
{
  "id": "comfy-prompt-id",
  "status": "queued",
  "status_url": "/v1/video/generations/comfy-prompt-id"
}
```

**Error Codes:**

| Status | Code | When |
|---|---|---|
| 400 | VALIDATION_ERROR | Invalid profile, dimensions, duration, fps, seed, prompt, or URL |
| 401 | UNAUTHORIZED | Token absent or invalid |
| 409 | PROFILE_NOT_READY | Required nodes or models are missing |
| 502 | BACKEND_REJECTED | ComfyUI rejects the prompt |
| 503 | BACKEND_UNAVAILABLE | ComfyUI is unreachable |

## GET /v1/video/generations/:id

### Description

Returns ComfyUI prompt state and a signed output URL on success.

### Authentication

Bearer worker token required.

### Response

```json
{
  "id": "comfy-prompt-id",
  "status": "queued | running | succeeded | failed",
  "progress": 0,
  "video_url": "present only on success",
  "error": { "code": "string", "message": "string" }
}
```

### AC Coverage

- AC-1, AC-2, AC-11, AC-13, AC-15, AC-E4.

