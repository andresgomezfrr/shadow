import { useApi } from '../../../hooks/useApi';
import { fetchObservationContext, resolveObservation, acknowledgeObservation, reopenObservation } from '../../../api/client';
import { Badge } from '../../common/Badge';
import { OBS_KIND_COLORS, OBS_KIND_COLOR_DEFAULT, OBS_SEVERITY_ICON, OBS_SEVERITY_ICON_COLOR } from '../../../utils/observation-colors';
import { timeAgo } from '../../../utils/format';
import { useCallback } from 'react';
import { useWorkspace } from './WorkspaceContext';

export function ObservationDetail({ observationId, onRefresh }: { observationId: string; onRefresh?: () => void }) {
  const { data: ctx, refresh } = useApi(() => fetchObservationContext(observationId), [observationId], 30_000);
  const { drillToItem } = useWorkspace();

  const doRefresh = useCallback(() => { refresh(); onRefresh?.(); }, [refresh, onRefresh]);

  const handleResolve = useCallback(async () => {
    const note = window.prompt('Reason for resolving (optional):');
    await resolveObservation(observationId, note || undefined);
    doRefresh();
  }, [observationId, doRefresh]);

  const handleAck = useCallback(async () => { await acknowledgeObservation(observationId); doRefresh(); }, [observationId, doRefresh]);
  const handleReopen = useCallback(async () => { await reopenObservation(observationId); doRefresh(); }, [observationId, doRefresh]);

  if (!ctx) return <div className="text-text-dim text-sm p-4">Loading...</div>;

  const { observation: obs, generatedSuggestions, linkedRuns } = ctx;
  const icon = OBS_SEVERITY_ICON[obs.severity] ?? '○';
  const iconColor = OBS_SEVERITY_ICON_COLOR[obs.severity] ?? 'text-text-muted';

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-sm ${iconColor}`}>{icon}</span>
        <Badge className={OBS_KIND_COLORS[obs.kind] ?? OBS_KIND_COLOR_DEFAULT}>{obs.kind}</Badge>
        <Badge className="text-text-dim bg-border">{obs.severity}</Badge>
        <Badge className="text-text-dim bg-border">{obs.status}</Badge>
      </div>
      <div className="font-medium text-sm">{obs.title}</div>

      {/* Votes + timeline */}
      <div className="text-xs text-text-muted flex items-center gap-3">
        {obs.votes > 1 && <span className="text-orange">Seen {obs.votes} times</span>}
        <span>First: {timeAgo(obs.firstSeenAt)}</span>
        <span>Last: {timeAgo(obs.lastSeenAt)}</span>
      </div>

      {/* Description */}
      {typeof obs.detail?.description === 'string' && obs.detail.description && (
        <p className="text-[13px] text-text-dim leading-relaxed m-0">{obs.detail.description}</p>
      )}

      {/* Context */}
      {obs.context && Object.keys(obs.context).length > 0 && (
        <div className="bg-bg rounded-lg p-2 text-xs space-y-1">
          {typeof obs.context.repoName === 'string' && <div><span className="text-accent">repo:</span> {obs.context.repoName}</div>}
          {typeof obs.context.branch === 'string' && <div><span className="text-accent">branch:</span> {obs.context.branch}</div>}
          {Array.isArray(obs.context.files) && (obs.context.files as string[]).length > 0 && (
            <div>
              <span className="text-accent">files:</span>
              <ul className="ml-4 list-disc mt-0.5">{(obs.context.files as string[]).slice(0, 5).map(f => <li key={f}>{f}</li>)}</ul>
            </div>
          )}
        </div>
      )}

      {/* Extra detail fields */}
      {Object.entries(obs.detail ?? {}).filter(([k]) => k !== 'description').map(([k, v]) => (
        <div key={k} className="text-xs text-text-muted">
          <span className="text-accent">{k}:</span>{' '}
          <span>{typeof v === 'string' ? v : JSON.stringify(v, null, 2)}</span>
        </div>
      ))}

      {/* Generated suggestions */}
      {generatedSuggestions.length > 0 && (
        <div className="bg-bg rounded-lg p-2 text-xs space-y-1">
          <span className="text-text-muted">Generated suggestions:</span>
          {generatedSuggestions.map(s => (
            <div key={s.id} className="flex items-center gap-2">
              <span>💡</span>
              <Badge className="text-text-dim bg-border">{s.status}</Badge>
              <span className="truncate flex-1">{s.title}</span>
              <button
                onClick={() => drillToItem(s.id, 'suggestion')}
                className="text-accent hover:underline shrink-0 bg-transparent border-none cursor-pointer text-xs"
              >View</button>
            </div>
          ))}
        </div>
      )}

      {/* Linked runs */}
      {linkedRuns.length > 0 && (
        <div className="bg-bg rounded-lg p-2 text-xs space-y-1">
          <span className="text-text-muted">Linked runs:</span>
          {linkedRuns.map(r => (
            <div key={r.id} className="flex items-center gap-2">
              <Badge className="text-text-dim bg-border">{r.status}</Badge>
              <span className="truncate flex-1">{r.prompt.slice(0, 60)}</span>
              <button
                onClick={() => drillToItem(r.id, 'run')}
                className="text-accent hover:underline shrink-0 bg-transparent border-none cursor-pointer text-xs"
              >View</button>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 border-t border-border pt-3">
        {obs.status === 'open' && (
          <>
            <button onClick={handleResolve} className="px-4 py-2 rounded-lg text-xs font-semibold bg-green text-bg border-none cursor-pointer hover:brightness-110">Resolve</button>
            <button onClick={handleAck} className="text-xs text-blue hover:underline bg-transparent border-none cursor-pointer">Acknowledge</button>
          </>
        )}
        {obs.status === 'acknowledged' && (
          <>
            <button onClick={handleResolve} className="px-4 py-2 rounded-lg text-xs font-semibold bg-green text-bg border-none cursor-pointer hover:brightness-110">Resolve</button>
            <button onClick={handleReopen} className="text-xs text-orange hover:underline bg-transparent border-none cursor-pointer">Reopen</button>
          </>
        )}
        {obs.status === 'done' && (
          <button onClick={handleReopen} className="text-xs text-text-muted hover:text-orange bg-transparent border-none cursor-pointer">Reopen</button>
        )}
      </div>
    </div>
  );
}
