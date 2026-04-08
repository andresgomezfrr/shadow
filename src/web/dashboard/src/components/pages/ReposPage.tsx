import { useState, useCallback } from 'react';
import { timeAgo } from '../../utils/format';
import { useApi } from '../../hooks/useApi';
import { useRunningJobs } from '../../hooks/useRunningJobs';
import { fetchRepos, triggerJobWithParams } from '../../api/client';
import { Badge } from '../common/Badge';
import { Markdown } from '../common/Markdown';
import { EmptyState } from '../common/EmptyState';
import { CorrectionPanel } from '../common/CorrectionPanel';
import type { Repo } from '../../api/types';

// --- helpers ---

function extractField(md: string, field: string): string | null {
  const match = md.match(new RegExp(`\\*\\*${field}\\*\\*:\\s*(.+?)(?:\\n|$)`));
  return match ? match[1].trim() : null;
}

function shortenUrl(url: string): string {
  return url
    .replace(/^(git@|https?:\/\/)/, '')
    .replace(/\.git$/, '')
    .replace(/^github\.com:/, 'github.com/');
}

const PHASE_COLORS: Record<string, string> = {
  'active-development': 'text-green bg-green/15',
  'active development': 'text-green bg-green/15',
  stabilizing: 'text-blue bg-blue/15',
  maintenance: 'text-orange bg-orange/15',
  prototype: 'text-purple bg-purple/15',
  legacy: 'text-text-muted bg-text-muted/10',
};

function phaseColor(phase: string): string {
  const lower = phase.toLowerCase().replace(/\s*—.*$/, '').trim();
  return PHASE_COLORS[lower] ?? 'text-text-dim bg-border';
}

function hasStructuredFields(md: string): boolean {
  return md.includes('**Type**:') || md.includes('**Stack**:');
}

// --- Structured profile component ---

function RepoProfile({ contextMd }: { contextMd: string }) {
  if (!hasStructuredFields(contextMd)) {
    return <div className="bg-bg rounded-lg p-4 border border-border/50"><Markdown>{contextMd}</Markdown></div>;
  }

  const type = extractField(contextMd, 'Type');
  const stack = extractField(contextMd, 'Stack');
  const phase = extractField(contextMd, 'Phase');
  const team = extractField(contextMd, 'Team');
  const cicd = extractField(contextMd, 'CI/CD');
  const activeAreas = extractField(contextMd, 'Active areas');
  const valuable = extractField(contextMd, 'Valuable suggestions');
  const avoid = extractField(contextMd, 'Avoid suggesting');
  const openPrs = extractField(contextMd, 'Open PRs');

  const overviewRows = [
    { label: 'Type', value: type },
    { label: 'Stack', value: stack },
    { label: 'Phase', value: phase, badge: true },
    { label: 'Team', value: team },
    { label: 'CI/CD', value: cicd },
  ].filter(r => r.value);

  return (
    <div className="space-y-3 animate-fade-in">
      {/* Overview grid */}
      {overviewRows.length > 0 && (
        <div className="bg-bg rounded-lg p-3 border border-border/50">
          <div className="text-[10px] text-text-muted uppercase tracking-wide mb-2">Overview</div>
          <div className="space-y-1.5">
            {overviewRows.map(row => (
              <div key={row.label} className="flex gap-3 text-xs">
                <span className="text-text-muted w-12 shrink-0">{row.label}</span>
                {row.badge && row.value ? (
                  <Badge className={phaseColor(row.value)}>{row.value}</Badge>
                ) : (
                  <span className="text-text-dim">{row.value}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active areas */}
      {activeAreas && (
        <div className="bg-bg rounded-lg p-3 border border-border/50">
          <div className="text-[10px] text-text-muted uppercase tracking-wide mb-1.5">Active Areas</div>
          <div className="text-xs text-text-dim">{activeAreas}</div>
        </div>
      )}

      {/* Suggestion guidance */}
      {(valuable || avoid) && (
        <div className="bg-bg rounded-lg p-3 border border-border/50">
          <div className="text-[10px] text-text-muted uppercase tracking-wide mb-1.5">Suggestion Guidance</div>
          {valuable && (
            <div className="text-xs mb-1.5">
              <span className="text-green">✓ Valuable:</span>{' '}
              <span className="text-text-dim">{valuable}</span>
            </div>
          )}
          {avoid && (
            <div className="text-xs">
              <span className="text-red">✗ Avoid:</span>{' '}
              <span className="text-text-dim">{avoid}</span>
            </div>
          )}
        </div>
      )}

      {/* Open PRs */}
      {openPrs && openPrs !== 'N/A' && (
        <div className="text-xs text-text-dim">
          <span className="text-text-muted">Open PRs:</span> {openPrs}
        </div>
      )}
    </div>
  );
}

// --- card ---

function RepoCard({
  repo,
  expanded,
  onToggle,
  isRunning,
}: {
  repo: Repo;
  expanded: boolean;
  onToggle: () => void;
  isRunning: (type: string) => boolean;
}) {
  const [showCorrection, setShowCorrection] = useState(false);

  const languageHint = repo.languageHint;
  const phase = repo.contextMd ? extractField(repo.contextMd, 'Phase') : null;
  const summary = repo.contextMd ? extractField(repo.contextMd, 'Summary') : null;

  const handleReprofile = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      triggerJobWithParams('repo-profile', { repoId: repo.id });
    },
    [repo.id],
  );

  const handleDeepScan = useCallback(
    (e?: React.MouseEvent) => {
      e?.stopPropagation();
      triggerJobWithParams('suggest-deep', { repoId: repo.id });
    },
    [repo.id],
  );

  return (
    <div
      className="bg-card border border-border rounded-lg px-5 py-4 cursor-pointer hover:border-accent transition-colors"
      onClick={onToggle}
    >
      {/* Row 1: name + badges */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-sm">{repo.name}</span>
        {languageHint && (
          <Badge className="text-blue bg-blue/15">{languageHint}</Badge>
        )}
        {phase && <Badge className={phaseColor(phase)}>{phase}</Badge>}
      </div>

      {/* Row 2: summary */}
      {summary && (
        <div className="text-xs text-text-dim mt-1.5 line-clamp-2">
          {summary}
        </div>
      )}

      {/* Row 3: metadata */}
      <div className="text-xs text-text-muted mt-2 flex items-center gap-2">
        <span>{repo.defaultBranch}</span>
        {repo.remoteUrl && <span>·</span>}
        {repo.remoteUrl && <span>{shortenUrl(repo.remoteUrl)}</span>}
        {repo.lastObservedAt && (
          <span>· observed {timeAgo(repo.lastObservedAt)}</span>
        )}
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="mt-4 space-y-3" onClick={e => e.stopPropagation()}>
          {/* Structured profile or not-profiled state */}
          {repo.contextMd ? (
            <RepoProfile contextMd={repo.contextMd} />
          ) : (
            <div className="bg-bg rounded-lg p-4 border border-border/50 text-text-muted text-sm">
              Not profiled yet. Click "Profile now" to generate.
            </div>
          )}

          {/* Commands */}
          {(repo.testCommand || repo.lintCommand || repo.buildCommand) && (
            <div className="text-xs text-text-dim flex items-center gap-3 flex-wrap">
              <span className="text-text-muted">Commands:</span>
              {repo.testCommand && (
                <span className="font-mono bg-bg px-1.5 py-0.5 rounded">
                  <span className="text-accent">test</span> {repo.testCommand}
                </span>
              )}
              {repo.lintCommand && (
                <span className="font-mono bg-bg px-1.5 py-0.5 rounded">
                  <span className="text-accent">lint</span> {repo.lintCommand}
                </span>
              )}
              {repo.buildCommand && (
                <span className="font-mono bg-bg px-1.5 py-0.5 rounded">
                  <span className="text-accent">build</span> {repo.buildCommand}
                </span>
              )}
            </div>
          )}

          {/* Footer with dates + re-profile button */}
          <div className="flex items-center gap-3 text-xs text-text-muted pt-1">
            {repo.contextUpdatedAt && (
              <span>Profiled {timeAgo(repo.contextUpdatedAt)}</span>
            )}
            {repo.lastFetchedAt && (
              <span>· Synced {timeAgo(repo.lastFetchedAt)}</span>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); setShowCorrection(true); }}
              className="px-3 py-1 rounded bg-orange-400/15 text-orange-300 hover:bg-orange-400/25 border-none cursor-pointer transition-colors text-xs"
            >
              Correct
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleDeepScan(e); }}
              disabled={isRunning('suggest-deep')}
              className="px-3 py-1 rounded bg-green-600/15 text-green-400 hover:bg-green-600/25 border-none cursor-pointer transition-colors disabled:opacity-50 text-xs"
            >
              {isRunning('suggest-deep') ? 'Running...' : 'Deep Scan'}
            </button>
            <button
              onClick={handleReprofile}
              disabled={isRunning('repo-profile')}
              className="ml-auto px-3 py-1 rounded bg-teal-400/15 text-teal-300 hover:bg-teal-400/25 border-none cursor-pointer transition-colors disabled:opacity-50 text-xs"
            >
              {isRunning('repo-profile')
                ? 'Running...'
                : repo.contextMd
                  ? 'Re-profile'
                  : 'Profile now'}
            </button>
          </div>
        </div>
      )}
      <CorrectionPanel
        open={showCorrection}
        onClose={() => setShowCorrection(false)}
        defaultScope="repo"
        defaultEntityType="repo"
        defaultEntityId={repo.id}
        defaultEntityName={repo.name}
      />
    </div>
  );
}

// --- page ---

export function ReposPage() {
  const { data } = useApi(fetchRepos, [], 30_000);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { isRunning } = useRunningJobs();

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <img src="/ghost/repos.png" alt="" className="w-[80px] h-[80px] rounded-full object-cover" />
        <h1 className="text-xl font-semibold">Repos</h1>
      </div>

      {!data ? (
        <div className="text-text-dim">Loading...</div>
      ) : data.length === 0 ? (
        <EmptyState
          title="No repos registered"
          description="Use: shadow repo add <path>"
        />
      ) : (
        <div className="flex flex-col gap-3">
          {data.map((r) => (
            <RepoCard
              key={r.id}
              repo={r}
              expanded={expanded.has(r.id)}
              onToggle={() => toggle(r.id)}
              isRunning={isRunning}
            />
          ))}
        </div>
      )}
    </div>
  );
}
