import { Badge } from '../common/Badge';
import type { ActivityEntry } from '../../api/types';

type Props = {
  entry: ActivityEntry;
};

function chip(label: string, className?: string) {
  return <Badge className={className ?? 'text-text-dim bg-border'}>{label}</Badge>;
}

function num(result: Record<string, unknown>, key: string): number {
  const v = result[key];
  return typeof v === 'number' ? v : 0;
}

function str(result: Record<string, unknown>, key: string): string | undefined {
  const v = result[key];
  return typeof v === 'string' ? v : undefined;
}

function arr(result: Record<string, unknown>, key: string): string[] {
  const v = result[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function items(result: Record<string, unknown>, key: string): Array<{ id: string; title: string }> {
  const v = result[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is { id: string; title: string } =>
    typeof x === 'object' && x !== null && typeof (x as Record<string, unknown>).id === 'string' && typeof (x as Record<string, unknown>).title === 'string'
  );
}

export function JobOutputSummary({ entry }: Props) {
  if (entry.status === 'queued') return <span className="text-orange text-xs">queued</span>;

  const r = entry.result ?? {};
  const type = entry.type;

  if (type === 'heartbeat') {
    const obs = num(r, 'observationsCreated');
    const mem = num(r, 'memoriesCreated');
    const obsItems = items(r, 'observationItems');
    const obsTitles = obsItems.length > 0 ? obsItems.map(i => i.title) : arr(r, 'observationTitles');
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
    const items = num(r, 'itemsCollected');
    const sources = arr(r, 'sources');
    if (items === 0) return <span className="text-text-muted text-xs">no MCP servers to query</span>;
    return (
      <span className="inline-flex items-center gap-1.5">
        <Badge className="text-amber-400 bg-amber-400/15">{items} item{items !== 1 ? 's' : ''}</Badge>
        {sources.length > 0 && <span className="text-xs text-text-dim truncate max-w-48">{sources.join(', ')}</span>}
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

  if (type === 'run:plan' || type === 'run:execution') {
    return (
      <span className="inline-flex items-center gap-1.5">
        {entry.repoName && chip(entry.repoName, 'text-text-dim bg-border')}
        {entry.confidence && (
          <Badge className={
            entry.confidence === 'high' ? 'text-green bg-green/15' :
            entry.confidence === 'medium' ? 'text-orange bg-orange/15' :
            'text-red bg-red/15'
          }>
            {entry.confidence}
          </Badge>
        )}
      </span>
    );
  }

  // Fallback: skip/idle or unknown
  return <span className="text-text-muted text-xs">--</span>;
}
