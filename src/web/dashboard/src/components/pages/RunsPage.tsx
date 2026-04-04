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
import { ConfidenceIndicator } from '../common/ConfidenceIndicator';
import { RunPipeline } from '../common/RunPipeline';
import { useState, useCallback } from 'react';
import type { Run } from '../../api/types';

// --- Status visual config ---

const STATUS_BORDER: Record<string, string> = {
  queued: 'border-l-orange',
  running: 'border-l-blue',
  completed: 'border-l-green',
  executed: 'border-l-purple',
  executed_manual: 'border-l-blue',
  discarded: 'border-l-text-muted',
  failed: 'border-l-red',
};

const STATUS_ICON: Record<string, string> = {
  queued: '○',
  running: '⟳',
  completed: '✓',
  executed: '✓',
  executed_manual: '✓',
  discarded: '—',
  failed: '✕',
};

const STATUS_ICON_COLOR: Record<string, string> = {
  queued: 'text-orange',
  running: 'text-blue animate-spin',
  completed: 'text-green',
  executed: 'text-purple',
  executed_manual: 'text-blue',
  discarded: 'text-text-muted',
  failed: 'text-red',
};

const STATUS_FILTERS = [
  { label: 'To review', value: 'completed', dotColor: 'bg-green', activeClass: 'bg-green/15 text-green' },
  { label: 'All', value: '' },
  { label: 'Queued', value: 'queued', dotColor: 'bg-orange', activeClass: 'bg-orange/15 text-orange' },
  { label: 'Running', value: 'running', dotColor: 'bg-blue', activeClass: 'bg-blue/15 text-blue' },
  { label: 'Executed', value: 'executed', dotColor: 'bg-purple', activeClass: 'bg-purple/15 text-purple' },
  { label: 'Manual', value: 'executed_manual', dotColor: 'bg-blue', activeClass: 'bg-blue/15 text-blue' },
  { label: 'Discarded', value: 'discarded', dotColor: 'bg-text-muted', activeClass: 'bg-text-muted/15 text-text-muted' },
  { label: 'Failed', value: 'failed', dotColor: 'bg-red', activeClass: 'bg-red/15 text-red' },
  { label: 'Archived', value: 'archived' },
];

const TERMINAL_STATUSES = new Set(['discarded', 'executed_manual']);
const PAGE_SIZE = 20;

// --- Helpers ---

function getPipelineStatus(run: Run, childRun?: Run): { plan: 'done' | 'running' | 'failed' | 'pending'; exec: 'done' | 'running' | 'failed' | 'pending'; pr: 'done' | 'pending' } {
  const planDone = ['completed', 'executed', 'executed_manual'].includes(run.status);
  const plan = run.status === 'running' ? 'running' : run.status === 'failed' ? 'failed' : planDone ? 'done' : 'pending';

  let exec: 'done' | 'running' | 'failed' | 'pending' = 'pending';
  if (childRun) {
    if (childRun.status === 'running') exec = 'running';
    else if (childRun.status === 'failed') exec = 'failed';
    else if (['executed', 'completed'].includes(childRun.status)) exec = 'done';
  } else if (run.status === 'executed' || run.status === 'executed_manual') {
    exec = 'done';
  }

  const pr = (run.prUrl || childRun?.prUrl) ? 'done' as const : 'pending' as const;
  return { plan, exec, pr };
}

function formatDuration(startedAt: string, finishedAt: string): string {
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

// --- Component ---

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
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState<Set<string>>(new Set());

  // Build parent→child lookup
  const childByParent = new Map<string, Run>();
  const childIds = new Set<string>();
  if (data) {
    for (const run of data) {
      if (run.parentRunId) {
        childByParent.set(run.parentRunId, run);
        childIds.add(run.id);
      }
    }
  }

  const toggle = (id: string) => {
    setExpanded((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  const toggleDetails = (id: string) => {
    setDetailsOpen((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  const handleExecute = useCallback(async (id: string) => { await executeRun(id); refresh(); }, [refresh]);
  const handleSession = useCallback(async (id: string) => {
    setSessionLoading(id);
    try { const result = await createRunSession(id); if (result) setSessionInfo({ runId: id, ...result }); }
    finally { setSessionLoading(null); }
    refresh();
  }, [refresh]);
  const handleDiscard = useCallback(async (id: string) => {
    const note = window.prompt('Reason for discarding (optional):');
    await discardRun(id, note || undefined);
    setConfirmDiscard(null);
    refresh();
  }, [refresh]);
  const handleExecutedManual = useCallback(async (id: string) => { await markRunExecutedManual(id); refresh(); }, [refresh]);
  const handleArchive = useCallback(async (id: string) => { await archiveRun(id); refresh(); }, [refresh]);
  const handleRetry = useCallback(async (id: string) => { await retryRun(id); refresh(); }, [refresh]);
  const handleDraftPr = useCallback(async (id: string) => {
    setPrLoading(id);
    try { const result = await createDraftPr(id); if (result?.prUrl) window.open(result.prUrl, '_blank'); refresh(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Failed to create draft PR'); }
    finally { setPrLoading(null); }
  }, [refresh]);

  // Filter out child runs from the top-level list (they render inline under parent)
  const topLevelRuns = data?.filter((r) => !childIds.has(r.id)) ?? [];

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
          <button onClick={() => setSessionInfo(null)} className="text-xs text-text-muted hover:text-text bg-transparent border-none cursor-pointer">dismiss</button>
        </div>
      )}

      {!data ? (
        <div className="text-text-dim">Loading...</div>
      ) : topLevelRuns.length === 0 ? (
        <EmptyState
          icon={params.status === 'completed' ? '✓' : '🏃'}
          title={params.status === 'completed' ? 'All caught up' : 'No runs'}
          description={params.status === 'completed' ? 'No runs waiting for review' : 'Accept a suggestion to create a run'}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {topLevelRuns.map((run) => {
            const childRun = childByParent.get(run.id);
            const isOpen = expanded.has(run.id);
            const isCompleted = run.status === 'completed';
            const isPlan = isCompleted && run.kind !== 'execution';
            const isTerminal = TERMINAL_STATUSES.has(run.status);
            const duration = run.startedAt && run.finishedAt ? formatDuration(run.startedAt, run.finishedAt) : null;
            const pipeline = getPipelineStatus(run, childRun);
            const borderColor = STATUS_BORDER[run.status] ?? 'border-l-border';
            const icon = STATUS_ICON[run.status] ?? '○';
            const iconColor = STATUS_ICON_COLOR[run.status] ?? 'text-text-muted';
            // Determine the "active" run for worktree/PR (child if exists, otherwise parent)
            const activeRun = childRun ?? run;

            return (
              <div
                key={run.id}
                ref={scrollRef(run.id)}
                className={`${isTerminal ? 'opacity-60' : ''}`}
              >
                {/* --- Parent card --- */}
                <div
                  onClick={() => toggle(run.id)}
                  className={`bg-card border border-l-[3px] ${borderColor} rounded-lg px-4 py-3 cursor-pointer transition-colors hover:border-accent/50 ${pulseId === run.id ? 'border-accent ring-2 ring-accent/30' : 'border-border'}`}
                >
                  {/* Collapsed row */}
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className={`text-sm font-mono w-4 text-center ${iconColor}`} title={run.status}>{icon}</span>
                    <Badge className="text-text-dim bg-border">{run.kind}</Badge>
                    {run.confidence && <ConfidenceIndicator confidence={run.confidence} doubts={run.doubts?.length} compact />}
                    {(childRun || run.status === 'executed') && (
                      <RunPipeline plan={pipeline.plan} exec={pipeline.exec} pr={pipeline.pr} />
                    )}
                    <span className="text-[13px] flex-1 min-w-0 truncate">{run.prompt}</span>
                    {duration && <span className="text-xs text-text-muted">{duration}</span>}
                    <span className="text-xs text-text-muted shrink-0">{timeAgo(run.createdAt)}</span>
                  </div>

                  {/* Expanded content */}
                  {isOpen && (
                    <div className="mt-3 animate-fade-in space-y-3" onClick={(e) => e.stopPropagation()}>

                      {/* Section: Actions (first!) */}
                      {isPlan && (
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => handleExecute(run.id)}
                            className="px-4 py-2 rounded-lg text-xs font-semibold bg-green text-bg border-none cursor-pointer transition-all hover:brightness-110"
                          >▶ Execute plan</button>
                          <button
                            onClick={() => handleSession(run.id)}
                            disabled={sessionLoading === run.id}
                            className="text-xs text-accent hover:underline bg-transparent border-none cursor-pointer disabled:opacity-50 disabled:cursor-wait"
                          >{sessionLoading === run.id ? 'Creating...' : 'Open session'}</button>
                          <span className="text-text-muted">·</span>
                          <button onClick={() => handleExecutedManual(run.id)} className="text-xs text-text-dim hover:text-text bg-transparent border-none cursor-pointer">Manual</button>
                          <span className="text-text-muted">·</span>
                          {confirmDiscard === run.id ? (
                            <span className="flex items-center gap-2">
                              <button onClick={() => handleDiscard(run.id)} className="text-xs text-red font-medium bg-transparent border-none cursor-pointer">Confirm discard?</button>
                              <button onClick={() => setConfirmDiscard(null)} className="text-xs text-text-muted bg-transparent border-none cursor-pointer">cancel</button>
                            </span>
                          ) : (
                            <button onClick={() => setConfirmDiscard(run.id)} className="text-xs text-text-muted hover:text-red bg-transparent border-none cursor-pointer">Discard</button>
                          )}
                        </div>
                      )}

                      {run.status === 'failed' && (
                        <div className="flex items-center gap-3">
                          <button onClick={() => handleRetry(run.id)} className="px-4 py-2 rounded-lg text-xs font-semibold bg-orange text-bg border-none cursor-pointer transition-all hover:brightness-110">↻ Retry</button>
                          <button onClick={() => handleArchive(run.id)} className="text-xs text-text-muted hover:text-red bg-transparent border-none cursor-pointer">Archive</button>
                        </div>
                      )}

                      {['executed', 'executed_manual', 'discarded'].includes(run.status) && (
                        <div className="flex items-center gap-3">
                          {activeRun.worktreePath && !activeRun.prUrl && (
                            <button
                              onClick={() => handleDraftPr(activeRun.id)}
                              disabled={prLoading === activeRun.id || !githubRepoIds.has(activeRun.repoId)}
                              title={!githubRepoIds.has(activeRun.repoId) ? 'No GitHub remote configured' : undefined}
                              className="px-4 py-2 rounded-lg text-xs font-semibold bg-purple text-bg border-none cursor-pointer transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
                            >{prLoading === activeRun.id ? 'Creating PR...' : 'Create draft PR'}</button>
                          )}
                          <button onClick={() => handleArchive(run.id)} className="text-xs text-text-muted hover:text-red bg-transparent border-none cursor-pointer">Archive</button>
                        </div>
                      )}

                      {/* Section: Confidence + Doubts */}
                      {run.confidence && (
                        <div className={`rounded-lg p-3 text-sm ${run.doubts?.length > 0 ? 'bg-orange/5 border border-orange/20' : 'bg-green/5 border border-green/20'}`}>
                          <div className="flex items-center gap-2 mb-1">
                            <ConfidenceIndicator confidence={run.confidence} doubts={run.doubts?.length} />
                          </div>
                          {run.doubts?.length > 0 && (
                            <ul className="list-disc list-inside text-text-dim space-y-0.5 text-xs mt-2">
                              {run.doubts.map((d, i) => <li key={i}>{d}</li>)}
                            </ul>
                          )}
                        </div>
                      )}

                      {/* Section: Output */}
                      {run.resultSummaryMd && (
                        <div className="bg-bg rounded-lg p-3 max-h-64 overflow-y-auto">
                          <Markdown>{run.resultSummaryMd}</Markdown>
                        </div>
                      )}

                      {run.errorSummary && (
                        <div className="bg-red/5 border border-red/20 rounded-lg p-3 text-xs text-red whitespace-pre-wrap">
                          {run.errorSummary}
                        </div>
                      )}

                      {/* Section: Details (collapsible) */}
                      <div>
                        <button
                          onClick={() => toggleDetails(run.id)}
                          className="text-xs text-text-muted hover:text-text bg-transparent border-none cursor-pointer flex items-center gap-1"
                        >
                          <span className={`transition-transform ${detailsOpen.has(run.id) ? 'rotate-90' : ''}`}>▸</span>
                          Details
                        </button>
                        {detailsOpen.has(run.id) && (
                          <div className="mt-2 bg-bg rounded-lg p-3 text-xs text-text-dim space-y-1.5 animate-fade-in">
                            {activeRun.worktreePath && (
                              <>
                                <div><span className="text-accent">branch:</span> <code className="select-all">shadow/{activeRun.id.slice(0, 8)}</code></div>
                                <div><span className="text-accent">worktree:</span> <code className="select-all">{activeRun.worktreePath}</code></div>
                              </>
                            )}
                            {activeRun.prUrl && (
                              <div><span className="text-accent">PR:</span> <a href={activeRun.prUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{activeRun.prUrl}</a></div>
                            )}
                            {activeRun.worktreePath && !activeRun.prUrl && (
                              <div>
                                <button
                                  onClick={() => handleDraftPr(activeRun.id)}
                                  disabled={prLoading === activeRun.id || !githubRepoIds.has(activeRun.repoId)}
                                  title={!githubRepoIds.has(activeRun.repoId) ? 'No GitHub remote configured' : undefined}
                                  className="text-xs text-purple hover:underline bg-transparent border-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                >{prLoading === activeRun.id ? 'Creating PR...' : 'Create draft PR'}</button>
                              </div>
                            )}
                            {run.sessionId && (
                              <div><span className="text-accent">session:</span> <code className="select-all">{run.sessionId}</code></div>
                            )}
                            {run.suggestionId && (
                              <div><a href={`/suggestions?highlight=${run.suggestionId}`} className="text-accent hover:underline">View suggestion</a></div>
                            )}
                            <div className="pt-1 border-t border-border space-y-0.5 text-text-muted">
                              <div>ID: {run.id}</div>
                              {run.startedAt && <div>Started: {new Date(run.startedAt).toLocaleString()}</div>}
                              {run.finishedAt && <div>Finished: {new Date(run.finishedAt).toLocaleString()}</div>}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Prompt (at the bottom — context, not the primary content) */}
                      <div className="bg-bg rounded-lg p-3 text-[13px] text-text-dim whitespace-pre-wrap break-words">{run.prompt}</div>
                    </div>
                  )}
                </div>

                {/* --- Child run (indented under parent) --- */}
                {childRun && (
                  <div className="ml-6 mt-1 border-l-2 border-accent/30 pl-3">
                    <div
                      onClick={() => toggle(childRun.id)}
                      className={`bg-card/60 border rounded-lg px-3 py-2 cursor-pointer transition-colors hover:border-accent/50 ${pulseId === childRun.id ? 'border-accent ring-2 ring-accent/30' : 'border-border'}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-mono w-3 text-center ${STATUS_ICON_COLOR[childRun.status] ?? 'text-text-muted'}`}>
                          {STATUS_ICON[childRun.status] ?? '○'}
                        </span>
                        <span className="text-xs text-text-muted">execution</span>
                        {childRun.worktreePath && (
                          <code className="text-xs text-accent">shadow/{childRun.id.slice(0, 8)}</code>
                        )}
                        {childRun.prUrl && (
                          <a href={childRun.prUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-xs text-accent hover:underline">PR</a>
                        )}
                        {childRun.startedAt && childRun.finishedAt && (
                          <span className="text-xs text-text-muted">{formatDuration(childRun.startedAt, childRun.finishedAt)}</span>
                        )}
                        <span className="text-xs text-text-muted ml-auto">{timeAgo(childRun.createdAt)}</span>
                      </div>

                      {expanded.has(childRun.id) && (
                        <div className="mt-2 animate-fade-in space-y-2" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-3">
                            {childRun.worktreePath && !childRun.prUrl && (
                              <button
                                onClick={() => handleDraftPr(childRun.id)}
                                disabled={prLoading === childRun.id || !githubRepoIds.has(childRun.repoId)}
                                title={!githubRepoIds.has(childRun.repoId) ? 'No GitHub remote configured' : undefined}
                                className="px-4 py-2 rounded-lg text-xs font-semibold bg-purple text-bg border-none cursor-pointer transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
                              >{prLoading === childRun.id ? 'Creating PR...' : 'Create draft PR'}</button>
                            )}
                            <button
                              onClick={() => handleSession(childRun.id)}
                              disabled={sessionLoading === childRun.id}
                              className="text-xs text-accent hover:underline bg-transparent border-none cursor-pointer disabled:opacity-50 disabled:cursor-wait"
                            >{sessionLoading === childRun.id ? 'Creating...' : 'Open session'}</button>
                          </div>
                          {childRun.resultSummaryMd && (
                            <div className="bg-bg rounded-lg p-3 max-h-48 overflow-y-auto">
                              <Markdown>{childRun.resultSummaryMd}</Markdown>
                            </div>
                          )}
                          {childRun.errorSummary && (
                            <div className="bg-red/5 border border-red/20 rounded-lg p-3 text-xs text-red whitespace-pre-wrap">{childRun.errorSummary}</div>
                          )}
                        </div>
                      )}
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
