export function EmojiGuidePage() {
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold mb-2">Emoji Guide</h1>
      <p className="text-text-dim mb-8">All the emojis Shadow uses in the status line and dashboard.</p>

      {/* Status Line Example */}
      <section className="bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold mb-3">Status Line</h2>
        <div className="bg-bg rounded-lg px-4 py-3 font-mono text-sm mb-4">
          📝 Shadow learning | 🎯⚡️ 🔍 | 💡2 | ♥ 12m
        </div>
        <p className="text-sm text-text-dim">
          <span className="text-text">Activity</span> + Shadow + <span className="text-text">state</span> | <span className="text-text">mood + energy + trust badge</span> | <span className="text-text">notifications</span> | <span className="text-text">heartbeat countdown</span>
        </p>
      </section>

      {/* Activity State */}
      <section className="bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold mb-4">Activity State</h2>
        <p className="text-sm text-text-dim mb-3">What Shadow is currently doing.</p>
        <Table rows={[
          ['😴', 'sleeping', 'Daemon not running'],
          ['😊', 'ready', 'Daemon running, no recent activity'],
          ['👀', 'watching', 'Few recent interactions (1-5 in last 5 min)'],
          ['📝', 'learning', 'Many recent interactions (>5) — learning from your session'],
          ['🎯', 'focus', 'Focus mode active — Shadow is silent'],
          ['👀', 'observing', 'Heartbeat: scanning repos'],
          ['🧠', 'analyzing', 'Heartbeat: LLM analyzing observations + conversations'],
          ['💡', 'thinking', 'Heartbeat: LLM generating suggestions'],
          ['📦', 'consolidating', 'Heartbeat: maintaining memory layers'],
          ['📢', 'notifying', 'Heartbeat: queuing events'],
          ['⚙️', 'working', 'Heartbeat: other phase'],
        ]} />
      </section>

      {/* Trust Badge */}
      <section className="bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold mb-4">Trust Badge</h2>
        <p className="text-sm text-text-dim mb-3">Your trust level with Shadow. Grows with usage.</p>
        <Table rows={[
          ['🔍', 'observer (0-15)', 'Read-only. Teach memories, view observations.'],
          ['💬', 'advisor (15-35)', 'Generate suggestions. Trigger observations.'],
          ['🤝', 'assistant (35-60)', 'Execute small tasks. Communicate with contacts.'],
          ['⚡️', 'partner (60-85)', 'Auto-fix lint/types. Execute medium tasks.'],
          ['👾', 'shadow (85-100)', 'Create branches, propose PRs. Full autonomy.'],
        ]} />
      </section>

      {/* Mood */}
      <section className="bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold mb-4">Mood</h2>
        <p className="text-sm text-text-dim mb-3">Auto-inferred from your conversations by the heartbeat.</p>
        <Table rows={[
          ['😐', 'neutral', 'Default / unclear mood'],
          ['😊', 'happy', 'Positive tone, celebrating wins'],
          ['🎯', 'focused', 'Deep in implementation, concentrated'],
          ['😴', 'tired', 'Late-night work, short messages'],
          ['😤', 'frustrated', 'Complaining about bugs/issues'],
          ['🤩', 'excited', 'Enthusiastic about new features/ideas'],
          ['🤔', 'concerned', 'Discussing risks or problems'],
        ]} />
      </section>

      {/* Energy */}
      <section className="bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold mb-4">Energy</h2>
        <p className="text-sm text-text-dim mb-3">Auto-inferred from activity patterns and time of day.</p>
        <Table rows={[
          ['⚡️', 'high', 'Lots of activity and engagement'],
          ['🔋', 'normal', 'Regular pace'],
          ['🪫', 'low', 'Sparse activity or late-night work'],
        ]} />
      </section>

      {/* Notifications */}
      <section className="bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold mb-4">Notifications</h2>
        <p className="text-sm text-text-dim mb-3">Shown at the end of the status line when there&apos;s something pending.</p>
        <Table rows={[
          ['💡3', 'suggestions', '3 pending suggestions to review'],
          ['📬2', 'events', '2 pending events to acknowledge'],
          ['♥ 12m', 'heartbeat', 'Next heartbeat in 12 minutes'],
          ['♥ now', 'heartbeat', 'Heartbeat running right now'],
        ]} />
      </section>

      {/* Memory Layers */}
      <section className="bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold mb-4">Memory Layers</h2>
        <p className="text-sm text-text-dim mb-3">Color-coded in the dashboard memories view.</p>
        <Table rows={[
          ['🟣', 'core', 'Permanent knowledge. Never decays.'],
          ['🔴', 'hot', 'Active context. Decays in 14 days without access.'],
          ['🟠', 'warm', 'Recent knowledge. Decays in 30 days.'],
          ['🔵', 'cool', 'Archive. Decays in 90 days.'],
          ['⚪', 'cold', 'Passive archive. Lowest search priority.'],
        ]} />
      </section>
    </div>
  );
}

function Table({ rows }: { rows: [string, string, string][] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-bg">
            <th className="text-left px-4 py-2 text-text-dim font-medium w-16">Emoji</th>
            <th className="text-left px-4 py-2 text-text-dim font-medium w-40">Name</th>
            <th className="text-left px-4 py-2 text-text-dim font-medium">Meaning</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([emoji, name, meaning], i) => (
            <tr key={i} className="border-t border-border hover:bg-card-hover transition-colors">
              <td className="px-4 py-2.5 text-lg">{emoji}</td>
              <td className="px-4 py-2.5 font-mono text-text">{name}</td>
              <td className="px-4 py-2.5 text-text-dim">{meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
