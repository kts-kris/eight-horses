import crypto from 'crypto';
import { persistAsset } from '@/lib/asset-storage';
import { estimatePipelineCostCny } from '@/lib/budget-estimate';
import {
  listProjectAssets,
  updateAssetByVersion,
  type AssetRow,
} from '@/lib/repos/asset-repo';
import { getProject } from '@/lib/repos/project-repo';

const parse = <T = any>(value: string | null | undefined, fallback: T): T => {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
};

const mediaUrl = (asset: AssetRow | undefined): string =>
  asset?.persistent_url || parse<string[]>(asset?.media_urls, [])[0] || '';

function absoluteUrl(value: string, baseUrl?: string): string {
  if (/^https?:\/\//.test(value)) return value;
  const base = (baseUrl || process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '');
  return value.startsWith('/') && base ? `${base}${value}` : value;
}

export interface FilmRerenderShot {
  shotNumber: number;
  videoAssetId: string;
  expectedVersion: number;
  firstFrameUrl: string;
  lastFrameUrl?: string;
  prompt: string;
  dialogue?: string;
  audioUrl?: string;
  durationSec: number;
  sourceVideoUrl: string;
}

export interface FilmRerenderReferenceAsset {
  id: string;
  type: string;
  version: number;
  url: string;
}

export interface FilmRerenderPayload {
  version: 1;
  fingerprint: string;
  projectId: string;
  provider: 'kling';
  resolution: '2160p';
  aspectRatio: '16:9' | '9:16' | '1:1';
  publicBaseUrl: string;
  concurrency: number;
  referenceAssets: FilmRerenderReferenceAsset[];
  shots: FilmRerenderShot[];
  createdAt: string;
}

export interface FilmRerenderPlan {
  payload: FilmRerenderPayload;
  estimateCny: number;
  totalDurationSec: number;
}

export interface FilmRerenderResult {
  state: 'done' | 'partial';
  completedShots: number[];
  skippedShots: number[];
  failedShots: Array<{ shotNumber: number; code: string; message: string }>;
  finalVideoUrl?: string;
  width?: number;
  height?: number;
}

export async function buildFilmRerenderPlan(
  projectId: string,
  requestedShots?: number[],
  baseUrl?: string,
): Promise<FilmRerenderPlan> {
  const [project, assets] = await Promise.all([getProject(projectId), listProjectAssets(projectId)]);
  if (!project) throw new Error('项目不存在');

  const selected = requestedShots?.length
    ? new Set(requestedShots.map(Number).filter((n) => Number.isInteger(n) && n > 0))
    : null;
  const videos = assets.filter((asset) => asset.type === 'video' && asset.shot_number != null);
  const storyboards = new Map(
    assets
      .filter((asset) => asset.type === 'storyboard' && asset.shot_number != null)
      .map((asset) => [Number(asset.shot_number), asset]),
  );
  const script = parse<any>(assets.find((asset) => asset.type === 'script')?.data, {});
  const scriptByShot = new Map<number, any>(
    (Array.isArray(script.shots) ? script.shots : []).map((shot: any) => [Number(shot.shotNumber), shot]),
  );
  const timeline = parse<any>(assets.find((asset) => asset.type === 'timeline')?.data, {});
  const audioByShot = new Map<number, string>(
    (Array.isArray(timeline.voiceoverClips) ? timeline.voiceoverClips : [])
      .filter((voice: any) => Number(voice?.shotNumber) > 0 && typeof voice?.audioUrl === 'string')
      .map((voice: any) => [Number(voice.shotNumber), absoluteUrl(String(voice.audioUrl), baseUrl)]),
  );
  const referenceAssets: FilmRerenderReferenceAsset[] = assets
    .filter((asset) => ['character', 'scene', 'style-bible', 'scene-anchor'].includes(asset.type))
    .map((asset) => ({
      id: asset.id,
      type: asset.type,
      version: Number(asset.version || 1),
      url: absoluteUrl(mediaUrl(asset), baseUrl),
    }))
    .filter((asset) => /^https?:\/\//.test(asset.url))
    .slice(0, 12);

  const shots: FilmRerenderShot[] = videos
    .filter((asset) => !selected || selected.has(Number(asset.shot_number)))
    .map((video) => {
      const shotNumber = Number(video.shot_number);
      const storyboard = storyboards.get(shotNumber);
      const sbData = parse<any>(storyboard?.data, {});
      const scriptShot = scriptByShot.get(shotNumber) || {};
      const dialogue = String(scriptShot.dialogue || '').trim();
      const audioUrl = audioByShot.get(shotNumber);
      return {
        shotNumber,
        videoAssetId: video.id,
        expectedVersion: Number(video.version || 1),
        firstFrameUrl: absoluteUrl(mediaUrl(storyboard), baseUrl),
        lastFrameUrl: typeof scriptShot.tailFrameUrl === 'string' && scriptShot.tailFrameUrl
          ? absoluteUrl(scriptShot.tailFrameUrl, baseUrl)
          : undefined,
        prompt: String(
          sbData.enhancedPrompt
          || sbData.prompt
          || sbData.description
          || scriptShot.visualDescription
          || scriptShot.description
          || storyboard?.name
          || `Shot ${shotNumber}`,
        ).slice(0, 2450),
        dialogue: dialogue || undefined,
        audioUrl: audioUrl && /^https?:\/\//.test(audioUrl) ? audioUrl : undefined,
        durationSec: Math.max(3, Math.min(10, Math.round(
          Number(parse<any>(video.data, {}).duration || scriptShot.duration || 5),
        ))),
        sourceVideoUrl: mediaUrl(video),
      };
    })
    .sort((a, b) => a.shotNumber - b.shotNumber);

  if (!shots.length) throw new Error('没有可重渲的视频镜头');
  const missingFrames = shots.filter((shot) => !/^https?:\/\//.test(shot.firstFrameUrl));
  if (missingFrames.length) {
    throw new Error(`以下镜头缺少可供 Kling 读取的 HTTPS 首帧：${missingFrames.map((s) => s.shotNumber).join(', ')}`);
  }
  const missingAudio = shots.filter((shot) => shot.dialogue && !shot.audioUrl);
  if (missingAudio.length) {
    throw new Error(`以下对白镜头缺少可公网读取的配音，无法保证最终口型：${missingAudio.map((s) => s.shotNumber).join(', ')}`);
  }
  if (selected) {
    const found = new Set(shots.map((shot) => shot.shotNumber));
    const missing = [...selected].filter((n) => !found.has(n));
    if (missing.length) throw new Error(`镜头不存在：${missing.join(', ')}`);
  }

  const createdAt = new Date().toISOString();
  const publicBaseUrl = (baseUrl || process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || '')
    .replace(/\/+$/, '');
  const stable = {
    projectId,
    projectUpdatedAt: project.updated_at,
    provider: 'kling',
    resolution: '2160p',
    aspectRatio: project.aspect,
    referenceAssets,
    shots: shots.map(({ shotNumber, videoAssetId, expectedVersion, firstFrameUrl, lastFrameUrl, prompt, dialogue, audioUrl, durationSec }) => ({
      shotNumber, videoAssetId, expectedVersion, firstFrameUrl, lastFrameUrl, prompt, dialogue, audioUrl, durationSec,
    })),
  };
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex').slice(0, 24);
  const totalDurationSec = shots.reduce((sum, shot) => sum + shot.durationSec, 0);
  const averageSec = totalDurationSec / shots.length;
  return {
    payload: {
      version: 1,
      fingerprint,
      projectId,
      provider: 'kling',
      resolution: '2160p',
      aspectRatio: ['16:9', '9:16', '1:1'].includes(project.aspect)
        ? project.aspect as '16:9' | '9:16' | '1:1'
        : '16:9',
      publicBaseUrl,
      concurrency: Math.max(1, Math.min(3, Number(process.env.FILM_RERENDER_CONCURRENCY) || 2)),
      referenceAssets,
      shots,
      createdAt,
    },
    estimateCny: estimatePipelineCostCny({
      shotCount: shots.length,
      videoShots: shots.length,
      secondsPerShot: averageSec,
      videoProvider: 'kling',
      skipImages: true,
      mode: '4k',
    }),
    totalDurationSec,
  };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await fn(items[index]);
    }
  });
  await Promise.all(runners);
  return output;
}

export async function runFilmRerenderJob(
  jobId: string,
  payload: FilmRerenderPayload,
  emit: (type: string, data: unknown) => void,
): Promise<FilmRerenderResult> {
  if (payload.version !== 1 || payload.provider !== 'kling') throw new Error('不支持的整片重渲 payload');
  await import('@/lib/video-providers/builtins');
  const { dispatchVideoGenerate, listVideoProviders } = await import('@/lib/video-providers/registry');
  const currentAssets = await listProjectAssets(payload.projectId);
  const currentById = new Map(currentAssets.map((asset) => [asset.id, asset]));
  let completedCount = 0;
  emit('filmRerenderStarted', {
    jobId,
    projectId: payload.projectId,
    totalShots: payload.shots.length,
    fingerprint: payload.fingerprint,
    qualityClass: 'provider-native-4k',
  });

  const outcomes = await mapLimit(payload.shots, payload.concurrency, async (shot) => {
    const current = currentById.get(shot.videoAssetId);
    const currentData = parse<any>(current?.data, {});
    if (currentData.finalRerenderFingerprint === payload.fingerprint) {
      completedCount++;
      emit('filmRerenderShot', { shotNumber: shot.shotNumber, state: 'skipped', completed: completedCount });
      return { shotNumber: shot.shotNumber, state: 'skipped' as const };
    }
    if (!current) {
      return { shotNumber: shot.shotNumber, state: 'failed' as const, code: 'asset_missing', message: '镜头资产已删除' };
    }

    emit('filmRerenderShot', { shotNumber: shot.shotNumber, state: 'running' });
    const exclude = new Set(listVideoProviders().map((provider) => provider.id).filter((id) => id !== 'kling'));
    try {
      const resumeLipSync = currentData.finalRerenderVisualFingerprint === payload.fingerprint
        && currentData.lipSyncPending === true
        && !!mediaUrl(current);
      let renderedVideoUrl = resumeLipSync ? absoluteUrl(mediaUrl(current), payload.publicBaseUrl) : '';
      let renderedProvider = String(currentData.engine || 'kling');
      if (!resumeLipSync) {
        const generated = await dispatchVideoGenerate({
          prompt: shot.prompt,
          preferredProvider: 'kling',
          firstFrameUrl: shot.firstFrameUrl,
          durationSec: shot.durationSec,
          resolution: '2160p',
          aspectRatio: payload.aspectRatio,
          mode: 'professional',
          onProgress: (pct, message) => emit('filmRerenderProgress', {
            shotNumber: shot.shotNumber,
            pct,
            message,
          }),
        }, {
          hasFirstFrame: true,
          hasLastFrame: false,
          hasSubjectReference: false,
          durationSec: shot.durationSec,
          prefer: 'kling',
          exclude,
        });
        if (!generated.result) {
          const message = generated.tried.map((item) => `${item.id}: ${item.error}`).join(' | ') || 'Kling 无可用结果';
          throw new Error(message);
        }
        renderedVideoUrl = generated.result.videoUrl;
        renderedProvider = generated.result.provider;
      }

      let lipSyncApplied = !shot.audioUrl;
      let lipSyncProvider: string | undefined;
      let lipSyncWarning: string | undefined;
      if (shot.audioUrl) {
        emit('filmLipSync', { shotNumber: shot.shotNumber, state: 'running' });
        const { getLipSyncService } = await import('@/services/lipsync.service');
        const lipSync = getLipSyncService();
        if (lipSync.isAvailable()) {
          const synced = await lipSync.syncMouthToAudio(renderedVideoUrl, shot.audioUrl, {
            language: 'zh',
            onProgress: (pct, message) => emit('filmLipSyncProgress', {
              shotNumber: shot.shotNumber,
              pct,
              message,
            }),
          });
          if (synced.applied) {
            renderedVideoUrl = synced.videoUrl;
            lipSyncApplied = true;
          } else {
            lipSyncWarning = synced.warning || '口型服务未返回同步结果';
          }
          lipSyncProvider = synced.provider;
        } else {
          lipSyncWarning = '口型服务未配置';
        }
      }

      const persisted = await persistAsset(renderedVideoUrl, { ext: '.mp4', contentType: 'video/mp4' });
      if (!persisted) throw new Error('4K 视频无法持久化');
      const write = await updateAssetByVersion(payload.projectId, shot.videoAssetId, resumeLipSync
        ? Number(current.version || shot.expectedVersion)
        : shot.expectedVersion, {
        data: {
          ...currentData,
          duration: shot.durationSec,
          engine: renderedProvider,
          model: 'kling-v3',
          quality: '4k',
          qualityClass: 'provider-native-4k',
          finalRerenderJobId: jobId,
          finalRerenderFingerprint: lipSyncApplied ? payload.fingerprint : undefined,
          finalRerenderVisualFingerprint: payload.fingerprint,
          finalRerenderAt: new Date().toISOString(),
          lipSyncApplied,
          lipSyncPending: !lipSyncApplied,
          lipSyncProvider: lipSyncProvider || null,
          lipSyncWarning: lipSyncWarning || null,
          sourceVideoUrl: shot.sourceVideoUrl,
          sourceRevision: shot.expectedVersion,
          sourceFirstFrameUrl: shot.firstFrameUrl,
          sourceLastFrameUrl: shot.lastFrameUrl || null,
          sourceReferenceAssets: payload.referenceAssets,
        },
        mediaUrls: [persisted.url],
        persistentUrl: persisted.url,
      });
      if (write !== 'updated') {
        return {
          shotNumber: shot.shotNumber,
          state: 'failed' as const,
          code: write === 'conflict' ? 'revision_conflict' : 'asset_missing',
          message: write === 'conflict' ? '渲染期间镜头已被修改，未覆盖新版本' : '镜头资产已删除',
        };
      }
      if (!lipSyncApplied) {
        emit('filmLipSync', {
          shotNumber: shot.shotNumber,
          state: 'failed',
          message: lipSyncWarning,
        });
        return {
          shotNumber: shot.shotNumber,
          state: 'failed' as const,
          code: 'lip_sync_failed',
          message: `4K 画面已保留，口型待续跑：${lipSyncWarning}`,
        };
      }
      completedCount++;
      emit('filmRerenderShot', {
        shotNumber: shot.shotNumber,
        state: 'completed',
        completed: completedCount,
        total: payload.shots.length,
      });
      return { shotNumber: shot.shotNumber, state: 'completed' as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emit('filmRerenderShot', { shotNumber: shot.shotNumber, state: 'failed', message: message.slice(0, 300) });
      return { shotNumber: shot.shotNumber, state: 'failed' as const, code: 'generation_failed', message };
    }
  });

  const failedShots = outcomes
    .filter((item): item is Extract<typeof item, { state: 'failed' }> => item.state === 'failed')
    .map((item) => ({ shotNumber: item.shotNumber, code: item.code, message: item.message.slice(0, 300) }));
  const completedShots = outcomes.filter((item) => item.state === 'completed').map((item) => item.shotNumber);
  const skippedShots = outcomes.filter((item) => item.state === 'skipped').map((item) => item.shotNumber);
  const state: 'done' | 'partial' = failedShots.length ? 'partial' : 'done';

  let finalVideoUrl: string | undefined;
  let width: number | undefined;
  let height: number | undefined;
  try {
    emit('filmRecompose', { state: 'running', resolution: '2160p' });
    const { recomposeProjectAt2160p } = await import('@/lib/project-recompose');
    const composed = await recomposeProjectAt2160p(payload.projectId, {
      finalRerenderJobId: jobId,
      finalRerenderFingerprint: payload.fingerprint,
      renderState: state,
      failedShots,
    }, (pct, message) => emit('filmRecomposeProgress', { pct, message }));
    finalVideoUrl = composed.finalVideoUrl;
    width = composed.width;
    height = composed.height;
  } catch (error) {
    failedShots.push({
      shotNumber: 0,
      code: 'recompose_failed',
      message: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
    });
  }
  const finalState: 'done' | 'partial' = failedShots.length ? 'partial' : state;
  const result = { state: finalState, completedShots, skippedShots, failedShots, finalVideoUrl, width, height };
  emit('filmRerenderCompleted', result);
  return result;
}
