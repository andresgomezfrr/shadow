import { num, str, arr, items } from '../../utils/job-results';
import { Badge } from '../common/Badge';
import { ConfidenceIndicator } from '../common/ConfidenceIndicator';
import { Markdown } from '../common/Markdown';
import { PhasePipeline, JOB_PHASES } from './ActivityEntryPhases';
import type { ActivityEntry as ActivityEntryType } from '../../api/types';

/**
 * Per-type expanded detail render for an ActivityEntry. Large dispatch table —
 * one branch per job type. Extracted from ActivityEntry.tsx (audit UI-01).
 *
 * The dispatch is driven by `entry.type`. Types with structured output render
 * a dedicated layout; everything else falls through to a generic key-value
 * dump at the bottom.
 */
export function ActivityEntryExpandedDetail({ entry }: { entry: ActivityEntryType }) {
  const r = entry.result ?? {};
  const type = entry.type;

  if (type === 'heartbeat') {
    const obsItems = items(r, 'observationItems');
    const memItems = items(r, 'memoryItems');
    const repos = arr(r, 'reposAnalyzed');
    return (
      <>
        <PhasePipeline phases={entry.phases} currentPhase={entry.activity ?? undefined} jobType={entry.type} allPhases={JOB_PHASES['heartbeat']} />
        {num(r, 'observationsCreated') > 0 && (
          <div>
            <span className="text-accent">Observations ({num(r, 'observationsCreated')}):</span>
            {obsItems.length > 0 ? (
              <ul className="ml-3 mt-0.5 space-y-0.5">
                {obsItems.map((item) => (
                  <li key={item.id}>
                    <a href={`/observations?highlight=${item.id}`} className="text-text-dim hover:text-accent hover:underline" onClick={e => e.stopPropagation()}>
                      - {item.title}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-text-muted ml-1">{num(r, 'observationsCreated')} created</span>
            )}
          </div>
        )}
        {num(r, 'memoriesCreated') > 0 && (
          <div>
            <span className="text-accent">Memories ({num(r, 'memoriesCreated')}):</span>
            {memItems.length > 0 ? (
              <ul className="ml-3 mt-0.5 space-y-0.5">
                {memItems.map((item) => (
                  <li key={item.id}>
                    <a href={`/memories?highlight=${item.id}`} className="text-text-dim hover:text-accent hover:underline" onClick={e => e.stopPropagation()}>
                      - {item.title}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-text-muted ml-1">{num(r, 'memoriesCreated')} created</span>
            )}
          </div>
        )}
        {repos.length > 0 && (
          <div><span className="text-accent">Repos:</span> <span className="text-text-dim">{repos.join(', ')}</span></div>
        )}
      </>
    );
  }

  if (type === 'suggest') {
    const sugItems = items(r, 'suggestionItems');
    return (
      <>
        <PhasePipeline phases={entry.phases} currentPhase={entry.activity ?? undefined} jobType={entry.type} allPhases={JOB_PHASES['suggest']} />
        {num(r, 'suggestionsCreated') > 0 ? (
          <div>
            <span className="text-accent">Suggestions ({num(r, 'suggestionsCreated')}):</span>
            {sugItems.length > 0 ? (
              <ul className="ml-3 mt-0.5 space-y-0.5">
                {sugItems.map((item) => (
                  <li key={item.id}>
                    <a href={`/suggestions?highlight=${item.id}`} className="text-text-dim hover:text-accent hover:underline" onClick={e => e.stopPropagation()}>
                      - {item.title}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-text-muted ml-1">{num(r, 'suggestionsCreated')} created</span>
            )}
          </div>
        ) : (
          <div className="text-text-muted">No suggestions generated</div>
        )}
      </>
    );
  }

  if (type === 'suggest-deep') {
    const sugItems = items(r, 'suggestionItems');
    const repoName = str(r, 'repoName');
    return (
      <>
        <PhasePipeline phases={entry.phases} currentPhase={entry.activity ?? undefined} jobType={entry.type} allPhases={JOB_PHASES['suggest-deep']} />
        {repoName && <div><span className="text-accent">Repo:</span> <span className="text-text-dim">{repoName}</span></div>}
        {num(r, 'suggestionsCreated') > 0 ? (
          <div>
            <span className="text-accent">Suggestions ({num(r, 'suggestionsCreated')}):</span>
            <ul className="ml-3 mt-0.5 space-y-0.5">
              {sugItems.map((item) => (
                <li key={item.id}>
                  <a href={`/suggestions?highlight=${item.id}`} className="text-text-dim hover:text-accent hover:underline" onClick={e => e.stopPropagation()}>- {item.title}</a>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="text-text-muted">No suggestions generated</div>
        )}
      </>
    );
  }

  if (type === 'suggest-project') {
    const sugItems = items(r, 'suggestionItems');
    const projectName = str(r, 'projectName');
    return (
      <>
        <PhasePipeline phases={entry.phases} currentPhase={entry.activity ?? undefined} jobType={entry.type} allPhases={JOB_PHASES['suggest-project']} />
        {projectName && <div><span className="text-accent">Project:</span> <span className="text-text-dim">{projectName}</span></div>}
        {num(r, 'suggestionsCreated') > 0 ? (
          <div>
            <span className="text-accent">Cross-repo suggestions ({num(r, 'suggestionsCreated')}):</span>
            <ul className="ml-3 mt-0.5 space-y-0.5">
              {sugItems.map((item) => (
                <li key={item.id}>
                  <a href={`/suggestions?highlight=${item.id}`} className="text-text-dim hover:text-accent hover:underline" onClick={e => e.stopPropagation()}>- {item.title}</a>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="text-text-muted">No cross-repo suggestions</div>
        )}
      </>
    );
  }

  if (type === 'project-profile') {
    const projectName = str(r, 'projectName');
    const repoCount = num(r, 'repoCount');
    return (
      <>
        <PhasePipeline phases={entry.phases} currentPhase={entry.activity ?? undefined} jobType={entry.type} allPhases={JOB_PHASES['project-profile']} />
        <div>
          <span className="text-accent">Profiled:</span>{' '}
          <span className="text-text-dim">{projectName ?? 'unknown'} ({repoCount} repos)</span>
        </div>
      </>
    );
  }

  if (type === 'revalidate-suggestion') {
    const verdict = str(r, 'verdict');
    const verdictNote = str(r, 'verdictNote');
    const title = str(r, 'suggestionTitle');
    const count = num(r, 'newCount');
    return (
      <>
        <PhasePipeline phases={entry.phases} currentPhase={entry.activity ?? undefined} jobType={entry.type} allPhases={JOB_PHASES['revalidate-suggestion']} />
        {title && <div><span className="text-accent">Suggestion:</span> <span className="text-text-dim">{title}</span></div>}
        {verdict && (
          <div className="flex items-center gap-2">
            <span className="text-accent">Verdict:</span>
            <Badge className={verdict === 'valid' ? 'text-green bg-green/15' : verdict === 'partial' ? 'text-orange bg-orange/15' : 'text-red bg-red/15'}>
              {verdict === 'valid' ? '✓ valid' : verdict === 'partial' ? '◐ partial' : '✕ outdated'}
            </Badge>
            {count > 1 && <span className="text-text-muted text-xs">(revalidation #{count})</span>}
          </div>
        )}
        {verdictNote && <div className="text-text-dim text-xs">{verdictNote}</div>}
      </>
    );
  }

  if (type === 'consolidate') {
    return (
      <>
        <PhasePipeline phases={entry.phases} currentPhase={entry.activity ?? undefined} jobType={entry.type} allPhases={JOB_PHASES['consolidate']} />
        <div className="flex items-center gap-3 flex-wrap">
          <span><span className="text-accent">Promoted:</span> <span className="text-text-dim">{num(r, 'memoriesPromoted')}</span></span>
          <span><span className="text-accent">Demoted:</span> <span className="text-text-dim">{num(r, 'memoriesDemoted')}</span></span>
          <span><span className="text-accent">Expired:</span> <span className="text-text-dim">{num(r, 'memoriesExpired')}</span></span>
          {num(r, 'memoriesMerged') > 0 && (
            <span><span className="text-accent">Merged:</span> <span className="text-text-dim">{num(r, 'memoriesMerged')} clusters ({num(r, 'memoriesArchivedByMerge')} archived)</span></span>
          )}
          {num(r, 'memoriesDeduped') > 0 && (
            <span><span className="text-accent">Deduped:</span> <span className="text-text-dim">{num(r, 'memoriesDeduped')}</span></span>
          )}
        </div>
      </>
    );
  }

  if (type === 'reflect') {
    const preview = str(r, 'deltaPreview');
    return (
      <>
        <PhasePipeline phases={entry.phases} currentPhase={entry.activity ?? undefined} jobType={entry.type} allPhases={JOB_PHASES['reflect']} />
        {r.skipped ? (
          <div className="text-text-muted">Skipped{str(r, 'reason') ? ` — ${str(r, 'reason')}` : ' — no changes since last reflect'}</div>
        ) : str(r, 'reason') && !r.soulUpdated ? (
          <div className="text-red">Rejected — {str(r, 'reason')}</div>
        ) : (
          <div>
            <a href="/profile#section-soul" className="text-accent hover:underline" onClick={e => e.stopPropagation()}>Soul updated</a>
            {preview && <div className="text-text-dim mt-0.5 italic">"{preview}"</div>}
          </div>
        )}
      </>
    );
  }

  if (type === 'remote-sync') {
    const summaries = (r.repoSummaries ?? []) as Array<{ name: string; newCommits: number }>;
    return (
      <>
        <PhasePipeline phases={entry.phases} currentPhase={entry.activity ?? undefined} jobType={entry.type} allPhases={JOB_PHASES['remote-sync']} />
        <div>
          <span className="text-accent">{num(r, 'reposSynced')} repos synced</span>
          <span className="text-text-muted">, {num(r, 'reposWithChanges')} with changes</span>
        </div>
        {summaries.length > 0 && (
          <ul className="ml-3 mt-0.5 space-y-0.5">
            {summaries.map((s, i) => (
              <li key={i} className="text-text-dim">- {s.name}: {s.newCommits} new commit{s.newCommits !== 1 ? 's' : ''}</li>
            ))}
          </ul>
        )}
      </>
    );
  }

  if (type === 'repo-profile') {
    const names = arr(r, 'repoNames');
    return (
      <>
        <PhasePipeline phases={entry.phases} currentPhase={entry.activity ?? undefined} jobType={entry.type} allPhases={JOB_PHASES['repo-profile']} />
        <div>
          <span className="text-accent">Profiled:</span>{' '}
          <span className="text-text-dim">{names.length > 0 ? names.join(', ') : `${num(r, 'reposProfiled')} repos`}</span>
        </div>
      </>
    );
  }

  if (type === 'context-enrich') {
    const projectResults = r.projectResults as Array<{
      projectName: string; itemsCollected: number; sources: string[]; error?: string;
      findings?: Array<{ source: string; summary: string }>;
    }> | undefined;
    return (
      <>
        <PhasePipeline phases={entry.phases} currentPhase={entry.activity ?? undefined} jobType={entry.type} allPhases={JOB_PHASES['context-enrich']} />
        {projectResults && projectResults.length > 0 ? (
          <div className="space-y-3">
            {projectResults.map(pr => (
              <div key={pr.projectName}>
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-accent font-medium">{pr.projectName}</span>
                  {pr.error ? (
                    <span className="text-red text-[10px]">error: {pr.error}</span>
                  ) : pr.itemsCollected > 0 ? (
                    <span className="text-text-muted text-[10px]">{pr.itemsCollected} finding{pr.itemsCollected !== 1 ? 's' : ''} via {pr.sources.join(', ')}</span>
                  ) : (
                    <span className="text-text-muted text-[10px]">no findings</span>
                  )}
                </div>
                {pr.findings && pr.findings.length > 0 && (
                  <ul className="ml-3 space-y-0.5">
                    {pr.findings.map((f, i) => (
                      <li key={i} className="text-text-dim text-[11px]">
                        <span className="text-text-muted">[{f.source}]</span> {f.summary}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-text-muted">{num(r, 'itemsCollected')} items collected</div>
        )}
      </>
    );
  }

  if (type.startsWith('digest-')) {
    const words = num(r, 'wordCount');
    const digestId = str(r, 'digestId');
    const ps = str(r, 'periodStart');
    const kind = type.replace('digest-', '');

    let periodFull = '';
    if (ps) {
      if (kind === 'brag') {
        const year = ps.slice(0, 4);
        const q = Math.ceil(parseInt(ps.slice(5, 7)) / 3);
        periodFull = `Q${q} ${year}`;
      } else if (kind === 'weekly') {
        const start = new Date(ps);
        const end = new Date(start); end.setDate(end.getDate() + 6);
        periodFull = `${start.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;
      } else {
        periodFull = new Date(ps).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      }
    }

    return (
      <>
        <PhasePipeline phases={entry.phases} currentPhase={entry.activity ?? undefined} jobType={entry.type} allPhases={JOB_PHASES[type] ?? [type]} />
        <div>
          <span className="text-accent">{kind} digest{periodFull ? ` for ${periodFull}` : ''}</span>
          {words > 0 && <span className="text-text-dim">, {words} words</span>}
          {digestId && (
            <a href={`/digests?kind=${kind}${ps ? `&periodStart=${encodeURIComponent(ps)}` : ''}`} className="text-accent hover:underline ml-2" onClick={e => e.stopPropagation()}>
              view digest
            </a>
          )}
        </div>
      </>
    );
  }

  if (type === 'auto-plan' || type === 'auto-execute') {
    const candidates = (r.candidates ?? []) as Array<{ title?: string; suggestionId?: string; action: string; reason?: string; runId?: string }>;

    const ACTION_STYLES: Record<string, { color: string; label: string }> = {
      skip: { color: 'text-text-muted', label: 'skip' },
      dismissed: { color: 'text-orange', label: 'dismissed' },
      planned: { color: 'text-lime-300', label: 'planned' },
      needs_review: { color: 'text-amber-300', label: 'needs review' },
      auto_executed: { color: 'text-rose-300', label: 'executed' },
      error: { color: 'text-red', label: 'error' },
    };

    return (
      <>
        <PhasePipeline phases={entry.phases} currentPhase={entry.activity ?? undefined} jobType={entry.type} allPhases={JOB_PHASES[type]} />
        {candidates.length > 0 ? (
          <div className="space-y-0.5">
            {candidates.map((c, i) => {
              const style = ACTION_STYLES[c.action] ?? ACTION_STYLES.skip;
              const title = c.title ?? c.runId?.slice(0, 8) ?? '?';
              const isRunLink = (c.action === 'planned' || c.action === 'auto_executed') && c.reason;
              // Title link: suggestion page for auto-plan actions, workspace run for auto-execute/needs_review
              const titleHref = c.suggestionId
                ? `/suggestions?highlight=${c.suggestionId}`
                : c.runId
                ? `/workspace?item=${c.runId}&itemType=run`
                : undefined;
              return (
                <div key={i} className="flex items-start gap-1.5 text-xs">
                  <span className={`font-medium ${style.color} shrink-0`}>{style.label}</span>
                  {titleHref ? (
                    <a
                      href={titleHref}
                      className="text-text-dim hover:text-accent hover:underline"
                      onClick={e => e.stopPropagation()}
                    >
                      {title}
                    </a>
                  ) : (
                    <span className="text-text-dim">{title}</span>
                  )}
                  {isRunLink ? (
                    <a href={`/workspace?item=${c.reason}&itemType=run`} className="text-accent text-[10px] hover:underline shrink-0" onClick={e => e.stopPropagation()}>
                      → run {c.reason!.slice(0, 8)}
                    </a>
                  ) : (
                    c.reason && <span className="text-text-muted/70 text-[10px]">— {c.reason}</span>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-text-muted">No candidates</div>
        )}
      </>
    );
  }

  if (type.startsWith('run:')) {
    const error = str(r, 'error');
    const diffStat = str(r, 'diffStat');
    const outcome = str(r, 'outcome');
    const doubts = arr(r, 'doubts');
    const verification = (r.verification ?? {}) as Record<string, { passed: boolean; output: string; durationMs: number }>;
    const summaryMd = str(r, 'summaryMd');
    return (
      <>
        {entry.taskTitle && entry.taskId && (
          <div>
            <span className="text-accent">Task:</span>{' '}
            <a
              href={`/workspace?item=${entry.taskId}&itemType=task`}
              className="text-text-dim hover:text-accent hover:underline"
              onClick={e => e.stopPropagation()}
            >
              {entry.taskTitle}
            </a>
          </div>
        )}
        {entry.confidence && (
          <div className="flex items-center gap-2">
            <span className="text-accent">Confidence:</span>
            <ConfidenceIndicator confidence={entry.confidence} doubts={doubts.length} />
            {outcome && <span className="text-text-muted text-[10px]">outcome: {outcome}</span>}
          </div>
        )}
        {doubts.length > 0 && (
          <ul className="ml-3 space-y-0.5">
            {doubts.map((d, i) => (
              <li key={i} className="text-orange text-[11px] flex gap-1.5">
                <span className="shrink-0">⚠</span>
                <span className="text-text-dim">{d}</span>
              </li>
            ))}
          </ul>
        )}
        {diffStat && (
          <div>
            <span className="text-accent">Diff:</span>
            <pre className="mt-0.5 text-[11px] text-text-dim whitespace-pre-wrap font-mono bg-border/30 rounded p-2 max-h-32 overflow-y-auto">{diffStat}</pre>
          </div>
        )}
        {Object.keys(verification).length > 0 && (
          <div>
            <span className="text-accent">Verification:</span>
            <div className="ml-3 mt-0.5 space-y-0.5">
              {Object.entries(verification).map(([cmd, result]) => (
                <div key={cmd} className="flex items-center gap-1.5 text-[11px]">
                  <span className={result.passed ? 'text-green' : 'text-red'}>{result.passed ? '✓' : '✗'}</span>
                  <span className="text-text-dim">{cmd}</span>
                  <span className="text-text-muted">({result.durationMs}ms)</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {error && (
          <div className="bg-red/5 border border-red/20 rounded p-2 text-[11px] text-red whitespace-pre-wrap max-h-24 overflow-y-auto">
            {error === 'orphaned — daemon restarted'
              ? 'Orphaned by daemon restart — no auto-retry. Open in Workspace and click Retry to run again.'
              : error}
          </div>
        )}
        {summaryMd && (
          <div>
            <span className="text-accent">Summary:</span>
            <div className="mt-0.5 max-h-64 overflow-y-auto">
              <Markdown>{summaryMd}</Markdown>
            </div>
          </div>
        )}
        <div className="flex items-center gap-3 pt-1">
          {entry.runId && (
            <a href={`/workspace?item=${entry.runId}&itemType=run`} className="text-accent hover:underline" onClick={e => e.stopPropagation()}>
              View in Workspace →
            </a>
          )}
          {entry.prUrl && (
            <a href={entry.prUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline" onClick={e => e.stopPropagation()}>
              View PR →
            </a>
          )}
        </div>
      </>
    );
  }

  if (type === 'pr-sync') {
    const processed = (r.processed ?? []) as Array<{ runId: string; action: 'merged' | 'closed' | 'error'; prUrl?: string; error?: string }>;
    const checked = num(r, 'runsChecked');
    const ACTION_COLOR: Record<string, string> = {
      merged: 'text-green',
      closed: 'text-orange',
      error: 'text-red',
    };
    return (
      <>
        <PhasePipeline phases={entry.phases} currentPhase={entry.activity ?? undefined} jobType={entry.type} allPhases={JOB_PHASES['pr-sync']} />
        {checked === 0 ? (
          <div className="text-text-muted">No awaiting runs to check</div>
        ) : processed.length === 0 ? (
          <div className="text-text-muted">Checked {checked} run{checked !== 1 ? 's' : ''} — all still open</div>
        ) : (
          <div>
            <span className="text-accent">Processed ({processed.length}):</span>
            <ul className="ml-3 mt-0.5 space-y-0.5">
              {processed.map(p => (
                <li key={p.runId}>
                  <a href={`/workspace?item=${p.runId}&itemType=run`} className="text-text-dim hover:text-accent hover:underline font-mono" onClick={e => e.stopPropagation()}>
                    {p.runId.slice(0, 8)}
                  </a>
                  <span className={`ml-2 ${ACTION_COLOR[p.action] ?? 'text-text-dim'}`}>{p.action}</span>
                  {p.error && <span className="text-red ml-2">— {p.error}</span>}
                  {p.prUrl && (
                    <>
                      {' · '}
                      <a href={p.prUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline" onClick={e => e.stopPropagation()}>View PR →</a>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </>
    );
  }

  // Fallback: generic key-value dump
  return (
    <>
      {(entry.phases.length > 0 || JOB_PHASES[type]) && <PhasePipeline phases={entry.phases} currentPhase={entry.activity ?? undefined} jobType={entry.type} allPhases={JOB_PHASES[type]} />}
      {Object.entries(r)
        .filter(([, v]) => v != null && v !== 0 && v !== '' && v !== false)
        .map(([k, v]) => {
          const label = k.replace(/([A-Z])/g, ' $1').toLowerCase();
          const isObjectLike = typeof v === 'object' && v !== null;
          const isArrayOfObjects = Array.isArray(v) && v.length > 0 && v.every(x => typeof x === 'object' && x !== null);
          return (
            <div key={k}>
              <span className="text-accent">{label}:</span>{' '}
              {isArrayOfObjects || (isObjectLike && !Array.isArray(v)) ? (
                <pre className="mt-0.5 text-[10px] text-text-dim bg-bg-elevated/50 rounded px-2 py-1 overflow-x-auto">{JSON.stringify(v, null, 2)}</pre>
              ) : Array.isArray(v) ? (
                v.join(', ')
              ) : (
                String(v)
              )}
            </div>
          );
        })}
    </>
  );
}
