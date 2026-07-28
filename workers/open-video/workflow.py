"""把 ComfyUI 官方工作流转换成可由 /prompt 接收的 API graph。

官方模板可能已经是 API graph，也可能是前端保存的 workflow graph。本模块只依赖
Python 标准库，便于在 GPU 主机上先做离线预检。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class CompileOptions:
    prompt: str
    negative_prompt: str = ""
    width: int = 1280
    height: int = 720
    frames: int = 121
    fps: int = 24
    seed: int = 1
    image_name: str | None = None
    filename_prefix: str = "wind-comic/open-video"


def is_api_graph(graph: Any) -> bool:
    return isinstance(graph, dict) and bool(graph) and all(
        isinstance(v, dict) and isinstance(v.get("class_type"), str)
        for v in graph.values()
    )


def _node_title(node: dict[str, Any]) -> str:
    return str(node.get("title") or node.get("_meta", {}).get("title") or "").lower()


def _patch_input(class_type: str, title: str, inputs: dict[str, Any], opts: CompileOptions) -> None:
    cls = class_type.lower()
    negative = "negative" in title
    if "cliptextencode" in cls and "text" in inputs:
        inputs["text"] = opts.negative_prompt if negative else opts.prompt
    if class_type == "LoadImage" and opts.image_name:
        inputs["image"] = opts.image_name
    for key in ("width", "latent_width"):
        if key in inputs:
            inputs[key] = opts.width
    for key in ("height", "latent_height"):
        if key in inputs:
            inputs[key] = opts.height
    for key in ("length", "video_length", "num_frames", "frames"):
        if key in inputs:
            inputs[key] = opts.frames
    for key in ("fps", "frame_rate"):
        if key in inputs:
            inputs[key] = opts.fps
    for key in ("seed", "noise_seed"):
        if key in inputs:
            inputs[key] = opts.seed
    if class_type in {"SaveAnimatedWEBP", "SaveWEBM", "VHS_VideoCombine", "SaveVideo"}:
        if "filename_prefix" in inputs:
            inputs["filename_prefix"] = opts.filename_prefix
        if "frame_rate" in inputs:
            inputs["frame_rate"] = opts.fps


def patch_api_graph(graph: dict[str, Any], opts: CompileOptions) -> dict[str, Any]:
    output: dict[str, Any] = {}
    for node_id, raw in graph.items():
        node = dict(raw)
        inputs = dict(node.get("inputs") or {})
        _patch_input(str(node["class_type"]), _node_title(node), inputs, opts)
        node["inputs"] = inputs
        output[str(node_id)] = node
    return output


def compile_ui_graph(
    graph: dict[str, Any],
    object_info: dict[str, Any],
    opts: CompileOptions,
) -> dict[str, Any]:
    if is_api_graph(graph):
        return patch_api_graph(graph, opts)

    nodes = graph.get("nodes")
    links = graph.get("links")
    if not isinstance(nodes, list) or not isinstance(links, list):
        raise ValueError("模板既不是 ComfyUI API graph，也不是 UI workflow graph")

    links_by_id: dict[int, tuple[str, int]] = {}
    for link in links:
        if isinstance(link, list) and len(link) >= 4:
            links_by_id[int(link[0])] = (str(link[1]), int(link[2]))

    output: dict[str, Any] = {}
    for raw in nodes:
        if not isinstance(raw, dict) or int(raw.get("mode", 0)) == 4:
            continue
        node_id = str(raw.get("id"))
        class_type = str(raw.get("type") or "")
        definition = object_info.get(class_type)
        if not class_type or not isinstance(definition, dict):
            continue

        declared: list[str] = []
        input_def = definition.get("input") or {}
        for group in ("required", "optional"):
            values = input_def.get(group) or {}
            if isinstance(values, dict):
                declared.extend(values.keys())

        connected: dict[str, Any] = {}
        connected_names: set[str] = set()
        for item in raw.get("inputs") or []:
            if not isinstance(item, dict) or item.get("link") is None:
                continue
            link = links_by_id.get(int(item["link"]))
            if link:
                name = str(item.get("name"))
                connected[name] = [link[0], link[1]]
                connected_names.add(name)

        widgets = list(raw.get("widgets_values") or [])
        widget_index = 0
        inputs = dict(connected)
        for name in declared:
            if name in connected_names:
                continue
            if widget_index < len(widgets):
                inputs[name] = widgets[widget_index]
                widget_index += 1

        node = {
            "class_type": class_type,
            "inputs": inputs,
            "_meta": {"title": str(raw.get("title") or class_type)},
        }
        _patch_input(class_type, _node_title(raw), inputs, opts)
        output[node_id] = node

    if not output:
        raise ValueError("模板没有可在当前 ComfyUI 执行的节点")
    return output


def referenced_models(graph: dict[str, Any]) -> set[str]:
    """提取 graph 中常见 loader 的模型文件名，用于 health 诚实报告。"""
    result: set[str] = set()
    for node in graph.values():
        if not isinstance(node, dict) or "loader" not in str(node.get("class_type", "")).lower():
            continue
        for key, value in (node.get("inputs") or {}).items():
            if ("name" in key or "model" in key) and isinstance(value, str):
                if value.lower().endswith((".safetensors", ".gguf", ".pt", ".pth")):
                    result.add(value)
    return result
