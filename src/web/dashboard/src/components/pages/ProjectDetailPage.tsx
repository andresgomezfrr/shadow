import { useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useApi } from '../../hooks/useApi';
import { fetchProjectDetail, triggerJobWithParams } from '../../api/client';
import { Badge } from '../common/Badge';
import { Markdown } from '../common/Markdown';
import { ScoreBar } from '../common/ScoreBar';
import { SEVERITY_COLORS, LAYER_COLORS } from '../../api/types';
import { timeAgo } from '../../utils/format';

const KIND_COLORS: Record<string, string> = {
  'long-term': 'text-blue bg-blue/15',
  sprint: 'text-orange bg-orange/15',
  task: 'text-green bg-green/15',
};

const SUG_KIND_COLORS: Record<string, string> = {
  refactor: 'text-purple bg-purple/15',
  bug: 'text-red bg-red/15',
  improvement: 'text-blue bg-blue/15',
  feature: 'text-green bg-green/15',
};

const STATUS_COLORS: Record<string, string> = {
  active: 'text-green bg-green/15',
  completed: 'text-text-dim bg-text-dim/15',
  'on-hold': 'text-orange bg-orange/15',
  archived: 'text-text-dim bg-text-dim/10',
};

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, refresh } = useApi(() => fetchProjectDetail(id!), [id], 30_000);
  const [analyzeTriggered, setAnalyzeTriggered] = useState(false);
  const [profileTriggered, setProfileTriggered] = useState(false);

  const handleAnalyze = useCallback(() => {
    if (analyzeTriggered || !id) return;
    setAnalyzeTriggered(true);
    triggerJobWithParams('suggest-project', { projectId: id });
    setTimeout(() => setAnalyzeTriggered(false), 15_000);
  }, [analyzeTriggered, id]);

  const handleProfile = useCallback(() => {
    if (profileTriggered || !id) return;
    setProfileTriggered(true);
    triggerJobWithParams('project-profile', { projectId: id });
    setTimeout(() => { setProfileTriggered(false); refresh(); }, 15_000);
  }, [profileTriggered, id, refresh]);

  if (!data) return <div className="text-text-dim">Loading...</div>;
  if ('error' in data) return <div className="text-red">Project not found</div>;

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link to="/projects" className="text-text-dim text-xs hover:text-accent mb-2 inline-block">&larr; Projects</Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{data.name}</h1>
          <Badge className={KIND_COLORS[data.kind] ?? 'text-text-dim bg-text-dim/15'}>{data.kind}</Badge>
          <Badge className={STATUS_COLORS[data.status] ?? 'text-text-dim bg-text-dim/15'}>{data.status}</Badge>
          <div className="ml-auto flex gap-2">
            <button
              onClick={handleProfile}
              disabled={profileTriggered}
              className="px-3 py-1.5 rounded text-xs bg-emerald-400/15 text-emerald-300 hover:bg-emerald-400/25 border-none cursor-pointer transition-colors disabled:opacity-50"
            >
              {profileTriggered ? 'Triggered' : data.contextMd ? 'Re-profile' : 'Profile'}
            </button>
            <button
              onClick={handleAnalyze}
              disabled={analyzeTriggered}
              className="px-3 py-1.5 rounded text-xs bg-emerald-400/15 text-emerald-300 hover:bg-emerald-400/25 border-none cursor-pointer transition-colors disabled:opacity-50"
            >
              {analyzeTriggered ? 'Triggered' : 'Analyze cross-repo'}
            </button>
          </div>
        </div>
        {data.description && <p className="text-text-dim mt-1">{data.description}</p>}
      </div>

      {/* Counts */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-card border border-border rounded-lg p-3 text-center">
          <div className="text-2xl font-bold">{data.counts.observations}</div>
          <div className="text-xs text-text-dim">Observations</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-3 text-center">
          <div className="text-2xl font-bold">{data.counts.suggestions}</div>
          <div className="text-xs text-text-dim">Suggestions</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-3 text-center">
          <div className="text-2xl font-bold">{data.counts.memories}</div>
          <div className="text-xs text-text-dim">Memories</div>
        </div>
      </div>

      {/* Entity chips */}
      <div className="flex flex-wrap gap-4 mb-6">
        {data.repos.length > 0 && (
          <div>
            <span className="text-xs text-text-dim mr-2">Repos:</span>
            {data.repos.map((r) => (
              <Badge key={r.id} className="text-blue bg-blue/10 mr-1">{r.name}</Badge>
            ))}
          </div>
        )}
        {data.systems.length > 0 && (
          <div>
            <span className="text-xs text-text-dim mr-2">Systems:</span>
            {data.systems.map((s) => (
              <Link key={s.id} to={`/systems/${s.id}`}>
                <Badge className="text-purple bg-purple/10 mr-1 hover:bg-purple/20 cursor-pointer">{s.name}</Badge>
              </Link>
            ))}
          </div>
        )}
        {data.contacts.length > 0 && (
          <div>
            <span className="text-xs text-text-dim mr-2">Team:</span>
            {data.contacts.map((c) => (
              <Badge key={c.id} className="text-green bg-green/10 mr-1">
                {c.name}{c.role ? ` (${c.role})` : ''}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Project Profile — structured */}
      {data.contextMd && (() => {
        const extractField = (md: string, field: string): string | null => {
          const match = md.match(new RegExp(`\\*\\*${field}\\*\\*:\\s*(.+?)(?:\\n|$)`));
          return match ? match[1].trim() : null;
        };
        const ctx = data.contextMd!;
        const summary = extractField(ctx, 'Summary');
        const architecture = extractField(ctx, 'Architecture');
        const patterns = extractField(ctx, 'Cross-repo patterns');
        const integration = extractField(ctx, 'Integration points');
        const tensions = extractField(ctx, 'Active tensions');
        const valuable = extractField(ctx, 'Valuable cross-repo suggestions');
        const hasFields = summary || architecture || patterns;

        if (!hasFields) {
          return (
            <div className="bg-card border border-border rounded-lg p-5 mb-6">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-text-muted uppercase tracking-wide">Project Profile</span>
                {data.contextUpdatedAt && <span className="text-xs text-text-muted">Profiled {timeAgo(data.contextUpdatedAt)}</span>}
              </div>
              <Markdown>{ctx}</Markdown>
            </div>
          );
        }

        return (
          <div className="mb-6 space-y-3">
            {/* Summary */}
            {summary && (
              <div className="bg-card border border-border rounded-lg px-5 py-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-text-muted uppercase tracking-wide">Project Profile</span>
                  {data.contextUpdatedAt && <span className="text-xs text-text-muted">Profiled {timeAgo(data.contextUpdatedAt)}</span>}
                </div>
                <p className="text-sm text-text-dim">{summary}</p>
              </div>
            )}

            {/* Architecture + Patterns */}
            {(architecture || patterns || integration) && (
              <div className="bg-card border border-border rounded-lg p-4 space-y-2">
                <div className="text-[10px] text-text-muted uppercase tracking-wide mb-1">Architecture & Patterns</div>
                {architecture && (
                  <div className="text-xs"><span className="text-text-muted">Architecture:</span> <span className="text-text-dim">{architecture}</span></div>
                )}
                {patterns && (
                  <div className="text-xs"><span className="text-text-muted">Cross-repo patterns:</span> <span className="text-text-dim">{patterns}</span></div>
                )}
                {integration && (
                  <div className="text-xs"><span className="text-text-muted">Integration points:</span> <span className="text-text-dim">{integration}</span></div>
                )}
              </div>
            )}

            {/* Tensions + Suggestions */}
            {(tensions || valuable) && (
              <div className="bg-card border border-border rounded-lg p-4 space-y-2">
                <div className="text-[10px] text-text-muted uppercase tracking-wide mb-1">Insights</div>
                {tensions && (
                  <div className="text-xs">
                    <span className="text-orange">⚠ Tensions:</span>{' '}
                    <span className="text-text-dim">{tensions}</span>
                  </div>
                )}
                {valuable && (() => {
                  // Split numbered items like "(1) foo (2) bar" into a list
                  const items = valuable.split(/\(\d+\)\s*/).filter(Boolean);
                  if (items.length > 1) {
                    return (
                      <div className="text-xs">
                        <span className="text-green">✓ Opportunities:</span>
                        <ul className="ml-3 mt-1 space-y-1">
                          {items.map((item, i) => <li key={i} className="text-text-dim">- {item.replace(/\.\s*$/, '')}</li>)}
                        </ul>
                      </div>
                    );
                  }
                  return (
                    <div className="text-xs">
                      <span className="text-green">✓ Opportunities:</span>{' '}
                      <span className="text-text-dim">{valuable}</span>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        );
      })()}

      {/* 2-col grid: Observations + Suggestions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Observations */}
        <div>
          <h2 className="text-lg font-medium mb-3">Observations ({data.counts.observations})</h2>
          {data.observations.length === 0 ? (
            <div className="text-text-dim text-sm">No active observations</div>
          ) : (
            <div className="space-y-2">
              {data.observations.map((o) => (
                <Link key={o.id} to={`/observations?highlight=${o.id}`} className="bg-card border border-border rounded p-3 block hover:border-accent/50 transition-colors no-underline">
                  <div className="flex items-center gap-2">
                    <Badge className={SEVERITY_COLORS[o.severity] ?? ''}>{o.severity}</Badge>
                    <Badge className="text-text-dim bg-text-dim/10">{o.kind}</Badge>
                    {o.votes > 1 && <span className="text-xs text-text-dim">{o.votes}x</span>}
                  </div>
                  <div className="text-sm mt-1 text-text">{o.title}</div>
                </Link>
              ))}
              {data.counts.observations > data.observations.length && (
                <Link to={`/observations`} className="text-xs text-accent hover:underline">View all &rarr;</Link>
              )}
            </div>
          )}
        </div>

        {/* Suggestions */}
        <div>
          <h2 className="text-lg font-medium mb-3">Suggestions ({data.counts.suggestions})</h2>
          {data.suggestions.length === 0 ? (
            <div className="text-text-dim text-sm">No pending suggestions</div>
          ) : (
            <div className="space-y-2">
              {data.suggestions.map((s) => (
                <Link key={s.id} to={`/suggestions?highlight=${s.id}`} className="bg-card border border-border rounded p-3 block hover:border-accent/50 transition-colors no-underline">
                  <div className="flex items-center gap-2">
                    <Badge className={SUG_KIND_COLORS[s.kind] ?? 'text-text-dim bg-text-dim/10'}>{s.kind}</Badge>
                    <ScoreBar impact={s.impactScore} confidence={s.confidenceScore} risk={s.riskScore} compact />
                  </div>
                  <div className="text-sm mt-1 text-text">{s.title}</div>
                </Link>
              ))}
              {data.counts.suggestions > data.suggestions.length && (
                <Link to={`/suggestions`} className="text-xs text-accent hover:underline">View all &rarr;</Link>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Memories */}
      <div className="mb-6">
        <h2 className="text-lg font-medium mb-3">Memories ({data.counts.memories})</h2>
        {data.memories.length === 0 ? (
          <div className="text-text-dim text-sm">No linked memories</div>
        ) : (
          <div className="space-y-2">
            {data.memories.map((m) => (
              <Link key={m.id} to={`/memories?highlight=${m.id}`} className="bg-card border border-border rounded p-3 flex items-center gap-2 hover:border-accent/50 transition-colors no-underline">
                <Badge className={LAYER_COLORS[m.layer] ?? ''}>{m.layer}</Badge>
                <Badge className="text-text-dim bg-text-dim/10">{m.kind}</Badge>
                <span className="text-sm text-text">{m.title}</span>
                <span className="text-xs text-text-dim ml-auto">{new Date(m.createdAt).toLocaleDateString()}</span>
              </Link>
            ))}
            {data.counts.memories > data.memories.length && (
              <Link to={`/memories`} className="text-xs text-accent hover:underline">View all &rarr;</Link>
            )}
          </div>
        )}
      </div>

      {/* Enrichment */}
      {data.enrichment.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-medium mb-3">External Context</h2>
          <div className="space-y-2">
            {data.enrichment.map((e) => (
              <div key={e.id} className="bg-card border border-border rounded p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Badge className="text-cyan bg-cyan/15">{e.source}</Badge>
                  <span className="text-xs text-text-dim">{new Date(e.createdAt).toLocaleString()}</span>
                </div>
                <div className="text-sm">{e.summary}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dates */}
      <div className="flex gap-4 text-xs text-text-dim border-t border-border pt-3">
        {data.startDate && <span>Start: {new Date(data.startDate).toLocaleDateString()}</span>}
        {data.endDate && <span>End: {new Date(data.endDate).toLocaleDateString()}</span>}
        <span>Created: {new Date(data.createdAt).toLocaleDateString()}</span>
      </div>
    </div>
  );
}
