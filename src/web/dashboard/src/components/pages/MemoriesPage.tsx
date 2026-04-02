import { useState, useEffect, useRef } from 'react';
import { fetchMemories } from '../../api/client';
import { LAYER_COLORS } from '../../api/types';
import type { Memory } from '../../api/types';
import { FilterTabs } from '../common/FilterTabs';
import { SearchInput } from '../common/SearchInput';
import { Badge } from '../common/Badge';
import { Markdown } from '../common/Markdown';
import { EmptyState } from '../common/EmptyState';

const LAYERS = [
  { label: 'All', value: '' },
  { label: 'Core', value: 'core' },
  { label: 'Hot', value: 'hot' },
  { label: 'Warm', value: 'warm' },
  { label: 'Cool', value: 'cool' },
  { label: 'Cold', value: 'cold' },
];

export function MemoriesPage() {
  const [layer, setLayer] = useState('');
  const [query, setQuery] = useState('');
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLoading(true);
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const data = await fetchMemories({
        q: query || undefined,
        layer: layer || undefined,
      });
      setMemories(data ?? []);
      setLoading(false);
    }, query ? 300 : 0);
  }, [layer, query]);

  const toggle = (id: string) => {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h1 className="text-xl font-semibold">Memories</h1>
        <FilterTabs options={LAYERS} active={layer} onChange={setLayer} />
      </div>
      <div className="mb-4">
        <SearchInput value={query} onChange={setQuery} placeholder="Search memories..." />
      </div>

      {loading ? (
        <div className="text-text-dim">Loading...</div>
      ) : memories.length === 0 ? (
        <EmptyState icon="🧠" title="No memories" description={query ? 'No results found' : 'Shadow has no saved memories yet'} />
      ) : (
        <div className="flex flex-col gap-2">
          {memories.map((m) => {
            const layerClass = LAYER_COLORS[m.layer] ?? LAYER_COLORS.cold;
            const isOpen = expanded.has(m.id);
            return (
              <div
                key={m.id}
                onClick={() => toggle(m.id)}
                className="bg-card border border-border rounded-lg px-4 py-3 cursor-pointer transition-colors hover:border-accent"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className={layerClass}>{m.layer}</Badge>
                  <Badge className="text-text-dim bg-border">{m.kind}</Badge>
                  <span className="font-medium text-sm flex-1 truncate">{m.title}</span>
                  {m.rank != null && (
                    <span className="text-xs text-text-muted">rank: {m.rank.toFixed(2)}</span>
                  )}
                </div>
                {isOpen && (
                  <div className="mt-3 animate-fade-in space-y-2">
                    <Markdown>{m.bodyMd}</Markdown>
                    {m.tags.length > 0 && (
                      <div className="flex gap-1 flex-wrap">
                        {m.tags.map((t) => (
                          <Badge key={t} className="text-text-muted bg-border">{t}</Badge>
                        ))}
                      </div>
                    )}
                    <div className="text-xs text-text-muted space-y-0.5">
                      <div>Scope: {m.scope} · Confidence: {m.confidenceScore}% · Accesses: {m.accessCount}</div>
                      <div>Source: {m.sourceType}{m.sourceId ? ` · ${m.sourceId.slice(0, 8)}` : ''}</div>
                      <div>Created: {new Date(m.createdAt).toLocaleString()}{m.lastAccessedAt ? ` · Last accessed: ${new Date(m.lastAccessedAt).toLocaleString()}` : ''}</div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
