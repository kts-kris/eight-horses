import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OpenVideoWorkerError,
  OpenVideoWorkerService,
  isOpenVideoProvider,
  workerModelForProvider,
} from '@/services/open-video-worker.service';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('OpenVideoWorkerService profiles', () => {
  it('maps both public provider ids to worker profiles', () => {
    expect(isOpenVideoProvider('wan22')).toBe(true);
    expect(isOpenVideoProvider('hunyuan-video-15')).toBe(true);
    expect(isOpenVideoProvider('kling')).toBe(false);
    expect(workerModelForProvider('wan22')).toBe('wan2.2-ti2v-5b');
    expect(workerModelForProvider('hunyuan-video-15')).toBe('hunyuan-video-1.5');
  });
});

describe('OpenVideoWorkerService readiness', () => {
  it('returns a ready selected profile', async () => {
    vi.stubEnv('OPEN_VIDEO_WORKER_URL', 'https://gpu.example');
    vi.stubEnv('OPEN_VIDEO_WORKER_TOKEN', 'secret');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      profiles: {
        'wan2.2-ti2v-5b': { ready: true, missing: [] },
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const result = await new OpenVideoWorkerService().assertReady('wan22');
    expect(result.profile).toBe('wan2.2-ti2v-5b');
    expect(result.ready).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      'https://gpu.example/health',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
      }),
    );
  });

  it('throws a typed profile_not_ready error with missing models', async () => {
    vi.stubEnv('OPEN_VIDEO_WORKER_URL', 'https://gpu.example');
    vi.stubEnv('OPEN_VIDEO_WORKER_TOKEN', 'secret');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      profiles: {
        'hunyuan-video-1.5': { ready: false, missing: ['model.safetensors'] },
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    await expect(new OpenVideoWorkerService().assertReady('hunyuan-video-15'))
      .rejects.toMatchObject<Partial<OpenVideoWorkerError>>({
        code: 'profile_not_ready',
        retryable: false,
      });
  });
});

describe('OpenVideoWorkerService generation', () => {
  it('submits, polls and returns the signed worker video url', async () => {
    vi.stubEnv('OPEN_VIDEO_WORKER_URL', 'https://gpu.example');
    vi.stubEnv('OPEN_VIDEO_WORKER_TOKEN', 'secret');
    vi.stubEnv('OPEN_VIDEO_POLL_MS', '1');
    const mockedFetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/v1/video/generations')) {
        return new Response(JSON.stringify({
          id: 'job-1',
          status: 'queued',
          status_url: '/v1/video/generations/job-1',
        }), { status: 202, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        id: 'job-1',
        status: 'succeeded',
        progress: 100,
        video_url: '/v1/files?filename=out.mp4&sig=x',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', mockedFetch);
    const progress = vi.fn();

    const result = await new OpenVideoWorkerService().generateVideo('wan22', {
      prompt: '镜头运动',
      firstFrameUrl: 'https://assets.example/first.png',
      durationSec: 5,
      aspectRatio: '16:9',
      onProgress: progress,
    });

    expect(result).toEqual({
      videoUrl: 'https://gpu.example/v1/files?filename=out.mp4&sig=x',
      upstreamId: 'job-1',
      durationSec: 5,
      model: 'wan2.2-ti2v-5b',
    });
    expect(progress).toHaveBeenCalledWith(100, 'open-video: succeeded');
    const submit = mockedFetch.mock.calls[0];
    const init = submit[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'wan2.2-ti2v-5b',
      width: 1280,
      height: 720,
      duration_seconds: 5,
      image_url: 'https://assets.example/first.png',
    });
  });

  it('surfaces a terminal worker failure without returning a clip', async () => {
    vi.stubEnv('OPEN_VIDEO_WORKER_URL', 'https://gpu.example');
    vi.stubEnv('OPEN_VIDEO_WORKER_TOKEN', 'secret');
    vi.stubEnv('OPEN_VIDEO_POLL_MS', '1');
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'job-2', status: 'queued', status_url: '/v1/video/generations/job-2',
      }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'job-2',
        status: 'failed',
        error: { code: 'backend_rejected', message: 'out of memory' },
      }), { status: 200 })));

    await expect(new OpenVideoWorkerService().generateVideo('wan22', { prompt: 'x' }))
      .rejects.toMatchObject<Partial<OpenVideoWorkerError>>({
        code: 'backend_rejected',
        retryable: false,
      });
  });
});
