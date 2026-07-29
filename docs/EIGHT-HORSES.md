# Eight Horses 改造说明

## 项目定位

Eight Horses 是 Wind Comic 的独立衍生版本，目标不是替换原有多 Agent
短剧生产能力，而是补齐一条更适合实际采购和制作的双档渲染路径：

1. 使用低成本 GPU 和开源模型快速产出完整 720p 审片样片。
2. 剧本、镜头、配音和时间线确认后，一键切换闭源高级模型生成原生 4K
   播放版成片。

上游项目：
[ChrisChen667788/wind-comic](https://github.com/ChrisChen667788/wind-comic)。
本分支基于上游提交 `ef473fcd7e2cb4b51438005d4d1361e904a7cd69`，
并保留其 MIT 许可证和原作者版权声明。

## Eight Horses 新增能力

### 低成本开源样片

- 新增 Wan2.2 TI2V-5B、HunyuanVideo 1.5 两个视频 provider。
- 默认输出 720p，单 GPU 默认并发为 1。
- 用户明确选择开源样片时采用 fail-closed 策略：Worker 未就绪就停止，
  不会静默切换付费视频模型。
- 资产记录实际 `engine` 和 `qualityClass=open-preview-720p`，不把样片冒充
  高质量最终片。

### 可迁移 GPU Worker

`workers/open-video/` 提供复用现有 ComfyUI 的 FastAPI sidecar：

- Bearer Token 鉴权；
- Wan2.2 / HunyuanVideo 官方工作流模板；
- GPU、ComfyUI、节点和模型完整性预检；
- 异步任务提交、状态轮询和 HMAC 签名视频输出；
- 首帧 URL 的 SSRF、重定向和流式大小防护；
- 不自动购买、扩容、重装或迁移云端 GPU。

### 一键原生 4K 最终片

- 在项目 Shot Workshop 中新增整片入口。
- 使用 Kling v3 原生 2160p 重渲每个已确认镜头。
- 提交前显示成本估算并执行账户预算门禁。
- 冻结镜头版本、首帧、提示词、配音和参考资产。
- 支持并发限制、幂等、部分成功、失败镜头续跑和版本冲突保护。
- 复用原时间线、中文配音、BGM、转场与字幕重新合成完整成片。

### 中文与口型

- 仓库内置开源 Noto Sans CJK 字体及许可证，避免 Linux 部署后出现方块字。
- 有对白的镜头在 4K 视觉渲染后再次执行中文 lip-sync。
- 如果口型服务失败，已付费生成的 4K 画面会先持久化；再次点击续跑时只补
  口型，不会重复生成 4K 视频。
- 对白镜头缺少公网可读取的配音时，整片任务会在提交前拒绝，避免交付无声或
  无法对口型的“成功”成片。

## 关键配置

```dotenv
OPEN_VIDEO_WORKER_URL=https://your-worker.example.com
OPEN_VIDEO_WORKER_TOKEN=replace-with-a-long-random-token
OPEN_VIDEO_POLL_MS=5000
OPEN_VIDEO_TIMEOUT_MS=900000
OPEN_VIDEO_CONCURRENCY=1

KELING_API_KEY=your-kling-key
KELING_VIDEO_MODEL=kling-v3
FILM_RERENDER_CONCURRENCY=2

# 必须是外部口型服务能够读取素材的真实公网 HTTPS 地址
NEXT_PUBLIC_APP_URL=https://your-eight-horses.example.com
```

Worker 的部署步骤、模型模板和预检命令见
[`workers/open-video/README.md`](../workers/open-video/README.md)。

## 验证基线

Eight Horses 首次发布前已完成：

- 426 个 Vitest 测试文件，3527 项测试全部通过；
- 7 项 Python Worker 测试全部通过；
- `tsc --noEmit` 通过；
- Next.js production build 通过；
- Noto Sans CJK 字体 SHA-256：
  `2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b`。

## 当前云端状态

代码和部署包已经就绪，但任何具体腾讯 HAI 实例的启动、模型下载和真实视频
生成仍需要实例所有者登录腾讯云后执行。Eight Horses 不包含云账号凭据，也不会
绕过登录或自动创建新的付费 GPU 资源。
