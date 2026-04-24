# Changelog

All notable changes to this project are documented here.

Shadow follows [Semantic Versioning](https://semver.org/) loosely: minor
versions bump for new features, patches for fixes and polish, and schema
migrations can land in any release (the daemon auto-applies them on restart).

## [Unreleased]

Audit-driven hardening window (2026-04-18 ledger). Highlights so far:

- Session-endpoint spawn path routed through `ClaudeCliAdapter` so it
  inherits default-deny `AskUserQuestion`, `SHADOW_JOB=1` hook filter, MCP
  allowlist, `killJobAdapters` tracking, and `AbortSignal` propagation.
- `/api/runs` N+1 collapsed via `parentRunIds[]` batch filter.
- 6 hardcoded model literals canonicalized into `ModelsSchema` (reflect
  delta/evolve, correction enforcement, memory merge, mood phrase, PR draft).
- Orphan `git worktree` cleanup on daemon startup.
- Structured `runId`/`childRunId` fields in the autonomy job result instead
  of overloading the `reason` string.
- `shadow ask`, `shadow teach`, and the run-session endpoint now pass prompt
  via stdin / `--system-prompt-file` to close the last `ARG_MAX` leaks.
- `source_table` SQL interpolation in entity-links whitelisted against an
  explicit allowlist.
- Stale-run detector sources its threshold from the per-job `timeoutMs`.
- Rolling dismissed-suggestion veto window (30d) so dismissed suggestions
  don't permanently block new ones in the same semantic space.
- CLI rejects unknown subcommands instead of silently passing them to
  `claude`.

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

[Unreleased]: https://github.com/andresgomezfrr/shadow/compare/v0.4.1...HEAD
[0.4.1]: https://github.com/andresgomezfrr/shadow/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/andresgomezfrr/shadow/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/andresgomezfrr/shadow/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/andresgomezfrr/shadow/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/andresgomezfrr/shadow/releases/tag/v0.1.0
