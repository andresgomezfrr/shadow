import { useApi } from '../../hooks/useApi';
import { useDialog } from '../../hooks/useDialog';
import { fetchTasks, createTask, updateTask, deleteTask, fetchRepos, fetchProjects } from '../../api/client';
import { Badge } from '../common/Badge';
import { FilterTabs } from '../common/FilterTabs';
import { EmptyState } from '../common/EmptyState';
import { Pagination } from '../common/Pagination';
import { Markdown } from '../common/Markdown';
import { timeAgo } from '../../utils/format';
import { useState, useCallback } from 'react';
import type { Task } from '../../api/types';
import { TASK_STATUS_COLORS, TASK_STATUS_COLOR_DEFAULT } from '../../utils/task-colors';

const ALL_STATUSES = ['open', 'active', 'blocked', 'done'] as const;
const PAGE_SIZE = 20;

export function TasksPage() {
  const [status, setStatus] = useState<string>('all');
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newRef, setNewRef] = useState('');
  const { dialog, prompt } = useDialog();

  const apiStatus = status === 'all' ? undefined : status;
  const { data, refresh } = useApi(() => fetchTasks({ status: apiStatus, limit: PAGE_SIZE, offset }), [status, offset], 15_000);
  const { data: repos } = useApi(fetchRepos, [], 60_000);
  const { data: projects } = useApi(fetchProjects, [], 60_000);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  const repoName = (id: string) => repos?.find(r => r.id === id)?.name ?? id.slice(0, 8);
  const projectName = (id: string) => projects?.find(p => p.id === id)?.name ?? id.slice(0, 8);

  const toggleExpand = useCallback((id: string) => {
    setExpanded(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }, []);

  const handleCreate = useCallback(async () => {
    if (!newTitle.trim()) return;
    const externalRefs = newRef.trim() ? [{ source: 'link', key: newRef.trim().split('/').pop() ?? newRef.trim(), url: newRef.trim() }] : [];
    await createTask({ title: newTitle.trim(), externalRefs });
    setNewTitle('');
    setNewRef('');
    setCreating(false);
    refresh();
  }, [newTitle, newRef, refresh]);

  const handleStatusChange = useCallback(async (id: string, newStatus: string) => {
    // Transitioning to 'done' prompts for an optional closedNote (audit UI-18;
    // backend column added by M-05). null → skipped (user cancelled). Empty
    // string → user confirmed but left it blank. Anything else → stored.
    const updates: Record<string, unknown> = {
      status: newStatus,
      ...(newStatus === 'done' ? { closedAt: new Date().toISOString() } : { closedAt: null, closedNote: null }),
    };
    if (newStatus === 'done') {
      const note = await prompt({
        title: 'Close task',
        message: 'Optional note on outcome (what shipped, what was skipped, context for future):',
        placeholder: 'Shipped PR #42, verified locally. Skipped the stretch refactor.',
        multiline: true,
      });
      if (note === null) return; // cancelled — leave status unchanged
      if (note.trim()) updates.closedNote = note.trim();
    }
    await updateTask(id, updates);
    refresh();
  }, [refresh, prompt]);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('Delete this task?')) return;
    await deleteTask(id);
    refresh();
  }, [refresh]);

  const filterOptions = [
    { label: 'All', value: 'all' },
    { label: 'Open', value: 'open' },
    { label: 'Active', value: 'active', dotColor: 'bg-blue', activeClass: 'bg-blue/15 text-blue' },
    { label: 'Blocked', value: 'blocked', dotColor: 'bg-red', activeClass: 'bg-red/15 text-red' },
    { label: 'Done', value: 'done', dotColor: 'bg-green', activeClass: 'bg-green/15 text-green' },
  ];

  return (
    <div>
      {dialog}
      <div className="flex items-center gap-3 mb-4">
        <span className="text-3xl">📋</span>
        <h1 className="text-xl font-semibold flex-1">Tasks</h1>
        <button
          onClick={() => setCreating(!creating)}
          className="px-4 py-2 rounded-lg text-xs font-semibold bg-accent text-bg border-none cursor-pointer hover:brightness-110"
        >+ New task</button>
      </div>

      {creating && (
        <div className="bg-card border border-border rounded-lg p-4 mb-4 space-y-3">
          <input
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            placeholder="Task title..."
            className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text outline-none focus:border-accent"
            autoFocus
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
          />
          <input
            value={newRef}
            onChange={e => setNewRef(e.target.value)}
            placeholder="External URL (optional, e.g. Jira ticket)"
            className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text outline-none focus:border-accent"
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
          />
          <div className="flex gap-2">
            <button onClick={handleCreate} className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-green text-bg border-none cursor-pointer hover:brightness-110">Create</button>
            <button onClick={() => setCreating(false)} className="text-xs text-text-muted hover:text-text bg-transparent border-none cursor-pointer">Cancel</button>
          </div>
        </div>
      )}

      <FilterTabs
        options={filterOptions}
        active={status}
        onChange={v => { setStatus(v); setOffset(0); }}
      />

      <div className="mt-3">
        {items.length === 0 ? (
          <EmptyState
            title="No tasks"
            description="Create a task with the button above or via MCP: shadow_task_create"
          />
        ) : (
          <div className="flex flex-col gap-2">
            {items.map((t: Task) => (
              <TaskCard
                key={t.id}
                task={t}
                expanded={expanded.has(t.id)}
                onToggle={() => toggleExpand(t.id)}
                onStatusChange={handleStatusChange}
                onDelete={handleDelete}
                repoName={repoName}
                projectName={projectName}
              />
            ))}
          </div>
        )}
      </div>

      <Pagination total={total} offset={offset} limit={PAGE_SIZE} onChange={setOffset} />
    </div>
  );
}

function TaskCard({ task: t, expanded, onToggle, onStatusChange, onDelete, repoName, projectName }: {
  task: Task;
  expanded: boolean;
  onToggle: () => void;
  onStatusChange: (id: string, status: string) => void;
  onDelete: (id: string) => void;
  repoName: (id: string) => string;
  projectName: (id: string) => string;
}) {
  const sessionCommand = t.sessionId && t.sessionRepoPath
    ? `cd ${t.sessionRepoPath} && claude --resume ${t.sessionId}`
    : t.sessionId ? `claude --resume ${t.sessionId}` : null;

  return (
    <div className="bg-card border border-border rounded-lg p-4 transition-colors hover:border-accent/30">
      <div className="flex items-center gap-2 cursor-pointer" onClick={onToggle}>
        <span className={`text-[10px] text-text-muted transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
        <Badge className={TASK_STATUS_COLORS[t.status] ?? TASK_STATUS_COLOR_DEFAULT}>{t.status.replace('_', ' ')}</Badge>
        {t.externalRefs.map((ref, i) => (
          <a key={i} href={ref.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="no-underline">
            <Badge className="text-purple bg-purple/15 hover:bg-purple/25 cursor-pointer">{ref.source.toUpperCase()} {ref.key}</Badge>
          </a>
        ))}
        <span className="font-medium text-sm flex-1 min-w-0 truncate">{t.title}</span>
        <span className="text-xs text-text-muted shrink-0">{timeAgo(t.updatedAt)}</span>
      </div>

      {expanded && (
        <div className="mt-3 ml-5 space-y-3">
          {t.contextMd && (
            <div className="bg-bg rounded-lg p-2 max-h-48 overflow-y-auto">
              <Markdown>{t.contextMd}</Markdown>
            </div>
          )}

          {sessionCommand && (
            <div className="text-xs">
              <span className="text-text-muted">Session: </span>
              <code className="bg-bg rounded px-1.5 py-0.5 select-all text-[11px]">{sessionCommand}</code>
            </div>
          )}

          {t.prUrls.length > 0 && (
            <div className="text-xs space-y-0.5">
              <span className="text-text-muted">PRs:</span>
              {t.prUrls.map((url, i) => (
                <div key={i}><a href={url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{url.replace(/^https:\/\/github\.com\//, '')}</a></div>
              ))}
            </div>
          )}

          {t.repoIds.length > 0 && (
            <div className="text-xs">
              <span className="text-text-muted">Repos: </span>
              {t.repoIds.map(id => <Badge key={id} className="text-blue bg-blue/10 mr-1">{repoName(id)}</Badge>)}
            </div>
          )}

          {t.projectId && (
            <div className="text-xs">
              <span className="text-text-muted">Project: </span>
              <Badge className="text-green bg-green/10">{projectName(t.projectId)}</Badge>
            </div>
          )}

          <div className="flex items-center gap-2 border-t border-border pt-3">
            {ALL_STATUSES.filter(s => s !== t.status).map(s => (
              <button
                key={s}
                onClick={() => onStatusChange(t.id, s)}
                className={`px-3 py-1 rounded-lg text-xs font-medium border-none cursor-pointer transition-all hover:brightness-110 ${
                  s === 'done' ? 'bg-green text-bg' :
                  s === 'active' ? 'bg-blue text-bg' :
                  s === 'blocked' ? 'bg-red text-bg' :
                  'bg-border text-text'
                }`}
              >{s === 'active' ? 'Start' : s === 'blocked' ? 'Block' : s === 'done' ? 'Done' : 'Open'}</button>
            ))}
            <button onClick={() => onDelete(t.id)} className="ml-auto text-xs text-text-muted hover:text-red bg-transparent border-none cursor-pointer">Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}
