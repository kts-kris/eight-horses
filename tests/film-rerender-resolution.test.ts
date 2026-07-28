import { describe, expect, it } from 'vitest';
import { buildCanvasFit } from '@/lib/video-reframe';

describe('整片最终重渲画布', () => {
  it('默认输出与历史预览分辨率完全兼容', () => {
    expect(buildCanvasFit('16:9')).toMatchObject({ w: 1280, h: 720 });
    expect(buildCanvasFit('9:16')).toMatchObject({ w: 720, h: 1280 });
  });

  it('2160p 按项目画幅输出原生 4K 画布', () => {
    expect(buildCanvasFit('16:9', '2160p')).toMatchObject({ w: 3840, h: 2160 });
    expect(buildCanvasFit('9:16', '2160p')).toMatchObject({ w: 2160, h: 3840 });
    expect(buildCanvasFit('1:1', '2160p')).toMatchObject({ w: 3840, h: 3840 });
  });
});
