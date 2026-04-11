import { useApi } from '../../../hooks/useApi';
import { fetchTaskContext, updateTask, closeTask, archiveTask } from '../../../api/client';
import { Badge } from '../../common/Badge';
import { Markdown } from '../../common/Markdown';
import { timeAgo } from '../../../utils/format';
import { useState, useCallback } from 'react';
import { useWorkspace } from './WorkspaceContext';

const STATUS_COLORS: Record<string, string> = {
  open: 'text-text-muted bg-border',
  active: 'text-blue bg-blue/15',
  blocked: 'text-red bg-red/15',
  done: 'text-green bg-green/15',
};

const ALL_STATUSES = ['open', 'active', 'blocked', 'done'] as const;

export function TaskDetail({ taskId, onRefresh }: { taskId: string; onRefresh?: () => void }) {
  const { data: ctx, refresh } = useApi(() => fetchTaskContext(taskId), [taskId], 30_000);
  const { drillToItem } = useWorkspace();
  const [contextOpen, setContextOpen] = useState(false);

  const doRefresh = useCallback(() => { refresh(); onRefresh?.(); }, [refresh, onRefresh]);

  const handleStatusChange = useCallback(async (status: string) => {
    if (status === 'done') {
      await closeTask(taskId);
    } else {
      await updateTask(taskId, { status });
    }
    doRefresh();
  }, [taskId, doRefresh]);

  const handleArchive = useCallback(async () => {
    await archiveTask(taskId);
    doRefresh();
  }, [taskId, doRefresh]);

  if (!ctx) return <div className="text-text-dim text-sm p-4">Loading...</div>;

  const { task, observations, suggestions, runs } = ctx;
  const sessionCommand = task.sessionId && task.sessionRepoPath
    ? `cd ${task.sessionRepoPath} && claude --resume ${task.sessionId}`
    : task.sessionId
      ? `claude --resume ${task.sessionId}`
      : null;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-lg">📋</span>
        <Badge className={STATUS_COLORS[task.status] ?? 'text-text-dim bg-border'}>{task.status.replace('_', ' ')}</Badge>
        {task.externalRefs.map((ref, i) => (
          <a key={i} href={ref.url} target="_blank" rel="noopener noreferrer"
            className="no-underline">
            <Badge className="text-purple bg-purple/15 hover:bg-purple/25 cursor-pointer">{ref.source.toUpperCase()} {ref.key}</Badge>
          </a>
        ))}
      </div>
      <div className="font-medium text-sm">{task.title}</div>

      {/* Context */}
      {task.contextMd && (
        <div>
          <button onClick={() => setContextOpen(!contextOpen)} className="text-xs text-accent hover:underline bg-transparent border-none cursor-pointer">
            {contextOpen ? '▾ Context' : '▸ Context'}
          </button>
          {contextOpen && (
            <div className="mt-1 bg-bg rounded-lg p-2 max-h-64 overflow-y-auto">
              <Markdown>{task.contextMd}</Markdown>
            </div>
          )}
        </div>
      )}

      {/* Session */}
      {sessionCommand && (
        <div className="bg-bg rounded-lg p-2 text-xs space-y-1">
          <span className="text-text-muted">Session:</span>
          <code className="block bg-card rounded px-2 py-1.5 select-all text-[11px] font-mono break-all">{sessionCommand}</code>
        </div>
      )}

      {/* PRs */}
      {task.prUrls.length > 0 && (
        <div className="bg-bg rounded-lg p-2 text-xs space-y-1">
          <span className="text-text-muted">Pull Requests:</span>
          {task.prUrls.map((url, i) => (
            <div key={i}>
              <a href={url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                {url.replace(/^https:\/\/github\.com\//, '')}
              </a>
            </div>
          ))}
        </div>
      )}

      {/* Timeline */}
      <div className="text-xs text-text-muted flex items-center gap-3">
        <span>Created {timeAgo(task.createdAt)}</span>
        <span>Updated {timeAgo(task.updatedAt)}</span>
        {task.closedAt && <span>Closed {timeAgo(task.closedAt)}</span>}
      </div>

      {/* Related observations */}
      {observations.length > 0 && (
        <div className="bg-bg rounded-lg p-2 text-xs space-y-1">
          <span className="text-text-muted">Related observations ({observations.length}):</span>
          {observations.map(o => (
            <div key={o.id} className="flex items-center gap-2">
              <Badge className="text-text-dim bg-border">{o.severity}</Badge>
              <span className="truncate flex-1">{o.title}</span>
              <button
                onClick={() => drillToItem(o.id, 'observation')}
                className="text-accent hover:underline shrink-0 bg-transparent border-none cursor-pointer text-xs"
              >View</button>
            </div>
          ))}
        </div>
      )}

      {/* Related suggestions */}
      {suggestions.length > 0 && (
        <div className="bg-bg rounded-lg p-2 text-xs space-y-1">
          <span className="text-text-muted">Related suggestions ({suggestions.length}):</span>
          {suggestions.map(s => (
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

      {/* Related runs */}
      {runs.length > 0 && (
        <div className="bg-bg rounded-lg p-2 text-xs space-y-1">
          <span className="text-text-muted">Related runs ({runs.length}):</span>
          {runs.map(r => (
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

      {/* Actions — status change + archive */}
      <div className="flex items-center gap-2 border-t border-border pt-3 flex-wrap">
        {ALL_STATUSES.filter(s => s !== task.status).map(s => (
          <button
            key={s}
            onClick={() => handleStatusChange(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border-none cursor-pointer transition-all hover:brightness-110 ${
              s === 'done' ? 'bg-green text-bg' :
              s === 'active' ? 'bg-blue text-bg' :
              s === 'blocked' ? 'bg-red text-bg' :
              'bg-border text-text'
            }`}
          >{s === 'active' ? 'Start' : s === 'blocked' ? 'Block' : s === 'done' ? 'Done' : 'Open'}</button>
        ))}
        {!task.archived && (
          <button onClick={handleArchive} className="text-xs text-text-muted hover:text-text bg-transparent border-none cursor-pointer ml-auto">Archive</button>
        )}
      </div>
    </div>
  );
}
