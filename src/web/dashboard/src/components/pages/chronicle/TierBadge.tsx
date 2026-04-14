import { useState } from 'react';
import type { ChronicleEntry } from '../../../api/types';
import { TIER_PORTRAITS } from './images';
import { ChronicleLightbox } from './ChronicleLightbox';

type Props = {
  tier: number;
  name: string;
  loreEntry: ChronicleEntry | null;
};

export function TierBadge({ tier, name, loreEntry }: Props) {
  const [open, setOpen] = useState(false);
  const portrait = TIER_PORTRAITS[tier];
  return (
    <section className="bg-card border border-border rounded-lg p-6 mb-6">
      <div className="flex items-center gap-5">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-full flex-shrink-0"
          aria-label={`View ${name}`}
        >
          <img
            src={portrait}
            alt={name}
            className="w-24 h-24 rounded-full object-cover ring-2 ring-accent/40 cursor-pointer transition-all hover:brightness-110 hover:scale-105"
          />
        </button>
        <div>
          <p className="text-text-dim text-xs uppercase tracking-wider">Current bond</p>
          <h1 className="text-3xl font-semibold text-accent">
            {name}
          </h1>
          <p className="text-text-muted text-sm mt-1">
            Lv.{tier}
          </p>
        </div>
      </div>
      {loreEntry && (
        <blockquote className="mt-5 pl-4 border-l-2 border-accent italic text-text text-sm leading-relaxed">
          {loreEntry.bodyMd}
        </blockquote>
      )}
      {open && (
        <ChronicleLightbox
          src={portrait}
          title={name}
          subtitle={`Lv.${tier}`}
          onClose={() => setOpen(false)}
        />
      )}
    </section>
  );
}
