import { Markdown } from '../../common/Markdown';
import type { Digest } from '../../../api/types';

export function MorningDigest({ digest }: { digest: Digest | null }) {
  if (!digest) return null;

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">📋 Yesterday's summary</h2>
        <span className="text-xs text-text-muted">{digest.periodStart} → {digest.periodEnd}</span>
      </div>
      <div className="bg-card border border-border rounded-lg p-4">
        <Markdown>{digest.contentMd}</Markdown>
      </div>
    </section>
  );
}
