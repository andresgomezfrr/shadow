import { useState, useEffect, useRef } from 'react';

const FALLBACK_FACES: Record<string, string> = {
  idle: '{•‿•}',
  focus: '{•̀_•́}',
  watching: '{•‿•}',
  learning: '{°_°}',
  heartbeat: '{°_°}',
  suggest: '{•ᴗ•}',
  'suggest-deep': '{•ᴗ•}',
  'suggest-project': '{•ᴗ•}',
  consolidate: '{•_•}',
  reflect: '{-_-}',
  'context-enrich': '{•_•}',
  'remote-sync': '{•_•}',
};

type Props = {
  open: boolean;
  onClose: () => void;
  imagePath: string;
  label: string;
  phase: string;
  isActive: boolean;
  mood: string;
  moodPhrase: string | null;
  energy: string;
};

const ENERGY_BARS: Record<string, { blocks: number; label: string }> = {
  low: { blocks: 1, label: 'low' },
  normal: { blocks: 3, label: 'normal' },
  high: { blocks: 5, label: 'high' },
};

export function GhostTV({ open, onClose, imagePath, label, phase, isActive, mood, moodPhrase, energy }: Props) {
  const [imgError, setImgError] = useState(false);
  const [prevImage, setPrevImage] = useState(imagePath);
  const [transitioning, setTransitioning] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  // Reset error state when image changes
  useEffect(() => { setImgError(false); }, [imagePath]);

  // Crossfade on image change
  useEffect(() => {
    if (imagePath !== prevImage) {
      setTransitioning(true);
      timeoutRef.current = setTimeout(() => {
        setPrevImage(imagePath);
        setTransitioning(false);
      }, 500);
    }
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, [imagePath, prevImage]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  const face = FALLBACK_FACES[phase] ?? '{•_•}';

  return (
    <div className="fixed inset-0 z-[60]" onClick={onClose}>
      <div
        className={`absolute top-2 left-[68px] w-[220px] rounded-xl overflow-hidden animate-fade-in ghost-glow`}
        data-mood={mood}
        data-energy={energy}
        onClick={e => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={e => { e.stopPropagation(); onClose(); }}
          className="absolute top-1.5 right-1.5 z-20 w-7 h-7 flex items-center justify-center rounded-full text-text/70 hover:text-text bg-black/50 hover:bg-black/70 transition-colors border-none cursor-pointer text-sm leading-none"
        >
          ✕
        </button>

        {/* Image area — image background fills the panel */}
        <div className="relative w-full aspect-square flex items-center justify-center overflow-hidden">
          {imgError ? (
            <div className="text-4xl font-mono text-accent ghost-pulse select-none bg-card w-full h-full flex items-center justify-center">
              {face}
            </div>
          ) : (
            <>
              {/* Previous image (fading out during transition) */}
              {transitioning && prevImage !== imagePath && (
                <img
                  src={prevImage}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover transition-opacity duration-500 opacity-0"
                />
              )}
              {/* Current image */}
              <img
                src={imagePath}
                alt={`Shadow — ${label}`}
                className={`w-full h-full object-cover transition-opacity duration-500 ${transitioning ? 'opacity-0' : 'opacity-100'}`}
                onError={() => setImgError(true)}
                onLoad={() => { if (transitioning) { setPrevImage(imagePath); setTransitioning(false); } }}
              />
            </>
          )}
        </div>

        {/* Phase label + mood phrase + energy */}
        <div className="text-center py-1.5 px-3 bg-card/90">
          <div className="text-xs text-accent/80 tracking-wide">{label}</div>
          {moodPhrase && (
            <div className="text-[11px] text-text-dim italic mt-0.5 leading-relaxed">
              &ldquo;{moodPhrase}&rdquo;
            </div>
          )}
          <div className="flex items-center justify-center gap-1.5 mt-1.5">
            <span className="text-[10px] text-text-muted">⚡</span>
            <div className="flex gap-[2px]">
              {Array.from({ length: 5 }, (_, i) => (
                <div
                  key={i}
                  className={`w-[14px] h-[4px] rounded-sm transition-colors ${
                    i < (ENERGY_BARS[energy]?.blocks ?? 3)
                      ? 'bg-accent/70'
                      : 'bg-border/40'
                  }`}
                />
              ))}
            </div>
            <span className="text-[10px] text-text-muted">{ENERGY_BARS[energy]?.label ?? 'normal'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
