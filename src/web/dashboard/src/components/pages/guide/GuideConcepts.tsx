import { TRUST_LEVELS, MEMORY_LAYERS } from './guide-data';

export function GuideConcepts() {
  return (
    <>
      {/* Memory System */}
      <section className="bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold mb-3">Memory System</h2>
        <p className="text-sm text-text-dim mb-4">
          Shadow maintains a <span className="text-text">5-layer memory system</span> that automatically
          promotes and demotes knowledge based on relevance and access frequency.
          Memories are created from your conversations, code changes, and explicit teaching.
        </p>
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-bg">
                <th className="text-left px-4 py-2 text-text-dim font-medium w-12"></th>
                <th className="text-left px-4 py-2 text-text-dim font-medium w-20">Layer</th>
                <th className="text-left px-4 py-2 text-text-dim font-medium w-24">Decay</th>
                <th className="text-left px-4 py-2 text-text-dim font-medium">Purpose</th>
              </tr>
            </thead>
            <tbody>
              {MEMORY_LAYERS.map((l) => (
                <tr key={l.name} className="border-t border-border hover:bg-card-hover transition-colors">
                  <td className="px-4 py-2.5 text-lg">{l.emoji}</td>
                  <td className="px-4 py-2.5 font-mono text-text">{l.name}</td>
                  <td className="px-4 py-2.5 text-text-dim">{l.decay}</td>
                  <td className="px-4 py-2.5 text-text-dim">{l.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-text-muted mt-3">
          Memory is on-demand — never auto-loaded into prompts. FTS5 + vector search finds relevant memories by context.
          Semantic dedup prevents duplicates (cosine similarity &gt; 0.85 = skip, &gt; 0.70 = update existing).
        </p>
      </section>

      {/* Trust System */}
      <section className="bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold mb-3">Trust System</h2>
        <p className="text-sm text-text-dim mb-4">
          Trust grows organically with usage. Each interaction earns trust points:
          check-in (+0.3), memory taught (+1.0), heartbeat completed (+0.5), suggestion accepted (+2.0).
          Higher trust unlocks more autonomous capabilities.
        </p>
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-bg">
                <th className="text-left px-4 py-2 text-text-dim font-medium w-12"></th>
                <th className="text-left px-4 py-2 text-text-dim font-medium w-16">Level</th>
                <th className="text-left px-4 py-2 text-text-dim font-medium w-24">Score</th>
                <th className="text-left px-4 py-2 text-text-dim font-medium w-24">Name</th>
                <th className="text-left px-4 py-2 text-text-dim font-medium">Capabilities</th>
              </tr>
            </thead>
            <tbody>
              {TRUST_LEVELS.map((t) => (
                <tr key={t.level} className="border-t border-border hover:bg-card-hover transition-colors">
                  <td className="px-4 py-2.5 text-lg">{t.badge}</td>
                  <td className="px-4 py-2.5 font-mono text-text">{t.level}</td>
                  <td className="px-4 py-2.5 text-text-dim">{t.score}</td>
                  <td className="px-4 py-2.5 font-mono text-text">{t.name}</td>
                  <td className="px-4 py-2.5 text-text-dim">{t.capabilities}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Heartbeat Cycle */}
      <section className="bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold mb-3">Heartbeat Cycle</h2>
        <p className="text-sm text-text-dim mb-4">
          The heartbeat runs every <span className="text-text">15 minutes</span> (configurable) and is Shadow&apos;s main learning loop.
          It follows a state machine with distinct phases:
        </p>
        <div className="space-y-2">
          {HEARTBEAT_PHASES.map(([icon, name, desc]) => (
            <div key={name} className="flex gap-3 items-start bg-bg rounded-lg px-4 py-3">
              <span className="text-lg flex-shrink-0">{icon}</span>
              <div>
                <span className="text-sm font-medium text-text">{name}</span>
                <span className="text-sm text-text-dim ml-2">{desc}</span>
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-text-muted mt-3">
          The heartbeat also triggers a separate <span className="text-text-dim">suggest</span> job (Opus model)
          when there&apos;s been activity since the last run. A daily <span className="text-text-dim">reflect</span> job
          synthesizes feedback and memories into a coherent soul reflection.
        </p>
      </section>

      {/* Observations */}
      <section className="bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold mb-3">Observations</h2>
        <p className="text-sm text-text-dim mb-4">
          Observations are <span className="text-text">LLM-generated insights</span> created during the heartbeat analyze phase.
          The LLM sees conversations, interactions, and repo context, then flags actionable items.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
          {OBSERVATION_KINDS.map(([icon, kind]) => (
            <div key={kind} className="bg-bg rounded-lg px-3 py-2 text-center">
              <div className="text-lg">{icon}</div>
              <div className="text-xs text-text-dim">{kind}</div>
            </div>
          ))}
        </div>
        <p className="text-sm text-text-dim">
          Lifecycle: <span className="text-text">active</span> &rarr; <span className="text-text">acknowledged</span> (seen)
          &rarr; <span className="text-text">resolved</span> (fixed). Auto-expires by severity:
          info = 7 days, warning = 14 days, high = never.
          You can vote, acknowledge, resolve, or reopen observations.
        </p>
      </section>

      {/* Suggestions */}
      <section className="bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold mb-3">Suggestions</h2>
        <p className="text-sm text-text-dim mb-4">
          Suggestions are <span className="text-text">actionable proposals</span> generated by a separate LLM call (Opus)
          after the heartbeat. They&apos;re scored on impact, confidence, and risk.
        </p>
        <p className="text-sm text-text-dim mb-3">
          Lifecycle: <span className="text-text">pending</span> &rarr;
          <span className="text-text"> accepted</span> (creates a run) |
          <span className="text-text"> dismissed</span> (with reason) |
          <span className="text-text"> snoozed</span> (delay for N hours).
        </p>
        <p className="text-sm text-text-dim">
          Accepting a suggestion creates a <span className="text-text">Run</span> — Shadow plans the implementation,
          optionally evaluates confidence, and can auto-execute if trust level allows.
          Dismissed suggestions are remembered to avoid re-suggesting the same thing (semantic dedup).
        </p>
      </section>

      {/* Proactivity & Focus */}
      <section className="bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold mb-3">Proactivity & Focus Mode</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-bg rounded-lg p-4">
            <h3 className="text-sm font-medium mb-2">Proactivity Level (1-10)</h3>
            <p className="text-xs text-text-dim mb-2">
              Controls how actively Shadow communicates. Low values mean Shadow only responds when asked.
              High values enable proactive sharing of observations, suggestions, and events.
            </p>
            <div className="flex gap-1 items-center text-xs text-text-muted">
              <span>1 = silent</span>
              <span className="flex-1 h-px bg-border" />
              <span>5 = balanced</span>
              <span className="flex-1 h-px bg-border" />
              <span>10 = very active</span>
            </div>
          </div>
          <div className="bg-bg rounded-lg p-4">
            <h3 className="text-sm font-medium mb-2">Focus Mode</h3>
            <p className="text-xs text-text-dim mb-2">
              Temporarily silences all proactive notifications. Shadow only responds to direct questions.
              Set a duration (<code className="text-accent">2h</code>, <code className="text-accent">30m</code>)
              or activate indefinitely. Use <code className="text-accent">shadow profile available</code> to exit.
            </p>
            <div className="text-xs text-text-muted">
              Ghost shows: <span className="font-mono text-purple">{'{•\u0300_•\u0301}'}</span> focus
            </div>
          </div>
        </div>
      </section>

      {/* Digests */}
      <section className="bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold mb-3">Digests</h2>
        <p className="text-sm text-text-dim mb-4">
          Shadow can generate formatted reports from your activity data.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {DIGEST_KINDS.map(([icon, name, desc]) => (
            <div key={name} className="bg-bg rounded-lg p-3">
              <div className="text-lg mb-1">{icon}</div>
              <div className="text-sm font-medium mb-1">{name}</div>
              <div className="text-xs text-text-dim">{desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Soul Reflection */}
      <section className="bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold mb-3">Soul Reflection</h2>
        <p className="text-sm text-text-dim">
          Once a day, Shadow runs a <span className="text-text">reflect</span> job (Opus model) that synthesizes
          all feedback, memories, and interactions into a coherent understanding of you as a developer.
          This reflection is stored in <code className="text-accent bg-bg px-1.5 py-0.5 rounded text-xs">SOUL.md</code> and
          influences how Shadow communicates — tone, priorities, what to highlight or avoid.
          The reflection blends with the existing personality; it evolves, never replaces.
        </p>
      </section>
    </>
  );
}

const HEARTBEAT_PHASES: [string, string, string][] = [
  ['\uD83D\uDC40', 'Observe', 'Collect repo context (git status, branches, recent commits)'],
  ['\uD83E\uDDF9', 'Cleanup', 'Resolve stale/duplicate observations via MCP'],
  ['\uD83E\uDDE0', 'Analyze', 'LLM extracts memories + mood from conversations and interactions'],
  ['\uD83D\uDC41\uFE0F', 'Observe (new)', 'LLM generates new observations from repo + conversation context'],
  ['\u267B\uFE0F', 'Consolidate', 'Promote/demote memory layers, archive cold memories'],
  ['\uD83D\uDD14', 'Notify', 'Queue events based on proactivity level'],
];

const OBSERVATION_KINDS: [string, string][] = [
  ['\u26A0\uFE0F', 'risk'],
  ['\uD83D\uDCA1', 'improvement'],
  ['\uD83C\uDF1F', 'opportunity'],
  ['\uD83D\uDD04', 'pattern'],
  ['\uD83D\uDD27', 'infrastructure'],
];

const DIGEST_KINDS: [string, string, string][] = [
  ['\u2615', 'Daily', 'Standup-format digest. What you did yesterday, what\'s in progress, blockers.'],
  ['\uD83D\uDCCB', 'Weekly', '1:1 format. Accomplishments, challenges, next priorities. Good for manager syncs.'],
  ['\uD83C\uDFC6', 'Brag', 'Quarterly brag doc. Accumulates achievements over time for performance reviews.'],
];
