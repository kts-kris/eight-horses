import { serveFilePathUrl } from '@/lib/serve-file-sign';
import { listAssetsByType, upsertAsset } from '@/lib/repos/asset-repo';
import { getProject } from '@/lib/repos/project-repo';

const parse = <T = any>(value: string | null | undefined, fallback: T): T => {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
};

export interface ProjectRecomposeResult {
  finalVideoUrl: string;
  width: number;
  height: number;
  clipCount: number;
  totalDuration: number;
}

/**
 * 重用现有台词、TTS、BGM 和转场，只替换镜头画面。该函数不调用生成式模型，
 * 所以 partial 重渲也能产出可完整播放、可审阅的版本。
 */
export async function recomposeProjectAt2160p(
  projectId: string,
  metadata: Record<string, unknown>,
  onProgress?: (pct: number, message: string) => void,
): Promise<ProjectRecomposeResult> {
  const [project, videoAssets, scriptAssets, musicAssets, timelineAssets] = await Promise.all([
    getProject(projectId),
    listAssetsByType(projectId, 'video'),
    listAssetsByType(projectId, 'script'),
    listAssetsByType(projectId, 'music'),
    listAssetsByType(projectId, 'timeline'),
  ]);
  if (!project) throw new Error('项目不存在');

  const scriptShots: any[] = parse<any>(scriptAssets[0]?.data, {}).shots || [];
  const scriptByShot = new Map<number, any>(scriptShots.map((shot) => [Number(shot.shotNumber), shot]));
  const clips = videoAssets
    .map((asset) => {
      const shotNumber = Number(asset.shot_number || 0);
      const data = parse<any>(asset.data, {});
      const script = scriptByShot.get(shotNumber) || {};
      const videoUrl = asset.persistent_url || parse<string[]>(asset.media_urls, [])[0] || '';
      return {
        shotNumber,
        videoUrl,
        duration: Number(data.duration || script.duration || 5),
        transition: String(script.transition || data.transition || 'cut'),
        dialogue: String(script.dialogue || data.dialogue || ''),
      };
    })
    .filter((clip) => clip.shotNumber > 0 && clip.videoUrl)
    .sort((a, b) => a.shotNumber - b.shotNumber);
  if (!clips.length) throw new Error('项目没有可合成的视频镜头');

  const keep = new Set(clips.map((clip) => clip.shotNumber));
  const timeline = parse<any>(timelineAssets[0]?.data, {});
  const voiceoverClips = (Array.isArray(timeline.voiceoverClips) ? timeline.voiceoverClips : [])
    .filter((voice: any) => keep.has(Number(voice.shotNumber)) && voice.audioUrl)
    .map((voice: any) => ({
      shotNumber: Number(voice.shotNumber),
      audioUrl: String(voice.audioUrl),
      startOffset: Number(voice.startOffset || 0),
    }));
  const musicUrl = musicAssets[0]?.persistent_url
    || parse<string[]>(musicAssets[0]?.media_urls, [])[0]
    || undefined;

  const { composeVideo } = await import('@/services/video-composer');
  const { buildCanvasFit } = await import('@/lib/video-reframe');
  const aspect = project.aspect || '16:9';
  const result = await composeVideo({
    clips,
    aspect,
    resolution: '2160p',
    musicUrl,
    voiceoverClips: voiceoverClips.length ? voiceoverClips : undefined,
    musicVolume: voiceoverClips.length ? 0.2 : 0.3,
    voiceoverVolume: 0.9,
    onProgress,
  });
  const finalVideoUrl = serveFilePathUrl(result.outputPath);
  const { w, h } = buildCanvasFit(aspect, '2160p');
  await upsertAsset({
    projectId,
    type: 'final_video',
    name: '最终成片',
    data: {
      duration: result.totalDuration,
      hasBgm: result.hasMusic,
      hasVoiceover: result.hasVoiceover,
      audible: result.hasMusic || result.hasVoiceover,
      aspect,
      width: w,
      height: h,
      recomposed: true,
      qualityClass: 'provider-native-4k',
      ...metadata,
    },
    mediaUrls: [finalVideoUrl],
    persistentUrl: finalVideoUrl,
  });
  return { finalVideoUrl, width: w, height: h, clipCount: clips.length, totalDuration: result.totalDuration };
}
