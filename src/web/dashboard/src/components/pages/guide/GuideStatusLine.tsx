export function GuideStatusLine() {
  return (
    <>
      {/* Status Line Example */}
      <section className="bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold mb-3">Status Line</h2>
        <pre className="bg-bg rounded-lg px-4 py-3 font-mono text-sm mb-4 whitespace-pre leading-loose">
{`{•\u203F•} ready | \uD83D\uDE10\uD83D\uDD0B \uD83D\uDD0D | \uD83D\uDCCB shadow | \uD83D\uDCA13 | \u2665 12m
{°_°}.. analyzing | \uD83C\uDFAF\u26A1 \uD83D\uDCAC | \uD83D\uDCCB my-project | \u2665 now
{•_•}\uD83D\uDD17 enriching | \uD83D\uDE10\uD83D\uDD0B \u26A1 | \u2665 28m
{•_•}\uD83D\uDD04 syncing | \uD83D\uDE0A\u26A1 \u26A1 | \u2665 15m`}
        </pre>
        <p className="text-sm text-text-dim">
          <span className="text-text">Ghost mascot</span> + <span className="text-text">state</span> | <span className="text-text">mood + energy + trust</span> | <span className="text-text">active project</span> | <span className="text-text">notifications</span> | <span className="text-text">heartbeat countdown</span>
        </p>
      </section>

      {/* Ghost Mascot */}
      <section className="bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold mb-4">Ghost Mascot</h2>
        <p className="text-sm text-text-dim mb-3">Shadow&apos;s face in the status line. Changes expression based on state, with random micro-variations between refreshes. Color indicates activity type.</p>
        <GhostTable rows={[
          ['purple', '{•\u203F•}', '{•_•}', '{•\u203F•}\u266A', 'ready (neutral)', 'Idle, waiting'],
          ['green', '{•\u1D57•}', '{•\u1D57•}\uD83C\uDFB6', '{•\u203F•}\uD83C\uDFD3', 'ready (happy)', 'Idle, good mood'],
          ['cyan', '{•\u203F•}', '{•.•}', '{•_•}.', 'watching', 'Few recent interactions'],
          ['cyan', '{°_°}\uD83D\uDCDA', '{°\u203F°}\u270F\uFE0F', '{°_°}\uD83D\uDCD6', 'learning', 'Many interactions, absorbing'],
          ['cyan', '{•\u203F•}\uD83D\uDC41\uFE0F', '{•.•}\uD83D\uDC40', '{•_•}\uD83D\uDD0E', 'observing', 'Heartbeat: scanning repos'],
          ['yellow', '{•_•}\uD83E\uDDF9', '{•\u203F•}\u267B\uFE0F', '{•_•}\uD83D\uDDD1\uFE0F', 'cleaning', 'Heartbeat: observation cleanup'],
          ['yellow', '{°_°}..', '{°_°}...', '{°.°}\uD83D\uDD0E', 'analyzing', 'Heartbeat: extract + observe'],
          ['green', '{•\u1D57•}\uD83D\uDCA1', '{•\u203F•}\uD83D\uDCA1', '{•\u1D57•}!', 'suggesting', 'Heartbeat: generating ideas'],
          ['yellow', '{•_•}\u2699', '{•\u203F•}\u2699', '{•_•}~', 'consolidating', 'Heartbeat: memory maintenance'],
          ['blue', '{-_-}~', '{-\u203F-}~', '{-_-}\uD83D\uDCAD', 'reflecting', 'Daily soul reflection'],
          ['teal', '{•_•}\uD83D\uDD17', '{•\u203F•}\uD83D\uDCE1', '{•_•}\uD83C\uDF10', 'enriching', 'MCP context enrichment'],
          ['pink', '{•_•}\uD83D\uDD04', '{•\u203F•}\u2B07\uFE0F', '{•_•}\uD83D\uDCE5', 'syncing', 'Git remote sync'],
          ['purple', '{•\u0300_•\u0301}', '{•\u0300\u203F•\u0301}', '{•\u0300_•\u0301}\u25B8', 'focus', 'Focus mode active'],
          ['dim', '{-_-}z', '{-_-}zz', '{-\u203F-}zzZ', 'sleeping', 'Daemon off'],
          ['dim', '{-_-}', '{-_-}.', '{-\u203F-}', 'tired', 'Mood: tired'],
          ['red', '{>_<}', '{>_<}!', '{>.<}', 'frustrated', 'Mood: frustrated'],
          ['yellow', '{•~•}', '{•~•}?', '{•_•}?', 'concerned', 'Mood: concerned'],
          ['green', '{•\u1D57•}!', '{•\u1D57•}!!', '{•\u1D57•}\u266A', 'excited', 'Mood: excited'],
        ]} />
      </section>

      {/* Trust Badge */}
      <section className="bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold mb-4">Trust Badge</h2>
        <p className="text-sm text-text-dim mb-3">Your trust level with Shadow. Grows with usage.</p>
        <Table rows={[
          ['\uD83D\uDD0D', 'observer (0-15)', 'Read-only. Teach memories, view observations.'],
          ['\uD83D\uDCAC', 'advisor (15-35)', 'Generate suggestions. Accept \u2192 run plans.'],
          ['\uD83E\uDD1D', 'assistant (35-60)', 'Execute tasks. Pre-loaded CLI sessions.'],
          ['\u26A1\uFE0F', 'partner (60-85)', 'Autonomous execution with review. Worktrees.'],
          ['\uD83D\uDC7E', 'shadow (85-100)', 'Full autonomy. Branch, test, PR.'],
        ]} />
      </section>

      {/* Mood */}
      <section className="bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold mb-4">Mood</h2>
        <p className="text-sm text-text-dim mb-3">Auto-inferred from your conversations by the heartbeat. Also affects ghost expression.</p>
        <Table rows={[
          ['\uD83D\uDE10', 'neutral', 'Default / unclear mood'],
          ['\uD83D\uDE0A', 'happy', 'Positive tone, celebrating wins'],
          ['\uD83C\uDFAF', 'focused', 'Deep in implementation, concentrated'],
          ['\uD83D\uDE34', 'tired', 'Late-night work, short messages'],
          ['\uD83D\uDE24', 'frustrated', 'Complaining about bugs/issues'],
          ['\uD83E\uDD29', 'excited', 'Enthusiastic about new features/ideas'],
          ['\uD83E\uDD14', 'concerned', 'Discussing risks or problems'],
        ]} />
      </section>

      {/* Energy */}
      <section className="bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold mb-4">Energy</h2>
        <p className="text-sm text-text-dim mb-3">Auto-inferred from activity patterns and time of day.</p>
        <Table rows={[
          ['\u26A1\uFE0F', 'high', 'Lots of activity and engagement'],
          ['\uD83D\uDD0B', 'normal', 'Regular pace'],
          ['\uD83E\uDEAB', 'low', 'Sparse activity or late-night work'],
        ]} />
      </section>

      {/* Notifications */}
      <section className="bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold mb-4">Notifications</h2>
        <p className="text-sm text-text-dim mb-3">Shown at the end of the status line when there&apos;s something pending.</p>
        <Table rows={[
          ['\uD83D\uDCA13', 'suggestions', '3 pending suggestions to review'],
          ['\u2665 12m', 'heartbeat', 'Next heartbeat in 12 minutes'],
          ['\u2665 now', 'heartbeat', 'Heartbeat running right now'],
        ]} />
      </section>

      {/* Memory Layers */}
      <section className="bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold mb-4">Memory Layers</h2>
        <p className="text-sm text-text-dim mb-3">Color-coded in the dashboard memories view.</p>
        <Table rows={[
          ['\uD83D\uDFE3', 'core', 'Permanent knowledge. Never decays.'],
          ['\uD83D\uDD34', 'hot', 'Active context. Decays in 14 days without access.'],
          ['\uD83D\uDFE0', 'warm', 'Recent knowledge. Decays in 30 days.'],
          ['\uD83D\uDD35', 'cool', 'Archive. Decays in 90 days.'],
          ['\u26AA', 'cold', 'Passive archive. Lowest search priority.'],
        ]} />
      </section>
    </>
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
  teal: 'text-cyan',
  pink: 'text-pink-400',
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
                  <span className={`inline-block w-3 h-3 rounded-full ${color === 'purple' ? 'bg-purple' : color === 'cyan' ? 'bg-cyan' : color === 'yellow' ? 'bg-orange' : color === 'green' ? 'bg-green' : color === 'blue' ? 'bg-blue' : color === 'red' ? 'bg-red' : color === 'teal' ? 'bg-cyan' : color === 'pink' ? 'bg-pink-400' : 'bg-text-muted'}`} />
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
