import fs from 'fs';
import { describe, expect, it } from 'vitest';

describe('整片 4K 一键重渲接线', () => {
  it('API 同时执行归属、订阅、预算、去重和持久队列保护', () => {
    const source = fs.readFileSync('app/api/projects/[id]/film-rerender/route.ts', 'utf8');
    for (const token of [
      "requireProjectAccess(request, id, 'edit')",
      "checkPlan(request, 'pro')",
      'assertBudget({ userId: user.sub',
      "getLatestJobByProjectType(id, 'film-rerender')",
      "enqueuePipelineJob({\n      type: 'film-rerender'",
      'ensurePipelineWorker()',
    ]) expect(source).toContain(token);
  });

  it('Worker 分派 film-rerender 并保留 partial 终态', () => {
    const source = fs.readFileSync('lib/pipeline-worker.ts', 'utf8');
    expect(source).toContain("job.type === 'film-rerender'");
    expect(source).toContain('terminalState = result.state');
    expect(source).toContain('completeJob(job.id, terminalState)');
  });

  it('项目镜头工坊提供整片入口', () => {
    const source = fs.readFileSync('components/project/shot-workshop-tab.tsx', 'utf8');
    expect(source).toContain('<FilmRerenderPanel');
  });
});
