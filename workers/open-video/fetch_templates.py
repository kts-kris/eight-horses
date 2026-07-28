"""下载官方 ComfyUI 模板；运行时不依赖第三方 Python 包。"""

from __future__ import annotations

import json
from pathlib import Path

import httpx


ROOT = Path(__file__).parent / "templates"
SOURCES = {
    "wan22_t2v.json": "https://raw.githubusercontent.com/comfyanonymous/ComfyUI_examples/master/wan22/text_to_video_wan22_5B.json",
    "wan22_i2v.json": "https://raw.githubusercontent.com/comfyanonymous/ComfyUI_examples/master/wan22/image_to_video_wan22_5B.json",
    "hunyuan15_t2v.json": "https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_hunyuan_video_1.5_720p_t2v.json",
    "hunyuan15_i2v.json": "https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_hunyuan_video_1.5_720p_i2v.json",
}


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    for name, url in SOURCES.items():
        response = httpx.get(url, timeout=30, follow_redirects=True)
        response.raise_for_status()
        data = response.json()
        (ROOT / name).write_text(json.dumps(data, ensure_ascii=False), "utf-8")
        print(f"{name}: ok")


if __name__ == "__main__":
    main()
