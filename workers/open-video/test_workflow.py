import unittest
import json
from pathlib import Path

from workflow import CompileOptions, compile_ui_graph, referenced_models


class WorkflowTest(unittest.TestCase):
    def test_patches_api_graph(self):
        graph = {
            "1": {"class_type": "CLIPTextEncode", "inputs": {"text": "old"}, "_meta": {"title": "Positive"}},
            "2": {"class_type": "EmptyHunyuanLatentVideo", "inputs": {"width": 1, "height": 1, "length": 1}},
        }
        out = compile_ui_graph(graph, {}, CompileOptions(prompt="中文提示", width=1280, height=720, frames=121))
        self.assertEqual(out["1"]["inputs"]["text"], "中文提示")
        self.assertEqual(out["2"]["inputs"]["width"], 1280)
        self.assertEqual(out["2"]["inputs"]["height"], 720)
        self.assertEqual(out["2"]["inputs"]["length"], 121)

    def test_compiles_ui_graph_links_and_widgets(self):
        graph = {
            "nodes": [
                {"id": 1, "type": "CheckpointLoaderSimple", "inputs": [], "widgets_values": ["m.safetensors"]},
                {"id": 2, "type": "CLIPTextEncode", "title": "Positive", "inputs": [{"name": "clip", "link": 4}], "widgets_values": ["old"]},
            ],
            "links": [[4, 1, 1, 2, 0, "CLIP"]],
        }
        info = {
            "CheckpointLoaderSimple": {"input": {"required": {"ckpt_name": [["m.safetensors"], {}]}}},
            "CLIPTextEncode": {"input": {"required": {"clip": ["CLIP"], "text": ["STRING"]}}},
        }
        out = compile_ui_graph(graph, info, CompileOptions(prompt="new"))
        self.assertEqual(out["2"]["inputs"]["clip"], ["1", 1])
        self.assertEqual(out["2"]["inputs"]["text"], "new")
        self.assertEqual(referenced_models(out), {"m.safetensors"})

    def test_official_templates_are_valid_workflow_graphs(self):
        template_dir = Path(__file__).parent / "templates"
        names = {"wan22_t2v.json", "wan22_i2v.json", "hunyuan15_t2v.json", "hunyuan15_i2v.json"}
        self.assertEqual({path.name for path in template_dir.glob("*.json")}, names)
        for name in names:
            graph = json.loads((template_dir / name).read_text("utf-8"))
            self.assertGreater(len(graph.get("nodes", [])), 5)
            self.assertGreater(len(graph.get("links", [])), 1)


if __name__ == "__main__":
    unittest.main()
