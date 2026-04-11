import { useState, useEffect, useMemo } from 'react';
import type { UserProfile } from '../../../api/types';
import { fetchRepos } from '../../../api/client';
import { Toggle } from '../../common/Toggle';
import { SaveIndicator } from '../../common/SettingsField';

type Props = {
  profile: UserProfile;
  saved: string | null;
  onSavePreference: (key: string, value: unknown) => Promise<void>;
  visible: boolean;
};

type Repo = { id: string; name: string };

type RulesConfig = {
  enabled: boolean;
  effortMax: string;
  riskMax: number;
  impactMin: number;
  confidenceMin: number;
  minAgeHours?: number;
  kinds: string[];
  repoIds: string[];
  maxPerJob: number;
};

type AutonomyConfig = {
  planRules: RulesConfig;
  executeRules: RulesConfig;
};

const PLAN_DEFAULTS: RulesConfig = {
  enabled: false, effortMax: 'medium', riskMax: 3, impactMin: 3,
  confidenceMin: 60, minAgeHours: 5, kinds: [], repoIds: [], maxPerJob: 3,
};
const EXECUTE_DEFAULTS: RulesConfig = {
  enabled: false, effortMax: 'small', riskMax: 2, impactMin: 3,
  confidenceMin: 70, kinds: ['refactor', 'improvement'], repoIds: [], maxPerJob: 3,
};

const ALL_KINDS = ['refactor', 'improvement', 'bug', 'feature'];
const EFFORT_OPTIONS = ['small', 'medium', 'large'];
const SELECT_CLASS = 'bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm outline-none focus:border-accent transition-colors cursor-pointer';

function getAutonomy(profile: UserProfile): AutonomyConfig {
  const prefs = profile.preferences as Record<string, unknown> | undefined;
  const raw = (prefs?.autonomy ?? {}) as Partial<AutonomyConfig>;
  return {
    planRules: { ...PLAN_DEFAULTS, ...raw.planRules },
    executeRules: { ...EXECUTE_DEFAULTS, ...raw.executeRules },
  };
}

// --- Range slider component ---

function RangeField({ label, value, min, max, step, onChange, formatValue }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  formatValue?: (v: number) => string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs text-text-dim">{label}</label>
        <span className="text-xs font-mono text-text">{formatValue ? formatValue(value) : value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step ?? 1}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1.5 bg-border rounded-full appearance-none cursor-pointer accent-accent"
      />
    </div>
  );
}

// --- Rules panel (used inside tabs) ---

function RulesPanel({ rules, onChange, showMinAge }: {
  rules: RulesConfig;
  onChange: (updates: Partial<RulesConfig>) => void;
  showMinAge?: boolean;
}) {
  return (
    <div className="space-y-4 pt-3">
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <div>
          <label className="text-xs text-text-dim block mb-1">Effort max</label>
          <select value={rules.effortMax} onChange={e => onChange({ effortMax: e.target.value })} className={SELECT_CLASS}>
            {EFFORT_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-text-dim block mb-1">Max per job</label>
          <select value={String(rules.maxPerJob)} onChange={e => onChange({ maxPerJob: Number(e.target.value) })} className={SELECT_CLASS}>
            {[1, 2, 3, 5, 10].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>

      <RangeField label="Risk max" value={rules.riskMax} min={1} max={5} onChange={v => onChange({ riskMax: v })} />
      <RangeField label="Impact min" value={rules.impactMin} min={1} max={5} onChange={v => onChange({ impactMin: v })} />
      <RangeField label="Confidence min" value={rules.confidenceMin} min={0} max={100} step={5} onChange={v => onChange({ confidenceMin: v })} formatValue={v => `${v}%`} />
      {showMinAge && (
        <RangeField label="Min age" value={rules.minAgeHours ?? 5} min={1} max={48} onChange={v => onChange({ minAgeHours: v })} formatValue={v => `${v}h`} />
      )}

      <div>
        <label className="text-xs text-text-dim block mb-1.5">Kinds {rules.kinds.length === 0 && <span className="text-text-muted">(all)</span>}</label>
        <div className="flex gap-2 flex-wrap">
          {ALL_KINDS.map(k => (
            <label key={k} className="flex items-center gap-1 text-xs text-text cursor-pointer">
              <input
                type="checkbox"
                checked={rules.kinds.length === 0 || rules.kinds.includes(k)}
                onChange={e => {
                  if (rules.kinds.length === 0) {
                    onChange({ kinds: e.target.checked ? [k] : ALL_KINDS.filter(x => x !== k) });
                  } else {
                    const next = e.target.checked
                      ? [...rules.kinds, k]
                      : rules.kinds.filter(x => x !== k);
                    onChange({ kinds: next.length === ALL_KINDS.length ? [] : next });
                  }
                }}
                className="accent-accent"
              />
              {k}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- Main section ---

export function SectionAutonomy({ profile, saved, onSavePreference, visible }: Props) {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [activeTab, setActiveTab] = useState<'plan' | 'execute'>('plan');
  const [repoSearch, setRepoSearch] = useState('');
  const autonomy = getAutonomy(profile);
  const masterEnabled = autonomy.planRules.enabled || autonomy.executeRules.enabled;

  useEffect(() => {
    fetchRepos().then(data => { if (data) setRepos(data); });
  }, []);

  const save = (next: AutonomyConfig) => {
    onSavePreference('autonomy', next);
  };

  const toggleMaster = (on: boolean) => {
    save({
      planRules: { ...autonomy.planRules, enabled: on },
      executeRules: { ...autonomy.executeRules, enabled: on },
    });
  };

  const updatePlanRules = (updates: Partial<RulesConfig>) => {
    save({ ...autonomy, planRules: { ...autonomy.planRules, ...updates } });
  };

  const updateExecuteRules = (updates: Partial<RulesConfig>) => {
    save({ ...autonomy, executeRules: { ...autonomy.executeRules, ...updates } });
  };

  const toggleRepo = (repoId: string, target: 'plan' | 'execute') => {
    const rules = target === 'plan' ? autonomy.planRules : autonomy.executeRules;
    const update = target === 'plan' ? updatePlanRules : updateExecuteRules;
    const next = rules.repoIds.includes(repoId)
      ? rules.repoIds.filter(id => id !== repoId)
      : [...rules.repoIds, repoId];
    update({ repoIds: next });
  };

  // Repos currently opted-in (shown as chips)
  const enabledRepos = useMemo(() => {
    const ids = new Set([...autonomy.planRules.repoIds, ...autonomy.executeRules.repoIds]);
    return repos.filter(r => ids.has(r.id));
  }, [repos, autonomy.planRules.repoIds, autonomy.executeRules.repoIds]);

  // Search results: repos not yet opted-in, filtered by query
  const searchResults = useMemo(() => {
    if (!repoSearch.trim()) return [];
    const ids = new Set([...autonomy.planRules.repoIds, ...autonomy.executeRules.repoIds]);
    const q = repoSearch.toLowerCase();
    return repos.filter(r => !ids.has(r.id) && r.name.toLowerCase().includes(q)).slice(0, 8);
  }, [repos, repoSearch, autonomy.planRules.repoIds, autonomy.executeRules.repoIds]);

  const addRepo = (repoId: string) => {
    // Add to plan by default when first opting in
    updatePlanRules({ repoIds: [...autonomy.planRules.repoIds, repoId] });
    setRepoSearch('');
  };

  const removeRepo = (repoId: string) => {
    // Remove from both plan and execute
    save({
      planRules: { ...autonomy.planRules, repoIds: autonomy.planRules.repoIds.filter(id => id !== repoId) },
      executeRules: { ...autonomy.executeRules, repoIds: autonomy.executeRules.repoIds.filter(id => id !== repoId) },
    });
  };

  return (
    <section
      id="section-autonomy"
      className={`bg-card border border-border rounded-lg p-5 mb-6 transition-opacity ${visible ? '' : 'opacity-20 pointer-events-none'}`}
    >
      <h2 className="text-base font-semibold mb-1">Autonomy</h2>
      <p className="text-sm text-text-dim mb-4">
        Shadow can autonomously plan and execute suggestions that pass configurable safety gates.
      </p>

      <div className="flex items-center justify-between mb-4">
        <div>
          <label className="text-sm font-medium">Enabled</label>
          <p className="text-xs text-text-dim">Enable autonomous planning and execution</p>
        </div>
        <div className="flex items-center gap-2">
          <SaveIndicator show={saved === 'autonomy'} />
          <Toggle checked={masterEnabled} onChange={toggleMaster} />
        </div>
      </div>

      {masterEnabled && (
        <div className="space-y-4">
          {/* Tab bar */}
          <div className="flex border-b border-border">
            <button
              onClick={() => setActiveTab('plan')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
                activeTab === 'plan'
                  ? 'border-accent text-accent'
                  : 'border-transparent text-text-dim hover:text-text'
              }`}
            >
              Plan Rules
              <span className="text-[10px] text-text-muted ml-1.5">(wider)</span>
            </button>
            <button
              onClick={() => setActiveTab('execute')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
                activeTab === 'execute'
                  ? 'border-accent text-accent'
                  : 'border-transparent text-text-dim hover:text-text'
              }`}
            >
              Execute Rules
              <span className="text-[10px] text-text-muted ml-1.5">(strict)</span>
            </button>
          </div>

          {/* Tab content */}
          {activeTab === 'plan' && (
            <RulesPanel rules={autonomy.planRules} onChange={updatePlanRules} showMinAge />
          )}
          {activeTab === 'execute' && (
            <>
              <RulesPanel rules={autonomy.executeRules} onChange={updateExecuteRules} />
              <div className="border border-border rounded-lg p-3 bg-amber-500/5">
                <p className="text-xs text-amber-300">
                  Execution requires HIGH confidence with zero doubts from the LLM evaluator. This is not configurable.
                </p>
              </div>
            </>
          )}

          {/* Repository Opt-in */}
          <div className="pt-2">
            <label className="text-sm font-medium mb-1 block">Repository Opt-in</label>
            <p className="text-xs text-text-dim mb-3">Search to add repos. Autonomy is OFF for all repos by default.</p>

            {/* Search input */}
            <div className="relative mb-3">
              <input
                type="text"
                value={repoSearch}
                onChange={e => setRepoSearch(e.target.value)}
                placeholder="Search repos to add..."
                className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text outline-none focus:border-accent transition-colors"
              />
              {/* Search dropdown */}
              {searchResults.length > 0 && (
                <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {searchResults.map(repo => (
                    <button
                      key={repo.id}
                      onClick={() => addRepo(repo.id)}
                      className="w-full text-left px-3 py-2 text-sm text-text hover:bg-border/50 transition-colors cursor-pointer first:rounded-t-lg last:rounded-b-lg"
                    >
                      {repo.name}
                    </button>
                  ))}
                </div>
              )}
              {repoSearch.trim() && searchResults.length === 0 && (
                <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg px-3 py-2">
                  <span className="text-xs text-text-muted">No repos found</span>
                </div>
              )}
            </div>

            {/* Enabled repos */}
            {enabledRepos.length === 0 && (
              <p className="text-xs text-text-muted">No repos enabled yet.</p>
            )}
            <div className="space-y-1.5">
              {enabledRepos.map(repo => {
                const planEnabled = autonomy.planRules.repoIds.includes(repo.id);
                const execEnabled = autonomy.executeRules.repoIds.includes(repo.id);
                return (
                  <div key={repo.id} className="flex items-center justify-between px-3 py-2 border border-border rounded-lg bg-bg group">
                    <span className="text-sm text-text">{repo.name}</span>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1 text-xs text-text-dim cursor-pointer">
                        <input type="checkbox" checked={planEnabled} onChange={() => toggleRepo(repo.id, 'plan')} className="accent-accent" />
                        Plan
                      </label>
                      <label className="flex items-center gap-1 text-xs text-text-dim cursor-pointer">
                        <input type="checkbox" checked={execEnabled} onChange={() => toggleRepo(repo.id, 'execute')} className="accent-accent" />
                        Execute
                      </label>
                      <button
                        onClick={() => removeRepo(repo.id)}
                        className="text-text-muted hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 cursor-pointer text-sm"
                        title="Remove repo"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
