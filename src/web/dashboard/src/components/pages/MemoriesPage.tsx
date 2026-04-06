import { useState, useEffect, useRef } from 'react';
import { fetchMemories } from '../../api/client';
import { useFilterParams } from '../../hooks/useFilterParams';
import { useHighlight } from '../../hooks/useHighlight';
import { LAYER_COLORS } from '../../api/types';
import type { Memory } from '../../api/types';
import { FilterTabs } from '../common/FilterTabs';
import { Pagination } from '../common/Pagination';
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

const PAGE_SIZE = 30;

export function MemoriesPage() {
  const { params, setParam } = useFilterParams({ layer: '', q: '', offset: '0' });
  const [inputQ, setInputQ] = useState(params.q);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { pulseId, scrollRef } = useHighlight(expanded, setExpanded);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search input → URL param
  useEffect(() => {
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setParam('q', inputQ), 300);
    return () => { if (debounceRef.current !== null) clearTimeout(debounceRef.current); };
  }, [inputQ, setParam]);

  // Fetch data when URL params change
  useEffect(() => {
    setLoading(true);
    (async () => {
      const data = await fetchMemories({
        q: params.q || undefined,
        layer: params.layer || undefined,
        limit: PAGE_SIZE,
        offset: Number(params.offset) || 0,
      });
      setMemories(data?.items ?? []);
      setTotal(data?.total ?? 0);
      setLoading(false);
    })();
  }, [params.layer, params.q, params.offset]);

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
        <FilterTabs options={LAYERS} active={params.layer} onChange={(v) => setParam('layer', v)} />
      </div>
      <div className="mb-4">
        <SearchInput value={inputQ} onChange={setInputQ} placeholder="Search memories..." />
      </div>

      {loading ? (
        <div className="text-text-dim">Loading...</div>
      ) : memories.length === 0 ? (
        <EmptyState icon="🧠" title="No memories" description={params.q ? 'No results found' : 'Shadow has no saved memories yet'} />
      ) : (
        <div className="flex flex-col gap-2">
          {memories.map((m) => {
            const layerClass = LAYER_COLORS[m.layer] ?? LAYER_COLORS.cold;
            const isOpen = expanded.has(m.id);
            return (
              <div
                key={m.id}
                ref={scrollRef(m.id)}
                onClick={() => toggle(m.id)}
                className={`bg-card border border-border rounded-lg px-4 py-3 cursor-pointer transition-colors hover:border-accent ${pulseId === m.id ? 'border-accent ring-2 ring-accent/30' : ''}`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className={layerClass}>{m.layer}</Badge>
                  <Badge className="text-text-dim bg-border">{m.kind}</Badge>
                  {m.sourceMemoryIds?.length > 0 && (
                    <Badge className="text-orange bg-orange/15">from {m.sourceMemoryIds.length}</Badge>
                  )}
                  {m.entities?.map((e: { type: string }, i: number) => (
                    <Badge key={i} className="text-blue bg-blue/10">{e.type}</Badge>
                  ))}
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
      <Pagination total={total} offset={Number(params.offset) || 0} limit={PAGE_SIZE} onChange={(o) => setParam('offset', String(o))} />
    </div>
  );
}
