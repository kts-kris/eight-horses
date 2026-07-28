import type { VideoGenerateInput } from '@/lib/video-providers/types';

export const OPEN_VIDEO_PROVIDER_PROFILES = {
  wan22: 'wan2.2-ti2v-5b',
  'hunyuan-video-15': 'hunyuan-video-1.5',
} as const;

export type OpenVideoProviderId = keyof typeof OPEN_VIDEO_PROVIDER_PROFILES;
export type OpenVideoWorkerProfile = (typeof OPEN_VIDEO_PROVIDER_PROFILES)[OpenVideoProviderId];

export interface OpenVideoWorkerProfileHealth {
  ready: boolean;
  missing?: string[];
  source?: string;
}

export interface OpenVideoWorkerHealth {
  ok: boolean;
  backend?: string;
  gpu?: { name?: string; vramMb?: number };
  profiles?: Partial<Record<OpenVideoWorkerProfile, OpenVideoWorkerProfileHealth>>;
}

interface WorkerJobResponse {
  id?: string;
  status?: string;
  status_url?: string;
  video_url?: string;
  progress?: number;
  error?: { code?: string; message?: string } | string;
}

export class OpenVideoWorkerError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'OpenVideoWorkerError';
  }
}

export function isOpenVideoProvider(value: unknown): value is OpenVideoProviderId {
  return typeof value === 'string' && value in OPEN_VIDEO_PROVIDER_PROFILES;
}

export function workerModelForProvider(provider: string): OpenVideoWorkerProfile {
  if (!isOpenVideoProvider(provider)) {
    throw new OpenVideoWorkerError('unsupported_profile', `不支持的开源视频 profile: ${provider}`, false, 400);
  }
  return OPEN_VIDEO_PROVIDER_PROFILES[provider];
}

export function hasOpenVideoWorker(): boolean {
  return /^https?:\/\//.test(process.env.OPEN_VIDEO_WORKER_URL || '')
    && !!process.env.OPEN_VIDEO_WORKER_TOKEN;
}

function dimensionsFor(input: VideoGenerateInput): { width: number; height: number } {
  const explicit = String(input.resolution || '').match(/^(\d{3,4})x(\d{3,4})$/);
  if (explicit) {
    return { width: Number(explicit[1]), height: Number(explicit[2]) };
  }
  if (input.aspectRatio === '9:16') return { width: 720, height: 1280 };
  if (input.aspectRatio === '1:1') return { width: 720, height: 720 };
  return { width: 1280, height: 720 };
}

function workerErrorMessage(body: WorkerJobResponse | Record<string, unknown>, fallback: string): string {
  const err = body?.error;
  if (typeof err === 'string') return err.slice(0, 300);
  if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
    return String((err as { message: string }).message).slice(0, 300);
  }
  return fallback;
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export class OpenVideoWorkerService {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly pollMs: number;
  private readonly generationTimeoutMs: number;

  constructor() {
    this.baseUrl = (process.env.OPEN_VIDEO_WORKER_URL || '').replace(/\/+$/, '');
    this.token = process.env.OPEN_VIDEO_WORKER_TOKEN || '';
    this.pollMs = Math.max(1, Number(process.env.OPEN_VIDEO_POLL_MS) || 5_000);
    this.generationTimeoutMs = Math.max(30_000, Number(process.env.OPEN_VIDEO_TIMEOUT_MS) || 15 * 60_000);
  }

  private ensureConfigured(): void {
    if (!/^https?:\/\//.test(this.baseUrl) || !this.token) {
      throw new OpenVideoWorkerError(
        'worker_not_configured',
        'OPEN_VIDEO_WORKER_URL / OPEN_VIDEO_WORKER_TOKEN 未配置',
        false,
        422,
      );
    }
  }

  private headers(json = false): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      ...(json ? { 'Content-Type': 'application/json' } : {}),
    };
  }

  private resolveMediaUrl(value: string): string {
    try {
      const resolved = new URL(value, `${this.baseUrl}/`);
      if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') throw new Error('invalid protocol');
      return resolved.toString();
    } catch {
      throw new OpenVideoWorkerError('missing_video_url', 'Worker 完成但未返回有效 video_url', false, 502);
    }
  }

  private async request(pathOrUrl: string, init: RequestInit, timeoutMs = 15_000): Promise<Response> {
    this.ensureConfigured();
    const url = /^https?:\/\//.test(pathOrUrl)
      ? pathOrUrl
      : `${this.baseUrl}/${pathOrUrl.replace(/^\/+/, '')}`;
    const parsed = new URL(url);
    if (parsed.origin !== new URL(this.baseUrl).origin) {
      throw new OpenVideoWorkerError('invalid_worker_url', 'Worker 返回了不同源的状态地址', false, 502);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      const timeout = error instanceof Error && error.name === 'AbortError';
      throw new OpenVideoWorkerError(
        timeout ? 'worker_timeout' : 'worker_unreachable',
        timeout ? 'Open Video Worker 请求超时' : 'Open Video Worker 无法连接',
        true,
        503,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async health(): Promise<OpenVideoWorkerHealth> {
    const response = await this.request('/health', { headers: this.headers() }, 5_000);
    const body = await response.json().catch(() => ({})) as OpenVideoWorkerHealth & Record<string, unknown>;
    if (!response.ok) {
      throw new OpenVideoWorkerError(
        response.status === 401 ? 'worker_unauthorized' : 'worker_unavailable',
        workerErrorMessage(body, `Open Video Worker health ${response.status}`),
        retryableStatus(response.status),
        response.status,
      );
    }
    return body;
  }

  async assertReady(provider: string): Promise<OpenVideoWorkerProfileHealth & { profile: OpenVideoWorkerProfile }> {
    const profile = workerModelForProvider(provider);
    const health = await this.health();
    const state = health.profiles?.[profile];
    if (!health.ok || !state?.ready) {
      const missing = state?.missing?.filter(Boolean).slice(0, 8) || [];
      throw new OpenVideoWorkerError(
        'profile_not_ready',
        `${profile} 未就绪${missing.length ? `: 缺少 ${missing.join(', ')}` : ''}`,
        false,
        409,
      );
    }
    return { ...state, profile };
  }

  async generateVideo(
    provider: string,
    input: VideoGenerateInput,
  ): Promise<{ videoUrl: string; upstreamId: string; durationSec: number; model: OpenVideoWorkerProfile }> {
    const model = workerModelForProvider(provider);
    const { width, height } = dimensionsFor(input);
    const durationSec = Math.max(1, Math.min(10, Math.round(input.durationSec || 5)));
    const response = await this.request('/v1/video/generations', {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({
        model,
        prompt: input.prompt.slice(0, 2450),
        image_url: /^https?:\/\//.test(input.firstFrameUrl || '') ? input.firstFrameUrl : undefined,
        width,
        height,
        duration_seconds: durationSec,
        fps: 24,
      }),
    }, 30_000);
    const created = await response.json().catch(() => ({})) as WorkerJobResponse;
    if (!response.ok) {
      const code = typeof created.error === 'object' && created.error?.code
        ? created.error.code
        : `worker_submit_${response.status}`;
      throw new OpenVideoWorkerError(
        code,
        workerErrorMessage(created, `Open Video Worker submit ${response.status}`),
        retryableStatus(response.status),
        response.status,
      );
    }
    if (created.video_url) {
      return {
        videoUrl: this.resolveMediaUrl(created.video_url),
        upstreamId: created.id || '',
        durationSec,
        model,
      };
    }
    const jobId = created.id || '';
    const statusUrl = created.status_url || (jobId ? `/v1/video/generations/${encodeURIComponent(jobId)}` : '');
    if (!jobId || !statusUrl) {
      throw new OpenVideoWorkerError('invalid_worker_response', 'Worker 未返回 job id/status url', false, 502);
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < this.generationTimeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, this.pollMs));
      const statusResponse = await this.request(statusUrl, { headers: this.headers() }, 15_000);
      const statusBody = await statusResponse.json().catch(() => ({})) as WorkerJobResponse;
      if (!statusResponse.ok) {
        if (retryableStatus(statusResponse.status)) continue;
        throw new OpenVideoWorkerError(
          `worker_poll_${statusResponse.status}`,
          workerErrorMessage(statusBody, `Open Video Worker poll ${statusResponse.status}`),
          false,
          statusResponse.status,
        );
      }
      const state = String(statusBody.status || '').toLowerCase();
      const pct = Math.max(0, Math.min(100, Number(statusBody.progress) || 0));
      input.onProgress?.(pct, `open-video: ${state || 'running'}`);
      if (state === 'succeeded' || state === 'completed' || state === 'success') {
        if (!statusBody.video_url) {
          throw new OpenVideoWorkerError('missing_video_url', 'Worker 完成但未返回 video_url', false, 502);
        }
        return {
          videoUrl: this.resolveMediaUrl(statusBody.video_url),
          upstreamId: jobId,
          durationSec,
          model,
        };
      }
      if (state === 'failed' || state === 'error' || state === 'cancelled') {
        const code = typeof statusBody.error === 'object' && statusBody.error?.code
          ? statusBody.error.code
          : 'worker_generation_failed';
        throw new OpenVideoWorkerError(
          code,
          workerErrorMessage(statusBody, `Open Video Worker ${state}`),
          false,
          502,
        );
      }
    }
    throw new OpenVideoWorkerError('worker_generation_timeout', '开源视频生成超过等待上限', true, 504);
  }
}
