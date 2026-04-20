import { useApi } from '../../hooks/useApi';
import { fetchContacts } from '../../api/client';
import { Badge } from '../common/Badge';
import { EmptyState } from '../common/EmptyState';
import { Markdown } from '../common/Markdown';
import { timeAgo } from '../../utils/format';
import { useState } from 'react';

export function TeamPage() {
  const { data } = useApi(fetchContacts, [], 30_000);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpanded((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <img src="/ghost/team.webp" alt="" className="w-[80px] h-[80px] rounded-full object-cover" />
        <h1 className="text-xl font-semibold">Team</h1>
      </div>

      {!data ? (
        <div className="text-text-dim">Loading...</div>
      ) : data.length === 0 ? (
        <EmptyState title="No contacts" description="Add contacts with: shadow contact add <name>" />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.map((c) => (
            <div
              key={c.id}
              onClick={() => toggle(c.id)}
              className="bg-card border border-border rounded-lg p-4 transition-colors hover:border-accent cursor-pointer"
            >
              <div className="font-medium text-sm mb-1">{c.name}</div>
              <div className="flex gap-1.5 flex-wrap mb-2">
                {c.role && <Badge className="text-accent bg-accent-soft">{c.role}</Badge>}
                {c.team && <Badge className="text-blue bg-blue/15">{c.team}</Badge>}
                {c.preferredChannel && <Badge className="text-purple bg-purple/15">{c.preferredChannel}</Badge>}
              </div>
              {c.email && <div className="text-xs text-text-dim">{c.email}</div>}
              {c.githubHandle && <div className="text-xs text-text-muted">@{c.githubHandle}</div>}
              {c.slackId && <div className="text-xs text-text-muted">Slack: {c.slackId}</div>}

              {expanded.has(c.id) && (
                <div className="mt-3 pt-3 border-t border-border animate-fade-in space-y-2" onClick={e => e.stopPropagation()}>
                  {c.notesMd && (
                    <div className="bg-bg rounded-lg p-3 text-xs">
                      <Markdown>{c.notesMd}</Markdown>
                    </div>
                  )}
                  <div className="flex gap-3 text-xs text-text-muted">
                    {c.lastMentionedAt && <span>Last mentioned {timeAgo(c.lastMentionedAt)}</span>}
                    <span>Added {timeAgo(c.createdAt)}</span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
