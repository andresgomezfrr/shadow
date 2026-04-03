import { timeAgo } from '../../utils/format';
import { useApi } from '../../hooks/useApi';
import { useHighlight } from '../../hooks/useHighlight';
import { useFilterParams } from '../../hooks/useFilterParams';
import { fetchRuns, fetchRepos, executeRun, createRunSession, discardRun, markRunExecutedManual, archiveRun, retryRun, createDraftPr } from '../../api/client';
import { Badge } from '../common/Badge';
import { Markdown } from '../common/Markdown';
import { EmptyState } from '../common/EmptyState';
import { FilterTabs } from '../common/FilterTabs';
import { Pagination } from '../common/Pagination';
import { useState, useCallback } from 'react';

const STATUS_STYLES: Record<string, string> = {
  queued: 'text-orange bg-orange/15',
  running: 'text-blue bg-blue/15',
  completed: 'text-green bg-green/15',
  executed: 'text-purple bg-purple/15',
  executed_manual: 'text-blue bg-blue/15',
  discarded: 'text-text-muted bg-text-muted/10',
  failed: 'text-red bg-red/15',
};


const STATUS_FILTERS = [
  { label: 'To review', value: 'completed' },
  { label: 'All', value: '' },
  { label: 'Queued', value: 'queued' },
  { label: 'Running', value: 'running' },
  { label: 'Executed', value: 'executed' },
  { label: 'Manual', value: 'executed_manual' },
  { label: 'Discarded', value: 'discarded' },
  { label: 'Failed', value: 'failed' },
  { label: 'Archived', value: 'archived' },
];

const PAGE_SIZE = 20;

export function RunsPage() {
  const hasHighlight = new URLSearchParams(window.location.search).has('highlight');
  const { params, setParam } = useFilterParams({ status: hasHighlight ? '' : 'completed', offset: '0' });
  const { data: rawData, refresh } = useApi(
    () => fetchRuns({
      status: params.status === 'archived' ? undefined : (params.status || undefined),
      archived: params.status === 'archived' ? true : undefined,
      limit: PAGE_SIZE, offset: Number(params.offset) || 0,
    }),
    [params.status, params.offset],
    15_000,
  );
  const data = rawData?.items ?? null;
  const total = rawData?.total ?? 0;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { pulseId, scrollRef } = useHighlight(expanded, setExpanded);
  const { data: repos } = useApi(fetchRepos, [], 60_000);
  const githubRepoIds = new Set(
    (repos ?? []).filter((r) => r.remoteUrl?.includes('github')).map((r) => r.id),
  );
  const [sessionInfo, setSessionInfo] = useState<{ runId: string; sessionId: string; command: string } | null>(null);
  const [sessionLoading, setSessionLoading] = useState<string | null>(null);
  const [prLoading, setPrLoading] = useState<string | null>(null);

  const toggle = (id: string) => {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleExecute = useCallback(async (id: string) => {
    await executeRun(id);
    refresh();
  }, [refresh]);

  const handleSession = useCallback(async (id: string) => {
    setSessionLoading(id);
    try {
      const result = await createRunSession(id);
      if (result) {
        setSessionInfo({ runId: id, ...result });
      }
    } finally {
      setSessionLoading(null);
    }
    refresh();
  }, [refresh]);

  const handleDiscard = useCallback(async (id: string) => {
    const note = window.prompt('Reason for discarding (optional):');
    await discardRun(id, note || undefined);
    refresh();
  }, [refresh]);

  const handleExecutedManual = useCallback(async (id: string) => {
    await markRunExecutedManual(id);
    refresh();
  }, [refresh]);

  const handleArchive = useCallback(async (id: string) => {
    await archiveRun(id);
    refresh();
  }, [refresh]);

  const handleRetry = useCallback(async (id: string) => {
    await retryRun(id);
    refresh();
  }, [refresh]);

  const handleDraftPr = useCallback(async (id: string) => {
    setPrLoading(id);
    try {
      const result = await createDraftPr(id);
      if (result?.prUrl) {
        window.open(result.prUrl, '_blank');
      }
      refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create draft PR');
    } finally {
      setPrLoading(null);
    }
  }, [refresh]);

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h1 className="text-xl font-semibold">Runs</h1>
        <FilterTabs options={STATUS_FILTERS} active={params.status} onChange={(v) => setParam('status', v)} />
      </div>

      {sessionInfo && (
        <div className="mb-4 p-4 rounded-lg bg-accent-soft border border-accent/30 text-sm space-y-2">
          <div className="font-medium text-accent">Session ready</div>
          <div className="text-text-dim">Resume in your terminal:</div>
          <code className="block bg-bg rounded p-2 text-xs font-mono select-all">{sessionInfo.command}</code>
          <button
            onClick={() => setSessionInfo(null)}
            className="text-xs text-text-muted hover:text-text bg-transparent border-none cursor-pointer"
          >dismiss</button>
        </div>
      )}

      {!data ? (
        <div className="text-text-dim">Loading...</div>
      ) : data.length === 0 ? (
        <EmptyState icon="🏃" title="No runs" description="Accept a suggestion to create a run" />
      ) : (
        <div className="flex flex-col gap-2">
          {data.map((run) => {
            const statusClass = STATUS_STYLES[run.status] ?? STATUS_STYLES.queued;
            const isOpen = expanded.has(run.id);
            const isCompleted = run.status === 'completed';
            const isPlan = isCompleted && run.kind !== 'execution';
            const duration = run.startedAt && run.finishedAt
              ? `${((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000).toFixed(0)}s`
              : null;

            return (
              <div
                key={run.id}
                ref={scrollRef(run.id)}
                onClick={() => toggle(run.id)}
                className={`bg-card border rounded-lg px-4 py-3 cursor-pointer transition-colors hover:border-accent ${pulseId === run.id ? 'border-accent ring-2 ring-accent/30' : 'border-border'}`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge title="Status" className={statusClass}>{run.status}</Badge>
                  <Badge title="Run kind" className="text-text-dim bg-border">{run.kind}</Badge>
                  {run.parentRunId && (
                    <a href={`/runs?highlight=${run.parentRunId}`} onClick={(e) => e.stopPropagation()} className="no-underline">
                      <Badge title="View parent plan" className="text-purple bg-purple/15 hover:bg-purple/25">↑ parent</Badge>
                    </a>
                  )}
                  {data?.some((r) => r.parentRunId === run.id) && (
                    <a href={`/runs?highlight=${data.find((r) => r.parentRunId === run.id)!.id}`} onClick={(e) => e.stopPropagation()} className="no-underline">
                      <Badge title="View child execution" className="text-green bg-green/15 hover:bg-green/25">↓ child</Badge>
                    </a>
                  )}
                  {run.confidence && (
                    <Badge title="Confidence" className={
                      run.confidence === 'high' ? 'text-green bg-green/15' :
                      run.confidence === 'medium' ? 'text-orange bg-orange/15' :
                      'text-red bg-red/15'
                    }>{run.confidence}</Badge>
                  )}
                  {run.doubts?.length > 0 && (
                    <Badge title="Has doubts" className="text-orange bg-orange/15">⚠ {run.doubts.length} doubt{run.doubts.length > 1 ? 's' : ''}</Badge>
                  )}
                  <span className="text-[13px] flex-1 min-w-0 truncate">{run.prompt}</span>
                  {duration && <span className="text-xs text-text-muted">{duration}</span>}
                  <span className="text-xs text-text-muted shrink-0">{timeAgo(run.createdAt)}</span>
                </div>

                {isOpen && (
                  <div className="mt-3 animate-fade-in space-y-3">
                    <div className="bg-bg rounded p-3 text-[13px] text-text whitespace-pre-wrap break-words">{run.prompt}</div>
                    {run.doubts?.length > 0 && (
                      <div className="bg-orange/5 border border-orange/20 rounded-lg p-3 text-sm">
                        <div className="font-medium text-orange mb-1.5">Shadow has doubts</div>
                        <ul className="list-disc list-inside text-text-dim space-y-0.5 text-xs">
                          {run.doubts.map((d, i) => <li key={i}>{d}</li>)}
                        </ul>
                      </div>
                    )}
                    {isPlan && (
                      <div className="flex gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleExecute(run.id); }}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-green/15 text-green border border-green/30 cursor-pointer transition-all hover:bg-green/25"
                        >Execute plan</button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleSession(run.id); }}
                          disabled={sessionLoading === run.id}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-accent-soft text-accent border border-accent/30 cursor-pointer transition-all hover:bg-accent/25 disabled:opacity-50 disabled:cursor-wait"
                        >{sessionLoading === run.id ? 'Creating session...' : 'Open session'}</button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleExecutedManual(run.id); }}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blue/15 text-blue border border-blue/30 cursor-pointer transition-all hover:bg-blue/25"
                        >Executed manually</button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDiscard(run.id); }}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-border text-text-dim border border-border cursor-pointer transition-all hover:bg-red/15 hover:text-red"
                        >Discard</button>
                      </div>
                    )}

                    {run.sessionId && (
                      <div className="bg-bg rounded p-3 text-xs space-y-1">
                        <div><span className="text-accent">session:</span> <code className="select-all">{run.sessionId}</code></div>
                        <div className="text-text-muted">claude --resume {run.sessionId}</div>
                      </div>
                    )}

                    {run.resultSummaryMd && (
                      <div className="bg-bg rounded p-3 max-h-96 overflow-y-auto">
                        <Markdown>{run.resultSummaryMd}</Markdown>
                      </div>
                    )}

                    {run.errorSummary && (
                      <div className="bg-red/5 rounded p-3 text-xs text-red whitespace-pre-wrap">
                        {run.errorSummary}
                      </div>
                    )}

                    {run.worktreePath && (
                      <div className="bg-bg rounded p-3 text-xs space-y-2">
                        <div className="space-y-1">
                          <div><span className="text-accent">worktree:</span> {run.worktreePath}</div>
                          <div><span className="text-accent">branch:</span> shadow/{run.id.slice(0, 8)}</div>
                        </div>
                        {run.prUrl ? (
                          <a href={run.prUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1.5 text-accent hover:underline">
                            PR: {run.prUrl}
                          </a>
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDraftPr(run.id); }}
                            disabled={prLoading === run.id || !githubRepoIds.has(run.repoId)}
                            title={!githubRepoIds.has(run.repoId) ? 'No GitHub remote configured' : undefined}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-purple/15 text-purple border border-purple/30 cursor-pointer transition-all hover:bg-purple/25 disabled:opacity-50 disabled:cursor-not-allowed"
                          >{prLoading === run.id ? 'Creating PR...' : 'Create draft PR'}</button>
                        )}
                      </div>
                    )}

                    <div className="flex items-center gap-3 text-xs text-text-muted">
                      {run.suggestionId && (
                        <a href={`/suggestions?highlight=${run.suggestionId}`} onClick={(e) => e.stopPropagation()} className="text-accent hover:underline">View suggestion</a>
                      )}
                      {run.status === 'failed' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRetry(run.id); }}
                          className="text-orange hover:text-accent bg-transparent border-none cursor-pointer text-xs"
                        >Retry</button>
                      )}
                      {['executed', 'executed_manual', 'discarded', 'failed'].includes(run.status) && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleArchive(run.id); }}
                          className="text-text-muted hover:text-red bg-transparent border-none cursor-pointer text-xs"
                        >Archive</button>
                      )}
                    </div>

                    <div className="text-xs text-text-muted space-y-0.5">
                      <div>ID: {run.id}</div>
                      {run.startedAt && <div>Started: {new Date(run.startedAt).toLocaleString()}</div>}
                      {run.finishedAt && <div>Finished: {new Date(run.finishedAt).toLocaleString()}</div>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <Pagination total={total} offset={Number(params.offset) || 0} limit={PAGE_SIZE} onChange={(o) => setParam('offset', String(o))} />
    </div>
  );
}
