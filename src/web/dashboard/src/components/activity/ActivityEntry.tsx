import { useState, useCallback } from 'react';
import { timeAgo, formatTokens } from '../../utils/format';
import { num, str, arr, items } from '../../utils/job-results';
import { Badge } from '../common/Badge';
import { ConfidenceIndicator } from '../common/ConfidenceIndicator';
import { JobOutputSummary } from './JobOutputSummary';
import { triggerJobWithParams } from '../../api/client';
import type { ActivityEntry as ActivityEntryType } from '../../api/types';

const TYPE_COLORS: Record<string, string> = {
  heartbeat: 'bg-purple-500/20 text-purple-300',
  suggest: 'bg-green-500/20 text-green-300',
  consolidate: 'bg-orange-500/20 text-orange-300',
  reflect: 'bg-blue-500/20 text-blue-300',
  'remote-sync': 'bg-pink-400/20 text-pink-300',
  'repo-profile': 'bg-teal-400/20 text-teal-300',
  'suggest-deep': 'bg-green-600/20 text-green-400',
  'suggest-project': 'bg-emerald-400/20 text-emerald-300',
  'project-profile': 'bg-emerald-400/20 text-emerald-300',
  'context-enrich': 'bg-amber-400/20 text-amber-300',
  'mcp-discover': 'bg-indigo-400/20 text-indigo-300',
  'digest-daily': 'bg-cyan-500/20 text-cyan-300',
  'digest-weekly': 'bg-cyan-500/20 text-cyan-300',
  'digest-brag': 'bg-cyan-500/20 text-cyan-300',
  'run:plan': 'bg-indigo-500/20 text-indigo-300',
  'run:execution': 'bg-violet-500/20 text-violet-300',
};

const STATUS_BADGE: Record<string, string> = {
  completed: 'text-green bg-green/15',
  running: 'text-blue bg-blue/15',
  failed: 'text-red bg-red/15',
  queued: 'text-orange bg-orange/15',
  executed: 'text-purple bg-purple/15',
  executed_manual: 'text-blue bg-blue/15',
  discarded: 'text-text-muted bg-text-muted/10',
};

const PHASE_DOT: Record<string, string> = {
  observe: 'bg-blue',
  cleanup: 'bg-text-muted',
  analyze: 'bg-purple',
  suggest: 'bg-green',
  notify: 'bg-text-muted',
  consolidate: 'bg-orange',
  'layer-maintenance': 'bg-orange',
  corrections: 'bg-yellow-400',
  merge: 'bg-amber-400',
  'meta-patterns': 'bg-orange',
  reflect: 'bg-blue',
  'reflect-delta': 'bg-blue',
  'reflect-evolve': 'bg-purple',
  enrich: 'bg-amber-400',
  discover: 'bg-indigo-400',
  'remote-sync': 'bg-pink-400',
  'repo-profile': 'bg-teal-400',
  scan: 'bg-green-600',
  profile: 'bg-emerald-400',
  digest: 'bg-cyan',
};

const PHASE_TEXT: Record<string, string> = {
  observe: 'text-blue',
  cleanup: 'text-text-muted',
  analyze: 'text-purple',
  suggest: 'text-green',
  notify: 'text-text-muted',
  consolidate: 'text-orange',
  'layer-maintenance': 'text-orange',
  corrections: 'text-yellow-400',
  merge: 'text-amber-400',
  'meta-patterns': 'text-orange',
  reflect: 'text-blue',
  'reflect-delta': 'text-blue',
  'reflect-evolve': 'text-purple',
  enrich: 'text-amber-400',
  discover: 'text-indigo-400',
  'remote-sync': 'text-pink-400',
  'repo-profile': 'text-teal-400',
  scan: 'text-green-600',
  profile: 'text-emerald-400',
  digest: 'text-cyan',
};

const JOB_PHASES: Record<string, string[]> = {
  heartbeat: ['observe', 'cleanup', 'analyze', 'notify'],
  suggest: ['suggest', 'notify'],
  consolidate: ['layer-maintenance', 'corrections', 'merge', 'meta-patterns'],
  reflect: ['reflect-delta', 'reflect-evolve'],
  'remote-sync': ['remote-sync'],
  'repo-profile': ['repo-profile'],
  'suggest-deep': ['scan', 'validate'],
  'suggest-project': ['analyze', 'validate'],
  'project-profile': ['profile'],
  'context-enrich': ['enrich'],
  'mcp-discover': ['discover'],
  'digest-daily': ['digest-daily'],
  'digest-weekly': ['digest-weekly'],
  'digest-brag': ['digest-brag'],
};


function isSkip(entry: ActivityEntryType): boolean {
  if (entry.status === 'running' || entry.status === 'queued') return false;
  if (entry.source === 'run') return false;
  if (entry.llmCalls > 0) return false;
  const result = entry.result ?? {};
  return !Object.values(result).some(v => v !== null && v !== undefined && v !== 0 && v !== false && v !== '');
}

function interestingPhases(phases: string[]): string[] {
  return phases.filter((p) => !['wake', 'idle', 'notify'].includes(p));
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '--';
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

// --- Phase Pipeline Component ---

function PhasePipeline({ phases, currentPhase, allPhases }: { phases: string[]; currentPhase?: string; allPhases?: string[] }) {
  const displayPhases = allPhases ?? interestingPhases(phases);
  if (displayPhases.length === 0) return null;

  return (
    <div className="flex items-center gap-0 mb-2">
      {displayPhases.map((phase, i) => {
        const isCurrent = phase === currentPhase;
        const isCompleted = !allPhases || phases.includes(phase);
        const isFuture = allPhases && !isCompleted && !isCurrent;
        const dotColor = isFuture ? 'bg-border' : (PHASE_DOT[phase] ?? 'bg-text-muted');
        const textColor = isFuture ? 'text-text-muted/40' : (PHASE_TEXT[phase] ?? 'text-text-muted');
        return (
          <div key={phase} className="flex items-center">
            {i > 0 && <div className={`w-4 h-px ${isFuture ? 'bg-border/50' : 'bg-border'} mx-0.5`} />}
            <div className="flex items-center gap-1">
              <div className={`w-1.5 h-1.5 rounded-full ${dotColor} ${isCurrent ? 'animate-pulse' : ''}`} />
              <span className={`text-[10px] ${textColor}`}>{phase}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --- Per-Type Expanded Detail ---

function renderExpandedDetail(entry: ActivityEntryType) {
  const r = entry.result ?? {};
  const type = entry.type;

  if (type === 'heartbeat') {
    const obsItems = items(r, 'observationItems');
    const memItems = items(r, 'memoryItems');
    const repos = arr(r, 'reposAnalyzed');
    return (
      <>
        <PhasePipeline phases={entry.phases} currentPhase={entry.activity ?? undefined} />
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
        <PhasePipeline phases={entry.phases} />
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
    const titles = arr(r, 'suggestionTitles').map(t => ({ id: '', title: t }));
    const repoName = str(r, 'repoName');
    return (
      <>
        <PhasePipeline phases={entry.phases} currentPhase={entry.activity ?? undefined} allPhases={JOB_PHASES['suggest-deep']} />
        {repoName && <div><span className="text-accent">Repo:</span> <span className="text-text-dim">{repoName}</span></div>}
        {num(r, 'suggestionsCreated') > 0 ? (
          <div>
            <span className="text-accent">Suggestions ({num(r, 'suggestionsCreated')}):</span>
            <ul className="ml-3 mt-0.5 space-y-0.5">
              {titles.map((t, i) => (
                <li key={i} className="text-text-dim">
                  {t.id ? <a href={`/suggestions?highlight=${t.id}`} className="hover:text-accent hover:underline" onClick={e => e.stopPropagation()}>- {t.title}</a> : `- ${t.title}`}
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
    const titles = arr(r, 'suggestionTitles');
    const projectName = str(r, 'projectName');
    return (
      <>
        <PhasePipeline phases={entry.phases} currentPhase={entry.activity ?? undefined} allPhases={JOB_PHASES['suggest-project']} />
        {projectName && <div><span className="text-accent">Project:</span> <span className="text-text-dim">{projectName}</span></div>}
        {num(r, 'suggestionsCreated') > 0 ? (
          <div>
            <span className="text-accent">Cross-repo suggestions ({num(r, 'suggestionsCreated')}):</span>
            <ul className="ml-3 mt-0.5 space-y-0.5">
              {titles.map((t, i) => <li key={i} className="text-text-dim">- {t}</li>)}
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
        <PhasePipeline phases={entry.phases} currentPhase={entry.activity ?? undefined} allPhases={JOB_PHASES['project-profile']} />
        <div>
          <span className="text-accent">Profiled:</span>{' '}
          <span className="text-text-dim">{projectName ?? 'unknown'} ({repoCount} repos)</span>
        </div>
      </>
    );
  }

  if (type === 'consolidate') {
    return (
      <>
        <PhasePipeline phases={entry.phases} />
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
        <PhasePipeline phases={entry.phases} />
        {r.skipped ? (
          <div className="text-text-muted">Skipped{str(r, 'reason') ? ` — ${str(r, 'reason')}` : ' — no changes since last reflect'}</div>
        ) : str(r, 'reason') && !r.soulUpdated ? (
          <div className="text-red">Rejected — {str(r, 'reason')}</div>
        ) : (
          <div>
            <span className="text-accent">Soul updated</span>
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
        <PhasePipeline phases={entry.phases} />
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
        <PhasePipeline phases={entry.phases} />
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
        <PhasePipeline phases={entry.phases} />
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
        <PhasePipeline phases={entry.phases} />
        <div>
          <span className="text-accent">{kind} digest{periodFull ? ` for ${periodFull}` : ''}</span>
          {words > 0 && <span className="text-text-dim">, {words} words</span>}
          {digestId && (
            <a href={`/digests?kind=${kind}`} className="text-accent hover:underline ml-2" onClick={e => e.stopPropagation()}>
              view digest
            </a>
          )}
        </div>
      </>
    );
  }

  if (type.startsWith('run:')) {
    return (
      <>
        {entry.runId && (
          <div>
            <a href={`/workspace?highlight=${entry.runId}`} className="text-accent hover:underline" onClick={e => e.stopPropagation()}>
              View in Workspace
            </a>
          </div>
        )}
        {entry.prUrl && (
          <div>
            <a href={entry.prUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline" onClick={e => e.stopPropagation()}>
              {entry.prUrl}
            </a>
          </div>
        )}
      </>
    );
  }

  // Fallback: generic key-value dump
  return (
    <>
      {entry.phases.length > 0 && <PhasePipeline phases={entry.phases} />}
      {Object.entries(r)
        .filter(([, v]) => v != null && v !== 0 && v !== '' && v !== false)
        .map(([k, v]) => (
          <div key={k}>
            <span className="text-accent">{k.replace(/([A-Z])/g, ' $1').toLowerCase()}:</span>{' '}
            {Array.isArray(v) ? v.join(', ') : String(v)}
          </div>
        ))}
    </>
  );
}

// --- Main Component ---

type Props = {
  entry: ActivityEntryType;
  defaultExpanded?: boolean;
};

export function ActivityEntryCard({ entry, defaultExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const isQueued = entry.status === 'queued';
  const isRunning = entry.status === 'running';
  const isFailed = entry.status === 'failed';
  const skip = isSkip(entry);
  const isRun = entry.source === 'run';
  const typeColor = TYPE_COLORS[entry.type] ?? 'text-text-dim bg-border';

  const borderClass = isRunning
    ? 'border-l-blue animate-pulse'
    : isFailed
    ? 'border-l-red'
    : 'border-l-transparent';

  // Queued state: orange left border
  if (isQueued) {
    return (
      <div className="bg-card border border-l-[3px] border-l-orange border-border rounded-lg px-4 py-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={typeColor}>{entry.type}</Badge>
          <span className="text-xs text-orange">queued</span>
          {entry.startedAt && <span className="text-xs text-text-muted ml-auto">{timeAgo(entry.startedAt)}</span>}
        </div>
      </div>
    );
  }

  // Skip rows: dimmed, collapsed
  if (skip && !expanded) {
    return (
      <div
        onClick={() => setExpanded(true)}
        className="bg-card/50 border border-l-[3px] border-l-transparent border-border/50 rounded px-4 py-2 cursor-pointer flex items-center gap-2 text-text-muted hover:border-border transition-colors"
      >
        <Badge className={typeColor}>{entry.type}</Badge>
        <Badge className="text-text-muted bg-text-muted/10">skip</Badge>
        <span className="text-xs flex-1">{formatDuration(entry.durationMs)}</span>
        {entry.startedAt && <span className="text-xs">{timeAgo(entry.startedAt)}</span>}
      </div>
    );
  }

  // Running state
  if (isRunning) {
    const expectedPhases = JOB_PHASES[entry.type];
    return (
      <div className="bg-accent/5 border border-l-[3px] border-l-blue border-accent/30 rounded-lg px-4 py-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={typeColor}>{entry.type}</Badge>
          {isRun && entry.repoName && <Badge className="text-text-dim bg-border">{entry.repoName}</Badge>}
          <span className="text-xs text-accent">running</span>
          {entry.startedAt && <span className="text-xs text-text-muted ml-auto">{timeAgo(entry.startedAt)}</span>}
        </div>
        {expectedPhases && (
          <div className="mt-2">
            <PhasePipeline phases={[]} currentPhase={entry.activity ?? undefined} allPhases={expectedPhases} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      onClick={() => setExpanded(!expanded)}
      className={`bg-card border border-l-[3px] ${borderClass} rounded-lg px-4 py-3 cursor-pointer transition-colors hover:border-accent/50 ${
        skip ? 'border-border/50' : 'border-border'
      }`}
    >
      {/* Collapsed row */}
      <div className="flex items-center gap-2 flex-wrap">
        <Badge className={typeColor}>{entry.type}</Badge>
        {isRun && entry.repoName && <Badge className="text-text-dim bg-border">{entry.repoName}</Badge>}
        {isRun && entry.confidence && (
          <ConfidenceIndicator confidence={entry.confidence} compact />
        )}
        {isRun && entry.status && (
          <Badge className={STATUS_BADGE[entry.status] ?? 'text-text-dim bg-border'}>{entry.status.replace('_', ' ')}</Badge>
        )}
        <span className="flex-1 min-w-0">
          <JobOutputSummary entry={entry} />
        </span>
        {isFailed && !!entry.result?.error && (
          <span className="text-red text-xs truncate max-w-60">
            {String(entry.result.error).slice(0, 60)}
          </span>
        )}
        {entry.tokensUsed > 0 && (
          <span className="font-mono text-xs text-text-muted">{formatTokens(entry.tokensUsed)} tok</span>
        )}
        <span className="font-mono text-xs text-text-muted">{formatDuration(entry.durationMs)}</span>
        {entry.startedAt && <span className="text-xs text-text-muted shrink-0">{timeAgo(entry.startedAt)}</span>}
      </div>

      {/* Expanded view */}
      {expanded && (
        <div className="mt-3 animate-fade-in bg-bg rounded p-3 text-xs text-text-dim space-y-1.5" onClick={(e) => e.stopPropagation()}>
          {/* Per-type detail */}
          {renderExpandedDetail(entry)}

          {/* Common metadata */}
          {entry.llmCalls > 0 && (
            <div className="pt-1 border-t border-border/30 mt-2">
              <span className="text-text-muted">{entry.llmCalls} LLM call{entry.llmCalls !== 1 ? 's' : ''}</span>
              {entry.tokensUsed > 0 && <span className="text-text-muted"> · {entry.tokensUsed.toLocaleString()} tokens</span>}
              <span className="text-text-muted"> · {formatDuration(entry.durationMs)}</span>
            </div>
          )}

          {/* Failed: error + retry */}
          {isFailed && entry.result?.error && (
            <div className="pt-1 border-t border-border/30 mt-2">
              <span className="text-red text-xs">{String(entry.result.error)}</span>
              {num(entry.result, 'retryCount') > 0 && (
                <span className="text-text-muted text-xs ml-2">
                  (attempt {num(entry.result, 'retryCount') + 1})
                </span>
              )}
            </div>
          )}

          {/* Timestamps + retry button */}
          <div className="text-text-muted flex items-center">
            {entry.startedAt && <span>{new Date(entry.startedAt).toLocaleString()}</span>}
            {entry.finishedAt && <span> → {new Date(entry.finishedAt).toLocaleTimeString()}</span>}
            <span className="ml-2 text-text-muted/50">{entry.id.slice(0, 8)}</span>
            {isFailed && entry.source === 'job' && <RetryButton entry={entry} />}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Retry button for failed jobs ---

function RetryButton({ entry }: { entry: ActivityEntryType }) {
  const [triggered, setTriggered] = useState(false);

  const handleRetry = useCallback(() => {
    if (triggered) return;
    setTriggered(true);

    // Extract original params from the job result (repoId, projectId, periodStart, etc.)
    const r = entry.result ?? {};
    const params: Record<string, string> = {};
    if (r.repoId) params.repoId = String(r.repoId);
    if (r.projectId) params.projectId = String(r.projectId);
    if (r.periodStart) params.periodStart = String(r.periodStart);

    triggerJobWithParams(entry.type, Object.keys(params).length > 0 ? params : undefined);
    setTimeout(() => setTriggered(false), 15_000);
  }, [triggered, entry]);

  return (
    <button
      onClick={handleRetry}
      disabled={triggered}
      className="ml-auto px-2 py-0.5 rounded text-[10px] bg-red/15 text-red hover:bg-red/25 border-none cursor-pointer transition-colors disabled:opacity-50"
    >
      {triggered ? 'Retrying...' : 'Retry'}
    </button>
  );
}
