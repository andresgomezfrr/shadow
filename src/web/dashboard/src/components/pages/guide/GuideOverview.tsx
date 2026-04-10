export function GuideOverview() {
  return (
    <>
      {/* What is Shadow */}
      <section className="bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold mb-3">What is Shadow?</h2>
        <p className="text-sm text-text-dim mb-4">
          Shadow is a <span className="text-text">local-first engineering companion</span> that runs as a background daemon,
          learns from your work, and interacts via Claude CLI (MCP tools) and this web dashboard.
          It&apos;s 100% LLM-based — Claude is the brain, Shadow is the persistence and observation layer.
        </p>
        <p className="text-sm text-text-dim">
          Shadow watches your repositories, analyzes your conversations and code changes,
          builds a persistent memory of your projects, and proactively suggests improvements.
          Everything runs locally on your machine — your data stays with you.
        </p>
      </section>

      {/* Key Features */}
      <section className="bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold mb-4">Key Features</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {FEATURES.map(([icon, title, desc]) => (
            <div key={title} className="bg-bg rounded-lg p-3">
              <div className="font-medium text-sm mb-1">{icon} {title}</div>
              <div className="text-xs text-text-dim">{desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Architecture */}
      <section className="bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold mb-3">How it Works</h2>
        <pre className="bg-bg rounded-lg px-4 py-3 font-mono text-xs text-text-dim mb-4 overflow-x-auto whitespace-pre leading-relaxed">
{`You \u2190 Claude CLI (MCP tools) \u2192 Shadow daemon (:3700)
                                    \u251C\u2500 SQLite DB (~/.shadow/shadow.db)
                                    \u251C\u2500 Web dashboard (this page)
                                    \u251C\u2500 Heartbeat (every 30min)
                                    \u2502  \u251C\u2500 summarize (Opus, session summary)
                                    \u2502  \u251C\u2500 extract (Opus, memories + mood)
                                    \u2502  \u251C\u2500 cleanup (Sonnet, resolve stale obs)
                                    \u2502  \u2514\u2500 observe (Opus, new observations)
                                    \u251C\u2500 Daemon jobs
                                    \u2502  \u251C\u2500 suggest (LLM, project-aware)
                                    \u2502  \u251C\u2500 consolidate (memory maintenance, 6h)
                                    \u2502  \u251C\u2500 reflect (soul reflection, daily)
                                    \u2502  \u251C\u2500 remote-sync (git ls-remote, 30min)
                                    \u2502  \u2514\u2500 enrich (MCP context gathering)
                                    \u251C\u2500 Hooks (6: sessions + tools + errors + subagents)
                                    \u2514\u2500 launchd service (auto-start, auto-restart)`}
        </pre>
        <p className="text-sm text-text-dim">
          The daemon runs in the background. Hooks capture your Claude CLI interactions.
          The heartbeat cycle analyzes everything periodically and builds knowledge.
        </p>
      </section>

      {/* Getting Started */}
      <section className="bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold mb-4">Getting Started</h2>
        <ol className="space-y-3 text-sm">
          {STEPS.map(([cmd, desc], i) => (
            <li key={i} className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent-soft text-accent text-xs flex items-center justify-center font-bold">{i + 1}</span>
              <div>
                <code className="text-accent bg-bg px-1.5 py-0.5 rounded text-xs">{cmd}</code>
                <span className="text-text-dim ml-2">{desc}</span>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Data Flow */}
      <section className="bg-card border border-border rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold mb-4">Data Flow</h2>
        <div className="space-y-2 text-sm">
          {DATA_FLOW.map(([icon, step], i) => (
            <div key={i} className="flex gap-3 items-start">
              <span className="text-lg flex-shrink-0">{icon}</span>
              <span className="text-text-dim">{step}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

const FEATURES: [string, string, string][] = [
  ['\uD83E\uDDE0', 'Persistent Memory', '5-layer memory system with automatic decay and consolidation. Learns from your work.'],
  ['\uD83D\uDCA1', 'Proactive Suggestions', 'LLM-powered suggestions based on patterns, risks, and opportunities in your code.'],
  ['\uD83D\uDC41\uFE0F', 'Observations', 'Automated insights from your repos — risks, improvements, patterns, opportunities.'],
  ['\uD83D\uDD12', 'Trust System', '5-level trust (observer \u2192 shadow) that unlocks capabilities as you build rapport.'],
  ['\uD83C\uDFAF', 'Focus Mode', 'Silence all proactive notifications when you need deep concentration.'],
  ['\uD83D\uDCCA', 'Dashboard', 'Web UI at localhost:3700 to browse memories, suggestions, observations, and more.'],
  ['\uD83D\uDCDD', 'Digests', 'Generate daily standups, weekly 1:1 reports, or quarterly brag docs from your activity.'],
  ['\uD83D\uDC7B', 'Ghost Mascot', 'Expressive status line character that shows Shadow\'s state and mood at a glance.'],
];

const STEPS: [string, string][] = [
  ['shadow init', 'Bootstrap everything: DB, hooks, launchd, soul seed'],
  ['shadow repo add .', 'Register your current repo for Shadow to watch'],
  ['shadow daemon start', 'Start the background daemon (auto-starts on boot via launchd)'],
  ['shadow teach "We use trunk-based dev"', 'Teach Shadow about your team and conventions'],
  ['shadow web', 'Open the dashboard to see everything visually'],
];

const DATA_FLOW: [string, string][] = [
  ['\uD83D\uDCBB', 'You work in Claude CLI as usual. Hooks capture your conversations and tool usage (async, zero impact).'],
  ['\u2764\uFE0F', 'Every 30min, the heartbeat claims the JSONL batch (consume-and-delete), collects repo context, and detects active projects.'],
  ['\uD83E\uDDE0', 'Opus summarizes the session data, then extracts memories + mood, and generates observations from the summary.'],
  ['\uD83D\uDCA1', 'Separate suggest job generates project-aware suggestions based on observations + memories + feedback.'],
  ['\uD83D\uDD17', 'Enrichment job queries external MCP tools (calendar, monitoring, CI) for cross-system context.'],
  ['\u267B\uFE0F', 'Consolidation promotes/demotes memory layers. Daily reflect synthesizes developer understanding.'],
  ['\uD83D\uDC7B', 'Next time you open Claude CLI, Shadow greets you with context, personality, and pending items.'],
];
