# Changelog

All notable changes to this project are documented here.

Shadow follows [Semantic Versioning](https://semver.org/) loosely: minor
versions bump for new features, patches for fixes and polish, and schema
migrations can land in any release (the daemon auto-applies them on restart).

## [Unreleased]

## [0.5.1] — 2026-04-28

**Uninstall path, daemon restart fix, defensive tests.**

Patch release on top of v0.5.0. Adds a documented exit path
(`shadow uninstall`), fixes two reliability bugs in the daemon and
upgrade flows, and lands regression tests on the two areas that had
shipped without coverage.

### Added

- **`shadow uninstall`** — removes the Claude integration end-to-end:
  fast-stops the daemon, removes the launchd plist or systemd unit,
  strips Shadow's hooks/statusLine/mcpServers entries from
  `~/.claude/settings.json` (matching by command path so third-party
  entries are left intact), removes the SHADOW section from
  `~/.claude/CLAUDE.md`, unregisters the MCP server, and deletes the
  deployed hook scripts. Data at `~/.shadow/` is preserved by default;
  `--purge --confirm` also wipes it.

### Fixed

- **`shadow daemon restart` actually restarts.** The previous
  implementation stopped the daemon but did not start it again,
  leaving the user with a stopped service.
- **`shadow upgrade` surfaces real git errors.** Network failures and
  fetch errors are now reported verbatim instead of being collapsed
  into a generic message.

### Tests

- 26 fixture tests for the `shadow uninstall` settings.json filter
  (the no-friendly-fire scenario where third-party hooks/statusLine
  must be preserved) and the CLAUDE.md SHADOW-section stripping.
- 14 unit tests for the suggestion rank-decay protection from v0.5.0
  audit `e0321be4` — high-impact suggestions on quiet projects must
  not silently fall below visibility.

### Docs / CI

- README quickstart drops the redundant `shadow init` step (the
  installer already runs it).
- The install-smoke workflow re-enables the `push` trigger now that
  the repository is public.

## [0.5.0] — 2026-04-24

**Hardening, Linux parity, OSS hygiene, status line overhaul.**

This release closes the audit ledger opened on 2026-04-18 (over 100
findings), brings Linux to first-class parity with macOS, reshapes the
status line into an interactive surface, and ships the paperwork needed
for a public release.

### Highlights

- **Linux support is first-class.** `shadow init` now installs a
  `systemd --user` unit on Linux alongside the existing launchd path on
  macOS. Sleep/wake awareness falls through to `loginctl`, and CI runs
  on both ubuntu-latest and macos-latest with a Docker smoke that
  validates a virgin-install build.
- **Interactive status line.** Every badge is an OSC 8 hyperlink that
  lands you on the right view: `📦 shadow · main` → the GitHub remote
  at the current branch; `📋 <project>` → `/projects/<id>`; `🤫` →
  `/chronicle`; `💡N` → `/suggestions`; `📬N` → `/morning` with the
  notification panel auto-opened; mascot → `/morning`; `🌐` → the
  dashboard root. The top-notification line also deep-links to the
  concrete target (run id, observation id, etc.) instead of a generic
  list. New `shadow statusline enable|disable` command to toggle the
  status line without editing `~/.claude/settings.json` by hand.
- **Cooperative shutdown.** `shadow daemon stop` and `restart` now
  narrate what's draining (ghost jobs, in-flight LLM calls, runner,
  SSE connections) and verify the daemon actually came back up after a
  restart. In-flight work is cancelled via `AbortSignal` propagated
  through the adapter, not waited out into a closing DB.
- **Observability.** 312 `console.*` call sites migrated to a
  conventional `log.error|warn|info(component, message, context)`
  helper with ISO-timestamp prefixes and a level pill; a new `/logs`
  dashboard page tails `daemon.stderr.log` live with level filtering;
  `observability_metrics` table stores periodic snapshots for later
  analysis.
- **Memory and analysis.** Prompts speak the user's language
  (locale-aware injection across 8 callsites); extract/observe carry
  few-shot examples in both EN and ES; 6 previously-hardcoded model
  literals are configurable; the `consolidate` job now synthesizes a
  `knowledge_summary` narrative memory (F-14) and surfaces its action
  in the Activity card.

### Robustness and data safety

- Cooperative daemon shutdown via per-job `AbortSignal`. In-flight LLM
  calls cancel cleanly instead of racing the DB close (R-16).
- Stale-run detector now uses per-job `timeoutMs` sourced from
  `JobHandlerEntry` instead of a hardcoded window.
- Pidfile-based liveness probe for runner child processes (R-15).
- Discriminated error codes for ghost jobs (R-14).
- `pr-sync` defers parent finalization while any child run is still
  active (R-13); standalone runs with `prUrl` now finalize too (R-07).
- Worktree cleanup retries and records risk on repeated failures
  (R-12); orphan worktrees left by a crashed daemon are removed on
  next startup (bcf9710a).
- `parentRunId` aggregation wrapped in a reusable `withTransaction`
  helper (R-06).
- Plan mode rejects empty-in-disguise plans (R-05) and requires a
  `<!-- PLAN COMPLETE -->` marker (P-04).
- FK-style cascade deletes implemented as explicit app-layer DELETEs
  per entity (D-06), with rollback tests.
- Schema migrations gain an `assertInvariant` + `assertBackfillComplete`
  helper (S-01); `updateProfile` warns on unknown keys (D-09); `_json`
  column mappers log fallbacks instead of failing silently (D-12).
- Memory tag FTS5 tokenization fixed via `json_each` in triggers
  (D-11).
- Default-deny `AskUserQuestion` in the Claude CLI adapter — a
  daemon-spawned Claude has no human to answer, so the session would
  hang (S-03).
- Session endpoint routed through `ClaudeCliAdapter` so it inherits
  every spawn invariant (`SHADOW_JOB=1`, MCP allowlist, default-deny,
  tracking, abort signal) instead of reimplementing spawn by hand
  (c5d66d43).
- Prompt-via-stdin for every remaining `spawn` callsite — `shadow
  ask`, `shadow teach` (via `--system-prompt-file`), and the run
  session endpoint (e39733ac).
- CLI rejects unknown subcommands instead of silently passing them to
  Claude as arguments.
- `llm_usage` now recorded in correction-enforce, memory-merge,
  suggest, and profiling handlers (S-02, T-03).
- `/api/runs` N+1 collapsed via a `parentRunIds[]` batch filter; the
  same treatment applied earlier to `/api/workspace` (W-02).
- `source_table` SQL interpolation in `entity_links` whitelisted
  against an explicit allowlist (edc3fbe8).
- Daily token budget skips deferrable jobs (consolidate, reflect,
  digests, enrichment) when exceeded (A-10).

### Linux support

- `shadow init` installs a `systemd --user` unit when running on Linux,
  with the same auto-upgrade-on-version-bump behaviour as the launchd
  plist (C-01).
- `isSystemAwake` falls through to `loginctl show-user --property=State`
  on Linux (C-02).
- Scripts, hooks, and paths all platform-aware; readme and docs
  updated to reflect the parity.

### Observability

- Logger module (`src/log.ts`) with level prefix + ISO timestamp, 312
  `console.*` sites migrated (O-05, O-01).
- `/logs` dashboard page: live tail of `daemon.stderr.log` with level
  filter and pills (F-07).
- `observability_metrics` table + periodic snapshot job (O-04).
- `audit_events` row on every MCP mutation and on bond-tier changes
  (O-02).
- Suggest and profiling handlers now record `llm_usage` (T-03).

### Status line

- `shadow statusline` command (`enable`, `disable`, or plain to inspect).
- OSC 8 hyperlinks on mascot (→ `/morning`), 🤫 (→ `/chronicle`),
  `📦 <repo> · <branch>` (→ GitHub remote at the branch), `📋 <project>`
  (→ `/projects/<id>`, only when cwd isn't inside a repo), `💡N` (→
  `/suggestions`), `📬N` (→ `/morning?notifications=open`), 🌐 (→
  dashboard root).
- Per-shell repo badge: reads `{cwd}` from Claude Code's JSON on stdin,
  matches against registered repos (longest prefix), reads the current
  branch from git, normalises the remote URL to a `https://` web URL
  deep-linked to `/tree/<branch>`.
- Top-notification deep-links: each kind maps to the concrete target —
  `run_failed` → `/runs?highlight=<id>`, `plan_needs_review` →
  `/workspace?tab=planned&highlight=<id>`, etc.
- `🌐` dashboard link moved to line 1 next to the heartbeat countdown;
  line 2 is now reserved for real content (thought or notification).

### Dashboard

- Sidebar with grouped nav + hover-expanding flyout + neon line-art
  glyphs replacing emojis (bloque 5O, 5Q).
- Toast system replaces native `alert`/`confirm` (UI-02).
- `/logs` page (F-07).
- Cmd+K global search with deep-link prefetch and `usePrefetchHighlight`
  hook (UI-03).
- Polling intervals centralised as named constants (UI-07).
- SSE reconnect counter resets on last-subscriber unsubscribe (UI-04);
  mounted guard in `useApi` visibilitychange handler (UI-05); slow SSE
  clients dropped on write backpressure (W-06).
- Copyable + expandable session id in run journey (UI-13); MCP server
  reorder via up/down arrows (UI-22); task archive flow with closing
  note prompt (UI-18); `PlayOnceVideo` component and 4 intro MP4s.
- ActivityEntryExpandedDetail test suite + cleaner consolidate render
  with knowledge-summary phase (F-08).

### Memory and analysis

- Locale-aware prompts module with EN-base + ES variants, injected
  across 8 user-facing callsites (P-13).
- Few-shot examples in `extract` and `observe` prompts (P-14).
- Settings UI exposes per-phase models including
  `summarize/extract/observe` (P-11).
- `consolidate` synthesizes a narrative `knowledge_summary` memory
  when ≥10 durable memories accumulate since the last one; cluster-merge
  step collapses highly-similar summaries at hour 3 (F-14).
- `MemoriesPage` gains a `kind` filter.
- Correction lifecycle: `enforced_at` column, 48h grace window, merge
  absorption via `mergeRelatedMemories`.
- 6 previously-hardcoded model literals (reflect delta/evolve,
  correction enforcement, memory merge, mood phrase, PR draft) now
  live in `ModelsSchema` with sensible defaults (cd2062ef).
- Dedicated `analysisTimeoutMs` separate from `runnerTimeoutMs` (A-05).
- `config.revalidateTtlDays` + suggest revalidation job (A-09 era).
- Orphaned `.rotating` JSONL files purged in daily cleanup (A-07).
- Bounds-check on LLM decision index in corrections (P-09); stricter
  raw-markdown fallback in profiles (P-10); regex-tolerant section
  check in reflect evolve (P-02); brag doc validated before overwrite
  (P-01).
- Cleanup of list-based JSON observations (P-03).

### MCP

- `shadow_run_close` for manual run finalization (M-06); `closedNote`
  accepted in `shadow_task_close` (M-05).
- Unified tool return envelope `{ok, data?, error?}` (M-03).
- Short tool descriptions expanded with usage context (M-08).
- Defaults centralised via Zod `.default()` (M-07).
- Enum keys in `shadow_profile_set` for early validation (M-04).
- `SubagentStart` hook captures `subagent_type`, `description`,
  `model`, `prompt` (H-02).

### Autonomy

- Per-job `timeoutMs` via `JobHandlerEntry` (auto-plan 30 min,
  auto-execute 60 min, cleanup 10 min). Timeout kills spawned adapters
  via `killJobAdapters` instead of waiting out `runnerTimeoutMs`.
- High-impact suggestions protected from rank-decay invisibility
  (e0321be4).
- Structured `runId` / `childRunId` in autonomy job result entries
  (a109a07f).
- Rolling 30-day veto window for dismissed suggestions so they don't
  permanently block new ones in the same semantic space.
- `pr-sync` job finalizes parents on merge/close; `done → awaiting_pr`
  reopen path for manually-created draft PRs.

### OSS hygiene

- Added `LICENSE` (Apache-2.0), `NOTICE`, `SECURITY.md`,
  `CHANGELOG.md`, issue templates, PR template.
- README restructured with "Why Shadow?", quickstart, TOC, "Is
  Shadow for you?" FAQ, and acknowledgments.
- `package.json` metadata: repository, homepage, bugs, author, license,
  keywords.
- CI matrix: ubuntu-latest + macos-latest host jobs + Docker smoke on
  a fresh Linux image + host-level CLI smoke on both platforms.
- Weekly cron validating the `curl | bash` one-liner installer.
- Hooks carry a version stamp (`# shadow-hook-version: <pkg-version>`)
  so `shadow init` auto-upgrades them when the package version changes
  (d74a6227).
- `GETTING_STARTED.md`, `GUIDE.md`, and `CLAUDE.md` all refreshed with
  current tool counts, job counts, route map, and env vars. Welcome
  discussion seeded in `Announcements`.

### Breaking / noteworthy behaviour changes

- Bare `shadow` with an unknown first token now exits 1 with help
  instead of silently passing the typo to Claude. Use
  `shadow -- <args>` when you want passthrough.
- The MCP server is served over HTTP on `/api/mcp`; `shadow mcp serve`
  (stdio) still exists for legacy clients. `shadow init` migrates a
  stale stdio registration to HTTP automatically.
- Legacy `bondTier` / `bondAxes` columns removed (D-10).
- Tasks' `repoIds` moved to a `task_repo_links` junction table (D-03);
  legacy `repo_ids_json` column dropped.
- Focus-mode, behaviour ranges (`proactivityLevel`, `personalityLevel`)
  remain numeric but the previous categorical strings are gone.

## [0.4.1] — 2026-04-14

**Runner robustness + autonomy polish.**

- Persist worktree edits in the `run:execution` flow.
- Skip scheduling during macOS darkwake to avoid mid-job LLM failures.
- Play-once video intros on empty state and list headers.
- Digest backfill updates the target period instead of the most-recent one.
- Allow manual trigger of `auto-plan` / `auto-execute` jobs.
- Allow parallel plan runs on the same repo.
- Per-candidate filter reasons in `auto-execute` output.
- Deep-link and URL sync for digest navigation.

## [0.4.0] — 2026-04-14

**Bond, Tasks, Autonomy.**

- **Bond system (v49)**: 5-axis bond (time, depth, momentum, alignment,
  autonomy), 8 tiers (observer → echo → whisper → shade → shadow → wraith →
  herald → kindred). Dual-gated by time + quality floor, monotonic.
- **Chronicle**: LLM-authored narrative timeline with tier lore, milestones,
  radar, tier path, and an unlockables grid.
- **PR-aware run lifecycle**: `awaiting_pr` status + `pr-sync` job using
  `gh pr view` to finalize parents on merge/close.
- **Cmd+K global search** with deep-link prefetch across entity types.
- **Corrections lifecycle**: `enforced_at` column + 48h grace window + merge
  absorption via `mergeRelatedMemories`.
- **Auto-plan / auto-execute output** split into collapsed stats + expanded
  per-item detail with deep-links.
- **DB schema v49**: bond axes, chronicle entries, unlockables, caches.
- Dashboard: Chronicle page, sidebar rename Trust→Bond, Guide page rewrite.
- `shadow profile bond-reset` subcommand.

## [0.3.0] — 2026-04-10

Autonomy L4 shipped: `auto-plan` and `auto-execute` jobs, trust gates
removed, configurable per-repo rules. Sleep/wake-aware scheduling
(`pmset` on macOS, `systemd-inhibit` on Linux).

## [0.2.0] — 2026-04-09

Job system v3, 13 job types, parallel execution, reactive chains,
corrections, memory merge.

## [0.1.0] — 2026-04-08

Initial tagged release.

- `shadow init` bootstraps `~/.shadow/`, hooks, and the service manager
  (launchd on macOS, `systemd --user` on Linux).
- Install script + `shadow upgrade` command + version-check daemon job.
- 68 MCP tools, web dashboard, heartbeat pipeline (summarize → extract →
  observe), suggestions, observations, entity graph, Tasks v1, Runs v1.

---

[Unreleased]: https://github.com/andresgomezfrr/shadow/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/andresgomezfrr/shadow/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/andresgomezfrr/shadow/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/andresgomezfrr/shadow/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/andresgomezfrr/shadow/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/andresgomezfrr/shadow/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/andresgomezfrr/shadow/releases/tag/v0.1.0
