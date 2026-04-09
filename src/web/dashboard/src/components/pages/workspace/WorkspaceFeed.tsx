import { useCallback } from 'react';
import { useApi } from '../../../hooks/useApi';
import {
  fetchWorkspaceFeed, executeRun, createRunSession, discardRun,
  acceptSuggestion, dismissSuggestion, snoozeSuggestion,
  acknowledgeObservation, resolveObservation,
} from '../../../api/client';
import { useWorkspace } from './WorkspaceContext';
import { FeedRunCard } from './FeedRunCard';
import { FeedSuggestionCard } from './FeedSuggestionCard';
import { FeedObservationCard } from './FeedObservationCard';
import { FilterTabs } from '../../common/FilterTabs';
import { Pagination } from '../../common/Pagination';
import { EmptyState } from '../../common/EmptyState';
import type { Run, Suggestion, Observation } from '../../../api/types';
import { useState } from 'react';

const PAGE_SIZE = 20;

export function WorkspaceFeed() {
  const { state, setFilter, setSelectedItem, setOffset } = useWorkspace();
  const [sessionInfo, setSessionInfo] = useState<{ command: string } | null>(null);

  const { data, refresh } = useApi(
    () => fetchWorkspaceFeed({
      type: state.activeFilter === 'all' ? undefined : state.activeFilter,
      projectId: state.selectedProjectId ?? undefined,
      limit: PAGE_SIZE,
      offset: state.offset,
    }),
    [state.activeFilter, state.selectedProjectId, state.offset],
    15_000,
  );

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const counts = data?.counts ?? { runs: 0, suggestions: 0, observations: 0 };
  const allCount = counts.runs + counts.suggestions + counts.observations;

  const handleSelect = useCallback((id: string, type: string) => {
    setSelectedItem(state.selectedItemId === id ? null : id, type);
  }, [setSelectedItem, state.selectedItemId]);

  // --- Run actions ---
  const handleExecute = useCallback(async (id: string) => { await executeRun(id); refresh(); }, [refresh]);
  const handleSession = useCallback(async (id: string) => {
    const result = await createRunSession(id);
    if (result) setSessionInfo({ command: result.command });
    refresh();
  }, [refresh]);
  const handleDiscard = useCallback(async (id: string) => {
    const note = window.prompt('Reason for discarding (optional):');
    await discardRun(id, note || undefined);
    refresh();
  }, [refresh]);

  // --- Suggestion actions ---
  const handleAccept = useCallback(async (id: string) => { await acceptSuggestion(id); refresh(); }, [refresh]);
  const handleDismiss = useCallback(async (id: string) => {
    const note = window.prompt('Reason for dismissing (optional):');
    await dismissSuggestion(id, note || undefined);
    refresh();
  }, [refresh]);
  const handleSnooze = useCallback(async (id: string) => { await snoozeSuggestion(id, 24); refresh(); }, [refresh]);

  // --- Observation actions ---
  const handleResolve = useCallback(async (id: string) => {
    const note = window.prompt('Reason for resolving (optional):');
    await resolveObservation(id, note || undefined);
    refresh();
  }, [refresh]);
  const handleAck = useCallback(async (id: string) => { await acknowledgeObservation(id); refresh(); }, [refresh]);

  const filterOptions = [
    { label: `All (${allCount})`, value: 'all' },
    { label: `Runs (${counts.runs})`, value: 'run', dotColor: 'bg-green', activeClass: 'bg-green/15 text-green' },
    { label: `Suggestions (${counts.suggestions})`, value: 'suggestion', dotColor: 'bg-blue', activeClass: 'bg-blue/15 text-blue' },
    { label: `Observations (${counts.observations})`, value: 'observation', dotColor: 'bg-orange', activeClass: 'bg-orange/15 text-orange' },
  ];

  return (
    <div className="flex flex-col gap-2">
      <FilterTabs
        options={filterOptions}
        active={state.activeFilter}
        onChange={v => setFilter(v as typeof state.activeFilter)}
      />

      {sessionInfo && (
        <div className="p-3 rounded-lg bg-accent-soft border border-accent/30 text-sm space-y-1">
          <div className="font-medium text-accent">Session ready</div>
          <code className="block bg-bg rounded p-2 text-xs font-mono select-all">{sessionInfo.command}</code>
          <button onClick={() => setSessionInfo(null)} className="text-xs text-text-muted hover:text-text bg-transparent border-none cursor-pointer">dismiss</button>
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState
          title="All caught up"
          description="No items pending your attention"
        />
      ) : (
        <div className="flex flex-col gap-1.5">
          {items.map(item => {
            const isSelected = state.selectedItemId === item.id;
            if (item.source === 'run') {
              return <FeedRunCard key={item.id} run={item.data as Run} selected={isSelected} onSelect={({ id, type }) => handleSelect(id, type)} onExecute={handleExecute} onSession={handleSession} onDiscard={handleDiscard} />;
            }
            if (item.source === 'suggestion') {
              return <FeedSuggestionCard key={item.id} suggestion={item.data as Suggestion} selected={isSelected} onSelect={({ id, type }) => handleSelect(id, type)} onAccept={handleAccept} onDismiss={handleDismiss} onSnooze={handleSnooze} />;
            }
            if (item.source === 'observation') {
              return <FeedObservationCard key={item.id} observation={item.data as Observation} selected={isSelected} onSelect={({ id, type }) => handleSelect(id, type)} onResolve={handleResolve} onAck={handleAck} />;
            }
            return null;
          })}
        </div>
      )}

      <Pagination total={total} offset={state.offset} limit={PAGE_SIZE} onChange={setOffset} />
    </div>
  );
}
