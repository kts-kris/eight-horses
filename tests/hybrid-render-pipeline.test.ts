import fs from 'fs';
import { describe, expect, it } from 'vitest';
import { estimatePipelineCostCny } from '@/lib/budget-estimate';

describe('开源样片 → 闭源原生 4K 整片闭环', () => {
  it('开源样片保留来源标签且不进入付费成本记账', () => {
    const orchestrator = fs.readFileSync('services/hybrid-orchestrator.ts', 'utf8');
    const persistence = fs.readFileSync('lib/create-pipeline.ts', 'utf8');
    expect(orchestrator).toContain("qualityClass: isOpenPreviewClip ? 'open-preview-720p'");
    expect(orchestrator).toContain("&& !isOpenPreviewClip");
    expect(orchestrator).toContain('Number(process.env.OPEN_VIDEO_CONCURRENCY) || 1');
    expect(persistence).toContain("qualityClass: v.qualityClass || 'provider-standard'");
    expect(persistence).toContain('engine: v.engine || activeProvider');
    expect(estimatePipelineCostCny({ videoProvider: 'wan22', shotCount: 8 }))
      .toBeLessThan(estimatePipelineCostCny({ videoProvider: 'kling', shotCount: 8 }));
  });

  it('最终档明确调用 Kling 原生 4K 而非把 720p 软件放大冒充原生', () => {
    const providers = fs.readFileSync('lib/video-providers/builtins.ts', 'utf8');
    const runner = fs.readFileSync('lib/film-rerender.ts', 'utf8');
    expect(providers).toContain('render4K: native4K');
    expect(runner).toContain("resolution: '2160p'");
    expect(runner).toContain("qualityClass: 'provider-native-4k'");
    expect(runner).toContain("syncMouthToAudio(renderedVideoUrl, shot.audioUrl");
    expect(runner).toContain("code: 'lip_sync_failed'");
  });

  it('最终整片复用配音字幕时间线，并显示跨模型漂移提示', () => {
    const recompose = fs.readFileSync('lib/project-recompose.ts', 'utf8');
    const panel = fs.readFileSync('components/project/film-rerender-panel.tsx', 'utf8');
    expect(recompose).toContain('voiceoverClips');
    expect(recompose).toContain('dialogue:');
    expect(recompose).toContain("resolution: '2160p'");
    expect(panel).toContain('人物动作与构图可能相对开源样片轻微漂移');
  });
});
