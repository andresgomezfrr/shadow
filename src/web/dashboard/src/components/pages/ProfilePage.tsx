import { useState, useEffect, useCallback, useRef } from 'react';
import { useApi } from '../../hooks/useApi';
import { fetchStatus, updateProfile, setFocusMode } from '../../api/client';
import { TRUST_NAMES } from '../../api/types';
import type { UserProfile } from '../../api/types';
import { ProgressBar } from '../common/ProgressBar';

function SaveIndicator({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="text-xs text-green ml-2 animate-fade-in">✓ Saved</span>
  );
}

function SliderField({
  label,
  description,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-sm font-medium">{label}</label>
        <span className="text-sm text-accent font-semibold">{value}</span>
      </div>
      {description && <p className="text-xs text-text-muted mb-2">{description}</p>}
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--color-accent)] h-1.5 bg-border rounded-full appearance-none cursor-pointer"
      />
      <div className="flex justify-between text-[10px] text-text-muted mt-0.5">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

const PERSONALITY_LABELS: Record<number, string> = {
  1: 'Minimal — only responds to direct questions',
  2: 'Informative — shares relevant data',
  3: 'Collaborative — suggests and gives opinions',
  4: 'Companion — close tone, subtle humor',
  5: 'Shadow — fully integrated, proactive',
};

const FOCUS_DURATIONS = [
  { label: '30m', value: '30m' },
  { label: '1h', value: '1h' },
  { label: '2h', value: '2h' },
  { label: '4h', value: '4h' },
  { label: 'No limit', value: '' },
];

export function ProfilePage() {
  const { data, refresh } = useApi(fetchStatus, [], 60_000);
  const [saved, setSaved] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const profile = data?.profile;

  const saveField = useCallback(
    async (field: string, value: unknown) => {
      await updateProfile({ [field]: value } as Partial<UserProfile>);
      setSaved(field);
      setTimeout(() => setSaved(null), 2000);
      refresh();
    },
    [refresh],
  );

  const debouncedSave = useCallback(
    (field: string, value: unknown) => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => saveField(field, value), 500);
    },
    [saveField],
  );

  const [localProactivity, setLocalProactivity] = useState(5);
  const [localPersonality, setLocalPersonality] = useState(4);

  useEffect(() => {
    if (profile) {
      setLocalProactivity(profile.proactivityLevel);
      setLocalPersonality(profile.personalityLevel);
    }
  }, [profile]);

  if (!profile) return <div className="text-text-dim">Loading...</div>;

  const trustName = TRUST_NAMES[profile.trustLevel] ?? 'Unknown';
  const focusActive = profile.focusMode === 'focus';

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-xl font-semibold mb-6">Shadow Settings</h1>

      {/* Trust info (read-only) */}
      <section className="bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
          Trust Level
          <span className="text-accent text-sm">Lv.{profile.trustLevel} {trustName}</span>
        </h2>
        <ProgressBar value={profile.trustLevel} max={5} />
        <div className="grid grid-cols-2 gap-4 mt-4 text-sm">
          <div>
            <span className="text-text-dim">Score:</span> <span className="text-text">{profile.trustScore.toFixed(1)}/100</span>
          </div>
          <div>
            <span className="text-text-dim">Bond:</span> <span className="text-text">{profile.bondLevel}</span>
          </div>
          <div>
            <span className="text-text-dim">Interactions:</span> <span className="text-text">{profile.totalInteractions}</span>
          </div>
        </div>
        <p className="text-xs text-text-muted mt-3">Trust level increases automatically with usage. It cannot be changed manually.</p>
      </section>

      {/* Identity */}
      <section className="bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold mb-4">Identity</h2>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium block mb-1">
              Name
              <SaveIndicator show={saved === 'displayName'} />
            </label>
            <input
              type="text"
              defaultValue={profile.displayName ?? ''}
              onBlur={(e) => saveField('displayName', e.target.value)}
              className="bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm w-full max-w-xs outline-none focus:border-accent transition-colors"
            />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">
              Locale
              <SaveIndicator show={saved === 'locale'} />
            </label>
            <select
              defaultValue={profile.locale}
              onChange={(e) => saveField('locale', e.target.value)}
              className="bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm outline-none focus:border-accent transition-colors cursor-pointer"
            >
              <option value="es">Spanish</option>
              <option value="en">English</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">
              Timezone
              <SaveIndicator show={saved === 'timezone'} />
            </label>
            <input
              type="text"
              defaultValue={profile.timezone ?? ''}
              placeholder="Europe/Madrid"
              onBlur={(e) => saveField('timezone', e.target.value)}
              className="bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm w-full max-w-xs outline-none focus:border-accent transition-colors"
            />
          </div>
        </div>
      </section>

      {/* Behavior */}
      <section className="bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold mb-4">Behavior</h2>
        <div className="space-y-6">
          <div>
            <SliderField
              label="Proactivity"
              description="How proactive Shadow is when sharing observations and suggestions"
              value={localProactivity}
              min={1}
              max={10}
              onChange={(v) => {
                setLocalProactivity(v);
                debouncedSave('proactivityLevel', v);
              }}
            />
            <SaveIndicator show={saved === 'proactivityLevel'} />
          </div>
          <div>
            <SliderField
              label="Personality"
              description={PERSONALITY_LABELS[localPersonality] ?? ''}
              value={localPersonality}
              min={1}
              max={5}
              onChange={(v) => {
                setLocalPersonality(v);
                debouncedSave('personalityLevel', v);
              }}
            />
            <SaveIndicator show={saved === 'personalityLevel'} />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">
              Verbosity
              <SaveIndicator show={saved === 'verbosity'} />
            </label>
            <select
              defaultValue={profile.verbosity}
              onChange={(e) => saveField('verbosity', e.target.value)}
              className="bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm outline-none focus:border-accent transition-colors cursor-pointer"
            >
              <option value="concise">Concise</option>
              <option value="normal">Normal</option>
              <option value="verbose">Verbose</option>
            </select>
          </div>
        </div>
      </section>

      {/* LLM Models */}
      <section className="bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold mb-4">🧠 LLM Models</h2>
        <p className="text-sm text-text-dim mb-4">Choose which model Shadow uses for each phase of the heartbeat.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {(['analyze', 'suggest', 'consolidate', 'runner'] as const).map((phase) => {
            const labels: Record<string, { label: string; desc: string }> = {
              analyze: { label: 'Analyze', desc: 'Processes observations + conversations' },
              suggest: { label: 'Suggest', desc: 'Generates recommendations' },
              consolidate: { label: 'Consolidate', desc: 'Maintains memory layers' },
              runner: { label: 'Runner', desc: 'Executes accepted tasks' },
            };
            const defaults: Record<string, string> = { analyze: 'sonnet', suggest: 'opus', consolidate: 'sonnet', runner: 'sonnet' };
            const currentModels = (profile.preferences as Record<string, unknown>)?.models as Record<string, string> | undefined;
            const currentValue = currentModels?.[phase] ?? defaults[phase];
            return (
              <div key={phase}>
                <label className="flex items-center justify-between text-sm text-text-muted mb-1">
                  <span>{labels[phase].label}</span>
                  <SaveIndicator show={saved === `model_${phase}`} />
                </label>
                <p className="text-xs text-text-dim mb-2">{labels[phase].desc}</p>
                <select
                  defaultValue={currentValue}
                  onChange={async (e) => {
                    const newModels = { ...currentModels, [phase]: e.target.value };
                    await updateProfile({ preferences: { models: newModels } });
                    setSaved(`model_${phase}`);
                    setTimeout(() => setSaved(null), 2000);
                    refresh();
                  }}
                  className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm outline-none focus:border-accent transition-colors cursor-pointer"
                >
                  <option value="haiku">Haiku (fast, cheap)</option>
                  <option value="sonnet">Sonnet (balanced)</option>
                  <option value="opus">Opus (highest quality)</option>
                </select>
              </div>
            );
          })}
        </div>
      </section>

      {/* Focus mode */}
      <section className="bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold mb-4 flex items-center gap-2">
          Focus Mode
          {focusActive && (
            <span className="text-xs px-2 py-0.5 rounded-xl bg-green/15 text-green">Active</span>
          )}
        </h2>
        {focusActive ? (
          <div>
            {profile.focusUntil && (
              <p className="text-sm text-text-dim mb-3">
                Until: {new Date(profile.focusUntil).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
            <button
              onClick={async () => {
                await setFocusMode('available');
                refresh();
              }}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-border text-text border border-border cursor-pointer transition-all hover:bg-red/15 hover:text-red hover:border-red/30"
            >
              Disable Focus
            </button>
          </div>
        ) : (
          <div className="flex gap-2 flex-wrap">
            {FOCUS_DURATIONS.map((d) => (
              <button
                key={d.value}
                onClick={async () => {
                  await setFocusMode('focus', d.value || undefined);
                  refresh();
                }}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-green/10 text-green border border-green/20 cursor-pointer transition-all hover:bg-green/20"
              >
                🎯 {d.label}
              </button>
            ))}
          </div>
        )}
        <p className="text-xs text-text-muted mt-3">In focus mode, Shadow only responds to direct questions.</p>
      </section>

      {/* Mood */}
      <section className="bg-card border border-border rounded-lg p-5">
        <h2 className="text-base font-semibold mb-4">Status</h2>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium block mb-1">
              Mood hint
              <SaveIndicator show={saved === 'moodHint'} />
            </label>
            <select
              defaultValue={profile.moodHint ?? 'neutral'}
              onChange={(e) => saveField('moodHint', e.target.value)}
              className="bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm outline-none focus:border-accent transition-colors cursor-pointer"
            >
              <option value="neutral">😐 Neutral</option>
              <option value="happy">😊 Happy</option>
              <option value="focused">🎯 Focused</option>
              <option value="tired">😴 Tired</option>
              <option value="excited">🚀 Excited</option>
              <option value="concerned">😟 Concerned</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">
              Energy level
              <SaveIndicator show={saved === 'energyLevel'} />
            </label>
            <select
              defaultValue={profile.energyLevel ?? ''}
              onChange={(e) => saveField('energyLevel', e.target.value || null)}
              className="bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm outline-none focus:border-accent transition-colors cursor-pointer"
            >
              <option value="">Not specified</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>
      </section>
    </div>
  );
}
