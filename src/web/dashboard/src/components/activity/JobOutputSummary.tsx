import type { ReactNode } from 'react';
import { Badge } from '../common/Badge';
import type { ActivityEntry } from '../../api/types';
import { num, str, arr, items } from '../../utils/job-results';

type Props = {
  entry: ActivityEntry;
};

function chip(label: string, className?: string) {
  return <Badge className={className ?? 'text-text-dim bg-border'}>{label}</Badge>;
}

export function JobOutputSummary({ entry }: Props) {
  if (entry.status === 'queued') return <span className="text-orange text-xs">queued</span>;

  const r = entry.result ?? {};
  const type = entry.type;

  if (type === 'heartbeat') {
    const obs = num(r, 'observationsCreated');
    const mem = num(r, 'memoriesCreated');
    const obsItems = items(r, 'observationItems');
    const obsTitles = obsItems.map(i => i.title);
    if (obs === 0 && mem === 0) return <span className="text-text-muted text-xs">idle — no new activity</span>;
    return (
      <span className="inline-flex items-center gap-1.5 flex-wrap">
        {obs > 0 && (
          <Badge
            className="text-blue bg-blue/15"
            title={obsTitles.length > 0 ? obsTitles.join(', ') : undefined}
            tooltipBelow
          >
            {obs} observation{obs !== 1 ? 's' : ''}
          </Badge>
        )}
        {mem > 0 && chip(`${mem} memor${mem !== 1 ? 'ies' : 'y'}`, 'text-purple bg-purple/15')}
      </span>
    );
  }

  if (type === 'suggest') {
    const count = num(r, 'suggestionsCreated');
    const sugItems = items(r, 'suggestionItems');
    const titles = sugItems.length > 0 ? sugItems.map(i => i.title) : arr(r, 'suggestionTitles');
    if (count === 0) return <span className="text-text-muted text-xs">no suggestions</span>;
    return (
      <span className="inline-flex items-center gap-1.5">
        <Badge className="text-green bg-green/15">{count} suggestion{count !== 1 ? 's' : ''}</Badge>
        {titles.length > 0 && <span className="text-xs text-text-dim truncate max-w-48">{titles[0]}</span>}
      </span>
    );
  }

  if (type === 'consolidate') {
    const promoted = num(r, 'memoriesPromoted');
    const demoted = num(r, 'memoriesDemoted');
    const merged = num(r, 'memoriesMerged');
    const deduped = num(r, 'memoriesDeduped');
    if (promoted === 0 && demoted === 0 && merged === 0 && deduped === 0) return <span className="text-text-muted text-xs">no changes</span>;
    const parts = [];
    if (promoted > 0) parts.push(`promoted ${promoted}`);
    if (demoted > 0) parts.push(`demoted ${demoted}`);
    if (merged > 0) parts.push(`merged ${merged}`);
    if (deduped > 0) parts.push(`deduped ${deduped}`);
    return chip(parts.join(', '), 'text-orange bg-orange/15');
  }

  if (type === 'reflect') {
    if (r.skipped) return <span className="text-text-muted text-xs">skipped</span>;
    if (r.soulUpdated) return chip('soul updated', 'text-blue bg-blue/15');
    if (str(r, 'reason')) return chip('rejected', 'text-red bg-red/15');
    return <span className="text-text-muted text-xs">--</span>;
  }

  if (type === 'remote-sync') {
    const synced = num(r, 'reposSynced');
    const changed = num(r, 'reposWithChanges');
    if (synced === 0) return <span className="text-text-muted text-xs">no repos</span>;
    return chip(`${synced} repo${synced !== 1 ? 's' : ''}, ${changed} with changes`, 'text-pink-400 bg-pink-400/15');
  }

  if (type === 'repo-profile') {
    const count = num(r, 'reposProfiled');
    const names = arr(r, 'repoNames');
    if (count === 0) return <span className="text-text-muted text-xs">--</span>;
    return (
      <span className="inline-flex items-center gap-1.5">
        <Badge className="text-teal-400 bg-teal-400/15">{count} repo{count !== 1 ? 's' : ''} profiled</Badge>
        {names.length > 0 && <span className="text-xs text-text-dim truncate max-w-48">{names.join(', ')}</span>}
      </span>
    );
  }

  if (type === 'context-enrich') {
    const totalItems = num(r, 'itemsCollected');
    const projectResults = r.projectResults as Array<{
      projectName: string; itemsCollected: number; sources: string[]; error?: string;
    }> | undefined;

    if (totalItems === 0 && !projectResults?.length) {
      return <span className="text-text-muted text-xs">no active projects to enrich</span>;
    }

    if (projectResults && projectResults.length > 0) {
      const errors = projectResults.filter(p => p.error);
      const withItems = projectResults.filter(p => p.itemsCollected > 0 && !p.error);
      const withoutItems = projectResults.filter(p => p.itemsCollected === 0 && !p.error);

      // Per-project breakdown: "Batuta: 4 (oliver, atlassian-mcp), Flyte: 0"
      const detailTooltip = projectResults
        .map(p => {
          if (p.error) return `${p.projectName}: error — ${p.error}`;
          if (p.itemsCollected === 0) return `${p.projectName}: no findings`;
          return `${p.projectName}: ${p.itemsCollected} finding${p.itemsCollected !== 1 ? 's' : ''}${p.sources.length > 0 ? ` (${p.sources.join(', ')})` : ''}`;
        }).join('\n');

      return (
        <span className="inline-flex items-center gap-1.5 flex-wrap">
          {withItems.map(p => (
            <Badge key={p.projectName} className="text-amber-400 bg-amber-400/15" title={p.sources.join(', ')} tooltipBelow>
              {p.projectName}: {p.itemsCollected}
            </Badge>
          ))}
          {withoutItems.length > 0 && (
            <span className="text-xs text-text-muted" title={detailTooltip}>
              {withoutItems.map(p => p.projectName).join(', ')}: no findings
            </span>
          )}
          {errors.length > 0 && (
            <Badge
              className="text-red bg-red/15"
              title={errors.map(p => `${p.projectName}: ${p.error}`).join('\n')}
              tooltipBelow
            >
              {errors.length} error{errors.length !== 1 ? 's' : ''}
            </Badge>
          )}
        </span>
      );
    }

    // Fallback: generic enrichment (no project breakdown)
    if (totalItems === 0) return <span className="text-text-muted text-xs">no findings</span>;
    const sources = arr(r, 'sources');
    return (
      <span className="inline-flex items-center gap-1.5">
        <Badge className="text-amber-400 bg-amber-400/15">{totalItems} finding{totalItems !== 1 ? 's' : ''}</Badge>
        {sources.length > 0 && <span className="text-xs text-text-dim truncate max-w-48">{sources.join(', ')}</span>}
      </span>
    );
  }

  if (type === 'mcp-discover') {
    const described = num(r, 'serversDescribed');
    const total = num(r, 'serversTotal');
    const names = arr(r, 'serverNames');
    if (described === 0 && total === 0) return <span className="text-text-muted text-xs">no servers</span>;
    if (described === 0) return <span className="text-text-muted text-xs">{total} servers up to date</span>;
    return (
      <span className="inline-flex items-center gap-1.5">
        <Badge className="text-indigo-300 bg-indigo-500/15">
          {described}/{total} described
        </Badge>
        {names.length > 0 && <span className="text-xs text-text-dim truncate max-w-48">{names.slice(0, 4).join(', ')}{names.length > 4 ? '...' : ''}</span>}
      </span>
    );
  }

  if (type.startsWith('digest-')) {
    const words = num(r, 'wordCount');
    const ps = str(r, 'periodStart');
    if (words === 0 && !ps) return <span className="text-text-muted text-xs">--</span>;

    const kind = type.replace('digest-', '');
    let periodLabel = '';
    if (ps) {
      if (kind === 'brag') {
        const year = ps.slice(0, 4);
        const q = Math.ceil(parseInt(ps.slice(5, 7)) / 3);
        periodLabel = `Q${q} ${year}`;
      } else if (kind === 'weekly') {
        const start = new Date(ps);
        const end = new Date(start); end.setDate(end.getDate() + 6);
        periodLabel = `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}–${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
      } else {
        periodLabel = new Date(ps).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      }
    }

    const label = `${kind}${periodLabel ? ` ${periodLabel}` : ''}${words > 0 ? `, ${words} words` : ''}`;
    return chip(label, 'text-cyan bg-cyan/15');
  }

  if (type === 'suggest-deep') {
    const count = num(r, 'suggestionsCreated');
    const repoName = str(r, 'repoName');
    if (count === 0) return <span className="text-text-muted text-xs">deep scan{repoName ? ` ${repoName}` : ''} — no suggestions</span>;
    return chip(`deep scan: ${count} suggestion${count !== 1 ? 's' : ''}${repoName ? ` for ${repoName}` : ''}`, 'text-green-400 bg-green-600/15');
  }

  if (type === 'suggest-project') {
    const count = num(r, 'suggestionsCreated');
    const projectName = str(r, 'projectName');
    if (count === 0) return <span className="text-text-muted text-xs">cross-repo{projectName ? ` ${projectName}` : ''} — no suggestions</span>;
    return chip(`cross-repo: ${count} suggestion${count !== 1 ? 's' : ''}${projectName ? ` for ${projectName}` : ''}`, 'text-emerald-300 bg-emerald-400/15');
  }

  if (type === 'project-profile') {
    const projectName = str(r, 'projectName');
    const repoCount = num(r, 'repoCount');
    return chip(`profiled ${projectName ?? 'project'} (${repoCount} repos)`, 'text-emerald-300 bg-emerald-400/15');
  }

  if (type === 'revalidate-suggestion') {
    const verdict = str(r, 'verdict');
    const title = str(r, 'suggestionTitle');
    const note = str(r, 'verdictNote');
    const error = str(r, 'error');
    if (!verdict && error) return <span className="text-red text-xs">{error}</span>;
    if (!verdict) return <span className="text-text-muted text-xs">--</span>;
    const verdictLabel = verdict === 'valid' ? '✓ valid' : verdict === 'partial' ? '◐ partial' : '✕ outdated';
    const verdictColor = verdict === 'valid' ? 'text-green bg-green/15' : verdict === 'partial' ? 'text-orange bg-orange/15' : 'text-red bg-red/15';
    return (
      <span className="inline-flex items-center gap-1.5 flex-wrap">
        <Badge className={verdictColor} title={note} tooltipBelow>{verdictLabel}</Badge>
        {title && <span className="text-xs text-text-dim truncate max-w-56">{title}</span>}
      </span>
    );
  }

  if (type === 'auto-plan' || type === 'auto-execute') {
    const candidates = r.candidates as Array<{ title?: string; action: string; reason?: string; runId?: string }> | undefined;
    if (!candidates || candidates.length === 0) {
      return <span className="text-text-muted text-xs">no candidates</span>;
    }

    const counts: Record<string, number> = {};
    for (const c of candidates) counts[c.action] = (counts[c.action] ?? 0) + 1;

    const STAT_STYLES: Record<string, { color: string; label: string }> = {
      skip: { color: 'text-text-muted bg-border', label: 'skipped' },
      dismissed: { color: 'text-orange bg-orange/15', label: 'dismissed' },
      planned: { color: 'text-lime-300 bg-lime-500/15', label: 'planned' },
      needs_review: { color: 'text-amber-300 bg-amber-400/15', label: 'needs review' },
      auto_executed: { color: 'text-rose-300 bg-rose-500/15', label: 'executed' },
      error: { color: 'text-red bg-red/15', label: 'error' },
    };

    // Show actionable stats first, then skips
    const order = ['planned', 'auto_executed', 'needs_review', 'dismissed', 'error', 'skip'];
    const badges = order
      .filter(action => (counts[action] ?? 0) > 0)
      .map(action => {
        const style = STAT_STYLES[action] ?? STAT_STYLES.skip;
        const n = counts[action];
        return <Badge key={action} className={style.color}>{n} {style.label}</Badge>;
      });

    return <span className="inline-flex items-center gap-1.5 flex-wrap">{badges}</span>;
  }

  if (type === 'run:execute') {
    const diffStat = str(r, 'diffStat');
    const diffSummary = diffStat ? (diffStat.split('\n').filter(l => l.trim()).pop() ?? null) : null;
    const outcome = str(r, 'outcome');
    const taskTitle = entry.taskTitle;
    const error = str(r, 'error');
    if (entry.status === 'failed' && error) {
      // Error already rendered by ActivityEntry collapsed row — return compact stats if any
      return diffSummary ? chip(diffSummary, 'text-red bg-red/15') : null;
    }
    const parts: ReactNode[] = [];
    if (diffSummary) parts.push(<Badge key="diff" className="text-cyan-300 bg-cyan-400/15">{diffSummary}</Badge>);
    if (outcome && outcome !== 'executed') parts.push(<Badge key="outcome" className="text-text-dim bg-border">{outcome}</Badge>);
    if (taskTitle) parts.push(<span key="task" className="text-xs text-text-dim truncate max-w-60">{taskTitle}</span>);
    return parts.length > 0 ? <span className="inline-flex items-center gap-1.5 flex-wrap">{parts}</span> : null;
  }

  if (type === 'pr-sync') {
    const checked = num(r, 'runsChecked');
    if (checked === 0) return <span className="text-text-muted text-xs">no awaiting runs</span>;
    const merged = num(r, 'merged');
    const closed = num(r, 'closed');
    const stillOpen = num(r, 'stillOpen');
    const errors = num(r, 'errors');
    const parts: ReactNode[] = [];
    if (merged > 0) parts.push(<Badge key="m" className="text-green bg-green/15">{merged} merged</Badge>);
    if (closed > 0) parts.push(<Badge key="c" className="text-orange bg-orange/15">{closed} closed</Badge>);
    if (stillOpen > 0) parts.push(<Badge key="o" className="text-text-dim bg-border">{stillOpen} still open</Badge>);
    if (errors > 0) parts.push(<Badge key="e" className="text-red bg-red/15">{errors} error{errors !== 1 ? 's' : ''}</Badge>);
    if (parts.length === 0) return <span className="text-text-muted text-xs">checked {checked}</span>;
    return <span className="inline-flex items-center gap-1.5 flex-wrap">{parts}</span>;
  }

  if (type === 'run:plan') {
    const doubts = arr(r, 'doubts');
    const taskTitle = entry.taskTitle;
    const parts: ReactNode[] = [];
    if (doubts.length > 0) parts.push(<Badge key="doubts" className="text-orange bg-orange/15">⚠ {doubts.length} doubt{doubts.length !== 1 ? 's' : ''}</Badge>);
    if (taskTitle) parts.push(<span key="task" className="text-xs text-text-dim truncate max-w-60">{taskTitle}</span>);
    return parts.length > 0 ? <span className="inline-flex items-center gap-1.5">{parts}</span> : null;
  }

  // Fallback: skip/idle or unknown
  return <span className="text-text-muted text-xs">--</span>;
}
