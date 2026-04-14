import { useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { fetchChronicle } from '../../api/client';
import { TierBadge } from './chronicle/TierBadge';
import { BondRadar } from './chronicle/BondRadar';
import { PathVisualizer } from './chronicle/PathVisualizer';
import { NextStep } from './chronicle/NextStep';
import { ChronicleTimeline } from './chronicle/ChronicleTimeline';
import { UnlocksGrid } from './chronicle/UnlocksGrid';
import { VoiceOfShadow } from './chronicle/VoiceOfShadow';
import { CHRONICLE_HERO } from './chronicle/images';

const HERO_VIDEO = '/ghost/chronicle/hero.mp4';

export function ChroniclePage() {
  const [heroVideoEnded, setHeroVideoEnded] = useState(false);
  const { data, loading, error } = useApi(fetchChronicle, []);

  if (loading) return <div className="max-w-5xl mx-auto text-text-dim">Loading the Chronicle...</div>;
  if (error) return <div className="max-w-5xl mx-auto text-red">Error loading chronicle: {String(error)}</div>;
  if (!data) return null;

  const { profile, tiers, entries, unlockables, nextStep, voiceOfShadow } = data;
  const currentTierInfo = tiers.find((t) => t.isCurrent);
  const currentLore = entries.find(
    (e) => e.kind === 'tier_lore' && e.tier === profile.bondTier,
  ) ?? null;

  return (
    <div className="max-w-5xl mx-auto">
      {heroVideoEnded ? (
        <img
          src={CHRONICLE_HERO}
          alt="The Chronicle"
          className="w-full h-auto rounded-lg mb-6 object-cover"
        />
      ) : (
        <video
          autoPlay
          muted
          playsInline
          poster={CHRONICLE_HERO}
          onEnded={() => setHeroVideoEnded(true)}
          src={HERO_VIDEO}
          className="w-full h-auto rounded-lg mb-6 object-cover"
        />
      )}

      <VoiceOfShadow
        initialBody={voiceOfShadow.body}
        className="text-center mb-4"
      />

      <TierBadge
        tier={profile.bondTier}
        name={currentTierInfo?.name ?? 'observer'}
        loreEntry={currentLore}
      />

      <div className="grid md:grid-cols-2 gap-6 mb-2">
        <section className="bg-card border border-border rounded-lg p-5">
          <h2 className="text-base font-semibold mb-3">Bond Radar</h2>
          <div className="flex justify-center">
            <BondRadar axes={profile.bondAxes} size={300} />
          </div>
        </section>
        <NextStep nextStep={nextStep} />
      </div>

      <PathVisualizer tiers={tiers} />

      <ChronicleTimeline entries={entries} />

      <UnlocksGrid unlockables={unlockables} currentTier={profile.bondTier} />

      <p className="text-center text-[11px] text-text-muted italic mt-8 mb-4">
        The bond evolves. Not all is written.
      </p>
    </div>
  );
}
