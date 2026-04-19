export function GuideJobs() {
  return (
    <div className="space-y-8">
      {/* Section 1: Overview */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Job System Overview</h2>
        <div className="bg-card border border-border rounded-lg p-5 space-y-3 text-sm text-text-dim">
          <p>Shadow runs background jobs to analyze your work, generate suggestions, and maintain its knowledge base. Jobs execute in parallel (up to 3 LLM jobs + IO jobs), with a 15-minute timeout per job.</p>
          <p>View all job activity in the <strong className="text-text">Activity</strong> page. Each job shows its phases, output, and token usage.</p>
          <p>Jobs are triggered by three mechanisms: <strong className="text-text">scheduled</strong> (fixed interval), <strong className="text-text">reactive</strong> (triggered by another job), or <strong className="text-text">manual</strong> (via dashboard trigger buttons).</p>
        </div>
      </section>

      {/* Section 2: Job Chain */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Job Chain</h2>
        <div className="bg-card border border-border rounded-lg p-5 text-sm">
          <pre className="text-text-dim font-mono text-xs whitespace-pre leading-relaxed">{`remote-sync (30min, IO)
  \u2193 remote commits detected
repo-profile (reactive, 2h gap)
  \u2193 repo re-profiled
project-profile (reactive, 4h gap, 2+ repos)

heartbeat (30min, LLM)
  \u2193 local activity detected
  \u2193 \u2192 repo-profile (if new local commits, 2h gap)
  \u2193 observations + activity
suggest (reactive, 1h gap)

suggest-deep (20+ commits or 7d/30d)
  \u2193 deep scan complete
suggest-project (reactive, 7d gap, 2+ repos)

consolidate (6h) \u2192 reflect (24h) \u2192 digests (clock-time)

auto-plan (3h, LLM)
  \u2193 valid suggestions \u2192 plan runs
auto-execute (3h, offset 1.5h, LLM)
  \u2193 high-confidence plans \u2192 worktree execution

version-check (12h, IO) \u2014 queues event if newer tag on remote

revalidate-suggestion (on-demand from Workspace)`}</pre>
        </div>
      </section>

      {/* Section 3: Job Types Reference */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Job Types</h2>
        <div className="space-y-4">
          <JobCard
            name="heartbeat"
            color="bg-purple-500/20 text-purple-300"
            purpose="Discovers active projects, extracts memories from conversations, generates observations about your work"
            trigger="Every 30min (60min when idle)"
            model="Opus (summarize/extract/observe), Sonnet (cleanup)"
            phases={['prepare', 'summarize', 'extract', 'cleanup', 'observe', 'notify']}
            output="Memories, observations, mood/energy updates"
            reactive={false}
            note="Also triggers suggest (if observations created) and repo-profile (if repos have new local commits, 2h gap)"
          />

          <JobCard
            name="suggest"
            color="bg-green-500/20 text-green-300"
            purpose="Incremental suggestions based on recent repo changes — bugs, missing tests, quick improvements"
            trigger="Reactive post-heartbeat when repos have new activity"
            model="Opus medium"
            phases={['suggest', 'notify']}
            output="1-3 suggestions per active repo"
            reactive={true}
            reactiveSource="heartbeat"
          />

          <JobCard
            name="suggest-deep"
            color="bg-green-600/20 text-green-400"
            purpose="Full codebase review with tool access — architecture, tech debt, features, dependencies, security"
            trigger="20+ commits or 7d (active repos) / 30d (dormant repos). First-time on repo add."
            model="Opus high"
            phases={['scan', 'validate']}
            output="1-5 high-confidence suggestions"
            reactive={false}
            note="Claude has full code access (Read, Grep, Glob, Bash) and can explore the repo freely"
          />

          <JobCard
            name="suggest-project"
            color="bg-emerald-400/20 text-emerald-300"
            purpose="Cross-repo analysis — shared libraries, duplicated logic, API contracts, dependency alignment"
            trigger="Reactive after suggest-deep if project has 2+ repos. First-time when repo added to project."
            model="Opus high"
            phases={['analyze', 'validate']}
            output="1-3 cross-repo suggestions"
            reactive={true}
            reactiveSource="suggest-deep"
          />

          <JobCard
            name="consolidate"
            color="bg-orange-500/20 text-orange-300"
            purpose="Memory maintenance: layer promotion/demotion, correction enforcement, merge similar memories, meta-pattern synthesis"
            trigger="Every 6h"
            model="Opus high"
            phases={['layer-maintenance', 'corrections', 'merge', 'meta-patterns']}
            output="Promoted/demoted/merged/deduped memory counts"
            reactive={false}
            note="Corrections are consumed here: contradicting memories archived/edited, corrections promoted to taught"
          />

          <JobCard
            name="reflect"
            color="bg-blue-500/20 text-blue-300"
            purpose="2-phase soul reflection: extract deltas from recent activity, evolve Shadow's understanding of you"
            trigger="Every 24h"
            model="Phase 1: Sonnet, Phase 2: Opus high"
            phases={['reflect-delta', 'reflect-evolve']}
            output="Updated soul reflection (5 sections: profile, patterns, blind spots, watch list, communication)"
            reactive={false}
          />

          <JobCard
            name="remote-sync"
            color="bg-pink-400/20 text-pink-300"
            purpose="Lightweight git ls-remote to detect new commits pushed to remote branches"
            trigger="Every 30min"
            model="None (IO only)"
            phases={['remote-sync']}
            output="Repos synced, new commits detected, behind/ahead counts"
            reactive={false}
            note="Triggers repo-profile reactively when changes detected (2h min gap)"
          />

          <JobCard
            name="repo-profile"
            color="bg-teal-400/20 text-teal-300"
            purpose="LLM analysis of repo context: stack, phase, team, CI, valuable/avoid suggestions. Used by suggest pipeline."
            trigger="Reactive after remote-sync (remote changes) or heartbeat (local commits). 2h min gap."
            model="Sonnet low"
            phases={['repo-profile']}
            output="Updated contextMd on repo record"
            reactive={true}
            reactiveSource="remote-sync + heartbeat"
            note="Triggers suggest-deep first-time scan for new repos, and project-profile for multi-repo projects"
          />

          <JobCard
            name="project-profile"
            color="bg-emerald-400/20 text-emerald-300"
            purpose="Synthesizes cross-repo project context: architecture, patterns, integration points, tensions"
            trigger="Reactive after repo-profile for projects with 2+ repos (4h min gap)"
            model="Opus high"
            phases={['profile']}
            output="Updated contextMd on project record"
            reactive={true}
            reactiveSource="repo-profile"
          />

          <JobCard
            name="context-enrich"
            color="bg-amber-400/20 text-amber-300"
            purpose="Queries external MCP servers for deployment status, CI/CD, calendar, PRs, tickets"
            trigger="Every 2h (disabled by default — requires external MCP servers)"
            model="Phase 1: Sonnet, Phase 2: Opus"
            phases={['enrich']}
            output="Enrichment cache items (fed into heartbeat context)"
            reactive={false}
            note="Enable in Settings. Requires MCP servers other than Shadow."
          />

          <JobCard
            name="revalidate-suggestion"
            color="bg-sky-400/20 text-sky-300"
            purpose="Re-evaluates a suggestion against the current codebase to check if it is still valid, partially valid, or outdated"
            trigger="On-demand from Workspace (user clicks Re-evaluate)"
            model="Opus high"
            phases={['prepare', 'evaluate', 'apply']}
            output="Updates suggestion content, scores, and verdict (valid/partial/outdated)"
            reactive={false}
            note="Uses tool access to read repo files. Outdated suggestions get a pre-filled dismiss note."
          />

          <JobCard
            name="auto-plan"
            color="bg-violet-500/20 text-violet-300"
            purpose="Scans open suggestions older than the configured min age, revalidates them against the codebase, auto-dismisses outdated ones, and creates plan runs for valid suggestions"
            trigger="Every ~3h (configurable via Autonomy rules)"
            model="Opus high"
            phases={['filtering', 'revalidating', 'planning']}
            output="Plan runs for valid suggestions, auto-dismissed outdated suggestions"
            reactive={false}
            note="Controlled by plan rules in Settings → Autonomy. Per-repo opt-in (off by default). Only processes suggestions matching configured effort, risk, impact, confidence, kind, and repo filters."
          />

          <JobCard
            name="auto-execute"
            color="bg-violet-600/20 text-violet-400"
            purpose="Scans planned runs with confidence evaluation, auto-executes in worktree if confidence is high with zero doubts, marks as needs_review otherwise"
            trigger="Every ~3h, offset 1.5h from auto-plan"
            model="Opus high"
            phases={['filtering', 'executing', 'verifying']}
            output="Executed runs in worktrees, or runs marked as needs_review"
            reactive={false}
            note="Controlled by execute rules in Settings → Autonomy (stricter than plan rules). Hardcoded safety gate: confidence must be HIGH with zero doubts — not configurable. Per-repo opt-in required."
          />

          <JobCard
            name="mcp-discover"
            color="bg-indigo-400/20 text-indigo-300"
            purpose="Describes each MCP server by introspecting tool schemas visible to Sonnet"
            trigger="Every 24h (gated on Enrichment enabled)"
            model="Sonnet"
            phases={['discover']}
            output="Server descriptions + tool counts → enrichment cache → dashboard settings"
            reactive={false}
            note="Enable Enrichment in Settings. One LLM call, zero tool invocations."
          />

          <JobCard
            name="version-check"
            color="bg-gray-400/20 text-gray-300"
            purpose="Checks for new Shadow releases by comparing local package.json version against remote git tags"
            trigger="Every 12h"
            model="None (IO only)"
            phases={['version-check']}
            output="version_available event if a newer tag exists on the remote"
            reactive={false}
            note="Creates a pending event with upgrade instructions when a new version is detected. Deduplicates events for the same version."
          />

          <JobCard
            name="digest-daily"
            color="bg-cyan-500/20 text-cyan-300"
            purpose="Daily standup summary (3-5 bullets) from commits, memories, observations, suggestions"
            trigger="23:30 daily (with backfill for missed days)"
            model="Sonnet"
            phases={['digest-daily']}
            output="Daily digest in Digests page"
            reactive={false}
          />

          <JobCard
            name="digest-weekly"
            color="bg-cyan-500/20 text-cyan-300"
            purpose="Weekly 1:1 summary (5-10 bullets) aggregating daily digests"
            trigger="Sunday 23:30 (with backfill for missed weeks)"
            model="Opus"
            phases={['digest-weekly']}
            output="Weekly digest in Digests page"
            reactive={false}
          />

          <JobCard
            name="digest-brag"
            color="bg-cyan-500/20 text-cyan-300"
            purpose="Quarterly brag doc for performance reviews, accumulating from weekly digests"
            trigger="Monday 08:00"
            model="Opus"
            phases={['digest-brag']}
            output="Quarterly brag doc in Digests page"
            reactive={false}
          />

          <JobCard
            name="cleanup"
            color="bg-slate-400/20 text-slate-300"
            purpose="Retention: purges rows > 90d from interactions, event_queue (delivered only), llm_usage, and jobs. Feedback and audit_events are preserved (load-bearing). Rolls raw llm_usage into llm_usage_daily before purging so historical token views stay queryable."
            trigger="03:30 daily"
            model="None (IO only)"
            phases={['cleanup']}
            output="{ rolledUp, deleted: { llm_usage, interactions, event_queue, jobs } } in Activity"
            reactive={false}
            note="Pending events (delivered=0) are never purged — stuck pending signals a bug, not churn. Feedback preserved for checkSuggestionDuplicate dismissed dedup + correction lifecycle."
          />
        </div>
      </section>

      {/* Section 4: Configuration */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Configuration</h2>
        <div className="bg-card border border-border rounded-lg p-5 text-sm text-text-dim space-y-3">
          <div>
            <p className="mb-1"><strong className="text-text">Models & effort levels</strong> — adjustable in <strong className="text-text">Settings → LLM Models</strong>.</p>
            <p className="text-xs text-text-muted">Or via env vars: SHADOW_MODEL_ANALYZE, SHADOW_MODEL_SUGGEST, SHADOW_MODEL_CONSOLIDATE, SHADOW_MODEL_RUNNER + corresponding SHADOW_EFFORT_* vars.</p>
          </div>
          <div>
            <p className="mb-1"><strong className="text-text">Environment variables</strong> (set in shell or .env):</p>
            <ul className="list-disc list-inside space-y-1 text-xs font-mono">
              <li>SHADOW_HEARTBEAT_INTERVAL_MS — heartbeat interval (default: 30min)</li>
              <li>SHADOW_PROACTIVITY_LEVEL — event delivery threshold 1-10 (default: 5)</li>
            </ul>
          </div>
          <div>
            <p className="mb-1"><strong className="text-text">Internal config</strong> (code defaults, not yet env-mapped):</p>
            <ul className="list-disc list-inside space-y-1 text-xs font-mono text-text-muted">
              <li>suggestReactiveThreshold: 1 — any observation triggers suggest</li>
              <li>suggestReactiveMinGapMs: 1h — min gap between suggests</li>
              <li>suggestDeepMinCommits: 20 — commits before deep scan</li>
              <li>suggestDeepActiveIntervalDays: 7 — deep scan for active repos</li>
              <li>suggestDeepDormantIntervalDays: 30 — deep scan for dormant repos</li>
              <li>projectProfileMinGapMs: 4h — min gap between project profiles</li>
            </ul>
          </div>
          <p>All jobs can be manually triggered from the <strong className="text-text">Activity</strong> page schedule ribbon. Jobs that operate per-repo or per-project show an entity selector on trigger.</p>
        </div>
      </section>

      {/* Section 5: Corrections */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Corrections</h2>
        <div className="bg-card border border-border rounded-lg p-5 text-sm text-text-dim space-y-2">
          <p>When Shadow learns something wrong, you can create a <strong className="text-text">correction</strong> — a temporary override that fixes the knowledge base.</p>
          <p>Corrections flow: <strong className="text-text">created</strong> (injected in extract + repo-profile prompts) → <strong className="text-text">consolidate processes it</strong> (archives/edits contradicting memories) → <strong className="text-text">promoted to taught</strong> (permanent knowledge, no longer injected as override).</p>
          <p>Create corrections via: the <strong className="text-text">✏️ Correct Shadow</strong> button in the sidebar, the <strong className="text-text">Correct</strong> button on repo cards, or the <strong className="text-text">shadow_correct</strong> MCP tool.</p>
        </div>
      </section>
    </div>
  );
}

// --- Helper component ---

function JobCard({ name, color, purpose, trigger, model, phases, output, reactive, reactiveSource, note }: {
  name: string;
  color: string;
  purpose: string;
  trigger: string;
  model: string;
  phases: string[];
  output: string;
  reactive: boolean;
  reactiveSource?: string;
  note?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${color}`}>{name}</span>
        {reactive && (
          <span className="text-[10px] text-text-muted bg-border/50 px-1.5 py-0.5 rounded">
            reactive{reactiveSource ? ` \u2190 ${reactiveSource}` : ''}
          </span>
        )}
      </div>
      <p className="text-sm text-text-dim mb-2">{purpose}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <div><span className="text-text-muted">Trigger:</span> <span className="text-text-dim">{trigger}</span></div>
        <div><span className="text-text-muted">Model:</span> <span className="text-text-dim">{model}</span></div>
        <div><span className="text-text-muted">Phases:</span> <span className="text-text-dim">{phases.join(' \u2192 ')}</span></div>
        <div><span className="text-text-muted">Output:</span> <span className="text-text-dim">{output}</span></div>
      </div>
      {note && <p className="text-[10px] text-text-muted mt-2 italic">{note}</p>}
    </div>
  );
}
