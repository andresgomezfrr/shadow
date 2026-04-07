import { useCallback, useState, useEffect, useRef } from 'react';
import { useEventStream } from './useEventStream';
import { useApi } from './useApi';
import { fetchActivity, fetchStatus } from '../api/client';

type PhaseInfo = { image: string; label: string };

const IDLE_IMAGES = ['/ghost/idle-1.png', '/ghost/idle-2.png', '/ghost/idle-3.png', '/ghost/idle-4.png'];
const randomIdle = () => IDLE_IMAGES[Math.floor(Math.random() * IDLE_IMAGES.length)];

const PHASE_MAP: Record<string, PhaseInfo> = {
  idle:              { image: '',                          label: 'idle' }, // resolved dynamically
  focus:             { image: '/ghost/focus.png',          label: 'focus mode' },
  watching:          { image: '/ghost/watching.png',       label: 'watching' },
  learning:          { image: '/ghost/learning.png',       label: 'learning' },
  heartbeat:         { image: '/ghost/analyzing.png',     label: 'analyzing...' },
  suggest:           { image: '/ghost/suggesting.png',    label: 'suggesting...' },
  'suggest-deep':    { image: '/ghost/suggesting.png',    label: 'deep suggesting...' },
  'suggest-project': { image: '/ghost/suggesting.png',    label: 'project suggestions...' },
  consolidate:       { image: '/ghost/consolidating.png', label: 'consolidating...' },
  reflect:           { image: '/ghost/reflecting.png',    label: 'reflecting...' },
  'context-enrich':  { image: '/ghost/enriching.png',     label: 'enriching...' },
  'remote-sync':     { image: '/ghost/syncing.png',       label: 'syncing...' },
  'repo-profile':    { image: '/ghost/analyzing.png',     label: 'profiling...' },
  'project-profile': { image: '/ghost/analyzing.png',     label: 'profiling...' },
  'digest-daily':    { image: '/ghost/reflecting.png',    label: 'writing digest...' },
  'digest-weekly':   { image: '/ghost/reflecting.png',    label: 'writing digest...' },
  'digest-brag':     { image: '/ghost/reflecting.png',    label: 'writing digest...' },
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
};

export function useGhostPhase(): GhostPhase {
  const [phase, setPhase] = useState('idle');
  const [idleImage] = useState(() => randomIdle());
  const runningJobs = useRef(new Map<string, string>());
  const recentActivityRef = useRef(0);
  const focusModeRef = useRef(false);
  const prevPhaseRef = useRef('idle');

  // Pick a new random idle image each time we enter idle
  const [currentIdleImage, setCurrentIdleImage] = useState(idleImage);
  const updatePhase = useCallback((newPhase: string) => {
    if (newPhase === 'idle' && prevPhaseRef.current !== 'idle') {
      setCurrentIdleImage(randomIdle());
    }
    prevPhaseRef.current = newPhase;
    setPhase(newPhase);
  }, []);

  // Preload all ghost images on mount
  useEffect(() => {
    const seen = new Set<string>();
    for (const { image } of Object.values(PHASE_MAP)) {
      if (image && !seen.has(image)) {
        seen.add(image);
        const img = new Image();
        img.src = image;
      }
    }
    for (const src of IDLE_IMAGES) {
      const img = new Image();
      img.src = src;
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

  // Poll status for recentActivity (ambient state)
  const { data: status } = useApi(fetchStatus, [], 15_000);

  useEffect(() => {
    if (!status) return;
    recentActivityRef.current = (status as Record<string, unknown>).recentActivity as number ?? 0;
    const profile = (status as Record<string, unknown>).profile as Record<string, unknown> | undefined;
    focusModeRef.current = !!profile?.focusMode;
    derivePhase();
  }, [status, derivePhase]);

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
    imagePath: phase === 'idle' ? currentIdleImage : info.image,
    label: info.label,
    isActive: phase !== 'idle',
  };
}
