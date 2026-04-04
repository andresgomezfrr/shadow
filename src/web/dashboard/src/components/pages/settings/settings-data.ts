import type { UserProfile } from '../../../api/types';

// --- Section & group definitions ---

export const SETTINGS_GROUPS = [
  { id: 'general', label: 'General' },
  { id: 'behavior', label: 'Behavior' },
  { id: 'features', label: 'Features' },
  { id: 'about', label: 'About' },
] as const;

export const SETTINGS_SECTIONS = [
  { id: 'trust', label: 'Trust Level', group: 'general', keywords: ['trust', 'level', 'score', 'interactions', 'observer', 'advisor', 'partner', 'shadow'] },
  { id: 'identity', label: 'Identity', group: 'general', keywords: ['name', 'displayName', 'locale', 'timezone', 'language', 'identity'] },
  { id: 'status', label: 'Status', group: 'general', keywords: ['mood', 'energy', 'happy', 'tired', 'focused', 'excited', 'concerned'] },
  { id: 'behavior', label: 'Behavior', group: 'behavior', keywords: ['proactivity', 'personality', 'verbosity', 'concise', 'verbose', 'minimal', 'companion'] },
  { id: 'models', label: 'LLM Models', group: 'behavior', keywords: ['llm', 'model', 'analyze', 'suggest', 'consolidate', 'runner', 'haiku', 'sonnet', 'opus'] },
  { id: 'thoughts', label: 'Thoughts', group: 'features', keywords: ['thought', 'ambient', 'status line', 'frequency', 'duration'] },
  { id: 'focus', label: 'Focus Mode', group: 'features', keywords: ['focus', 'mode', 'do not disturb', 'dnd', 'quiet'] },
  { id: 'enrichment', label: 'Enrichment', group: 'features', keywords: ['enrichment', 'mcp', 'calendar', 'ci', 'monitoring', 'external', 'context'] },
  { id: 'soul', label: 'Soul', group: 'about', keywords: ['soul', 'reflection', 'personality', 'evolution', 'snapshot', 'understand'] },
  { id: 'config', label: 'System Config', group: 'about', keywords: ['config', 'env', 'environment', 'heartbeat', 'daemon', 'timeout', 'runner', 'sync', 'interval'] },
] as const;

export type SectionId = (typeof SETTINGS_SECTIONS)[number]['id'];

// --- Labels & options ---

export const PERSONALITY_LABELS: Record<number, string> = {
  1: 'Minimal — only responds to direct questions',
  2: 'Informative — shares relevant data',
  3: 'Collaborative — suggests and gives opinions',
  4: 'Companion — close tone, subtle humor',
  5: 'Shadow — fully integrated, proactive',
};

export const FOCUS_DURATIONS = [
  { label: '30m', value: '30m' },
  { label: '1h', value: '1h' },
  { label: '2h', value: '2h' },
  { label: '4h', value: '4h' },
  { label: 'No limit', value: '' },
];

export const MOOD_OPTIONS = [
  { value: 'neutral', label: '😐 Neutral' },
  { value: 'happy', label: '😊 Happy' },
  { value: 'focused', label: '🎯 Focused' },
  { value: 'tired', label: '😴 Tired' },
  { value: 'excited', label: '🚀 Excited' },
  { value: 'concerned', label: '😟 Concerned' },
];

export const ENERGY_OPTIONS = [
  { value: '', label: 'Not specified' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

export const MODEL_OPTIONS = [
  { value: 'haiku', label: 'Haiku (fast, cheap)' },
  { value: 'sonnet', label: 'Sonnet (balanced)' },
  { value: 'opus', label: 'Opus (highest quality)' },
];

export const MODEL_PHASES = [
  { key: 'analyze', label: 'Analyze', desc: 'Processes observations + conversations', default: 'sonnet' },
  { key: 'suggest', label: 'Suggest', desc: 'Generates recommendations', default: 'opus' },
  { key: 'consolidate', label: 'Consolidate', desc: 'Maintains memory layers', default: 'sonnet' },
  { key: 'runner', label: 'Runner', desc: 'Executes accepted tasks', default: 'sonnet' },
  { key: 'enrichPlan', label: 'Enrich Plan', desc: 'Plans MCP enrichment queries', default: 'sonnet' },
  { key: 'enrichExecute', label: 'Enrich Execute', desc: 'Gathers external context via MCP', default: 'opus' },
  { key: 'digestDaily', label: 'Digest Daily', desc: 'Daily standup summary', default: 'sonnet' },
  { key: 'digestWeekly', label: 'Digest Weekly', desc: 'Weekly 1:1 summary', default: 'opus' },
  { key: 'digestBrag', label: 'Digest Brag', desc: 'Quarterly brag doc', default: 'opus' },
] as const;

export const THOUGHT_FREQUENCY_OPTIONS = [
  { value: '5', label: 'Every ~5 min' },
  { value: '10', label: 'Every ~10 min' },
  { value: '15', label: 'Every ~15 min' },
  { value: '30', label: 'Every ~30 min' },
  { value: '60', label: 'Every ~1 hour' },
];

export const THOUGHT_DURATION_OPTIONS = [
  { value: '30000', label: '30 seconds' },
  { value: '60000', label: '1 minute' },
  { value: '120000', label: '2 minutes' },
];

export const ENRICHMENT_INTERVAL_OPTIONS = [
  { value: '30', label: 'Every 30 min' },
  { value: '60', label: 'Every 1h' },
  { value: '120', label: 'Every 2h (default)' },
  { value: '360', label: 'Every 6h' },
  { value: '720', label: 'Every 12h' },
];

// --- Preference helpers ---

type Prefs = Record<string, unknown>;

export function getPref<T>(profile: UserProfile, key: string, fallback: T): T {
  const prefs = profile.preferences as Prefs | undefined;
  return (prefs?.[key] as T) ?? fallback;
}

export function getModel(profile: UserProfile, phase: string, fallback: string): string {
  const prefs = profile.preferences as Prefs | undefined;
  const models = prefs?.models as Record<string, string> | undefined;
  return models?.[phase] ?? fallback;
}

export function getModels(profile: UserProfile): Record<string, string> | undefined {
  const prefs = profile.preferences as Prefs | undefined;
  return prefs?.models as Record<string, string> | undefined;
}

export function getThoughtFrequencyValue(profile: UserProfile): string {
  const ms = getPref<number | undefined>(profile, 'thoughtIntervalMinMs', undefined);
  if (ms === 5 * 60 * 1000) return '5';
  if (ms === 10 * 60 * 1000) return '10';
  if (ms === 30 * 60 * 1000) return '30';
  if (ms === 60 * 60 * 1000) return '60';
  return '15';
}
