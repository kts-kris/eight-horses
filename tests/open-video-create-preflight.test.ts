import fs from 'fs';
import { describe, expect, it } from 'vitest';

describe('开源视频创作入口', () => {
  it('在费用与入队前做 Worker profile 预检', () => {
    const source = fs.readFileSync('app/api/create-stream/route.ts', 'utf8');
    const preflight = source.indexOf('assertReady(videoProvider)');
    const budget = source.indexOf('assertBudget({ userId: uid');
    const enqueue = source.indexOf('enqueuePipelineJob({ type:');
    expect(preflight).toBeGreaterThan(0);
    expect(preflight).toBeLessThan(budget);
    expect(preflight).toBeLessThan(enqueue);
    expect(source).toContain('isOpenVideoProvider(videoProvider)');
    expect(source).toContain('open_video_worker_unavailable');
  });

  it('两个创作界面都提供 Wan2.2 和 HunyuanVideo 1.5', () => {
    for (const file of ['app/create/page.tsx', 'app/dashboard/create/page.tsx']) {
      const source = fs.readFileSync(file, 'utf8');
      expect(source).toContain("'wan22'");
      expect(source).toContain("'hunyuan-video-15'");
    }
  });
});
