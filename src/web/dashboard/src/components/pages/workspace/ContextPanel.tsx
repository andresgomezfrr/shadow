import { useEffect, useRef, useState, useCallback } from 'react';
import { useWorkspace } from './WorkspaceContext';
import { RunJourney } from './RunJourney';
import { SuggestionDetail } from './SuggestionDetail';
import { ObservationDetail } from './ObservationDetail';

type StackEntry = { id: string; type: string };

export function ContextPanel() {
  const { state, setSelectedItem, isDrillDown } = useWorkspace();
  const [stack, setStack] = useState<StackEntry[]>([]);
  const prevRef = useRef<StackEntry | null>(null);
  const isBackNav = useRef(false);

  useEffect(() => {
    const cur = state.selectedItemId && state.selectedItemType
      ? { id: state.selectedItemId, type: state.selectedItemType }
      : null;
    const prev = prevRef.current;

    if (isBackNav.current) {
      isBackNav.current = false;
    } else if (isDrillDown.current && prev && cur && prev.id !== cur.id) {
      // Drill-down from a detail panel — push previous to stack
      isDrillDown.current = false;
      setStack(s => [...s, prev]);
    } else if (cur && prev && prev.id !== cur.id) {
      // Feed click — clear stack
      isDrillDown.current = false;
      setStack([]);
    } else if (!cur) {
      setStack([]);
    }
    prevRef.current = cur;
  }, [state.selectedItemId, state.selectedItemType, isDrillDown]);

  const handleBack = useCallback(() => {
    if (stack.length === 0) return;
    const prev = stack[stack.length - 1];
    isBackNav.current = true;
    setStack(s => s.slice(0, -1));
    prevRef.current = prev;
    setSelectedItem(prev.id, prev.type);
  }, [stack, setSelectedItem]);

  const handleClose = useCallback(() => {
    setStack([]);
    prevRef.current = null;
    setSelectedItem(null);
  }, [setSelectedItem]);

  if (!state.selectedItemId || !state.selectedItemType) return null;

  const hasBack = stack.length > 0;
  const backLabel = hasBack ? stack[stack.length - 1].type : '';

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3 h-full overflow-y-auto">
      <div className="flex items-center justify-between sticky top-0 bg-card pb-2 z-10">
        <div className="flex items-center gap-2">
          {hasBack && (
            <button
              onClick={handleBack}
              className="text-xs text-accent hover:underline bg-transparent border-none cursor-pointer"
            >← {backLabel}</button>
          )}
          <span className="text-xs text-text-muted uppercase tracking-wider">
            {state.selectedItemType === 'run' ? 'Journey' : state.selectedItemType}
          </span>
        </div>
        <button
          onClick={handleClose}
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
