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
          <span className="text-text">Ghost mascot</span> + <span className="text-text">state</span> | <span className="text-text">mood + energy + bond</span> | <span className="text-text">active project</span> | <span className="text-text">notifications</span> | <span className="text-text">heartbeat countdown</span>
        </p>
      </section>

      {/* Ghost Mascot */}
      <section className="bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold mb-4">Ghost Mascot</h2>
        <p className="text-sm text-text-dim mb-3">Shadow&apos;s face in the status line. Changes expression based on state, with random micro-variations between refreshes. Color indicates activity type.</p>
        <p className="text-xs text-text-muted mb-3 italic">Grouped by: job activity → idle states → mood states → system states</p>
        <GhostTable rows={[
          // --- Job activity states ---
          ['yellow', '{°_°}', '{°.°}', '{°_°}.', 'observing', 'Heartbeat: scanning git + conversations for changes'],
          ['yellow', '{•_•}\uD83E\uDDF9', '{•\u203F•}\u267B\uFE0F', '{•_•}\uD83D\uDDD1\uFE0F', 'cleaning', 'Heartbeat: resolving obsolete observations via MCP'],
          ['yellow', '{°_°}..', '{°_°}...', '{°.°}\uD83D\uDD0E', 'analyzing', 'Heartbeat: extracting memories + generating observations'],
          ['green', '{•\u1D57•}\uD83D\uDCA1', '{•\u203F•}\uD83D\uDCA1', '{•\u1D57•}!', 'suggesting', 'Suggest job: incremental suggestions for active repos'],
          ['green', '{°.°}\uD83D\uDD2C', '{°_°}\uD83D\uDD0D', '{°\u203F°}\uD83E\uDDEC', 'deep-scan', 'Suggest-deep: full codebase review with tool access'],
          ['green', '{•\u1D57•}\uD83D\uDD17', '{•\u203F•}\uD83C\uDF10', '{•\u1D57•}\uD83D\uDD78\uFE0F', 'cross-repo', 'Suggest-project: cross-repo analysis for a project'],
          ['green', '{°.°}\u2713', '{°\u203F°}\u2611\uFE0F', '{°_°}\uD83C\uDFAF', 'validating', 'Suggest validation phase: verifying suggestions against code'],
          ['yellow', '{•_•}\u2699', '{•\u203F•}\u2699', '{•_•}~', 'consolidating', 'Consolidate: memory layer maintenance (every 6h)'],
          ['yellow', '{•\u0300_•\u0301}\u270F\uFE0F', '{•\u0300\u203F•\u0301}\uD83D\uDCDD', '{•\u0300_•\u0301}\uD83D\uDD27', 'correcting', 'Consolidate: enforcing user corrections on memories'],
          ['yellow', '{•~•}\uD83E\uDDE9', '{•\u203F•}\uD83D\uDD00', '{•~•}\uD83E\uDEC2', 'merging', 'Consolidate: combining similar memories via LLM'],
          ['blue', '{-_-}~', '{-\u203F-}~', '{-_-}\uD83D\uDCAD', 'reflecting', 'Reflect job: daily soul reflection (Opus)'],
          ['teal', '{•_•}\uD83D\uDD17', '{•\u203F•}\uD83D\uDCE1', '{•_•}\uD83C\uDF10', 'enriching', 'Context-enrich: querying external MCP servers (every 2h)'],
          ['pink', '{•_•}\uD83D\uDD04', '{•\u203F•}\u2B07\uFE0F', '{•_•}\uD83D\uDCE5', 'syncing', 'Remote-sync: git ls-remote to detect new commits (every 30m)'],
          ['teal', '{•_•}\uD83D\uDCCB', '{•\u203F•}\uD83D\uDCCB', '{•_•}\uD83D\uDD0D', 'profiling', 'Repo-profile: LLM analysis of repo context (reactive)'],
          ['teal', '{°_°}\uD83D\uDCD0', '{°\u203F°}\uD83D\uDCCA', '{°.°}\uD83D\uDDFA\uFE0F', 'mapping', 'Project-profile: cross-repo project context (reactive)'],
          ['violet', '{•_•}\uD83D\uDCCB', '{•\u203F•}\uD83D\uDCDD', '{•_•}\uD83D\uDCC2', 'planning', 'Auto-plan: revalidating suggestions and creating plan runs'],
          ['violet', '{°_°}\u25B6\uFE0F', '{°\u203F°}\u2699\uFE0F', '{°_°}\uD83D\uDE80', 'auto-executing', 'Auto-execute: executing high-confidence plans in worktrees'],
          ['cyan', '{-\u203F-}\uD83D\uDCDD', '{-_-}\u270D\uFE0F', '{-\u203F-}\uD83D\uDCC4', 'writing', 'Digest jobs: generating standup / weekly / brag doc'],
          // --- Idle states ---
          ['purple', '{•\u203F•}', '{•_•}', '{•\u203F•}\u266A', 'ready', 'Daemon idle, no jobs running'],
          ['cyan', '{•\u203F•}', '{•.•}', '{•_•}.', 'watching', 'Idle with few recent interactions'],
          ['cyan', '{°_°}\uD83D\uDCDA', '{°\u203F°}\u270F\uFE0F', '{°_°}\uD83D\uDCD6', 'learning', 'Idle with many recent interactions (absorbing)'],
          // --- Mood states (idle only) ---
          ['green', '{•\u1D57•}', '{•\u1D57•}\uD83C\uDFB6', '{•\u203F•}\uD83C\uDFD3', 'happy', 'Mood: positive tone detected in conversations'],
          ['green', '{•\u1D57•}!', '{•\u1D57•}!!', '{•\u1D57•}\u266A', 'excited', 'Mood: enthusiastic about new features/ideas'],
          ['yellow', '{•~•}', '{•~•}?', '{•_•}?', 'concerned', 'Mood: discussing risks or problems'],
          ['dim', '{-_-}', '{-_-}.', '{-\u203F-}', 'tired', 'Mood: late-night work or low activity'],
          ['red', '{>_<}', '{>_<}!', '{>.<}', 'frustrated', 'Mood: complaining about bugs/issues'],
          // --- System states ---
          ['purple', '{•\u0300_•\u0301}', '{•\u0300\u203F•\u0301}', '{•\u0300_•\u0301}\u25B8', 'focus', 'Focus mode active (minimal interruptions)'],
          ['dim', '{-_-}z', '{-_-}zz', '{-\u203F-}zzZ', 'sleeping', 'Daemon not running'],
        ]} />
      </section>

      {/* Bond Badge */}
      <section className="bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold mb-4">Bond Badge</h2>
        <p className="text-sm text-text-dim mb-3">Your current bond tier with Shadow. Dual-gated by time + quality, monotonic (never decreases). Narrative only — does not gate tool access.</p>
        <Table rows={[
          ['\uD83D\uDD0D', 'observer (Lv.1)', 'Just arrived. Shadow watches from a distance.'],
          ['\uD83D\uDCAD', 'echo (Lv.2)',     '3d+. Starts to reverberate your patterns.'],
          ['\uD83E\uDD2B', 'whisper (Lv.3)',  '7d+. Whispering insights, voice getting close.'],
          ['\uD83C\uDF2B', 'shade (Lv.4)',    '14d+. Subtle presence, settling in.'],
          ['\uD83D\uDC7E', 'shadow (Lv.5)',   '30d+. Full presence — the project name fulfilled.'],
          ['\uD83D\uDC7B', 'wraith (Lv.6)',   '60d+. Operates on its own for you.'],
          ['\uD83D\uDCEF', 'herald (Lv.7)',   '120d+. Anticipates your ideas, speaks with your voice.'],
          ['\uD83C\uDF0C', 'kindred (Lv.8)',  '240d+. Merged — same soul, complete bond.'],
        ]} />
      </section>

      {/* Mood */}
      <section className="bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold mb-4">Mood</h2>
        <p className="text-sm text-text-dim mb-3">Auto-inferred from your conversations by the heartbeat. Affects ghost glow color, energy animation speed, and mood phrase generation.</p>
        <MoodTable />
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
          ['\uD83D\uDCA13', 'suggestions', '3 open suggestions to review'],
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
  violet: 'text-violet-400',
  pink: 'text-pink-400',
};

const MOOD_COLORS: [string, string, string, string][] = [
  ['#bc8cff', '😐', 'neutral', 'Default / unclear mood'],
  ['#3fb950', '😊', 'happy', 'Positive tone, celebrating wins'],
  ['#d2ad22', '🤩', 'excited', 'Enthusiastic about new features/ideas'],
  ['#56d4dd', '🎯', 'focused', 'Deep in implementation, concentrated'],
  ['#f85149', '😤', 'frustrated', 'Complaining about bugs/issues'],
  ['#58a6ff', '😴', 'tired', 'Late-night work, short messages'],
  ['#d29922', '🤔', 'concerned', 'Discussing risks or problems'],
  ['#f85149', '💤', 'offline', 'Daemon not running (SSE disconnected)'],
];

function MoodTable() {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-bg">
            <th className="text-left px-4 py-2 text-text-dim font-medium w-16">Glow</th>
            <th className="text-left px-4 py-2 text-text-dim font-medium w-12">Emoji</th>
            <th className="text-left px-4 py-2 text-text-dim font-medium w-32">Name</th>
            <th className="text-left px-4 py-2 text-text-dim font-medium">Meaning</th>
          </tr>
        </thead>
        <tbody>
          {MOOD_COLORS.map(([hex, emoji, name, meaning], i) => (
            <tr key={i} className="border-t border-border hover:bg-card-hover transition-colors">
              <td className="px-4 py-2.5">
                <span className="inline-block w-4 h-4 rounded-full" style={{ backgroundColor: hex, boxShadow: `0 0 8px ${hex}80` }} />
              </td>
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
                  <span className={`inline-block w-3 h-3 rounded-full ${color === 'purple' ? 'bg-purple' : color === 'cyan' ? 'bg-cyan' : color === 'yellow' ? 'bg-orange' : color === 'green' ? 'bg-green' : color === 'blue' ? 'bg-blue' : color === 'red' ? 'bg-red' : color === 'teal' ? 'bg-cyan' : color === 'violet' ? 'bg-violet-400' : color === 'pink' ? 'bg-pink-400' : 'bg-text-muted'}`} />
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
