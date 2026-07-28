"""Wind Comic Open Video Worker：现有 ComfyUI 的鉴权 sidecar。"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import ipaddress
import socket
import time
import urllib.parse
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, model_validator

from workflow import CompileOptions, compile_ui_graph, referenced_models


COMFY_URL = os.getenv("COMFYUI_URL", "http://127.0.0.1:6889").rstrip("/")
TOKEN = os.getenv("OPEN_VIDEO_WORKER_TOKEN", "")
SIGNING_KEY = os.getenv("OPEN_VIDEO_SIGNING_KEY", TOKEN)
TEMPLATE_DIR = Path(os.getenv("OPEN_VIDEO_TEMPLATE_DIR", Path(__file__).parent / "templates"))
MAX_IMAGE_BYTES = int(os.getenv("OPEN_VIDEO_MAX_IMAGE_BYTES", str(20 * 1024 * 1024)))

PROFILE_TEMPLATES = {
    ("wan2.2-ti2v-5b", False): "wan22_t2v.json",
    ("wan2.2-ti2v-5b", True): "wan22_i2v.json",
    ("hunyuan-video-1.5", False): "hunyuan15_t2v.json",
    ("hunyuan-video-1.5", True): "hunyuan15_i2v.json",
}

app = FastAPI(title="Wind Comic Open Video Worker", version="1.0.0")


class GenerationRequest(BaseModel):
    model: Literal["wan2.2-ti2v-5b", "hunyuan-video-1.5"]
    prompt: str = Field(min_length=1, max_length=2450)
    negative_prompt: str = Field(default="", max_length=1200)
    image_url: str | None = None
    width: int = Field(default=1280, ge=256, le=1920)
    height: int = Field(default=720, ge=256, le=1920)
    duration_seconds: int = Field(default=5, ge=1, le=10)
    fps: int = Field(default=24, ge=8, le=30)
    seed: int | None = None

    @model_validator(mode="after")
    def validate_pixels(self) -> "GenerationRequest":
        if self.width * self.height > 1280 * 1280:
            raise ValueError("输出像素超过单 Worker 安全上限")
        return self


def require_token(authorization: str | None = Header(default=None)) -> None:
    if not TOKEN:
        raise HTTPException(503, detail="OPEN_VIDEO_WORKER_TOKEN 未配置")
    expected = f"Bearer {TOKEN}"
    if not authorization or not hmac.compare_digest(authorization, expected):
        raise HTTPException(401, detail="Unauthorized")


def file_signature(filename: str, subfolder: str, kind: str, exp: int) -> str:
    payload = f"{filename}\n{subfolder}\n{kind}\n{exp}".encode()
    return hmac.new(SIGNING_KEY.encode(), payload, hashlib.sha256).hexdigest()


def signed_file_url(filename: str, subfolder: str, kind: str = "output") -> str:
    exp = int(time.time()) + 3600
    query = urllib.parse.urlencode({
        "filename": filename,
        "subfolder": subfolder,
        "type": kind,
        "exp": exp,
        "sig": file_signature(filename, subfolder, kind, exp),
    })
    public = os.getenv("OPEN_VIDEO_PUBLIC_URL", "").rstrip("/")
    return f"{public}/v1/files?{query}" if public else f"/v1/files?{query}"


def assert_public_http_url(raw_url: str) -> None:
    parsed = urllib.parse.urlparse(raw_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("只允许公网 http(s) URL")
    try:
        addresses = {item[4][0] for item in socket.getaddrinfo(parsed.hostname, parsed.port or 443)}
    except socket.gaierror as exc:
        raise ValueError("image_url DNS 解析失败") from exc
    if not addresses:
        raise ValueError("image_url DNS 无结果")
    for address in addresses:
        ip = ipaddress.ip_address(address)
        if not ip.is_global:
            raise ValueError(f"image_url 解析到非公网地址：{address}")


async def comfy_json(path: str, method: str = "GET", payload: Any = None) -> Any:
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.request(method, f"{COMFY_URL}/{path.lstrip('/')}", json=payload)
        response.raise_for_status()
        return response.json()


@lru_cache(maxsize=1)
def load_template(name: str) -> dict[str, Any]:
    path = (TEMPLATE_DIR / name).resolve()
    if path.parent != TEMPLATE_DIR.resolve() or not path.exists():
        raise FileNotFoundError(f"模板不存在：{name}")
    return json.loads(path.read_text("utf-8"))


async def compile_profile(model: str, image_name: str | None, request: GenerationRequest) -> dict[str, Any]:
    info = await comfy_json("/object_info")
    template_name = PROFILE_TEMPLATES[(model, bool(image_name))]
    frames = request.duration_seconds * request.fps + 1
    opts = CompileOptions(
        prompt=request.prompt,
        negative_prompt=request.negative_prompt,
        width=request.width,
        height=request.height,
        frames=frames,
        fps=request.fps,
        seed=request.seed if request.seed is not None else int(time.time_ns() % (2**31)),
        image_name=image_name,
        filename_prefix=f"wind-comic/{model}/{int(time.time())}",
    )
    return compile_ui_graph(load_template(template_name), info, opts)


async def read_response_capped(response: httpx.Response, max_bytes: int) -> bytes:
    declared = int(response.headers.get("content-length") or 0)
    if declared > max_bytes:
        raise HTTPException(413, detail="首帧超过 Worker 大小上限")
    chunks: list[bytes] = []
    total = 0
    async for chunk in response.aiter_bytes():
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(413, detail="首帧超过 Worker 大小上限")
        chunks.append(chunk)
    return b"".join(chunks)


async def upload_image(url: str) -> str:
    async with httpx.AsyncClient(timeout=30, follow_redirects=False) as client:
        current = url
        response: httpx.Response | None = None
        for _ in range(6):
            try:
                assert_public_http_url(current)
            except ValueError as exc:
                raise HTTPException(400, detail=str(exc)) from exc
            response = await client.send(client.build_request("GET", current), stream=True)
            if response.status_code not in {301, 302, 303, 307, 308}:
                break
            location = response.headers.get("location")
            await response.aclose()
            if not location:
                raise HTTPException(502, detail="首帧重定向缺少 Location")
            current = urllib.parse.urljoin(current, location)
        else:
            raise HTTPException(400, detail="首帧重定向次数过多")
        assert response is not None
        try:
            response.raise_for_status()
            content_type = response.headers.get("content-type", "")
            if not content_type.startswith("image/"):
                raise HTTPException(415, detail="image_url 不是图片")
            content = await read_response_capped(response, MAX_IMAGE_BYTES)
        finally:
            await response.aclose()
        ext = "." + content_type.split("/", 1)[1].split(";", 1)[0].replace("jpeg", "jpg")
        filename = f"wind-comic-{hashlib.sha256(content).hexdigest()[:16]}{ext}"
        uploaded = await client.post(
            f"{COMFY_URL}/upload/image",
            files={"image": (filename, content, content_type)},
            data={"overwrite": "true"},
        )
        uploaded.raise_for_status()
        return str(uploaded.json().get("name") or filename)


@app.get("/health", dependencies=[Depends(require_token)])
async def health() -> dict[str, Any]:
    try:
        stats, info = await comfy_json("/system_stats"), await comfy_json("/object_info")
    except Exception as exc:
        raise HTTPException(503, detail=f"ComfyUI 不可达：{type(exc).__name__}") from exc

    available_models: set[str] = set()
    for definition in info.values():
        input_def = definition.get("input") if isinstance(definition, dict) else None
        for group in ("required", "optional"):
            values = (input_def or {}).get(group) or {}
            for schema in values.values() if isinstance(values, dict) else []:
                enum = schema[0] if isinstance(schema, list) and schema else None
                if isinstance(enum, list):
                    available_models.update(
                        str(item) for item in enum
                        if isinstance(item, str) and item.lower().endswith((".safetensors", ".gguf", ".pt", ".pth"))
                    )

    profiles: dict[str, Any] = {}
    for profile in ("wan2.2-ti2v-5b", "hunyuan-video-1.5"):
        missing: set[str] = set()
        errors: list[str] = []
        for has_image in (False, True):
            template_name = PROFILE_TEMPLATES[(profile, has_image)]
            try:
                graph = compile_ui_graph(
                    load_template(template_name),
                    info,
                    CompileOptions(prompt="health check", image_name="health.png" if has_image else None),
                )
                missing.update(referenced_models(graph) - available_models)
            except Exception as exc:
                errors.append(f"{template_name}: {exc}")
        profiles[profile] = {
            "ready": not errors and not missing,
            "missing": sorted(missing),
            "source": "official ComfyUI template",
            "errors": errors[:4],
        }
    devices = stats.get("devices") or []
    gpu = devices[0] if devices else {}
    return {
        "ok": True,
        "backend": COMFY_URL,
        "gpu": {"name": gpu.get("name"), "vramMb": (gpu.get("vram_total") or 0) // 1024 // 1024},
        "profiles": profiles,
    }


@app.post("/v1/video/generations", status_code=202, dependencies=[Depends(require_token)])
async def generate(request: GenerationRequest) -> dict[str, Any]:
    try:
        image_name = await upload_image(request.image_url) if request.image_url else None
        graph = await compile_profile(request.model, image_name, request)
        queued = await comfy_json("/prompt", "POST", {"prompt": graph})
    except HTTPException:
        raise
    except FileNotFoundError as exc:
        raise HTTPException(409, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(503, detail=f"ComfyUI 请求失败：{type(exc).__name__}") from exc
    prompt_id = str(queued.get("prompt_id") or "")
    if not prompt_id:
        raise HTTPException(502, detail="ComfyUI 未返回 prompt_id")
    return {"id": prompt_id, "status": "queued", "status_url": f"/v1/video/generations/{prompt_id}"}


def find_output(history: dict[str, Any]) -> dict[str, str] | None:
    for node in (history.get("outputs") or {}).values():
        for key in ("videos", "gifs", "images"):
            values = node.get(key) if isinstance(node, dict) else None
            if isinstance(values, list):
                for item in values:
                    if isinstance(item, dict) and item.get("filename"):
                        return {
                            "filename": str(item["filename"]),
                            "subfolder": str(item.get("subfolder") or ""),
                            "kind": str(item.get("type") or "output"),
                        }
    return None


@app.get("/v1/video/generations/{job_id}", dependencies=[Depends(require_token)])
async def generation_status(job_id: str) -> dict[str, Any]:
    history = await comfy_json(f"/history/{job_id}")
    record = history.get(job_id) if isinstance(history, dict) else None
    if record:
        output = find_output(record)
        status = record.get("status") or {}
        if output:
            return {
                "id": job_id,
                "status": "succeeded",
                "progress": 100,
                "video_url": signed_file_url(**output),
            }
        if status.get("status_str") == "error" or status.get("completed") is False:
            messages = status.get("messages") or []
            return {"id": job_id, "status": "failed", "error": {"code": "comfy_failed", "message": str(messages)[-500:]}}
    queue = await comfy_json("/queue")
    queued_ids = {str(x[1]) for key in ("queue_running", "queue_pending") for x in (queue.get(key) or []) if len(x) > 1}
    return {"id": job_id, "status": "running" if job_id in queued_ids else "queued", "progress": 10}


@app.get("/v1/files")
async def files(
    filename: str = Query(min_length=1),
    subfolder: str = "",
    type: str = "output",
    exp: int = 0,
    sig: str = "",
) -> StreamingResponse:
    if exp < int(time.time()) or not hmac.compare_digest(sig, file_signature(filename, subfolder, type, exp)):
        raise HTTPException(403, detail="文件链接无效或已过期")
    params = {"filename": filename, "subfolder": subfolder, "type": type}
    client = httpx.AsyncClient(timeout=None)
    upstream = await client.send(client.build_request("GET", f"{COMFY_URL}/view", params=params), stream=True)
    if upstream.status_code != 200:
        await client.aclose()
        raise HTTPException(upstream.status_code, detail="ComfyUI 文件读取失败")

    async def stream():
        try:
            async for chunk in upstream.aiter_bytes():
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(stream(), media_type=upstream.headers.get("content-type", "video/mp4"))
