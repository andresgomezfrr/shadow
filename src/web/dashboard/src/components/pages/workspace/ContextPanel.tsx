import { useWorkspace } from './WorkspaceContext';
import { RunJourney } from './RunJourney';
import { SuggestionDetail } from './SuggestionDetail';
import { ObservationDetail } from './ObservationDetail';

export function ContextPanel() {
  const { state, setSelectedItem } = useWorkspace();

  if (!state.selectedItemId || !state.selectedItemType) return null;

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3 h-full overflow-y-auto">
      <div className="flex items-center justify-between sticky top-0 bg-card pb-2 z-10">
        <span className="text-xs text-text-muted uppercase tracking-wider">
          {state.selectedItemType === 'run' ? 'Journey' : state.selectedItemType}
        </span>
        <button
          onClick={() => setSelectedItem(null)}
          className="text-xs text-text-muted hover:text-text bg-transparent border-none cursor-pointer"
        >✕ close</button>
      </div>

      {state.selectedItemType === 'run' && (
        <RunJourney runId={state.selectedItemId} />
      )}
      {state.selectedItemType === 'suggestion' && (
        <SuggestionDetail suggestionId={state.selectedItemId} />
      )}
      {state.selectedItemType === 'observation' && (
        <ObservationDetail observationId={state.selectedItemId} />
      )}
    </div>
  );
}
