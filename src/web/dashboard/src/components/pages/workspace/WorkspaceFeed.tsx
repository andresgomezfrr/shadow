import { useCallback } from 'react';
import { useApi } from '../../../hooks/useApi';
import { useDialog } from '../../../hooks/useDialog';
import {
  fetchWorkspaceFeed, executeRun, createRunSession, discardRun, retryRun, archiveRun,
  acceptSuggestion, dismissSuggestion, snoozeSuggestion,
  acknowledgeObservation, resolveObservation,
} from '../../../api/client';
import { useWorkspace } from './WorkspaceContext';
import { FeedRunCard } from './FeedRunCard';
import { FeedTaskCard } from './FeedTaskCard';
import { FeedSuggestionCard } from './FeedSuggestionCard';
import { FeedObservationCard } from './FeedObservationCard';
import { FilterTabs } from '../../common/FilterTabs';
import { Pagination } from '../../common/Pagination';
import { EmptyState } from '../../common/EmptyState';
import type { Run, Task, Suggestion, Observation } from '../../../api/types';
import { useState } from 'react';

const PAGE_SIZE = 20;

export function WorkspaceFeed() {
  const { state, setFilter, setSelectedItem, setOffset } = useWorkspace();
  const [sessionInfo, setSessionInfo] = useState<{ command: string } | null>(null);
  const { dialog, prompt } = useDialog();

  const { data, refresh } = useApi(
    () => fetchWorkspaceFeed({
      type: state.activeFilter === 'all' ? undefined : state.activeFilter,
      projectId: state.selectedProjectId ?? undefined,
      repoId: state.selectedRepoId ?? undefined,
      limit: PAGE_SIZE,
      offset: state.offset,
    }),
    [state.activeFilter, state.selectedProjectId, state.selectedRepoId, state.offset],
    15_000,
  );

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const counts = data?.counts ?? { runs: 0, runsActive: 0, runsDone: 0, runsFailed: 0, tasks: 0, tasksOpen: 0, tasksActive: 0, tasksBlocked: 0, tasksDone: 0, suggestions: 0, sugAccepted: 0, observations: 0, obsDone: 0, snoozed: 0, acknowledged: 0 };
  const allCount = counts.runs + counts.tasks + counts.suggestions + counts.observations;

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
    const note = await prompt({ title: 'Discard run', message: 'Reason for discarding (optional):', placeholder: 'Why is this being discarded?' });
    if (note === null) return;
    await discardRun(id, note || undefined);
    refresh();
  }, [prompt, refresh]);
  const handleRetry = useCallback(async (id: string) => { await retryRun(id); refresh(); }, [refresh]);
  const handleArchive = useCallback(async (id: string) => { await archiveRun(id); refresh(); }, [refresh]);

  // --- Suggestion actions ---
  const handleAccept = useCallback(async (id: string, category?: string) => { await acceptSuggestion(id, category); refresh(); }, [refresh]);
  const handleDismiss = useCallback(async (id: string) => {
    const note = await prompt({ title: 'Dismiss suggestion', message: 'Reason for dismissing (optional):', placeholder: 'Why is this being dismissed?' });
    if (note === null) return;
    await dismissSuggestion(id, note || undefined);
    refresh();
  }, [prompt, refresh]);
  const handleSnooze = useCallback(async (id: string) => { await snoozeSuggestion(id, 24); refresh(); }, [refresh]);

  // --- Observation actions ---
  const handleResolve = useCallback(async (id: string) => {
    const note = await prompt({ title: 'Resolve observation', message: 'Reason for resolving (optional):', placeholder: 'Why is this resolved?' });
    if (note === null) return;
    await resolveObservation(id, note || undefined);
    refresh();
  }, [prompt, refresh]);
  const handleAck = useCallback(async (id: string) => { await acknowledgeObservation(id); refresh(); }, [refresh]);

  // Map sub-filter values to their parent for highlight
  const parentFilter: Record<string, string> = {
    all: 'all', run: 'run', 'run-active': 'run', 'run-done': 'run', 'run-failed': 'run',
    task: 'task', 'task-open': 'task', 'task-active': 'task', 'task-blocked': 'task', 'task-done': 'task',
    suggestion: 'suggestion', snoozed: 'suggestion', 'sug-accepted': 'suggestion',
    observation: 'observation', acknowledged: 'observation', 'obs-done': 'observation',
  };
  const activeParent = parentFilter[state.activeFilter] ?? 'all';

  const filterOptions = [
    { label: `All (${allCount})`, value: 'all' },
    { label: `Runs (${counts.runs})`, value: 'run', dotColor: 'bg-green', activeClass: 'bg-green/15 text-green' },
    { label: `Tasks (${counts.tasks + counts.tasksDone})`, value: 'task', dotColor: 'bg-teal-400', activeClass: 'bg-teal-500/15 text-teal-300' },
    { label: `Suggestions (${counts.suggestions + counts.snoozed})`, value: 'suggestion', dotColor: 'bg-blue', activeClass: 'bg-blue/15 text-blue' },
    { label: `Observations (${counts.observations + counts.acknowledged})`, value: 'observation', dotColor: 'bg-orange', activeClass: 'bg-orange/15 text-orange' },
  ];

  const runSubTabs = [
    { label: `Active (${counts.runsActive})`, value: 'run-active' },
    { label: `Done (${counts.runsDone})`, value: 'run-done' },
    { label: `Failed (${counts.runsFailed})`, value: 'run-failed' },
  ];

  const taskSubTabs = [
    { label: `Open (${counts.tasksOpen})`, value: 'task-open' },
    { label: `Active (${counts.tasksActive})`, value: 'task-active' },
    { label: `Blocked (${counts.tasksBlocked})`, value: 'task-blocked' },
    { label: `Done (${counts.tasksDone})`, value: 'task-done' },
  ];

  const suggestionSubTabs = [
    { label: `Open (${counts.suggestions})`, value: 'suggestion' },
    { label: `Snoozed (${counts.snoozed})`, value: 'snoozed' },
    { label: `Accepted (${counts.sugAccepted})`, value: 'sug-accepted' },
  ];

  const observationSubTabs = [
    { label: `Open (${counts.observations})`, value: 'observation' },
    { label: `Acknowledged (${counts.acknowledged})`, value: 'acknowledged' },
    { label: `Done (${counts.obsDone})`, value: 'obs-done' },
  ];

  return (
    <div className="flex flex-col gap-2">
      {dialog}
      <FilterTabs
        options={filterOptions}
        active={activeParent}
        onChange={v => setFilter(v as typeof state.activeFilter)}
      />

      {/* Sub-tabs for runs */}
      {(activeParent === 'run') && (
        <div className="flex gap-1 ml-1">
          {runSubTabs.map(t => (
            <button
              key={t.value}
              onClick={() => setFilter(t.value as typeof state.activeFilter)}
              className={`px-2.5 py-1 rounded text-[11px] border-none cursor-pointer transition-colors ${
                state.activeFilter === t.value
                  ? 'bg-green/15 text-green font-medium'
                  : 'bg-transparent text-text-muted hover:text-text'
              }`}
            >{t.label}</button>
          ))}
        </div>
      )}

      {/* Sub-tabs for tasks */}
      {(activeParent === 'task') && (
        <div className="flex gap-1 ml-1">
          {taskSubTabs.map(t => (
            <button
              key={t.value}
              onClick={() => setFilter(t.value as typeof state.activeFilter)}
              className={`px-2.5 py-1 rounded text-[11px] border-none cursor-pointer transition-colors ${
                state.activeFilter === t.value
                  ? 'bg-teal-500/15 text-teal-300 font-medium'
                  : 'bg-transparent text-text-muted hover:text-text'
              }`}
            >{t.label}</button>
          ))}
        </div>
      )}

      {/* Sub-tabs for suggestions */}
      {(activeParent === 'suggestion') && (
        <div className="flex gap-1 ml-1">
          {suggestionSubTabs.map(t => (
            <button
              key={t.value}
              onClick={() => setFilter(t.value as typeof state.activeFilter)}
              className={`px-2.5 py-1 rounded text-[11px] border-none cursor-pointer transition-colors ${
                state.activeFilter === t.value
                  ? 'bg-blue/15 text-blue font-medium'
                  : 'bg-transparent text-text-muted hover:text-text'
              }`}
            >{t.label}</button>
          ))}
        </div>
      )}

      {/* Sub-tabs for observations */}
      {(activeParent === 'observation') && (
        <div className="flex gap-1 ml-1">
          {observationSubTabs.map(t => (
            <button
              key={t.value}
              onClick={() => setFilter(t.value as typeof state.activeFilter)}
              className={`px-2.5 py-1 rounded text-[11px] border-none cursor-pointer transition-colors ${
                state.activeFilter === t.value
                  ? 'bg-orange/15 text-orange font-medium'
                  : 'bg-transparent text-text-muted hover:text-text'
              }`}
            >{t.label}</button>
          ))}
        </div>
      )}

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
              return <FeedRunCard key={item.id} run={item.data as Run} selected={isSelected} onSelect={({ id, type }) => handleSelect(id, type)} onExecute={handleExecute} onSession={handleSession} onDiscard={handleDiscard} onRetry={handleRetry} onArchive={handleArchive} />;
            }
            if (item.source === 'task') {
              return <FeedTaskCard key={item.id} task={item.data as Task} selected={isSelected} onSelect={({ id, type }) => handleSelect(id, type)} />;
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
