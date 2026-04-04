import { useState } from 'react';
import { useApi } from '../../../hooks/useApi';
import { fetchSoulHistory } from '../../../api/client';

type Props = {
  visible: boolean;
};

export function SectionSoul({ visible }: Props) {
  const { data } = useApi(fetchSoulHistory, [], 120_000);
  const [expandedSnapshot, setExpandedSnapshot] = useState<string | null>(null);

  if (!data || !data.current) return null;

  return (
    <section
      id="section-soul"
      className={`bg-card border border-border rounded-lg p-5 mb-6 transition-opacity ${
        visible ? '' : 'opacity-20 pointer-events-none'
      }`}
    >
      <h2 className="text-base font-semibold mb-1">Shadow&apos;s Soul Reflection</h2>
      <p className="text-xs text-text-dim mb-4">
        How Shadow understands you. Evolves daily via 2-phase reflect (Sonnet delta + Opus evolve).
        Updated: {new Date(data.current.updatedAt).toLocaleString()}
      </p>

      <div className="bg-bg rounded-lg px-4 py-3 text-sm text-text-dim prose prose-sm prose-invert max-w-none mb-4 whitespace-pre-wrap">
        {data.current.bodyMd}
      </div>

      {data.snapshots.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2 text-text-dim">
            Evolution history ({data.snapshots.length})
          </h3>
          <div className="space-y-1">
            {data.snapshots.map((snap) => (
              <div key={snap.id}>
                <button
                  onClick={() => setExpandedSnapshot(expandedSnapshot === snap.id ? null : snap.id)}
                  className="w-full flex items-center justify-between px-3 py-2 bg-bg rounded text-xs text-text-dim hover:text-text transition-colors cursor-pointer border-none bg-transparent text-left"
                >
                  <span>{snap.title}</span>
                  <span className="text-text-muted">
                    {expandedSnapshot === snap.id ? '\u25B4' : '\u25BE'}
                  </span>
                </button>
                {expandedSnapshot === snap.id && (
                  <div className="bg-bg rounded-lg px-4 py-3 text-xs text-text-muted mt-1 mb-2 whitespace-pre-wrap animate-fade-in">
                    {snap.bodyMd}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
