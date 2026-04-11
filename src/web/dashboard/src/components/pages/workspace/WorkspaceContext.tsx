import { createContext, useContext, useCallback, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Run, Suggestion, Observation, Task } from '../../../api/types';

export type SelectedItem = {
  id: string;
  type: 'run' | 'suggestion' | 'observation' | 'task';
  data: Run | Suggestion | Observation | Task;
};

export type ActiveFilter = 'all' | 'run' | 'run-active' | 'run-done' | 'run-failed' | 'task' | 'task-open' | 'task-active' | 'task-blocked' | 'task-done' | 'suggestion' | 'snoozed' | 'sug-accepted' | 'observation' | 'acknowledged' | 'obs-done';

type WorkspaceState = {
  selectedProjectId: string | null;
  activeFilter: ActiveFilter;
  selectedItemId: string | null;
  selectedItemType: string | null;
  offset: number;
};

type WorkspaceContextType = {
  state: WorkspaceState;
  setProject: (id: string | null) => void;
  setFilter: (f: ActiveFilter) => void;
  setSelectedItem: (id: string | null, type?: string) => void;
  drillToItem: (id: string, type: string) => void;
  setOffset: (n: number) => void;
  isDrillDown: React.RefObject<boolean>;
  expandedPlan: string | null;
  setExpandedPlan: (content: string | null) => void;
};

const WorkspaceCtx = createContext<WorkspaceContextType | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [params, setParams] = useSearchParams();

  const state: WorkspaceState = {
    selectedProjectId: params.get('project') || null,
    activeFilter: (params.get('filter') as ActiveFilter) || 'all',
    selectedItemId: params.get('item') || null,
    selectedItemType: params.get('itemType') || null,
    offset: Number(params.get('offset')) || 0,
  };

  const update = useCallback((updates: Record<string, string | null>) => {
    setParams(prev => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(updates)) {
        if (v === null || v === '' || v === '0') next.delete(k);
        else next.set(k, v);
      }
      return next;
    }, { replace: true });
  }, [setParams]);

  const setProject = useCallback((id: string | null) => {
    update({ project: id, offset: null });
  }, [update]);

  const setFilter = useCallback((f: ActiveFilter) => {
    update({ filter: f === 'all' ? null : f, offset: null });
  }, [update]);

  const isDrillDown = useRef(false);

  const setSelectedItem = useCallback((id: string | null, type?: string) => {
    update({ item: id, itemType: type ?? null });
  }, [update]);

  const drillToItem = useCallback((id: string, type: string) => {
    isDrillDown.current = true;
    update({ item: id, itemType: type });
  }, [update]);

  const setOffset = useCallback((n: number) => {
    update({ offset: n > 0 ? String(n) : null });
  }, [update]);

  const [expandedPlan, setExpandedPlan] = useState<string | null>(null);

  return (
    <WorkspaceCtx.Provider value={{ state, setProject, setFilter, setSelectedItem, drillToItem, setOffset, isDrillDown, expandedPlan, setExpandedPlan }}>
      {children}
    </WorkspaceCtx.Provider>
  );
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceCtx);
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return ctx;
}
