export function EmojiGuidePage() {
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold mb-2">Emoji &amp; Mascot Guide</h1>
      <p className="text-text-dim mb-8">All the emojis and ghost expressions Shadow uses in the status line and dashboard.</p>

      {/* Status Line Example */}
      <section className="bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold mb-3">Status Line</h2>
        <div className="bg-bg rounded-lg px-4 py-3 font-mono text-sm mb-4 space-y-1">
          <div><span className="text-purple">{'{•‿•}'}</span> ready | 😐🔋 🔍 | ♥ 12m</div>
          <div><span className="text-cyan">{'{°_°}..'}</span> analyzing | 🎯⚡️ 💬 | 💡2 | ♥ now</div>
          <div><span className="text-green">{'{•ᴗ•}💡'}</span> thinking | 😊⚡️ 💬 | ♥ 15m</div>
        </div>
        <p className="text-sm text-text-dim">
          <span className="text-text">Ghost mascot</span> + <span className="text-text">state</span> | <span className="text-text">mood + energy + trust</span> | <span className="text-text">notifications</span> | <span className="text-text">heartbeat countdown</span>
        </p>
      </section>

      {/* Ghost Mascot */}
      <section className="bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold mb-4">Ghost Mascot</h2>
        <p className="text-sm text-text-dim mb-3">Shadow&apos;s face in the status line. Changes expression based on state, with random micro-variations between refreshes. Color indicates activity type.</p>
        <GhostTable rows={[
          ['purple', '{•‿•}', '{•_•}', '{•‿•}♪', 'ready (neutral)', 'Idle, waiting'],
          ['green', '{•ᴗ•}', '{•ᴗ•}♪', '{•‿•}~', 'ready (happy)', 'Idle, good mood'],
          ['cyan', '{•‿•}', '{•.•}', '{•_•}.', 'watching', 'Few recent interactions'],
          ['cyan', '{°_°}', '{°‿°}', '{°_°}~', 'learning', 'Many interactions, absorbing'],
          ['yellow', '{°_°}..', '{°_°}...', '{°.°}..', 'analyzing', 'Heartbeat: extract + observe'],
          ['green', '{•ᴗ•}💡', '{•‿•}💡', '{•ᴗ•}!', 'suggesting', 'Heartbeat: generating ideas'],
          ['yellow', '{•_•}⚙', '{•‿•}⚙', '{•_•}~', 'consolidating', 'Heartbeat: memory maintenance'],
          ['blue', '{-_-}~', '{-‿-}~', '{-_-}..', 'reflecting', 'Daily soul reflection'],
          ['purple', '{•̀_•́}', '{•̀‿•́}', '{•̀_•́}▸', 'focus', 'Focus mode active'],
          ['dim', '{-_-}z', '{-_-}zz', '{-‿-}zzZ', 'sleeping', 'Daemon off'],
          ['dim', '{-_-}', '{-_-}.', '{-‿-}', 'tired', 'Mood: tired'],
          ['red', '{>_<}', '{>_<}!', '{>.<}', 'frustrated', 'Mood: frustrated'],
          ['yellow', '{•~•}', '{•~•}?', '{•_•}?', 'concerned', 'Mood: concerned'],
          ['green', '{•ᴗ•}!', '{•ᴗ•}!!', '{•ᴗ•}♪', 'excited', 'Mood: excited'],
        ]} />
      </section>

      {/* Trust Badge */}
      <section className="bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold mb-4">Trust Badge</h2>
        <p className="text-sm text-text-dim mb-3">Your trust level with Shadow. Grows with usage.</p>
        <Table rows={[
          ['🔍', 'observer (0-15)', 'Read-only. Teach memories, view observations.'],
          ['💬', 'advisor (15-35)', 'Generate suggestions. Accept → run plans.'],
          ['🤝', 'assistant (35-60)', 'Execute tasks. Pre-loaded CLI sessions.'],
          ['⚡️', 'partner (60-85)', 'Autonomous execution with review. Worktrees.'],
          ['👾', 'shadow (85-100)', 'Full autonomy. Branch, test, PR.'],
        ]} />
      </section>

      {/* Mood */}
      <section className="bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold mb-4">Mood</h2>
        <p className="text-sm text-text-dim mb-3">Auto-inferred from your conversations by the heartbeat. Also affects ghost expression.</p>
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

const COLOR_CLASSES: Record<string, string> = {
  purple: 'text-purple',
  cyan: 'text-cyan',
  yellow: 'text-orange',
  green: 'text-green',
  blue: 'text-blue',
  red: 'text-red',
  dim: 'text-text-muted',
};

function GhostTable({ rows }: { rows: [string, string, string, string, string, string][] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-bg">
            <th className="text-left px-4 py-2 text-text-dim font-medium w-20">Color</th>
            <th className="text-left px-4 py-2 text-text-dim font-medium">V1</th>
            <th className="text-left px-4 py-2 text-text-dim font-medium">V2</th>
            <th className="text-left px-4 py-2 text-text-dim font-medium">V3</th>
            <th className="text-left px-4 py-2 text-text-dim font-medium w-32">State</th>
            <th className="text-left px-4 py-2 text-text-dim font-medium">When</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([color, v1, v2, v3, state, when], i) => {
            const cls = COLOR_CLASSES[color] ?? 'text-text';
            return (
              <tr key={i} className="border-t border-border hover:bg-card-hover transition-colors">
                <td className="px-4 py-2.5">
                  <span className={`inline-block w-3 h-3 rounded-full ${color === 'purple' ? 'bg-purple' : color === 'cyan' ? 'bg-cyan' : color === 'yellow' ? 'bg-orange' : color === 'green' ? 'bg-green' : color === 'blue' ? 'bg-blue' : color === 'red' ? 'bg-red' : 'bg-text-muted'}`} />
                </td>
                <td className={`px-4 py-2.5 font-mono ${cls}`}>{v1}</td>
                <td className={`px-4 py-2.5 font-mono ${cls}`}>{v2}</td>
                <td className={`px-4 py-2.5 font-mono ${cls}`}>{v3}</td>
                <td className="px-4 py-2.5 font-mono text-text">{state}</td>
                <td className="px-4 py-2.5 text-text-dim">{when}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
