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
