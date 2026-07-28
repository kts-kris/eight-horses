import asyncio
import unittest

import httpx
from fastapi import HTTPException

from server import assert_public_http_url, file_signature, find_output, read_response_capped


class ServerHelpersTest(unittest.TestCase):
    def test_finds_comfy_video_output(self):
        history = {
            "outputs": {
                "42": {
                    "videos": [{
                        "filename": "wind-comic/out.mp4",
                        "subfolder": "final",
                        "type": "output",
                    }]
                }
            }
        }
        self.assertEqual(find_output(history), {
            "filename": "wind-comic/out.mp4",
            "subfolder": "final",
            "kind": "output",
        })

    def test_file_signature_binds_path_and_expiry(self):
        first = file_signature("a.mp4", "", "output", 100)
        self.assertEqual(first, file_signature("a.mp4", "", "output", 100))
        self.assertNotEqual(first, file_signature("b.mp4", "", "output", 100))
        self.assertNotEqual(first, file_signature("a.mp4", "", "output", 101))

    def test_rejects_private_image_urls(self):
        with self.assertRaises(ValueError):
            assert_public_http_url("http://127.0.0.1/private.png")

    def test_streaming_image_limit_rejects_oversize_payload(self):
        response = httpx.Response(200, content=b"12345")
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(read_response_capped(response, 4))
        self.assertEqual(ctx.exception.status_code, 413)


if __name__ == "__main__":
    unittest.main()
