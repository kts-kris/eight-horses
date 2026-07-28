'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleNotch, FilmReel, Repeat, WarningCircle } from '@phosphor-icons/react';

interface Estimate {
  shotCount: number;
  totalDurationSec: number;
  estimateCny: number;
  qualityClass: string;
  latestJob?: { id: string; state: string } | null;
}

interface JobState {
  id: string;
  state: 'queued' | 'running' | 'done' | 'partial' | 'failed';
  attempts: number;
  lastError?: string;
}

export function FilmRerenderPanel({ projectId, canUse }: { projectId: string; canUse: boolean }) {
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [job, setJob] = useState<JobState | null>(null);
  const [result, setResult] = useState<any>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadEstimate = useCallback(async () => {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/film-rerender`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || '无法计算整片重渲成本');
    setEstimate(data);
    if (data.latestJob) {
      setJob({ ...data.latestJob, attempts: 0 });
    }
  }, [projectId]);

  const poll = useCallback(async (jobId: string) => {
    const response = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/film-rerender?jobId=${encodeURIComponent(jobId)}`,
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || '无法读取重渲任务');
    setJob(data.job);
    setResult(data.result);
    const latest = [...(data.events || [])].reverse().find((event: any) =>
      ['filmRerenderProgress', 'filmRerenderShot', 'filmRecomposeProgress'].includes(event.type));
    if (latest?.data?.message) setMessage(latest.data.message);
    else if (latest?.data?.shotNumber) setMessage(`正在处理第 ${latest.data.shotNumber} 镜`);
    if (data.job.state === 'queued' || data.job.state === 'running') {
      pollRef.current = setTimeout(() => void poll(jobId).catch((e) => setError(e.message)), 2500);
    }
  }, [projectId]);

  useEffect(() => {
    void loadEstimate().catch((e) => setError(e instanceof Error ? e.message : '读取失败'));
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [loadEstimate]);

  useEffect(() => {
    if (job?.id) {
      void poll(job.id).catch((e) => setError(e instanceof Error ? e.message : '轮询失败'));
    }
  }, [job?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    if (!canUse) {
      window.location.href = '/dashboard/billing';
      return;
    }
    if (!estimate) return;
    const confirmed = window.confirm(
      `将使用 Kling v3 原生 4K 重渲 ${estimate.shotCount} 镜，预估 ¥${estimate.estimateCny.toFixed(1)}。`
      + '\n成功镜头会立即保留，失败镜头可一键续跑。是否继续？',
    );
    if (!confirmed) return;
    setError('');
    setMessage('正在冻结镜头版本并创建任务…');
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/film-rerender`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'kling' }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 402 && data.code !== 'budget_exceeded') {
        window.location.href = '/dashboard/billing';
      }
      throw new Error(data.message || '整片重渲任务创建失败');
    }
    setJob({ id: data.jobId, state: data.state, attempts: 0 });
  };

  const retry = async () => {
    if (!job) return;
    setError('');
    const response = await fetch(`/api/pipeline-jobs/${encodeURIComponent(job.id)}/retry`, { method: 'POST' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || '续跑失败');
    setJob({ ...job, state: 'queued' });
    void poll(job.id);
  };

  const busy = job?.state === 'queued' || job?.state === 'running';
  const partial = job?.state === 'partial';
  const hasRevisionConflict = !!result?.failedShots?.some((item: any) => item.code === 'revision_conflict');

  return (
    <section className="cinema-card-hi p-4 border-[var(--cinema-amber)]/40" aria-label="整片一键 4K 重渲">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FilmReel className="w-5 h-5 text-[var(--cinema-amber)]" />
            <h3 className="cinema-headline text-base">整片一键最终重渲</h3>
            <span className="cinema-mono text-[10px] opacity-60">KLING V3 · NATIVE 4K</span>
          </div>
          <p className="cinema-subhead text-[12px] mt-1 opacity-80">
            冻结当前镜头与参考资产，原生 2160p 重渲后沿用现有中文配音、字幕、音乐和时间线重新合成。
          </p>
          <p className="cinema-mono text-[10px] mt-1 opacity-55">
            提醒：最终档由不同模型重绘，人物动作与构图可能相对开源样片轻微漂移，请以完成后的整片复核为准。
          </p>
          {estimate && (
            <p className="cinema-mono text-[11px] mt-2 opacity-70">
              {estimate.shotCount} 镜 · 约 {estimate.totalDurationSec}s · 预估 ¥{estimate.estimateCny.toFixed(1)}
            </p>
          )}
          {(message || error || result) && (
            <p className={`cinema-mono text-[11px] mt-2 ${error ? 'text-[var(--cinema-red)]' : 'text-[var(--cinema-amber)]'}`}>
              {error || (result?.failedShots?.length
                ? `已生成可预览成片；${result.failedShots.length} 项待续跑`
                : result?.finalVideoUrl ? '4K 最终成片已完成' : message)}
            </p>
          )}
          {result?.finalVideoUrl && (
            <a
              href={result.finalVideoUrl}
              target="_blank"
              rel="noreferrer"
              className="cinema-mono text-[11px] mt-2 inline-block underline text-[var(--cinema-amber)]"
            >
              打开完整 4K 成片
            </a>
          )}
        </div>
        <div className="flex gap-2">
          {hasRevisionConflict ? (
            <button
              className="cinema-btn cinema-btn-primary inline-flex items-center gap-2"
              onClick={() => void start().catch((e) => setError(e.message))}
            >
              <Repeat className="w-4 h-4" /> 按当前版本新建任务
            </button>
          ) : partial || job?.state === 'failed' ? (
            <button
              className="cinema-btn cinema-btn-primary inline-flex items-center gap-2"
              onClick={() => void retry().catch((e) => setError(e.message))}
            >
              <Repeat className="w-4 h-4" /> 只补失败镜头
            </button>
          ) : (
            <button
              className="cinema-btn cinema-btn-primary inline-flex items-center gap-2 disabled:opacity-50"
              disabled={busy || !estimate}
              onClick={() => void start().catch((e) => setError(e.message))}
            >
              {busy ? <CircleNotch className="w-4 h-4 animate-spin" /> : <FilmReel className="w-4 h-4" />}
              {busy ? '整片重渲中…' : canUse ? '一键生成最终 4K' : '升级 Pro 解锁'}
            </button>
          )}
        </div>
      </div>
      {partial && (
        <div className="mt-3 flex items-center gap-2 text-[11px] opacity-75">
          <WarningCircle className="w-4 h-4 text-[var(--cinema-amber)]" />
          已成功的镜头不会重复计费；续跑只处理失败或冲突镜头。
        </div>
      )}
    </section>
  );
}
