/**
 * POST /api/pipeline-jobs/[id]/retry (v10.4.2) — 死信重投。
 * 仅 failed 可重投;attempts 保留 → worker 走续跑(断点装载,不重复生成/计费)。
 * PIPELINE_QUEUE 未开时也允许入队(返回 workerActive=false 提示不会立即执行)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '../../../auth/lib';
import { requeueJob, getPipelineJob, getJobProgressLog } from '@/lib/repos/pipeline-job-repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  // v12.233(对抗复检收尾):此前只验登录、**不验归属** ——
  // 任意登录用户可重投他人失败任务,重新触发对方的 AI 生成流水线、烧对方预算。
  const existing = await getPipelineJob(id);
  if (!existing) return NextResponse.json({ message: '任务不存在' }, { status: 404 });
  if (existing.userId && existing.userId !== payload.sub) {
    return NextResponse.json({ message: '任务不存在' }, { status: 404 }); // 用 404 不泄露"该 id 存在"
  }

  if (existing.type === 'film-rerender') {
    const { checkPlan, planRejection } = await import('@/lib/plan-gate');
    const gate = checkPlan(request, 'pro');
    if (!gate.ok) return planRejection(gate.current, gate.required);
    const log = await getJobProgressLog(id);
    const last = [...log].reverse().find((event) => event.type === 'filmRerenderCompleted');
    const failedItems: any[] = Array.isArray((last?.data as any)?.failedShots)
      ? (last?.data as any).failedShots
      : [];
    const failedNumbers = new Set(
      failedItems
        .filter((item: any) => Number(item?.shotNumber) > 0)
        .map((item: any) => Number(item.shotNumber)),
    );
    const allShots: any[] = Array.isArray(existing.payload?.shots) ? existing.payload.shots : [];
    const pending = failedNumbers.size
      ? allShots.filter((shot) => failedNumbers.has(Number(shot.shotNumber)))
      : allShots;
    const visualRetryNumbers = new Set(
      failedItems
        .filter((item: any) => Number(item?.shotNumber) > 0 && item?.code !== 'lip_sync_failed')
        .map((item: any) => Number(item.shotNumber)),
    );
    const videoShots = failedNumbers.size
      ? pending.filter((shot) => visualRetryNumbers.has(Number(shot.shotNumber))).length
      : pending.length;
    const seconds = pending.length
      ? pending.reduce((sum, shot) => sum + Math.max(3, Number(shot.durationSec) || 5), 0) / pending.length
      : 5;
    const { estimatePipelineCostCny } = await import('@/lib/budget-estimate');
    const estimated = estimatePipelineCostCny({
      shotCount: Math.max(1, pending.length),
      videoShots,
      secondsPerShot: seconds,
      videoProvider: 'kling',
      skipImages: true,
      mode: '4k',
    });
    const { assertBudget } = await import('@/lib/budget-enforce');
    const budget = await assertBudget({ userId: payload.sub, pendingCostCny: estimated });
    if (!budget.allow) {
      return NextResponse.json({
        message: budget.guard.message,
        code: 'budget_exceeded',
        guard: budget.guard,
        estimateCny: estimated,
      }, { status: 402 });
    }
  }

  const ok = await requeueJob(id);
  if (!ok) {
    const job = await getPipelineJob(id);
    return NextResponse.json(
      { message: job ? `仅 failed/partial 状态可重投(当前 ${job.state})` : '任务不存在' },
      { status: job ? 409 : 404 },
    );
  }
  const workerActive = process.env.PIPELINE_QUEUE === '1' || existing.type === 'film-rerender';
  if (workerActive) {
    const { ensurePipelineWorker } = await import('@/lib/pipeline-worker');
    ensurePipelineWorker();
  }
  return NextResponse.json({ requeued: true, workerActive });
}
