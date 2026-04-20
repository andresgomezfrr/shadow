import { useApi } from '../../../hooks/useApi';
import { useDialog } from '../../../hooks/useDialog';
import { fetchRunContext, fetchPrStatus, createRunSession, executeRun, discardRun, retryRun, archiveRun, closeRun, cleanupWorktree, createDraftPr } from '../../../api/client';
import { ConfidenceIndicator } from '../../common/ConfidenceIndicator';
import { Badge } from '../../common/Badge';
import { RunSpinner } from '../../common/RunSpinner';
import { timeAgo } from '../../../utils/format';
import { useState, useCallback, useEffect } from 'react';
import { useWorkspace } from './WorkspaceContext';
import type { Run } from '../../../api/types';

// --- Copyable session id pill (audit UI-13) ---
// Click copies the full id to clipboard + flashes ✓. Click again toggles expand
// so the full uuid is visible for grep into ~/.claude/projects/<cwd>/<id>.jsonl
// or manual paste into `claude --resume <id>`.
function SessionIdPill({ sessionId }: { sessionId: string }) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const handleClick = async () => {
    try {
      await navigator.clipboard.writeText(sessionId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* clipboard blocked — expand still useful */ }
    setExpanded((v) => !v);
  };
  return (
    <code
      onClick={handleClick}
      title={copied ? 'Copied!' : 'Click to copy + expand'}
      className="bg-bg rounded px-1.5 py-0.5 text-[11px] cursor-pointer hover:bg-border/60 transition-colors inline-flex items-center gap-1"
    >
      {expanded ? sessionId : `${sessionId.slice(0, 12)}...`}
      {copied && <span className="text-green ml-1">✓</span>}
    </code>
  );
}

// --- Timeline step visual ---
function Step({ status, label, children }: { status: 'done' | 'active' | 'pending' | 'failed'; label: string; children?: React.ReactNode }) {
  const dot: Record<string, string> = {
    done: 'bg-green text-green', active: 'bg-blue text-blue',
    pending: 'bg-border text-text-muted', failed: 'bg-red text-red',
  };
  const parts = dot[status]?.split(' ') ?? ['bg-border', 'text-text-muted'];
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        {status === 'active'
          ? <RunSpinner className="shrink-0" />
          : <div className={`w-3 h-3 rounded-full shrink-0 ${parts[0] ?? 'bg-border'}`} />
        }
        <div className="w-px flex-1 bg-border" />
      </div>
      <div className="pb-4 flex-1 min-w-0">
        <div className={`text-xs font-medium mb-1 ${parts[1] ?? 'text-text-muted'}`}>{label}</div>
        {children}
      </div>
    </div>
  );
}

export function RunJourney({ runId, onRefresh }: { runId: string; onRefresh?: () => void }) {
  const [pollMs, setPollMs] = useState(30_000);
  const { data: ctx, refresh } = useApi(() => fetchRunContext(runId), [runId, pollMs], pollMs);
  const [sessionInfo, setSessionInfo] = useState<{ command: string } | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [expandedAttempt, setExpandedAttempt] = useState<string | null>(null);
  const { drillToItem, expandedPlan, setExpandedPlan } = useWorkspace();
  const { dialog, prompt } = useDialog();

  const run = ctx?.run;
  const childRuns = ctx?.childRuns ?? [];
  const sourceSuggestion = ctx?.sourceSuggestion;
  const sourceObservation = ctx?.sourceObservation;

  // Adaptive polling: 5s when something is actively running/queued, 30s otherwise.
  useEffect(() => {
    const hasActive =
      run?.status === 'running' || run?.status === 'queued' ||
      childRuns.some(c => c.status === 'running' || c.status === 'queued');
    const target = hasActive ? 5_000 : 30_000;
    setPollMs(prev => prev === target ? prev : target);
  }, [run?.status, childRuns]);

  // Active run = latest non-archived child, or the run itself
  const activeChild = childRuns.filter(c => !c.archived).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  const activeRun = activeChild ?? run;

  // PR status — only fetch if run has a PR URL
  const prRunId = activeRun?.prUrl ? activeRun.id : null;
  const { data: prStatus } = useApi(
    () => prRunId ? fetchPrStatus(prRunId) : Promise.resolve(null),
    [prRunId],
    60_000,
  );

  const doRefresh = useCallback(() => { refresh(); onRefresh?.(); }, [refresh, onRefresh]);

  const handleExecute = useCallback(async () => {
    if (!run) return;
    setLoading('execute');
    try { await executeRun(run.id); doRefresh(); } finally { setLoading(null); }
  }, [run, doRefresh]);

  const handleSession = useCallback(async () => {
    if (!run) return;
    setLoading('session');
    try {
      const result = await createRunSession(run.id);
      if (result) setSessionInfo({ command: result.command });
      doRefresh();
    } finally { setLoading(null); }
  }, [run, doRefresh]);

  const handleDiscard = useCallback(async () => {
    if (!run) return;
    const note = await prompt({ title: 'Discard run', message: 'Reason for discarding (optional):', placeholder: 'Why is this being discarded?' });
    if (note === null) return;
    await discardRun(run.id, note || undefined);
    doRefresh();
  }, [run, prompt, doRefresh]);

  const handleClose = useCallback(async () => {
    if (!run) return;
    const note = await prompt({ title: 'Close run', message: 'Reason for closing (optional):', placeholder: 'Why is this being closed?' });
    if (note === null) return;
    await closeRun(run.id, note || undefined);
    doRefresh();
  }, [run, prompt, doRefresh]);

  const handleRetry = useCallback(async (targetId?: string) => {
    const id = targetId ?? run?.id;
    if (!id) return;
    setLoading('retry');
    try { await retryRun(id); doRefresh(); } finally { setLoading(null); }
  }, [run, doRefresh]);

  const handleArchive = useCallback(async () => {
    if (!run) return;
    await archiveRun(run.id);
    doRefresh();
  }, [run, doRefresh]);

  const handleDraftPr = useCallback(async () => {
    if (!activeRun) return;
    setLoading('pr');
    try {
      const result = await createDraftPr(activeRun.id);
      if (result?.prUrl) window.open(result.prUrl, '_blank');
      doRefresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create draft PR');
    } finally { setLoading(null); }
  }, [activeRun, doRefresh]);

  const handleCleanup = useCallback(async () => {
    if (!activeRun) return;
    await cleanupWorktree(activeRun.id);
    doRefresh();
  }, [activeRun, doRefresh]);

  if (!ctx || !run) return <div className="text-text-dim text-sm p-4">Loading journey...</div>;

  const isPlanCompleted = run.status === 'planned';
  const isTerminal = ['done', 'dismissed'].includes(run.status);
  const hasWorktree = !!activeRun?.worktreePath;
  const hasPr = !!activeRun?.prUrl;

  // Determine step statuses
  const planStatus: 'done' | 'active' | 'pending' | 'failed' =
    run.status === 'failed' ? 'failed' :
    run.status === 'running' ? 'active' :
    ['planned', 'awaiting_pr', 'done', 'dismissed'].includes(run.status) ? 'done' : 'pending';

  const execStatus: 'done' | 'active' | 'pending' | 'failed' =
    activeChild?.status === 'failed' ? 'failed' :
    activeChild?.status === 'queued' ? 'active' :
    activeChild?.status === 'running' ? 'active' :
    activeChild && ['planned', 'done'].includes(activeChild.status) ? 'done' :
    run.status === 'awaiting_pr' ? 'done' :
    run.status === 'done' && (run.outcome === 'executed' || run.outcome === 'executed_manual' || run.outcome === 'merged' || run.outcome === 'no_changes' || run.outcome === 'closed_manual') ? 'done' : 'pending';

  return (
    <div className="space-y-2">
      {dialog}
      {/* Origin — Observation */}
      {sourceObservation && (
        <Step status="done" label="Origin">
          <div className="text-xs text-text-dim">
            <span className="text-orange mr-1">{sourceObservation.severity}</span>
            {sourceObservation.title}
          </div>
          <button
            onClick={() => drillToItem(sourceObservation.id, 'observation')}
            className="text-xs text-accent hover:underline bg-transparent border-none cursor-pointer"
          >View observation</button>
        </Step>
      )}

      {/* Suggestion */}
      {sourceSuggestion && (
        <Step status="done" label="Suggestion">
          <div className="text-xs text-text-dim">
            💡 {sourceSuggestion.title}
          </div>
          <button
            onClick={() => drillToItem(sourceSuggestion.id, 'suggestion')}
            className="text-xs text-accent hover:underline bg-transparent border-none cursor-pointer mt-0.5"
          >View suggestion</button>
        </Step>
      )}

      {/* Plan */}
      <Step status={planStatus} label="Plan">
        {run.confidence && <ConfidenceIndicator confidence={run.confidence} doubts={run.doubts?.length} />}
        {run.doubts && run.doubts.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {run.doubts.map((d, i) => (
              <li key={i} className="text-xs text-orange flex gap-1.5">
                <span className="shrink-0">⚠</span>
                <span className="text-text-dim">{d}</span>
              </li>
            ))}
          </ul>
        )}
        {run.resultSummaryMd && (
          <div className="mt-1">
            <button
              onClick={() => setExpandedPlan(expandedPlan ? null : run.resultSummaryMd)}
              className="text-xs text-accent hover:underline bg-transparent border-none cursor-pointer"
            >
              {expandedPlan ? '▾ Hide plan' : '▸ View plan'}
            </button>
          </div>
        )}
        {run.errorSummary && (
          <div className="mt-1 bg-red/5 border border-red/20 rounded p-2 text-xs text-red whitespace-pre-wrap max-h-24 overflow-y-auto">{run.errorSummary}</div>
        )}
        {isPlanCompleted && childRuns.length === 0 && (
          <div className="flex items-center gap-2 mt-2">
            <button onClick={handleExecute} disabled={loading === 'execute'} className="px-3 py-1 rounded-lg text-xs font-semibold bg-green text-bg border-none cursor-pointer hover:brightness-110 disabled:opacity-50">▶ Execute</button>
            <button onClick={handleSession} disabled={loading === 'session'} className="text-xs text-accent hover:underline bg-transparent border-none cursor-pointer disabled:opacity-50">{loading === 'session' ? '...' : 'Session'}</button>
            <button onClick={handleArchive} className="text-xs text-text-muted hover:text-text bg-transparent border-none cursor-pointer">Archive</button>
          </div>
        )}
        {run.status === 'failed' && (
          <div className="flex items-center gap-2 mt-2">
            <button onClick={() => handleRetry()} disabled={loading === 'retry'} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-orange/15 text-orange border-none cursor-pointer hover:bg-orange/25 disabled:opacity-50">{loading === 'retry' ? '...' : 'Retry'}</button>
            <button onClick={handleArchive} className="text-xs text-text-muted hover:text-text bg-transparent border-none cursor-pointer">Archive</button>
          </div>
        )}
      </Step>

      {/* Execution attempts — expandable per attempt (UI-16) */}
      {childRuns.length > 0 && (
        <Step status={execStatus} label={`Execution${childRuns.length > 1 ? ` (${childRuns.length} attempts)` : ''}`}>
          {childRuns.map((child, i) => {
            const isActive = !child.archived && child.id === activeChild?.id;
            const isExpanded = expandedAttempt === child.id;
            const canExpand = !!child.errorSummary || !!child.resultSummaryMd;
            return (
              <div key={child.id} className={`${i > 0 ? 'mt-1' : ''}`}>
                <div
                  onClick={canExpand ? () => setExpandedAttempt(isExpanded ? null : child.id) : undefined}
                  className={`text-xs flex items-center gap-1.5 rounded px-1.5 py-1 ${
                    child.archived
                      ? 'text-text-muted bg-transparent'
                      : isActive
                        ? 'text-text bg-accent/5 border-l-2 border-accent/40 pl-2'
                        : 'text-text-dim'
                  } ${canExpand ? 'cursor-pointer hover:bg-card/60' : ''}`}
                >
                  {canExpand && <span className="text-[9px] shrink-0">{isExpanded ? '▾' : '▸'}</span>}
                  <span className="shrink-0">
                    {child.status === 'failed' ? '✕' : child.status === 'running' ? '⟳' : child.status === 'queued' ? '◌' : '✓'}
                  </span>
                  <span className="shrink-0">Attempt {i + 1}</span>
                  <span className="text-text-muted">· {child.status}</span>
                  {child.status === 'running' && child.activity && (
                    <span className="text-blue">({child.activity})</span>
                  )}
                  {child.startedAt && child.finishedAt && (
                    <span className="text-text-muted">· {Math.round((new Date(child.finishedAt).getTime() - new Date(child.startedAt).getTime()) / 1000)}s</span>
                  )}
                  {child.archived && <Badge className="text-text-muted bg-border/60 ml-1">archived</Badge>}
                  {isActive && <Badge className="text-accent bg-accent/15 ml-1">active</Badge>}
                  <button
                    onClick={e => { e.stopPropagation(); drillToItem(child.id, 'run'); }}
                    className="ml-auto text-accent hover:underline bg-transparent border-none cursor-pointer text-xs shrink-0"
                  >View →</button>
                </div>
                {isExpanded && (
                  <div className="mt-1 ml-4 space-y-1">
                    {child.errorSummary && (
                      <div className="bg-red/5 border border-red/20 rounded p-2 text-xs text-red whitespace-pre-wrap max-h-32 overflow-y-auto">
                        {child.errorSummary === 'orphaned — daemon restarted'
                          ? 'Orphaned by daemon restart — no auto-retry. Click Retry to run again.'
                          : child.errorSummary}
                      </div>
                    )}
                    {child.resultSummaryMd && !child.errorSummary && (
                      <div className="bg-bg rounded p-2 text-xs text-text-dim whitespace-pre-wrap max-h-32 overflow-y-auto">
                        {child.resultSummaryMd}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {execStatus === 'failed' && activeChild && (
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={() => handleRetry(activeChild.id)}
                disabled={loading === 'retry'}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-orange/15 text-orange border-none cursor-pointer hover:bg-orange/25 disabled:opacity-50"
              >
                {loading === 'retry' ? '...' : 'Retry'}
              </button>
            </div>
          )}
        </Step>
      )}

      {/* Manual execution note */}
      {run.status === 'done' && run.outcome === 'executed_manual' && childRuns.length === 0 && (
        <Step status="done" label="Execution">
          <div className="text-xs text-text-dim">Implemented manually</div>
        </Step>
      )}

      {/* Verification */}
      {activeRun && activeRun.verified && Object.keys(activeRun.verification).length > 0 && (
        <Step status={activeRun.verified === 'verified' ? 'done' : 'failed'} label="Verification">
          {Object.entries(activeRun.verification).map(([cmd, result]) => (
            <div key={cmd} className="text-xs flex items-center gap-1">
              <span className={result.passed ? 'text-green' : 'text-red'}>{result.passed ? '✓' : '✗'}</span>
              <span>{cmd}</span>
              <span className="text-text-muted">({result.durationMs}ms)</span>
            </div>
          ))}
        </Step>
      )}

      {/* Pull Request — only after execution completes */}
      {(hasPr || (hasWorktree && execStatus === 'done')) && (
        <Step status={hasPr ? 'done' : 'pending'} label="Pull Request">
          {hasPr && prStatus ? (
            <div className="text-xs space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                {(() => {
                  // State badge — merge/closed dominate over draft
                  if (prStatus.state === 'MERGED') {
                    return <Badge className="text-purple bg-purple/15">merged</Badge>;
                  }
                  if (prStatus.state === 'CLOSED') {
                    return <Badge className="text-red bg-red/15">closed</Badge>;
                  }
                  if (prStatus.isDraft) {
                    return <Badge className="text-orange bg-orange/15">draft</Badge>;
                  }
                  return <Badge className="text-blue bg-blue/15">open</Badge>;
                })()}
                {prStatus.state === 'OPEN' && prStatus.checksStatus && (
                  <Badge className={prStatus.checksStatus === 'SUCCESS' ? 'text-green bg-green/15' : prStatus.checksStatus === 'FAILURE' ? 'text-red bg-red/15' : 'text-orange bg-orange/15'}>
                    checks: {prStatus.checksStatus.toLowerCase()}
                  </Badge>
                )}
                {prStatus.state === 'OPEN' && prStatus.reviewDecision && (
                  <Badge className={prStatus.reviewDecision === 'APPROVED' ? 'text-green bg-green/15' : prStatus.reviewDecision === 'CHANGES_REQUESTED' ? 'text-red bg-red/15' : 'text-orange bg-orange/15'}>
                    {prStatus.reviewDecision.toLowerCase().replace(/_/g, ' ')}
                  </Badge>
                )}
              </div>
              <a href={activeRun!.prUrl!} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">View on GitHub →</a>
            </div>
          ) : hasPr ? (
            <a href={activeRun!.prUrl!} target="_blank" rel="noopener noreferrer" className="text-xs text-accent hover:underline">View on GitHub →</a>
          ) : hasWorktree ? (
            <button onClick={handleDraftPr} disabled={loading === 'pr'} className="px-3 py-1 rounded-lg text-xs font-semibold bg-purple text-bg border-none cursor-pointer hover:brightness-110 disabled:opacity-50">
              {loading === 'pr' ? (<><span className="inline-block w-3 h-3 border-2 border-bg border-t-transparent rounded-full animate-spin mr-1.5" />Creating PR (~5s)</>) : 'Create draft PR'}
            </button>
          ) : null}
        </Step>
      )}

      {/* --- Session & Worktree info --- */}
      <div className="border-t border-border pt-3 space-y-2">
        {/* Session — hidden while running (daemon owns the process) */}
        {run.status !== 'running' && (
        <div className="text-xs">
          <span className="text-text-muted">Session: </span>
          {sessionInfo ? (
            <code className="bg-bg rounded px-1.5 py-0.5 select-all text-[11px]">{sessionInfo.command}</code>
          ) : run.sessionId ? (
            <span className="text-text-dim">
              <SessionIdPill sessionId={run.sessionId} />
              <button onClick={handleSession} className="text-accent hover:underline bg-transparent border-none cursor-pointer ml-2 text-xs">Resume</button>
            </span>
          ) : (
            <button onClick={handleSession} disabled={loading === 'session'} className="text-accent hover:underline bg-transparent border-none cursor-pointer text-xs disabled:opacity-50">
              {loading === 'session' ? 'Creating...' : 'Open session'}
            </button>
          )}
        </div>
        )}

        {/* Worktree */}
        {hasWorktree && (
          <div className="text-xs">
            <span className="text-text-muted">Branch: </span>
            <code className="bg-bg rounded px-1.5 py-0.5 select-all text-[11px]">shadow/{activeRun!.id.slice(0, 8)}</code>
            {isTerminal && (
              <button onClick={handleCleanup} className="text-text-muted hover:text-red bg-transparent border-none cursor-pointer ml-2 text-xs">Clean up</button>
            )}
          </div>
        )}
      </div>

      {/* --- Bottom actions --- */}
      {!isTerminal && (
        <div className="border-t border-border pt-3 flex items-center gap-3">
          <button onClick={handleClose} className="text-xs text-text-muted hover:text-text bg-transparent border-none cursor-pointer">Close journey</button>
        </div>
      )}
      {run.status === 'done' && (run.outcome === 'no_changes' || run.outcome === 'closed_manual') && run.closedNote && (
        <div className="text-xs text-text-muted italic">Closed: "{run.closedNote}"</div>
      )}
    </div>
  );
}
