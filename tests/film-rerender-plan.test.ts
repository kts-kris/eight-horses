import { beforeAll, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { db, now } from '@/lib/db';
import { buildFilmRerenderPlan } from '@/lib/film-rerender';
import { createAsset } from '@/lib/repos/asset-repo';

let projectId: string;

beforeAll(async () => {
  const userId = `film-user-${nanoid()}`;
  projectId = `film-project-${nanoid()}`;
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at)
              VALUES (?, ?, 'x', 'film', 'user', ?)`)
    .run(userId, `${userId}@test.local`, now());
  db.prepare(`INSERT INTO projects
              (id, user_id, title, description, cover_urls, status, aspect, created_at, updated_at)
              VALUES (?, ?, 'film', '', '[]', 'completed', '16:9', ?, ?)`)
    .run(projectId, userId, now(), now());
  await createAsset({
    projectId,
    type: 'script',
    name: '剧本',
    data: {
      shots: [{
        shotNumber: 1,
        duration: 7,
        description: '角色对着镜头说中文台词',
        dialogue: '这是最终口型同步测试',
      }],
    },
  });
  await createAsset({
    projectId,
    type: 'storyboard',
    name: '第一镜',
    data: { prompt: '保持人物外观，电影镜头推进' },
    mediaUrls: ['/api/serve-file?key=frame'],
    persistentUrl: '/api/serve-file?key=frame',
    shotNumber: 1,
  });
  await createAsset({
    projectId,
    type: 'timeline',
    name: '剪辑时间线',
    data: {
      voiceoverClips: [{
        shotNumber: 1,
        audioUrl: '/api/serve-file?key=voice',
      }],
    },
  });
  await createAsset({
    projectId,
    type: 'video',
    name: '第一镜视频',
    data: { duration: 7, qualityClass: 'open-preview' },
    mediaUrls: ['/api/serve-file?key=preview'],
    persistentUrl: '/api/serve-file?key=preview',
    shotNumber: 1,
  });
});

describe('整片重渲冻结计划', () => {
  it('冻结镜头版本、首帧、时长和确定性 fingerprint', async () => {
    const first = await buildFilmRerenderPlan(projectId, undefined, 'https://wind.example');
    const second = await buildFilmRerenderPlan(projectId, undefined, 'https://wind.example');
    expect(first.payload.shots).toHaveLength(1);
    expect(first.payload.shots[0]).toMatchObject({
      shotNumber: 1,
      durationSec: 7,
      firstFrameUrl: 'https://wind.example/api/serve-file?key=frame',
      dialogue: '这是最终口型同步测试',
      audioUrl: 'https://wind.example/api/serve-file?key=voice',
    });
    expect(first.payload.publicBaseUrl).toBe('https://wind.example');
    expect(first.payload.fingerprint).toBe(second.payload.fingerprint);
    expect(first.payload.referenceAssets).toEqual([]);
    expect(first.estimateCny).toBeGreaterThan(0);
  });

  it('选择不存在镜头时明确拒绝，不产生空任务', async () => {
    await expect(buildFilmRerenderPlan(projectId, [99], 'https://wind.example'))
      .rejects.toThrow('没有可重渲的视频镜头');
  });
});
