import { useCallback, useState, useEffect, useRef } from 'react';
import { useEventStream } from './useEventStream';
import { useApi } from './useApi';
import { fetchActivity, fetchStatus } from '../api/client';

type PhaseInfo = { images: string[]; label: string };

export const isVideo = (p: string) => p.endsWith('.mp4');

const randomFrom = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];

const PHASE_MAP: Record<string, PhaseInfo> = {
  idle:              { images: ['/ghost/idle.mp4', '/ghost/idle-1.png', '/ghost/idle-2.png', '/ghost/idle-3.png', '/ghost/idle-4.png', '/ghost/idle-5.png', '/ghost/idle-6.png', '/ghost/idle-7.png', '/ghost/idle-9.png'], label: 'idle' },
  focus:             { images: ['/ghost/focus.png'],           label: 'focus mode' },
  watching:          { images: ['/ghost/watching.mp4', '/ghost/watching-1.png'], label: 'watching' },
  learning:          { images: ['/ghost/watching.mp4', '/ghost/watching-1.png'], label: 'learning' },
  heartbeat:         { images: ['/ghost/analyzing.mp4', '/ghost/analyzing-1.png', '/ghost/analyzing-2.png', '/ghost/analyzing-3.png', '/ghost/analyzing-4.png'], label: 'analyzing...' },
  suggest:           { images: ['/ghost/suggesting-1.png', '/ghost/suggesting-2.png', '/ghost/suggesting-3.png'], label: 'suggesting...' },
  'suggest-deep':    { images: ['/ghost/suggesting-1.png', '/ghost/suggesting-2.png', '/ghost/suggesting-3.png'], label: 'deep suggesting...' },
  'suggest-project': { images: ['/ghost/suggesting-1.png', '/ghost/suggesting-2.png', '/ghost/suggesting-3.png'], label: 'project suggestions...' },
  consolidate:       { images: ['/ghost/consolidating-1.png', '/ghost/consolidating-2.png'], label: 'consolidating...' },
  reflect:           { images: ['/ghost/reflecting.png'],      label: 'reflecting...' },
  'context-enrich':  { images: ['/ghost/enriching.png'],       label: 'enriching...' },
  'remote-sync':     { images: ['/ghost/syncing.png'],         label: 'syncing...' },
  'repo-profile':    { images: ['/ghost/analyzing.mp4', '/ghost/analyzing-1.png', '/ghost/analyzing-2.png', '/ghost/analyzing-3.png', '/ghost/analyzing-4.png'], label: 'profiling...' },
  'project-profile': { images: ['/ghost/analyzing.mp4', '/ghost/analyzing-1.png', '/ghost/analyzing-2.png', '/ghost/analyzing-3.png', '/ghost/analyzing-4.png'], label: 'profiling...' },
  'digest-daily':    { images: ['/ghost/reflecting.png'],      label: 'writing digest...' },
  'digest-weekly':   { images: ['/ghost/reflecting.png'],      label: 'writing digest...' },
  'digest-brag':     { images: ['/ghost/reflecting.png'],      label: 'writing digest...' },
};

// Higher index = higher priority for display
const PHASE_PRIORITY = [
  'remote-sync', 'context-enrich', 'repo-profile', 'project-profile',
  'digest-daily', 'digest-weekly', 'digest-brag',
  'reflect', 'consolidate', 'suggest', 'suggest-deep', 'suggest-project',
  'heartbeat',
];

const SSE_EVENTS = ['job:started', 'job:phase', 'job:complete', 'job:enqueued'];

export type GhostPhase = {
  phase: string;
  imagePath: string;
  label: string;
  isActive: boolean;
  mood: string;
  moodPhrase: string | null;
  moodPhraseChanged: boolean;
  energy: string;
};

export function useGhostPhase(): GhostPhase {
  const [phase, setPhase] = useState('idle');
  const [currentImage, setCurrentImage] = useState(() => randomFrom(PHASE_MAP.idle.images));
  const runningJobs = useRef(new Map<string, string>());
  const recentActivityRef = useRef(0);
  const focusModeRef = useRef(false);
  const prevPhaseRef = useRef('idle');

  // Mood + energy state
  const [mood, setMood] = useState('neutral');
  const [energy, setEnergy] = useState('normal');
  const [moodPhrase, setMoodPhrase] = useState<string | null>(null);
  const [moodPhraseChanged, setMoodPhraseChanged] = useState(false);
  const prevMoodPhraseRef = useRef<string | null>(null);

  // Pick a new random image each time phase changes
  const updatePhase = useCallback((newPhase: string) => {
    if (newPhase !== prevPhaseRef.current) {
      const info = PHASE_MAP[newPhase] ?? PHASE_MAP.idle;
      setCurrentImage(randomFrom(info.images));
    }
    prevPhaseRef.current = newPhase;
    setPhase(newPhase);
  }, []);

  // Preload all ghost images on mount (including offline)
  useEffect(() => {
    const seen = new Set<string>();
    const allSources = Object.values(PHASE_MAP).flatMap(p => p.images);
    allSources.push('/ghost/offline.png');
    for (const src of allSources) {
      if (!seen.has(src) && !isVideo(src)) {
        seen.add(src);
        const img = new Image();
        img.src = src;
      }
    }
  }, []);

  // Derive dominant phase from running jobs + ambient state
  const derivePhase = useCallback((): void => {
    const jobs = runningJobs.current;

    // If jobs are running, pick the highest-priority one
    if (jobs.size > 0) {
      let best = '';
      let bestPriority = -1;
      for (const type of jobs.values()) {
        const p = PHASE_PRIORITY.indexOf(type);
        if (p > bestPriority) { bestPriority = p; best = type; }
      }
      updatePhase(best || jobs.values().next().value || 'idle');
      return;
    }

    // No jobs — check focus mode first, then ambient state
    if (focusModeRef.current) { updatePhase('focus'); return; }
    const activity = recentActivityRef.current;
    if (activity > 5) { updatePhase('learning'); return; }
    if (activity > 0) { updatePhase('watching'); return; }
    updatePhase('idle');
  }, [updatePhase]);

  // Poll status for recentActivity + mood (ambient state)
  const { data: status } = useApi(fetchStatus, [], 15_000);

  useEffect(() => {
    if (!status) return;
    recentActivityRef.current = (status as Record<string, unknown>).recentActivity as number ?? 0;
    const profile = (status as Record<string, unknown>).profile as Record<string, unknown> | undefined;
    focusModeRef.current = !!profile?.focusMode;

    // Update mood + energy
    const newMood = (profile?.moodHint as string) || 'neutral';
    setMood(newMood);
    setEnergy((profile?.energyLevel as string) || 'normal');

    // Update mood phrase — detect changes
    const newPhrase = (profile?.moodPhrase as string) || null;
    if (newPhrase && newPhrase !== prevMoodPhraseRef.current) {
      setMoodPhrase(newPhrase);
      // Only trigger "changed" if we had a previous phrase (skip initial load)
      if (prevMoodPhraseRef.current !== null) {
        setMoodPhraseChanged(true);
      }
    }
    prevMoodPhraseRef.current = newPhrase;

    derivePhase();
  }, [status, derivePhase]);

  // Auto-reset moodPhraseChanged after consumer reads it
  useEffect(() => {
    if (moodPhraseChanged) {
      const t = setTimeout(() => setMoodPhraseChanged(false), 100);
      return () => clearTimeout(t);
    }
  }, [moodPhraseChanged]);

  // Poll running jobs as fallback (same pattern as LiveStatusBar)
  const { data: polled } = useApi(
    () => fetchActivity({ status: 'running', limit: 5 }),
    [],
    10_000,
  );

  useEffect(() => {
    if (!polled?.items) return;
    const jobs = runningJobs.current;
    jobs.clear();
    for (const item of polled.items) {
      jobs.set(item.id, item.type);
    }
    derivePhase();
  }, [polled, derivePhase]);

  // SSE event handler
  const handleSSE = useCallback((type: string, data: unknown) => {
    const d = data as Record<string, unknown> | undefined;
    if (!d) return;
    const jobs = runningJobs.current;

    if (type === 'job:started' || type === 'job:enqueued') {
      const id = d.jobId as string || d.id as string;
      const jobType = d.type as string;
      if (id && jobType) jobs.set(id, jobType);
    } else if (type === 'job:complete') {
      const id = d.jobId as string || d.id as string;
      if (id) jobs.delete(id);
    }

    derivePhase();
  }, [derivePhase]);

  useEventStream(SSE_EVENTS, handleSSE);

  const info = PHASE_MAP[phase] ?? PHASE_MAP.idle;
  return {
    phase,
    imagePath: currentImage,
    label: info.label,
    isActive: phase !== 'idle',
    mood,
    moodPhrase,
    moodPhraseChanged,
    energy,
  };
}
