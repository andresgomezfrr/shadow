import { CONFIG_GENERAL, CONFIG_PERSONALITY, CONFIG_TIMING, CONFIG_MODELS, CONFIG_EFFORTS, CONFIG_ADVANCED, type ConfigVar } from './guide-data';

export function GuideConfig() {
  return (
    <>
      <p className="text-sm text-text-dim mb-6">
        Shadow is configured via <span className="text-text">environment variables</span> (prefix <code className="text-accent bg-bg px-1.5 py-0.5 rounded text-xs">SHADOW_</code>).
        Set them in your shell profile or <code className="text-accent bg-bg px-1.5 py-0.5 rounded text-xs">.env</code> file in the Shadow directory.
        Most settings can also be changed from the <span className="text-text">/profile</span> page in the dashboard.
      </p>

      <ConfigSection title="General" vars={CONFIG_GENERAL} />
      <ConfigSection title="Personality" vars={CONFIG_PERSONALITY} />
      <ConfigSection title="Timing" vars={CONFIG_TIMING} />
      <ConfigSection title="Models" description="Which Claude model to use for each phase. Options: opus, sonnet, haiku." vars={CONFIG_MODELS} />
      <ConfigSection title="Effort Levels" description="Effort level per phase. Options: low, medium, high." vars={CONFIG_EFFORTS} />
      <ConfigSection title="Advanced" vars={CONFIG_ADVANCED} />

      {/* Autonomy */}
      <section className="bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold mb-2">Autonomy</h2>
        <p className="text-xs text-text-muted mb-3">
          Configured in <strong className="text-text-dim">Settings &rarr; Autonomy</strong>. Controls autonomous planning and execution of suggestions.
          Per-repo opt-in &mdash; repos must be explicitly enabled.
        </p>
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-medium text-text mb-2">Plan Rules (wider funnel)</h3>
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-bg">
                    <th className="text-left px-4 py-2 text-text-dim font-medium">Field</th>
                    <th className="text-left px-4 py-2 text-text-dim font-medium">Description</th>
                    <th className="text-left px-4 py-2 text-text-dim font-medium w-36">Default</th>
                  </tr>
                </thead>
                <tbody>
                  {AUTONOMY_PLAN_RULES.map((r) => (
                    <tr key={r.field} className="border-t border-border hover:bg-card-hover transition-colors">
                      <td className="px-4 py-2.5 font-mono text-xs text-accent whitespace-nowrap">{r.field}</td>
                      <td className="px-4 py-2.5 text-text-dim text-xs">{r.description}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-text-muted">{r.defaultVal}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <h3 className="text-sm font-medium text-text mb-2">Execute Rules (strict gate)</h3>
            <p className="text-xs text-text-muted mb-2">Same fields as plan rules, with tighter defaults. Plus a hardcoded safety gate: confidence must be HIGH with zero doubts (not configurable).</p>
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-bg">
                    <th className="text-left px-4 py-2 text-text-dim font-medium">Field</th>
                    <th className="text-left px-4 py-2 text-text-dim font-medium">Description</th>
                    <th className="text-left px-4 py-2 text-text-dim font-medium w-36">Default</th>
                  </tr>
                </thead>
                <tbody>
                  {AUTONOMY_EXECUTE_RULES.map((r) => (
                    <tr key={r.field} className="border-t border-border hover:bg-card-hover transition-colors">
                      <td className="px-4 py-2.5 font-mono text-xs text-accent whitespace-nowrap">{r.field}</td>
                      <td className="px-4 py-2.5 text-text-dim text-xs">{r.description}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-text-muted">{r.defaultVal}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <h3 className="text-sm font-medium text-text mb-2">Per-Repo Toggle</h3>
            <p className="text-xs text-text-dim">
              Each repo has an autonomy toggle (off by default). Only repos explicitly enabled will be considered by auto-plan and auto-execute jobs.
              Toggle repos in <strong className="text-text">Settings &rarr; Autonomy</strong>.
            </p>
          </div>
        </div>
      </section>

      {/* Tuning Tips */}
      <section className="bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold mb-4">Tuning Tips</h2>
        <div className="space-y-3 text-sm text-text-dim">
          <div className="bg-bg rounded-lg px-4 py-3">
            <span className="text-text font-medium">Token budget tight?</span> Set <code className="text-accent">SHADOW_MODEL_SUGGEST=sonnet</code> and <code className="text-accent">SHADOW_EFFORT_SUGGEST=medium</code>.
            Suggestions will be less creative but much cheaper.
          </div>
          <div className="bg-bg rounded-lg px-4 py-3">
            <span className="text-text font-medium">Too many notifications?</span> Lower <code className="text-accent">SHADOW_PROACTIVITY_LEVEL</code> to 2-3,
            or use <code className="text-accent">shadow profile focus 2h</code> for temporary silence.
          </div>
          <div className="bg-bg rounded-lg px-4 py-3">
            <span className="text-text font-medium">Heartbeat too frequent?</span> Increase <code className="text-accent">SHADOW_HEARTBEAT_INTERVAL_MS</code>.
            30 minutes (1800000) is a good balance for less active repos.
          </div>
          <div className="bg-bg rounded-lg px-4 py-3">
            <span className="text-text font-medium">Multiple repos?</span> Shadow watches up to {'{'}30{'}'} repos by default.
            The heartbeat collects context from all of them, but only generates observations for repos with recent activity.
          </div>
        </div>
      </section>
    </>
  );
}

type AutonomyRule = { field: string; description: string; defaultVal: string };

const AUTONOMY_PLAN_RULES: AutonomyRule[] = [
  { field: 'maxEffort', description: 'Maximum effort level for suggestions to auto-plan', defaultVal: 'low' },
  { field: 'maxRisk', description: 'Maximum risk score (0-10)', defaultVal: '3' },
  { field: 'minImpact', description: 'Minimum impact score (0-10)', defaultVal: '5' },
  { field: 'minConfidence', description: 'Minimum confidence score (0-10)', defaultVal: '7' },
  { field: 'minAgeHours', description: 'Minimum age before a suggestion is eligible (maturity filter)', defaultVal: '5' },
  { field: 'kinds', description: 'Allowed suggestion kinds (e.g. improvement, risk, pattern)', defaultVal: 'all' },
  { field: 'repos', description: 'Allowed repo IDs (per-repo opt-in)', defaultVal: 'none' },
];

const AUTONOMY_EXECUTE_RULES: AutonomyRule[] = [
  { field: 'maxEffort', description: 'Maximum effort level for plans to auto-execute', defaultVal: 'low' },
  { field: 'maxRisk', description: 'Maximum risk score (0-10)', defaultVal: '2' },
  { field: 'minImpact', description: 'Minimum impact score (0-10)', defaultVal: '6' },
  { field: 'minConfidence', description: 'Minimum confidence score (0-10)', defaultVal: '8' },
  { field: 'repos', description: 'Allowed repo IDs (per-repo opt-in)', defaultVal: 'none' },
];

function ConfigSection({ title, description, vars }: { title: string; description?: string; vars: ConfigVar[] }) {
  return (
    <section className="bg-card border border-border rounded-lg p-5 mb-6">
      <h2 className="text-base font-semibold mb-2">{title}</h2>
      {description && <p className="text-xs text-text-muted mb-3">{description}</p>}
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-bg">
              <th className="text-left px-4 py-2 text-text-dim font-medium">Variable</th>
              <th className="text-left px-4 py-2 text-text-dim font-medium">Description</th>
              <th className="text-left px-4 py-2 text-text-dim font-medium w-36">Default</th>
            </tr>
          </thead>
          <tbody>
            {vars.map((v) => (
              <tr key={v.envVar} className="border-t border-border hover:bg-card-hover transition-colors">
                <td className="px-4 py-2.5 font-mono text-xs text-accent whitespace-nowrap">{v.envVar}</td>
                <td className="px-4 py-2.5 text-text-dim text-xs">{v.description}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-text-muted">{v.defaultVal}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
