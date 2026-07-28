import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/app/api/auth/lib';
import { requireProjectAccess } from '@/lib/auth-guard';
import { assertBudget } from '@/lib/budget-enforce';
import { buildFilmRerenderPlan } from '@/lib/film-rerender';
import { checkPlan, planRejection } from '@/lib/plan-gate';
import {
  enqueuePipelineJob,
  getJobProgressLog,
  getLatestJobByProjectType,
  getPipelineJob,
} from '@/lib/repos/pipeline-job-repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function parseShots(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const numbers = [...new Set(value.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  return numbers.length ? numbers : undefined;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireProjectAccess(request, id, 'view');
  if (!access.ok) return NextResponse.json({ message: access.message }, { status: access.status });
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });

  const requestedJobId = request.nextUrl.searchParams.get('jobId');
  if (requestedJobId) {
    const job = await getPipelineJob(requestedJobId);
    if (!job || job.projectId !== id || (job.userId && job.userId !== user.sub)) {
      return NextResponse.json({ message: '任务不存在' }, { status: 404 });
    }
    const events = await getJobProgressLog(job.id);
    const completed = [...events].reverse().find((event) => event.type === 'filmRerenderCompleted');
    return NextResponse.json({
      job: {
        id: job.id,
        state: job.state,
        step: job.step,
        attempts: job.attempts,
        lastError: job.lastError,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      },
      result: completed?.data || null,
      events: events.slice(-100),
    });
  }

  try {
    const plan = await buildFilmRerenderPlan(id, undefined, request.nextUrl.origin);
    const latest = await getLatestJobByProjectType(id, 'film-rerender');
    return NextResponse.json({
      provider: 'kling',
      resolution: '2160p',
      qualityClass: 'provider-native-4k',
      shotCount: plan.payload.shots.length,
      totalDurationSec: plan.totalDurationSec,
      estimateCny: plan.estimateCny,
      fingerprint: plan.payload.fingerprint,
      latestJob: latest ? {
        id: latest.id,
        state: latest.state,
        attempts: latest.attempts,
        updatedAt: latest.updatedAt,
      } : null,
    });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : '无法建立重渲计划' },
      { status: 409 },
    );
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireProjectAccess(request, id, 'edit');
  if (!access.ok) return NextResponse.json({ message: access.message }, { status: access.status });
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });

  const gate = checkPlan(request, 'pro');
  if (!gate.ok) return planRejection(gate.current, gate.required);
  const body = await request.json().catch(() => ({}));
  if (body?.provider && body.provider !== 'kling') {
    return NextResponse.json({ message: '当前原生 4K 最终档仅支持 Kling v3' }, { status: 400 });
  }
  const { hasKling } = await import('@/services/kling.service');
  if (!hasKling()) {
    return NextResponse.json({ message: 'KELING_API_KEY 未配置，无法原生 4K 重渲' }, { status: 422 });
  }

  try {
    const plan = await buildFilmRerenderPlan(id, parseShots(body?.shotNumbers), request.nextUrl.origin);
    const latest = await getLatestJobByProjectType(id, 'film-rerender');
    if (
      latest
      && (latest.state === 'queued' || latest.state === 'running')
      && latest.payload?.fingerprint === plan.payload.fingerprint
    ) {
      return NextResponse.json({
        jobId: latest.id,
        state: latest.state,
        deduplicated: true,
        estimateCny: plan.estimateCny,
      }, { status: 200 });
    }

    const budget = await assertBudget({ userId: user.sub, pendingCostCny: plan.estimateCny });
    if (!budget.allow) {
      return NextResponse.json({
        message: budget.guard.message,
        code: 'budget_exceeded',
        guard: budget.guard,
        estimateCny: plan.estimateCny,
      }, { status: 402 });
    }
    const job = await enqueuePipelineJob({
      type: 'film-rerender',
      projectId: id,
      userId: user.sub,
      payload: plan.payload,
    });
    const { ensurePipelineWorker } = await import('@/lib/pipeline-worker');
    ensurePipelineWorker();
    return NextResponse.json({
      jobId: job.id,
      state: job.state,
      shotCount: plan.payload.shots.length,
      totalDurationSec: plan.totalDurationSec,
      estimateCny: plan.estimateCny,
      qualityClass: 'provider-native-4k',
    }, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : '整片重渲任务创建失败' },
      { status: 409 },
    );
  }
}
