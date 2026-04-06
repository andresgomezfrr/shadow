export function GuideJobs() {
  return (
    <div className="space-y-8">
      {/* Section 1: Overview */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Job System Overview</h2>
        <div className="bg-card border border-border rounded-lg p-5 space-y-3 text-sm text-text-dim">
          <p>Shadow runs background jobs to analyze your work, generate suggestions, and maintain its knowledge base. Jobs execute in parallel (up to 3 LLM jobs + IO jobs), with an 8-minute timeout per job.</p>
          <p>View all job activity in the <strong className="text-text">Activity</strong> page. Each job shows its phases, output, and token usage.</p>
          <p>Jobs are triggered by three mechanisms: <strong className="text-text">scheduled</strong> (fixed interval), <strong className="text-text">reactive</strong> (triggered by another job), or <strong className="text-text">manual</strong> (via dashboard trigger buttons).</p>
        </div>
      </section>

      {/* Section 2: Job Chain */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Job Chain</h2>
        <div className="bg-card border border-border rounded-lg p-5 text-sm">
          <pre className="text-text-dim font-mono text-xs whitespace-pre leading-relaxed">{`remote-sync (30min, IO)
  \u2193 commits detected
repo-profile (reactive, 2h gap)
  \u2193 repo re-profiled
project-profile (reactive, 4h gap, 2+ repos)

heartbeat (30min, LLM)
  \u2193 observations + activity
suggest (reactive, 1h gap)

suggest-deep (20+ commits or 7d/30d)
  \u2193 deep scan complete
suggest-project (reactive, 7d gap, 2+ repos)

consolidate (6h) \u2192 reflect (24h) \u2192 digests (clock-time)`}</pre>
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
            model="Sonnet medium"
            phases={['observe', 'cleanup', 'analyze', 'notify']}
            output="Memories, observations, mood/energy updates"
            reactive={false}
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
            trigger="Reactive after remote-sync detects new commits (2h min gap). Manual trigger available."
            model="Sonnet low"
            phases={['repo-profile']}
            output="Updated contextMd on repo record"
            reactive={true}
            reactiveSource="remote-sync"
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
        </div>
      </section>

      {/* Section 4: Configuration */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Configuration</h2>
        <div className="bg-card border border-border rounded-lg p-5 text-sm text-text-dim space-y-2">
          <p>Job models and effort levels can be adjusted in <strong className="text-text">Settings</strong>.</p>
          <p>Intervals and thresholds are configured via environment variables:</p>
          <ul className="list-disc list-inside space-y-1 text-xs font-mono">
            <li>SHADOW_HEARTBEAT_INTERVAL_MS — heartbeat interval (default: 30min)</li>
            <li>SHADOW_SUGGEST_REACTIVE_THRESHOLD — observations needed to trigger suggest (default: 1)</li>
            <li>SHADOW_SUGGEST_DEEP_MIN_COMMITS — commits before deep scan (default: 20)</li>
            <li>SHADOW_SUGGEST_DEEP_ACTIVE_INTERVAL_DAYS — deep scan interval for active repos (default: 7)</li>
            <li>SHADOW_SUGGEST_DEEP_DORMANT_INTERVAL_DAYS — deep scan interval for dormant repos (default: 30)</li>
          </ul>
          <p className="mt-2">All jobs can be manually triggered from the <strong className="text-text">Activity</strong> page schedule ribbon.</p>
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
