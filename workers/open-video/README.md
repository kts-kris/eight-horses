# Open Video Worker

这是 Eight-Horses 对现有 ComfyUI 的鉴权 sidecar，不安装或替换 ComfyUI。它提供：

- `GET /health`：检查 ComfyUI、GPU、Wan2.2 / HunyuanVideo 1.5 工作流。
- `POST /v1/video/generations`：提交 720p T2V / I2V。
- `GET /v1/video/generations/{id}`：读取任务状态。
- `GET /v1/files`：短时 HMAC 签名输出。

部署到腾讯 HAI 现有实例时：

1. 保持 ComfyUI 使用现有 `6889` 端口。
2. 复制 `.env.example` 为 `.env`，填入随机 Token 和反向代理后的 HTTPS 公网地址。
3. 运行 `docker compose up -d`；sidecar 只监听 `127.0.0.1:6890`。
4. 由已有 HTTPS 反向代理暴露 `6890`，不要直接开放裸 HTTP。
5. 在 Eight-Horses 服务设置同一 `OPEN_VIDEO_WORKER_URL` 与 `OPEN_VIDEO_WORKER_TOKEN`。
6. 执行 `sh preflight.sh`，两个 profile 均为 `ready: true` 后再允许创作。

仓库已固定一份官方模板快照；需要刷新时可显式运行 `python fetch_templates.py`。模板来自官方
`ComfyUI_examples` 和 `Comfy-Org/workflow_templates`。模型下载仍由现有
ComfyUI 模板管理能力完成；本目录不会自动采购、更换或迁移 GPU。
