import { useState, useEffect } from 'react';
import type { UserProfile } from '../../../api/types';
import { SaveIndicator } from '../../common/SettingsField';

type Props = {
  profile: UserProfile;
  saved: string | null;
  onSave: (field: string, value: unknown) => Promise<void>;
  onDebouncedSave: (field: string, value: unknown) => void;
  onSavePreference: (key: string, value: unknown) => Promise<void>;
  visible: boolean;
};

const DAILY_BUDGET_DEFAULT = 1_000_000;

const SELECT_CLASS = 'bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm outline-none focus:border-accent transition-colors cursor-pointer';

const PROACTIVITY_TIERS = [
  { value: 1, label: 'Silent', description: 'Only critical alerts' },
  { value: 4, label: 'Low', description: 'Important stuff only' },
  { value: 6, label: 'Normal', description: 'Balanced' },
  { value: 9, label: 'High', description: 'Show me everything' },
] as const;

function proactivityToTier(level: number): number {
  if (level <= 3) return 1;
  if (level <= 5) return 4;
  if (level <= 7) return 6;
  return 9;
}

export function tierLabel(level: number): string {
  if (level <= 3) return 'Silent';
  if (level <= 5) return 'Low';
  if (level <= 7) return 'Normal';
  return 'High';
}

export function SectionBehavior({ profile, saved, onSave, onSavePreference, visible }: Props) {
  const [localProactivity, setLocalProactivity] = useState(profile.proactivityLevel);
  const prefsBudget = (profile.preferences as Record<string, unknown> | undefined)?.dailyTokenBudget;
  const initialBudget = typeof prefsBudget === 'number' ? prefsBudget : DAILY_BUDGET_DEFAULT;
  const [budgetInput, setBudgetInput] = useState(String(initialBudget));

  useEffect(() => {
    setLocalProactivity(profile.proactivityLevel);
  }, [profile.proactivityLevel]);

  useEffect(() => {
    const pb = (profile.preferences as Record<string, unknown> | undefined)?.dailyTokenBudget;
    setBudgetInput(String(typeof pb === 'number' ? pb : DAILY_BUDGET_DEFAULT));
  }, [profile.preferences]);

  const commitBudget = () => {
    const n = Math.max(0, Math.floor(Number(budgetInput) || 0));
    setBudgetInput(String(n));
    onSavePreference('dailyTokenBudget', n);
  };

  return (
    <section
      id="section-behavior"
      className={`bg-card border border-border rounded-lg p-5 mb-6 transition-opacity ${
        visible ? '' : 'opacity-20 pointer-events-none'
      }`}
    >
      <h2 className="text-base font-semibold mb-4">Behavior</h2>
      <div className="space-y-6">
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium">Proactivity</label>
            <SaveIndicator show={saved === 'proactivityLevel'} />
          </div>
          <p className="text-xs text-text-muted mb-2">How much Shadow shares with you proactively</p>
          <div className="flex gap-1.5">
            {PROACTIVITY_TIERS.map((tier) => (
              <button
                key={tier.value}
                onClick={() => { setLocalProactivity(tier.value); onSave('proactivityLevel', tier.value); }}
                className={`flex-1 px-2 py-2 rounded-lg text-xs border-none cursor-pointer transition-colors text-center ${
                  proactivityToTier(localProactivity) === tier.value
                    ? 'bg-accent-soft text-accent'
                    : 'bg-border/50 text-text-muted hover:text-text'
                }`}
              >
                <div className="font-medium">{tier.label}</div>
                <div className="text-[10px] mt-0.5 opacity-70">{tier.description}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium">Daily token budget</label>
            <SaveIndicator show={saved === 'dailyTokenBudget'} />
          </div>
          <p className="text-xs text-text-muted mb-2">
            Soft cap on Shadow&apos;s LLM spend per 24h. When exceeded, deferrable jobs
            (consolidate, reflect, digests, chronicle lore, deep scans) skip with a logged
            reason. Heartbeat, runner executions, and your direct MCP calls always run.
            Set to 0 to disable the cap.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              step={50_000}
              value={budgetInput}
              onChange={(e) => setBudgetInput(e.target.value)}
              onBlur={commitBudget}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              className="w-40 bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm outline-none focus:border-accent transition-colors"
            />
            <span className="text-xs text-text-muted">tokens / 24h</span>
          </div>
        </div>
      </div>
    </section>
  );
}
