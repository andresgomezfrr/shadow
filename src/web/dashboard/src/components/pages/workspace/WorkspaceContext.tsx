import { createContext, useContext, useCallback, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Run, Suggestion, Observation } from '../../../api/types';

export type SelectedItem = {
  id: string;
  type: 'run' | 'suggestion' | 'observation';
  data: Run | Suggestion | Observation;
};

export type ActiveFilter = 'all' | 'run' | 'suggestion' | 'observation';

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
  setOffset: (n: number) => void;
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

  const setSelectedItem = useCallback((id: string | null, type?: string) => {
    update({ item: id, itemType: type ?? null });
  }, [update]);

  const setOffset = useCallback((n: number) => {
    update({ offset: n > 0 ? String(n) : null });
  }, [update]);

  return (
    <WorkspaceCtx.Provider value={{ state, setProject, setFilter, setSelectedItem, setOffset }}>
      {children}
    </WorkspaceCtx.Provider>
  );
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceCtx);
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return ctx;
}
