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
      return <span className="text-text-muted text-xs">no suggestions to evaluate</span>;
    }

    const ACTION_STYLES: Record<string, { color: string; label: string }> = {
      skip: { color: 'text-text-muted', label: 'skip' },
      dismissed: { color: 'text-orange', label: 'dismissed' },
      planned: { color: 'text-lime-300', label: 'planned' },
      needs_review: { color: 'text-amber-300', label: 'needs review' },
      auto_executed: { color: 'text-rose-300', label: 'executed' },
      error: { color: 'text-red', label: 'error' },
    };

    return (
      <div className="space-y-0.5">
        {candidates.map((c, i) => {
          const style = ACTION_STYLES[c.action] ?? ACTION_STYLES.skip;
          const title = c.title ?? c.runId?.slice(0, 8) ?? '?';
          const isRunLink = (c.action === 'planned' || c.action === 'auto_executed') && c.reason;
          return (
            <div key={i} className="flex items-center gap-1.5 text-xs">
              <span className={`font-medium ${style.color}`}>{style.label}</span>
              <span className="text-text-dim truncate max-w-64">{title}</span>
              {isRunLink ? (
                <a href={`/workspace?filter=run&item=${c.reason}&itemType=run`} className="text-accent text-[10px] hover:underline">→ run {c.reason!.slice(0, 8)}</a>
              ) : (
                c.reason && <span className="text-text-muted/70 text-[10px]">— {c.reason}</span>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  if (type === 'run:plan' || type === 'run:execute') {
    return null; // repoName + confidence already shown by ActivityEntry
  }

  // Fallback: skip/idle or unknown
  return <span className="text-text-muted text-xs">--</span>;
}
