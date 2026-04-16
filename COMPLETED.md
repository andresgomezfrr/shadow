# Shadow — Completed Items

Historical record of completed backlog items.

---

## Session 2026-04-16 (Daemon lifecycle fix — `stop`/`restart` reliability)

- **Root cause: installed plist stuck on `KeepAlive: <true/>`** — The plist template in `cmd-init.ts` was fixed on 2026-04-07 (`a04cc119`) to use `KeepAlive: { Crashed: true }` (only respawn on crash, not on clean SIGTERM), but `shadow init` skips already-installed plists, so Andrés's install had been running the broken `KeepAlive: <true/>` for 8+ days. Every call to `shadow daemon stop` → launchd resurrected the daemon seconds later. Direct evidence: **162 `EADDRINUSE: address already in use :::3700`** errors in `~/.shadow/daemon.stderr.log`, one per failed restart race.
- **Bug 1 — `stopDaemon()` lied** — `src/daemon/runtime.ts:210` removed the pid file immediately after sending SIGTERM, before the process actually exited. But the daemon's own shutdown handler (line 863) removes the pid file as the last step of graceful drain (up to 60s via `jobQueueRef.drainAll(60_000)`). Result: `isDaemonRunning()` returned `false` for the entire drain window even though the process was still alive. Any polling caller waiting for stop got a false positive. Fix: stopDaemon no longer touches the pid file on the happy path; the daemon cleans up its own file during shutdown. Error paths (dead pid, invalid pid) still remove the file.
- **Bug 2 — `gracefulStopDaemon` sent SIGTERM before unloading launchd** — `cmd-daemon.ts:49-83` called `stopDaemon()` first, then (if that failed) `launchctl bootout`. But launchd was still managing the service during the drain window — and with `KeepAlive: <true/>` it respawned the daemon as soon as the original exited. Fix: rewrote the helper with the correct order — bootout FIRST, wait for launchd unload, THEN SIGTERM the pid-in-file if the process is still alive (covers the tsx-wrapper orphan case where launchd only signals the wrapper but the daemon child has a different pid), wait for drain with progress callback, force-kill as fallback. Also added `waitForLaunchdUnload()` helper that polls `launchctl list | grep -q com.shadow.daemon` — necessary because `launchctl list LABEL` and `launchctl print` both return exit 0 even for nonexistent services (errors go to stderr only), so neither gives a reliable binary signal.
- **Bug 3 — web server `startWebServer` failure silently swallowed** — `src/daemon/runtime.ts:299-301` had `catch { /* web module not available — continue without it */ }` around the web server startup. When port 3700 was held by an orphan from the previous stop race, the daemon caught EADDRINUSE, continued without a web server, and ran as a phantom: dashboard unreachable, MCP HTTP dead, but `isDaemonRunning` returned true. The 162 stderr errors accumulated unnoticed. Fix: log a clear diagnostic (with actionable hint to run `shadow daemon stop && shadow daemon start`), then `process.exit(0)` — **not** exit 1, to avoid triggering a crash-loop under `KeepAlive: { Crashed: true }`. Clean exit = launchd does not respawn = user sees the failure in `shadow status`.
- **Bug 4 — `runtime.ts` auto-start triggered in tests** — The auto-start detection `process.argv[1]?.includes('daemon/runtime')` matched both `runtime.ts` AND `runtime.test.ts` (both contain the substring). Tests importing from `./runtime.js` would trigger `startDaemon()`, hit EADDRINUSE against the real daemon, and throw asynchronously. Fix: tightened the check to exact basename match (`runtime.ts` or `runtime.js`, not the substring).
- **New: `waitForDaemonStopped` with progress callback** — Polls `isDaemonRunning()` every 250ms until the daemon exits or the timeout (default 30s, 65s from the CLI to cover Shadow's 60s drain budget). Optional `onProgress` callback fires every 5s with elapsed seconds + active job count from `daemon.json`, so the CLI can show `waiting for N job(s) to drain (Ns elapsed)…` instead of appearing frozen. Both `daemon stop` and `daemon restart` print this progress on stderr.
- **New: `src/cli/plist.ts`** — Single source of truth for plist content + launchctl reload logic, reused by `cmd-init.ts` and the new `daemon reinstall`. Exports: `PLIST_VERSION` constant (v2 = current, v1 = pre-stamp), `PLIST_PATH`, `renderPlistContent()`, `readPlistVersion()`, `writeAndReloadPlist()`. Template upgraded with `<!-- shadow-plist-version: 2 -->` stamp comment, `KeepAlive: { Crashed: true }`, and `ExitTimeOut: 90` (covers 60s drain + 30s headroom so launchd doesn't SIGKILL mid-drain; default is 20s which was below the drain budget).
- **New: `shadow daemon reinstall` subcommand** — Stops the current daemon via `gracefulStopDaemon` (with launchd-first order), regenerates the plist from the current template, and `launchctl bootstrap` reloads. Manual escape hatch for plist upgrades or recovery. Version-aware auto-heal also wired into `shadow init`: if the installed plist has a stamp older than `PLIST_VERSION`, init regenerates and reloads on the fly, printing `plist upgraded v1 → v2`. Users who installed before 2026-04-07 pick up the fix automatically on the next init/upgrade.
- **Semantic fix — `daemon stop` reports `graceful` vs `not_running` correctly** — Initial implementation returned `not_running` when `launchctl bootout`'s own SIGTERM + `ExitTimeOut=90` drained the daemon fast enough that `isDaemonRunning` was false by the time step 2 checked. That made a successful fast-drain stop look like "daemon was never running", which was confusing. Fix: capture `isDaemonRunning()` snapshot before bootout; after bootout, return `graceful` if the daemon was alive before and is gone now, `not_running` only if it was never running.
- **4 sanity tests for the new contracts** — `src/daemon/runtime.test.ts`: stopDaemon preserves the pid file when the target is alive (using a sacrificial `sleep` child), removes it when the target is already dead; `waitForDaemonStopped` returns `true` quickly when the process dies mid-wait (< 2s), returns `false` on timeout (respects the 1s bound). Keeps the regression tight on the contracts we just changed without attempting a full daemon-lifecycle suite.
- **E2E validation on live system** — Ran `shadow daemon reinstall` against Andrés's installed plist: v1 → v2 upgrade succeeded in one step, new daemon came up clean on port 3700. Then `shadow daemon stop` → daemon gone, `launchctl list` empty, no process, port free. Verified the core bug fix: waited **25 seconds** post-stop, daemon stayed stopped (no launchd resurrection). Then `shadow daemon start` → new pid, API responding. Then `shadow daemon restart` → clean transition. **Zero new EADDRINUSE errors** in the stderr log across the full cycle (vs 162 accumulated historical). `npm run build` refreshed `dist/` so the `shadow` global binary (npm-linked to `dist/cli.js`) now has `daemon reinstall` too. Commits: `c44faad`, `aa706a6`.

---

## Session 2026-04-16 (Installation path consolidation)

- **Claude Code plugin path removed — `shadow init` is the sole installation route** — Two divergent installation paths had drifted: `shadow init` (writes hooks + statusLine to `~/.claude/settings.json`, injects CLAUDE.md section, installs launchd plist, registers MCP via `claude mcp add`) vs a Claude Code plugin at `.claude-plugin/plugin.json` (v0.1.0 frozen while project was v0.4.1, `.claude-plugin/mcp.json` orphaned, SessionStart hook inlined `npx tsx` instead of the shared `session-start.sh`, and `claude plugin install` can't install statusLine, inject CLAUDE.md, or bootstrap the launchd service — all core init behaviors per Anthropic's plugin spec). The plugin path was a strict subset of init with divergent wrappers around identical hooks. Removed `.claude-plugin/` and `hooks/` entirely; stripped the "Plugin (alternative registration)" section from `GETTING_STARTED.md` and corrected the architecture diagram ("4 hooks" → "6 hooks + statusLine"). Reversible: if Anthropic extends the plugin spec to cover statusLine + CLAUDE.md + OS services, the plugin manifest can be regenerated from git history.

---

## Session 2026-04-15 (Runner reliability cluster)

- **Stale run detector respects runner timeout and active queue** — `src/daemon/runtime.ts:676-686` hardcoded `STALE_RUN_MS = 10min`, below the 30min `runnerTimeoutMs`, so legitimately slow runs (multi-repo, heavy context) were killed prematurely with `errorSummary='Stale: exceeded 10min timeout'`. Worse, the detector never checked whether the run was still tracked by `RunQueue.active` — a live adapter with an in-flight Claude session could get clobbered from under itself. Fix: added public `RunQueue.isActive(runId): boolean` (queue.ts:115) and rewrote the detector to (a) skip any run still in the queue, (b) use `config.runnerTimeoutMs` as the threshold, (c) report `orphaned from queue` in the error summary so the failure mode is self-documenting. Now only genuinely orphaned runs (DB says running, no adapter) get reaped. Ref: run `1e4dea01`.
- **Empty plan treated as failure, not planned** — Previously if a plan run exited 0 but neither `capturePlanFromSession` nor `result.output` produced content, the runner fell through the happy path: confidence evaluation over an empty string (which could spuriously return `high` from the LLM), `resultSummaryMd: ''` persisted, state transitioned to `planned`. The UI hid the Plan section when `resultSummaryMd` was empty (`src/web/routes/runs.ts:240`), so the run looked healthy but was a ghost — ready to feed a downstream execution that would hallucinate on nothing. Two guards: (1) `evaluateConfidence` short-circuits on empty plan before spending tokens, returns `{ confidence: 'low', doubts: ['plan output is empty — cannot evaluate'] }`; (2) `processRun` treats empty `effectivePlan` as a real failure — transitions to `failed`, propagates to parent via `aggregateParentStatus`, applies bond delta, creates event + audit entry, and early-returns before the happy path touches `resultSummaryMd`. The early-return mirrors the catch-block failure path for consistency. Ref: runs `7a426733`, `8b061e52`.
- **`AskUserQuestion` disallowed + briefing hardening** — Two observed failure modes from runs `3d668e1d` and `8b061e52`: (1) Claude invoked `AskUserQuestion` against a human that wasn't there, the tool failed x2, and the session died with no output; (2) when a tool call got denied (e.g. `oliver__list_dashboards`), Claude retried it 7+ times, burning the turn budget. `AskUserQuestion` is a built-in tool and is **not** covered by `--allowedTools mcp__*` — the allowlist only applies to MCP tools. Fix: extended `ObjectivePack` with `disallowedTools?: string[]`, wired `--disallowedTools` to the CLI adapter (deny rules win over allow in Claude CLI — verified via `claude --help` + docs). Runner now passes `disallowedTools=['AskUserQuestion']` on both the main run pack and the confidence-evaluation pack. Briefing also gained an autonomy hardening block: "**You are running autonomously.** Make assumptions, never ask questions, never retry denied tool calls — adapt using other available tools." Hard defense (deny flag) + soft defense (briefing) together. Agent SDK adapter carries a `TODO` for `disallowedTools`; not the default backend in Andrés's install.
- **`mcp-context` silent in job contexts** — The SessionStart hook (`scripts/session-start.sh`) runs `shadow mcp-context` for every Claude session, including runner-spawned ones. The hook output injected the full soul + "What I know" + recent observations into the model's context, duplicating the soul that the runner already passes via its briefing (`src/runner/service.ts:120-123` loads `soul_reflection` memory directly). Fix: `mcp-context` early-returns with a benign comment line (`# shadow runner context — soul injected by runner briefing`) when `process.env.SHADOW_JOB === '1'`. The env var is already set by `ClaudeCliAdapter:107` for every daemon spawn; interactive spawns (`shadow teach`, `shadow ask`, Workspace session button) deliberately don't set it, so they continue to receive the full context. A comment line rather than empty stdout avoids the `SessionStart:startup hook error` warnings Claude Code emits on empty hook output (GitHub issue #12671, #21643). **Note on the original backlog framing:** the item described the bug as "burns turns on redundant `shadow_check_in`". Post-fix validation (run `efe62362`) showed Claude still calls `shadow_check_in` once as the second tool call — the instruction also lives in `~/.claude/CLAUDE.md` user global (`cmd-init.ts:91-103`). Andrés clarified that this is **not redundant** in runner sessions: `check_in` returns repo-scoped memories, observations, and entities that the briefing doesn't cover. The fix correctly stops the soul-duplication at the hook level; the check_in tool call itself is valuable and left alone.
- **E2E validation run** — Launched a plan run (`efe62362`) with a deliberately ambiguous prompt ("Improve the runner reliability cluster — decide what to harden, make assumptions"). 7m 51s total, status `planned`, `confidence: high`, ~8 KB plan output with real multi-phase content. Transcript analysis (218 lines, `~/.claude/projects/.../b025d449-cba5-4170-a911-dc76e9f3421f.jsonl`): 0 calls to `AskUserQuestion`, confidence eval ran (activity=evaluating → planned), happy path intact. Claude even generated a meta-plan for the next runner hardening pass (diff-coherence check + test suite for state-machine / plan-capture / autonomy handlers) as a side-effect of the ambiguous prompt. Commits: `6f480c8`, `d145dfc`, `e2bd8fc`, `8818437`.

---

## Session 2026-04-15 (Chronicle images + hero video + lightbox)

- **20 Chronicle images generated and wired** — Full art set for `/chronicle`: `hero` (cinematic banner), 8 tier portraits (`tier-1-observer` → `tier-8-kindred`), `tier-locked` (anti-spoiler silhouette), `unlock-placeholder` (wrapped object for locked slots), `bg-texture` (tileable carbon-fiber bg), and 8 milestone icons (`constellation`, `crescent-moon`, `hourglass`, `lantern`, `footprints`, `book`, `quill`, `key`). Generated via Gemini/nano-banana using the prompts in `docs/chronicle-image-prompts.md`, with Reference 1 (style anchor) + Reference 2 (character anchor) for consistency across the series. L5 shadow was the most iterated — the original concept ("ghost casts human-shaped shadow") kept being interpreted as a separate 3D figure by the generator; solved by replacing the hoodie with shadow substance instead (shadow-as-clothing). The decision to allow character evolution tier-by-tier (not rigid Ref2 matching) was saved as a feedback memory for future regenerations. L2 echo and L3 whisper were regenerated after the fact with richer atmospheric framing so the progression L1→L4 didn't feel too flat before the L5 pivot.
- **Hero video (play-once intro)** — Generated with Veo/Gemini (`internal/chronicle-assets/hero-source.mp4`, 1280×720, 8s, h264+AAC, 1.88 MB). ffmpeg pipeline strips audio, recompresses at CRF 23, and crops symmetrically 60px top+bottom to remove the Veo watermark and letterboxing → final `hero.mp4` at 1280×600 (2.13:1, close to 21:9), 1.18 MB. Last frame extracted with `ffmpeg -sseof -0.1 -update 1 -frames:v 1` and used as the static `hero.webp` poster — guarantees a pixel-perfect swap when `onEnded` fires (no visible "pop" between video end and static image). `ChroniclePage` uses the same play-once pattern as `SuggestionsPage`/`ObservationsPage`: `videoEnded` state + `<video autoPlay muted playsInline poster={...} onEnded>` → swap to `<img>`.
- **Image optimization pipeline (PNG → WebP)** — Raw Gemini PNGs were 5-6 MB each at 1024-3168px wide (95 MB total). Installed `webp` via brew, batch-converted with `cwebp -q 85..90 -resize <target> 0`: hero at 1600w, tier portraits at 512px, milestones at 256px, bg-texture at 1024px. Final: **768 KB total** (123× smaller) — individual files 15-90 KB. Raw PNGs moved to `internal/chronicle-assets/` (gitignored) as backup for future regeneration; `public/ghost/chronicle/` only contains the production-ready WebPs + `hero.mp4`.
- **Wiring — `ChroniclePage`, `TierBadge`, `PathVisualizer`, `ChronicleTimeline`, `UnlocksGrid`** — New `chronicle/images.ts` constants module maps tier numbers → portrait paths and milestone keys → icons (`first_correction` → quill, `first_auto_execute` → key, `memories:*` → book, default → constellation). `ChroniclePage` shows hero as header banner. `TierBadge` displays the current tier portrait (96px ring) instead of the emoji badge. `PathVisualizer` shows 8 tier portraits as the progress row. `ChronicleTimeline` prepends each entry with its tier/milestone icon. `UnlocksGrid` replaces the 🔒 emoji with `unlock-placeholder` for locked slots and the tier portrait for unlocked ones. `BOND_TIER_BADGES` emoji constant kept for backwards compat in other pages (status line, notifications).
- **`ChronicleLightbox` — shared component + React Portal fix** — Extracted the click-to-enlarge logic into a reusable `ChronicleLightbox.tsx` component (`{ src, title, subtitle, onClose }`): fixed-position viewport-centered card at 448px, backdrop-blur, ESC + click-outside to close, hover scale + brightness. Used across all 4 Chronicle sections (TierBadge portrait, Path tiers, Timeline icons, unlocked Unlocks). **Portal fix**: the first implementation rendered inline and `position: fixed` broke because `AppShell` wraps `<main>` children in `<div className="animate-fade-in">` where the CSS animation uses `transform: translateY(...)` — any ancestor with `transform` creates a containing block for fixed-positioned descendants, so `fixed inset-0` was positioning relative to that div (and its scroll position), not the viewport. Fix: render the lightbox with `createPortal(ui, document.body)` to escape the containing block chain entirely. Works correctly now regardless of scroll depth.
- **Dev-only `?unlock=1` override (added then removed)** — For visual QA during wiring, added a dev-only override to ChroniclePage that forces `bondTier=8` + all tiers reached + all unlockables unlocked + synthesized fake entries (8 tier_lore + 3 milestones), gated by localhost hostname check. Removed before commit — the review was complete and the override added ~55 lines to ChroniclePage. Cleanup left the page at ~85 lines.
- **BACKLOG cleanup — Radar + Path clipping** — Both resolved in this session:
  - **Radar: axis labels overflow SVG** — `BondRadar.tsx` labels at 125% of radius escaped the `0 0 300 300` viewBox. Fix: `labelPad=70`, SVG rendered at `size + labelPad*2` wide (440px for size=300), viewBox `${-labelPad} 0 ${size + labelPad*2} ${size}` — inner radar math unchanged, labels have horizontal room to breathe without compressing the shape.
  - **Chronicle "The Path" badges clipped at top** — Two layered bugs: (1) `rounded-full` + `object-cover` clipped the ghost's hood in the upper corners because the circle mask cuts the square corners and the character extends into them; (2) `overflow-x-auto` on the flex container implicitly forced `overflow-y: auto`, clipping the `ring-4 scale-105` outline on the current tier. Fix: `w-20 h-20 rounded-xl object-contain bg-bg` (square with rounded corners, no mask cropping), `flex items-center justify-center gap-2 py-3 px-3 flex-wrap` (natural-width items, centered, vertical padding for ring breathing room, no overflow-x-auto — wraps on narrow screens instead of scrolling), fixed-width `w-6` connectors between tiers (were `flex-1`).

---

## Session 2026-04-13 (play-once video intros)

- **Empty state + list headers play-once videos** — Extended the ActivityPage play-once pattern (`videoEnded` state + `onEnded` → swap to `<img>`) to three more surfaces. `EmptyState.tsx` now plays `/ghost/empty.mp4` once on mount then freezes on `empty.png`. `SuggestionsPage.tsx:241` and `ObservationsPage.tsx:84` do the same with `suggestions-header.mp4` / `observations-header.mp4` on their header illustrations. PNG used as `poster` on every `<video>` so the first frame doesn't flash before the MP4 starts. Unlike ShadowTV's looping videos (autoPlay+loop), these are deliberately play-once — the video is an intro, not ambient animation. Three new MP4s committed under `public/ghost/` (2-3 MB each, Gemini-generated).

---

## Session 2026-04-13 (sleep-aware scheduling fix)

- **`systemAwake` check added to scheduler gate via `pmset -g assertions`** — Yesterday's DNS gate alone was insufficient: macOS keeps TCPKeepAlive active during darkwake, so `dns.resolve4('api.anthropic.com')` resolved fine and the gate opened mid-darkwake, letting LLM jobs start that then failed when the Mac returned to sleep. Forensic evidence from the 2026-04-12 clamshell cycle (18:00→20:22): 19 jobs fired inside the sleep window, `consolidate` failed at 136s, `suggest-deep` timed out at the 900s max (15min of Opus inference burned). New `isSystemAwake()` in runtime.ts spawns pmset each tick (~12ms overhead), parses `UserIsActive`, fails open on any error. Combined with network as `canSchedule = networkUp && systemAwake` and applied to all 14 scheduled job enqueues + JobQueue claim loop.
- **Two missing gates closed** — `remote-sync` (runtime.ts:486) and `version-check` (runtime.ts:499) were enqueued without any gate. `remote-sync` is load-bearing because it triggers a reactive cascade: `remote-sync` → `repo-profile` → `suggest-deep` + `project-profile`. Both now wrapped in `canSchedule &&`.
- **JobQueue.tick() accepts `allowClaim`** — When false (darkwake/offline), the claim loop is skipped but in-flight jobs keep running (can't cancel LLM calls mid-inference without losing tokens). Called from runtime.ts as `jobQueue.tick({ allowClaim: canSchedule })`. Queued jobs wait for the next fully-awake tick.
- **Reactive handlers consult shared state** — `DaemonSharedState` gained `networkAvailable` + `systemAwake` flags, propagated each tick from the scheduler. 6 reactive enqueue sites now gate on them: `handleHeartbeat`→suggest + repo-profile, `handleRemoteSync`→repo-profile, `handleRepoProfile`→suggest-deep (first-scan) + project-profile, `handleSuggestDeep`→suggest-project. `handleRepoProfile` signature changed from `(ctx)` to `(ctx, shared)`. Without this, a parent job that legitimately started could still spawn LLM children mid-darkwake via the reactive path.
- **Deploy + pending validation** — Shipped via `shadow daemon restart` (commit 0588059), pmset overhead verified at 12ms. Overnight clamshell sleep test scheduled for 2026-04-14 morning: expected 0 jobs with `started_at` inside the sleep window + multiple `Skipping job scheduling — system not fully awake` entries in daemon.stderr.log.

---

## Session 2026-04-13 (run lifecycle PR-aware + UI polish)

- **PR-aware run lifecycle** — New `awaiting_pr` non-terminal status between `planned` and terminal. Parent plan stays `planned` while the execution child runs (no more eager transition to `done` on Execute click). When the child finishes successfully: if it created a PR → parent transitions to `awaiting_pr`; if it made changes without a PR → `done` outcome=executed; if it decided no changes were needed → `done` outcome=closed with the child's resultSummaryMd as `closedNote`. The new `pr-sync` job (IO, 30min, gated on `awaiting_pr` count > 0) polls `gh pr view` and finalizes: MERGED → parent `done` outcome=merged + `pr_merged` event; CLOSED → parent `dismissed` with `closedNote='PR closed without merge'`. State machine adds `planned → awaiting_pr` and `awaiting_pr → {done, dismissed, failed}`. `aggregateParentStatus()` (already present in state-machine.ts since the concurrency commit) was the missing piece — both `/execute` and `auto-execute` were short-circuiting it by transitioning the parent eagerly. Now they only create the child and let aggregation drive the lifecycle. Andrés's mental model: `done` = PR finalized.
- **RunQueue.canStart** — Now allows children when parent is `planned` (in addition to terminal). New guard against concurrent siblings: only one execution child per parent runs at a time. Fixes the latent bug where auto-execute + autonomy created queued children that never ran (parent in planned was never terminal).
- **`queued` runs no longer marked failed on daemon restart** — `cleanOrphanedJobsOnStartup` was killing queued runs with `errorSummary='orphaned — daemon restarted'`. They were never running. RunQueue.tick() re-picks queued runs on the next tick — leave them alone. Only `running` runs are real orphans.
- **Retry button in Execution step** — Was only in Plan step (for failed plan generation). Now when the latest non-archived child is `failed`, a Retry button appears in the Execution step that calls `retryRun(child.id)` — archives the failed child and creates a new one with same `parentRunId`. Also surfaces a special message when `errorSummary === 'orphaned — daemon restarted'`. The Plan-step Execute button now hides when children already exist (was redundant).
- **Spinner + adaptive polling + activity render in RunJourney** — The Step component dropped `animate-pulse` because of how the dot class was split (`dot[status]?.split(' ')[0]`). Fixed to apply `animate-pulse` explicitly when status='active'. Polling adapts: 5s when something is running/queued, 30s otherwise. The `activity` field (preparing/executing/verifying) is now rendered next to the running attempt.
- **PR badges polish** — Old badge logic showed `'draft'` text but inherited the state's color (so a draft OPEN looked green like ready-to-merge, and a draft CLOSED was red+labeled `'draft'`). Replaced with a clean priority: MERGED > CLOSED > draft > open. Distinct colors: merged=purple, closed=red, draft=orange, open=blue. checks/review badges only show when state=OPEN. Fixed `replace('_', ' ')` → `replace(/_/g, ' ')` for multi-underscore review decisions.
- **Activity page run:execute enrichment** — `JobOutputSummary` had `return null` for run:execute. Now collapsed shows diffStat, outcome (when not 'executed'), task title; expanded shows task link, confidence + doubts list, full diffStat, verification per command, error summary in red, summary markdown rendered via `<Markdown>` component, plus PR/Workspace links. Backend `activity.ts` extended to include `taskId`/`taskTitle` (join to tasks) + `errorSummary`/`outcome`/`diffStat`/`doubts`/`verification` in the result object.
- **`/api/runs` includes execution children** — When the endpoint returns parent runs (filtered by status), it now also includes their non-archived execution children. Without this, RunsPage's pipeline view broke for parents in `awaiting_pr` because their children were in `done` and didn't match the same filter.
- **Workspace `awaiting_pr` integration** — Added to `activeRunStatuses` set, `runStatusFilter` resolution, priority 104 in `assignPriority`, count tabs, and fetch arrays. Also the new state appears in `RUN_STATUS_BORDER`/`ICON`/`ICON_COLOR` (border-l-fuchsia-500, ⏳ icon, fuchsia text) and `STATUS_BADGE` map for ActivityEntry. RunsPage gets a new "Awaiting PR" filter tab with fuchsia styling.
- **Color recoloring run:execute → fuchsia** — `run:plan` (indigo) and `run:execute` (violet) were both in the purple spectrum and indistinguishable at badge size. `run:execute` is now `bg-fuchsia-500/20 text-fuchsia-300` — magenta, distinct hue. PHASE_DOT/PHASE_TEXT for 'executing' + JOB_ACTIVE_DOT/JOB_ACTIVE_TEXT for 'run:execute' updated to fuchsia. FeedRunCard kind badge now uses JOB_TYPE_COLORS instead of plain gray.
- **Markdown rendering in Activity expanded view** — Plan summary was rendered as raw markdown with `whitespace-pre-wrap`. Now uses the existing `<Markdown>` component (`src/web/dashboard/src/components/common/Markdown.tsx` with react-markdown + softBreaks). Headings, lists, code blocks, links work properly.
- **`pr-sync` handler bug fix** — First version of the handler used `--json state,merged,mergedAt`. The `merged` field doesn't exist in `gh pr view` output (the correct fields are `state` which is `OPEN`/`CLOSED`/`MERGED`, plus `mergedAt`/`closedAt`). It failed silently because the silent catch in the handler swallowed parse errors. Fixed to use `--json state,mergedAt`.
- **Build path correction in CLAUDE.md** — CLAUDE.md previously said the dashboard build outputs to `src/web/public/`. The reality (in `src/web/server.ts:63-65`) is the daemon serves from `src/web/dashboard/dist/` (with legacy fallback to `src/web/public/index.html` if dist doesn't exist). I lost ~3 build cycles in this session because I changed `vite.config.ts` to write to `public/` (matching the docs) and the daemon kept serving stale assets from `dashboard/dist/`. Reverted the vite outDir to `dist` and updated CLAUDE.md.
- **`pr-sync` job registered in CLI + runtime** — `shadow job pr-sync` triggers manually. Registered in `cmd-daemon.ts` JOB_TYPES, `job-handlers.ts` registry (category=io), `runtime.ts` periodic enqueue (30min, only when `awaiting_pr` count > 0).

---

## Session 2026-04-13 (bond system + Chronicle page + v49)

- **Bond system v49** — Replaced single-score trust with 5-axis bond + 8 tiers. Schema v49 ADD-only (follows v40-v48 convention): `bond_axes_json`, `bond_tier`, `bond_reset_at`, `bond_tier_last_rise_at` on `user_profile`, plus new tables `chronicle_entries` (immutable narrative records with UNIQUE indexes per tier_lore tier + milestone_key), `unlockables` (8 placeholder slots seeded), `bond_daily_cache` (24h TTL for Haiku outputs). Legacy `trust_level`/`trust_score`/`bond_level`/`required_trust_level`/`trust_delta` columns stay unused for v50 cleanup.
- **Axis formulas** — time (sqrt curve over 1 year, gate-only), depth (saturating 1−e^(−n/60) over taught/correction/knowledge_summary/soul_reflection memories), momentum (28d window of feedback accept/dismiss + runs done + observations done/ack), alignment (60% accept-dismiss rate + 30% corrections + 10% soul reflections), autonomy (saturating over successful parent_run_id runs). All pure functions in `src/profile/bond.ts`.
- **Tier engine** — 8 tiers (observer/echo/whisper/shade/shadow/wraith/herald/kindred), dual-gated (min days + quality floor avg of 4 dynamic axes), monotonic (never retrocede). `applyBondDelta` is sync: recomputes axes, persists, evaluates tier, fires fire-and-forget hooks on rise (chronicle lore + event_queue + unlock eval). Event kind is informational — axes are data-driven, idempotent.
- **Reset flow** — `resetBondState(db)` transactional: zeroes axes, tier to 1, clears chronicle_entries + bond_daily_cache, relocks unlockables. Preserves memories, suggestions, observations, runs, interactions, audit, soul. Triggered on first daemon boot via `~/.shadow/bond-reset.v49.done` sentinel (atomic `fs.openSync(path, 'wx')`). Also exposed as `shadow profile bond-reset --confirm`.
- **Chronicle page** — New `/chronicle` route (sidebar 🌒) with 6 sections: TierBadge (ghost art + lore fragment), BondRadar (hand-rolled 5-axis SVG), PathVisualizer (8 nodes, future tiers as silhouettes), NextStep (time + quality requirements + Haiku hint), ChronicleTimeline (entries), UnlocksGrid (8 slots). Voice of Shadow ambient phrase in header + Morning page. Anti-spoiler filter server-side (`/api/chronicle` masks future tier names as '???' and excludes unreached `tier_lore` entries).
- **4 LLM activities in `src/analysis/chronicle.ts`** — triggerChronicleLore (Opus, tier-cross, immutable), triggerChronicleMilestone (Opus, memories:N/first_correction/first_auto_execute, immutable), getVoiceOfShadow (Haiku, 24h cache), getNextStepHint (Haiku, 24h cache). Config: `models.chronicleLore`/`chronicleDaily` + env vars.
- **Rename trust→bond** — Full cleanup across DB, types, mappers, stores, profile module (git mv trust.ts → bond.ts), runner, suggestion engine, MCP tools, CLI (`shadow profile bond`, `shadow profile bond-reset --confirm`), web routes (new `handleChronicleRoutes`), dashboard (Topbar, Sidebar, MorningPage, DashboardPage, NotificationPanel with `bond_tier_rise` + `unlock` event kinds, deleted SectionTrustLevel). Dead code removed: `isActionAllowed`, `DEFAULT_ACTION_TRUST`, `AutonomyOverride`, local `applyTrustDelta` helper in suggestion/engine.ts.
- **Guide updates** — New Bond System section with 5-axis and 8-tier tables, new Chronicle section. GuideStatusLine renamed Trust Badge → Bond Badge with 8 tiers. GuideOverview + GuideMcpTools + GuideConfig updated (added SHADOW_MODEL_CHRONICLE_LORE / CHRONICLE_DAILY env vars). `BOND_TIERS_DATA` + `BOND_AXES_DATA` + `CHRONICLE_CONCEPT` exports in guide-data.ts.
- **Statusline fix (portable paths)** — `scripts/statusline.sh` had hardcoded `/Users/andresg/...` (wrong user, from a stale install). Replaced with `$HOME` + `$(command -v shadow)` + `$SHADOW_DEV_DIR` override. Also updated the tier case statement to 8 tiers with new emojis (🔍 💭 🤫 🌫 👾 👻 📯 🌌) and changed the grep pattern from `trustLevel` to `bondTier`.
- **v49 migration fix** — First deploy attempt failed with `Cannot add a column with non-constant default`. SQLite rejects function calls in ALTER TABLE ADD COLUMN DEFAULT. Fix: placeholder constant `'2026-01-01T00:00:00Z'` followed by `UPDATE user_profile SET bond_reset_at = datetime('now')` in the same migration step. The sentinel reset hook on first boot overwrites it again.
- **Research + design** — 7 rounds of brainstorming grounded in Pet Companion design (Yu-kai Chou), Self-Determination Theory (Ryan & Deci), Duolingo streak psychology (loss aversion, streak freezes), Stardew Valley heart system, Habitica gamification. Pre-written image generation prompts saved locally in `internal/docs/chronicle-image-prompts.md` for Midjourney/Flux/DALL-E (hero, 8 tier portraits, locked silhouette, unlockable placeholder, bg texture, milestone icon set).

---

## Session 2026-04-12 (corrections lifecycle + cmd+k)

- **Corrections timing fix — `enforced_at` + 48h grace window + merge absorption** — Migration v48: `memories.enforced_at INTEGER`. `enforceCorrections` ya no promueve a `kind='taught'`; stampa `enforced_at` (sólo si la enforcement completó con éxito — flag `enforceSucceeded` cubre LLM/parse/catch failures). `loadPendingCorrections` filtra por `enforced_at IS NULL OR enforced_at > now() - 48h` — readers siguen viendo corrections recién aplicadas durante 48h (cubre cadencia ≤ diaria de `reflect`, `digest-daily`, `repo-profile`, `project-profile`). `mergeRelatedMemories` ahora absorbe corrections post-grace: bypass condicional de `PROTECTED_KINDS` + core-layer gate, prompt con nota sobre corrections. Resultado: la correction se disuelve en la memoria que corrigió via pipeline existente con `sourceMemoryIds` trackeados. `kind='taught'` queda legacy. Bug detectado y fixed durante validación end-to-end: el catch del LLM call stampaba `enforced_at` incluso en fallo → data loss path — Shadow mismo lo reportó vía suggestion durante el propio run de consolidate.
- **Cmd+K global search** — Command palette en dashboard (Cmd+K / Ctrl+K / `/`). Búsqueda unificada sobre memories, observations, suggestions, tasks, runs, projects, systems, repos, contacts. Reusa `hybridSearch` (FTS5+vector) para knowledge entities y SQL LIKE para structural. Resultados agrupados por tipo con badges, keyboard nav (↑↓/Enter/Esc), recents en localStorage (max 10, LRU).
- **Deep-link prefetch pattern** — Endpoint genérico `GET /api/lookup?type=X&id=Y` para fetch individual. `useHighlight` ahora expone `highlightId` capturado (sobrevive al clear del URL). 4 páginas (Memories, Observations, Suggestions, Runs) hacen prefetch del item si no está en la lista visible y lo prependan. Evita el silent-fail de deep-links a items fuera de la primera página paginada.

## Backlog cleanup 2026-04-12

- **Warning de worktree huérfano** — Cerrado por diseño. El endpoint `/api/runs/{id}/cleanup-worktree` (`src/web/routes/runs.ts:318-321`) ya es idempotente: envuelve `git worktree remove` y `git branch -D` en try/catch silencioso y limpia `worktreePath` en DB al final. Si el directorio no existe, el remove falla, se ignora, y la DB queda limpia igual. Un warning visual no aportaba acción diferenciada.
- **Auto-accept de planes** — Superseded by L4 Autonomy. `auto-plan` revalida suggestions maduras contra código y crea plan runs; `auto-execute` ejecuta planes con high confidence + 0 doubts. UI configurable (effort, risk, impact, confidence, kinds, per-repo opt-in) en `SectionAutonomy.tsx`.
- **Timeout diferenciado plan vs execute** — Already shipped in L4. Per-job `timeoutMs` en `JobHandlerEntry`: auto-plan 30min, auto-execute 60min. Infraestructura en `JobQueue` (`entry.timeoutMs ?? JOB_TIMEOUT_MS`).
- **Agrupación por repo en dashboard** — Dropped. Los filtros por repo ya existen en suggestions/observations; la agrupación visual sería cosmética y redundante.
- **Evaluar intervalos de jobs con datos reales** — Dropped. Item de análisis, no actionable. Si aparece evidencia de que un job quema tokens sin valor, se revisa puntualmente.

---

## Session 2026-04-11 (autonomous execution — L4)

- **Auto-plan job** — Periodic job (3h) that scans mature open suggestions, revalidates against codebase via LLM, auto-dismisses stale ones, creates plan runs for valid candidates. Configurable rules (effort, risk, impact, confidence, min age, kinds, per-repo opt-in).
- **Auto-execute job** — Periodic job (3h, offset 1.5h) that evaluates planned runs with confidence eval. Auto-executes in worktree if confidence=high + 0 doubts, marks needs_review otherwise. Configurable rules (stricter defaults than plan rules).
- **Trust gate removal** — Removed `trustGate()` from all 40 MCP write tools. Trust is now narrative/gamification only. Score + deltas kept for future evolution.
- **Per-job timeout** — `JobHandlerEntry.timeoutMs` optional field. Auto-plan 30min, auto-execute 60min.
- **Confidence eval → Opus** — Changed from hardcoded Sonnet to `config.models.runner` (default Opus).
- **Suggestion effort field** — Migration v47: `effort` column on suggestions, `auto_eval_at` on runs. Effort persisted from LLM suggest pipeline.
- **Settings UI** — New "Autonomy" section with tabs (plan/execute rules), range sliders, searchable repo opt-in.
- **Visibility** — Job colors, output summaries, Ghost TV states, status line states, guide pages, event kinds, job schedule endpoint.
- **L4 trust level (proactive)** — From backlog long-term. Implemented as configurable autonomy rules rather than trust-level gating.

---

## Session 2026-04-11 (orphaned embeddings cleanup)

- **Embedding cleanup on terminal states** — 7 paths now call `deleteEmbedding` when observations/suggestions reach terminal status. Observations: `expireObservationsBySeverity`, `capObservationsPerRepo`, MCP `shadow_observation_resolve`, web route resolve. Suggestions: `acceptSuggestion`, `expireStale`, CLI `suggest accept`. Dismissed suggestion embeddings intentionally preserved — load-bearing for dedup blocking (`checkSuggestionDuplicate` checks dismissed with 0.75 threshold).

---

## Session 2026-04-11 (audit #2 — 14 findings fixed)

Second comprehensive codebase audit. 6 exploration agents across runner, migrations, analysis pipeline, backend adapters, watcher, web server, dashboard (memory leaks, SSE, state management), storage (transactions, model consistency, FTS/vector sync, concurrency, data lifecycle, dedup). ~20 false positives dismissed. 14 verified findings fixed in 4 sessions:

**S1 — Backend quick fixes:**
- **jobs.ts JSON parse** — replaced silent `.catch(()=>({}))` with `parseOptionalBody` + Zod schema on job trigger endpoint.
- **Focus duration bounds** — added max 168h (1 week) validation on `shadow_focus` MCP tool.
- **Request body size limit** — `readBody()` now enforces MAX_BODY_SIZE (10MB), destroys request on exceed.
- **runs.ts silent catches** — added `console.error` to 3 catch blocks (session ID parse, git diff, LLM title gen).

**S2 — Data integrity:**
- **Entity deletes with transactions** — wrapped deleteRepo/System/Project/Contact in `BEGIN IMMEDIATE / COMMIT / ROLLBACK`.
- **Embedding regeneration after merge** — `consolidate.ts` now calls `generateAndStoreEmbedding()` after `mergeMemoryBody()`.
- **Suggest fail-close** — validation failure now discards all candidates instead of passing them through unfiltered.

**S3 — Dashboard resilience:**
- **ErrorBoundary** — new class component wrapping all routes in App.tsx with Ghost-themed fallback UI.
- **useApi error state** — hook returns `{ data, loading, error, refresh }`. Backward compatible (error is new field).
- **Duplicate fetch fix** — `getActiveRevalidations` reduced from 2 identical API calls to 1.
- **SSE reconnect limit** — max 10 attempts before stopping. Resets on tab focus or successful connection.
- **Blob URL revoke** — Sidebar offline image blob URL properly revoked in useEffect cleanup.

**S4 — job-handlers.ts split (1266 → 3 files):**
- `daemon/handlers/suggest.ts` (568 lines) — handleSuggest, handleSuggestDeep, handleSuggestProject, handleRevalidateSuggestion.
- `daemon/handlers/profiling.ts` (222 lines) — handleRemoteSync, handleRepoProfile, handleContextEnrich, handleMcpDiscover, handleProjectProfile.
- `daemon/job-handlers.ts` (471 lines) — types, helpers, handleHeartbeat, handleConsolidate, handleReflect, createDigestHandler, handleVersionCheck, buildHandlerRegistry.
- Zero breaking changes — all external imports unchanged, registry imports from sub-modules.

**Remaining in backlog:** data retention cleanup job (P3, deferred).

---

## Session 2026-04-11 (observation dedup for resolved/expired)

- **Heartbeat dedup for resolved/expired observations** — 3-pass semantic dedup: active → resolved → expired. Observations that reappear after resolution get reopened (with votes++) instead of created as duplicates. Deliberately resolved observations (with feedback) are protected — only silent votes++ without reopen. Cap overflow and expired observations safe to reopen.
- **Fix `update` action no-op** — `checkObservationDuplicate` returning `update` (similarity 0.65-0.80) now actually calls `bumpObservationVotes` instead of just logging and continuing.
- **New store methods** — `bumpObservationVotes(id, context?)` and `reopenObservation(id, context?)` with context merge. `hasResolveFeedback(observationId)` to distinguish deliberate resolves from auto-caps.
- **Migration v45** — Index `feedback(target_kind, target_id, action)` for efficient feedback lookup.
- **Migration v46** — Normalize 6 orphaned observations with `resolved` status (v42 deploy timing gap) to `done`.

## Session 2026-04-11 (entity_links junction table)

- **Junction table for knowledge entities** — Migration v44: unified `entity_links` table replacing `entities_json LIKE` queries with indexed JOINs. Dual-write strategy (JSON + junction). 1378 existing links backfilled. 13 write paths updated, 10+ in-memory JS filters converted to SQL. `removeEntityReferences` refactored to use indexed lookup. Covers memories, observations, suggestions, tasks. `repo_ids_json` / `findProjectsForRepo` left as separate scope.

## Session 2026-04-11 (MCP tool tests)

- **Tests MCP tools — 205 tests, 68 tools** — Full coverage across 8 modules (status, memory, observations, suggestions, entities, profile, data, tasks). Shared test infrastructure `_test-helpers.ts` with real tmpdir SQLite per suite. `mock.module()` for external deps (suggestion engine, digests, search, embeddings). Node.js `--experimental-test-module-mocks` flag.
- **Fix createSuggestion status default** — Column DEFAULT was `'pending'` from v1, never updated after migration v28 renamed pending→open. Now explicitly inserts `status='open'`.
- **Fix test:dev script** — Excludes dashboard `node_modules` from find, adds module mock flag.

---

## Session 2026-04-11 (unified lifecycle + dashboard coherence + bug fixes)

- **Unified entity lifecycle** — Consistent status vocabulary across all 4 workspace entities. Observations: active→open, resolved→done. Suggestions: pending→open, backlog removed (accept "plan" creates task). Tasks: todo→open, in_progress→active, closed→done. Runs: completed→planned, executed/executed_manual/closed→done (with outcome field), discarded→dismissed. 69 files, migrations v42+v43.
- **Entity connections** — Tasks gain `suggestion_id` (from accept "plan"), runs gain `task_id` (from task execute). Flow: Observation → Suggestion → Task or Run. New MCP tools: `shadow_task_archive`, `shadow_task_execute`. Removed: `shadow_suggest_update`, backlog state, updateSuggestionCategory.
- **Run activity tracking** — Runs show live phase in Activity page (preparing/planning/executing/evaluating/verifying). Migration v41 adds `activity` column. EventBus threaded through RunQueue→RunnerService for SSE `run:phase` events.
- **Dashboard coherence** — Sub-tab symmetry: all entities have active + terminal state sub-tabs in workspace. Sidebar reordered to funnel (workspace→observations→suggestions→tasks→runs). Group labels (ACTION/SYSTEM/CONFIG). Workspace "All" shows only active items. Runs standalone page activated. Tasks count badge in sidebar.
- **Stale detector race fix** — Threshold 10min→16min to avoid racing with JobQueue 15min timeout.
- **Parent close kills children** — Close endpoint now kills active Claude CLI processes and cleans worktrees for in-flight children before transitioning.
- **Event queue dedup** — Skip duplicate events with same kind+target within 15min window.
- **Enrichment cache retention** — `expireStaleEnrichment()` now DELETEs stale entries (not just marks). Default 30d TTL for orphaned entries. Expire at job start too.
- **Reflect evolution** — MCP access (`allowedTools: mcp__shadow__*`) so reflect can verify understanding. Condensation prompt (5-8 points/section, remove obsolete). Single-path (LLM uses shadow_soul_update directly). Validation with revert on malformed output. Soul 13K→6.8K chars on first run.
- **Generic prompts** — Removed hardcoded service names (Oliver, Jira, Linear) from LLM-facing schemas and prompts.
- **`shadow job <type>`** — Unified CLI command to trigger any of the 15 daemon job types. `shadow job list` shows available types. `shadow heartbeat` and `shadow reflect` kept as aliases.
- **Backlog items resolved**: "Sugerencias lifecycle" (unified lifecycle covers it), "Concepto de Tarea/Iniciativa" (tasks entity full-stack), "Evaluar: dónde trackear tickets de Jira" (tasks with external refs).

## Session 2026-04-10 (hooks upgrade + 2-phase heartbeat + dashboard pipeline UX)

- **Hooks upgrade** — PostToolUse rewritten with jq pipeline: per-tool detail (Edit lengths, Bash output, Grep patterns, etc.). Matcher expanded to 8 tools (added Glob, Agent, ToolSearch). UserPromptSubmit/Stop: full text capture (removed 500 char cap), added cwd field. New StopFailure hook (API errors → events.jsonl). New SubagentStart hook (subagent spawns → events.jsonl). All hooks filter daemon self-traffic via SHADOW_JOB=1 env var.
- **Consume-and-delete rotation** — Replaced 2h-filter-writeback with atomic rename at heartbeat start. Each heartbeat processes exactly the data since the last one (zero overlap). Orphaned .rotating files from crashed heartbeats are detected and consumed in the next run.
- **2-phase heartbeat** — New summarize phase (Opus, text-free) reads all raw session data and produces structured summary. Extract + observe then use the summary (~1-3KB) instead of raw data. Prevents JSON format loss on large batches (900KB caused LLM to respond in prose). Extract/observe upgraded to Opus. Cleanup stays Sonnet.
- **SHADOW_JOB env filter** — Daemon LLM calls (via claude --print) were contaminating conversations.jsonl (262MB line caused OOM crash). Fix: claude-cli.ts sets SHADOW_JOB=1, hooks exit early when set.
- **Job timeout** — Bumped from 8min to 15min for 4-phase heartbeat.
- **Dashboard pipeline UX** — Phase pipeline shows all job phases. Active phase pulses in job color (not individual phase color). Completed jobs show uniform dim phases. Multi-repo jobs show detail: enrich (Flyte 2/3), repo-profile (shadow 1/3). Fixed phase lists for digest and revalidate-suggestion. All 15 job types verified against handler code.
- **Rename format functions** — summarizeInteractions → formatInteractions, summarizeConversations → formatConversations, summarizeEvents → formatEvents (JSONL→text formatters, not LLM summaries).

## Session 2026-04-09 (workspace redesign + revalidation + notifications)

- **Workspace redesign — Developer Command Center** — Unified feed of runs + suggestions + observations sorted by priority. Quick filter tabs (All/Runs/Suggestions/Observations). Project strip for top 3 active projects. URL-persisted state (filter, project, selected item, offset).
- **Context Panel** — Slide-in right panel (500px). Run Journey (vertical timeline: observation → suggestion → plan → execution attempts → verification → PR). Suggestion Detail (source obs, scores, linked runs, revalidation verdict). Observation Detail (context, 1:N generated suggestions, linked runs).
- **Run lifecycle improvements** — `closed` status for closing journeys without PR. Draft PR on `executed_manual` runs. Worktree cleanup button. `shadow_run_create` MCP tool for creating runs directly from Claude CLI.
- **Suggestion revalidation** — On-demand Opus job reads repo and evaluates if suggestion is still valid/partial/outdated. Updates content and scores in-place. Verdict-based score adjustments (valid: confidence≥70, partial: ×0.6, outdated: confidence=15). Ranking boost (+5/revalidation, -20 if outdated). Pre-filled dismiss for outdated. Revalidating state persists across page refresh.
- **Backend endpoints** — workspace/feed, runs/context, suggestions/context, observations/context, runs/pr-status (gh CLI), runs/close, runs/cleanup-worktree, notifications API (read_at based).
- **Activity phase pipelines** — All 13 job types now show phase pipeline with currentPhase during running state. Both dot and text pulse on active phase. Heartbeat phases granularized: prepare → extract → cleanup → observe → notify (5 real phases matching 3 LLM calls).
- **Notification center** — Ghost bell icon in topbar (peaceful=no alerts, active+glow=alerts). Slide-in panel with grouped notifications. Mark as read (individual groups + all). SSE auto-refresh. Custom ghost images for empty/active states.
- **Event system cleanup** — Simplified from 14 to 7 event kinds. Fixed observation_alert→observation_notable mismatch. Added run_completed, run_failed, job_failed events. Removed dead kinds. Notify added to suggest-deep, suggest-project handlers. Manual job completion events via job-queue.
- **Orphan cleanup preserves params** — `cleanOrphanedJobsOnStartup` merges error into existing result instead of overwriting, so retry can extract original params (suggestionId, repoId).
- **Revalidation parse robustness** — Permissive Zod schema (only verdict+note required). Prompt reinforced for JSON-only final message. Error diagnostics with raw snippet in job result.

## Session 2026-04-08/09 (backlog cleanup + suggest lifecycle)

- **Suggestion kind colors extracted to shared module** — `utils/suggestion-colors.ts` with `SUG_KIND_COLORS`, `SUG_KIND_OPTIONS`, `SUG_KIND_COLOR_DEFAULT`. Same pattern as `observation-colors.ts`. SuggestionsPage imports from shared module.
- **"Analyze cross-repo" → "Suggest cross-repo"** — Button text in ProjectDetailPage corrected to match actual job type (suggest-project).
- **LiveStatusBar/ActivityEntry color consistency** — Already resolved: both use shared `JOB_TYPE_COLORS` from `job-colors.ts`. Removed from backlog.
- **Progreso visible en jobs multi-repo/multi-project** — `onProgress` callback en `remoteSyncRepos`, `profileRepos` y `activityEnrich`. Handlers reportan item actual + conteo via `setPhase` (e.g. "repo-profile: shadow (1/2)").
- **Repo + project filters in Suggestions/Observations** — Exposed repoId/projectId in API routes, client, and dashboard UI. Select dropdowns appear when >1 repo or >=1 project.
- **Clickable suggestion titles in suggest-deep/suggest-project** — Handlers now return `suggestionItems` (with IDs) instead of `suggestionTitles` (strings). ActivityEntry renders clickable links.
- **Descripciones de memorias no parsean `\n`** — `softBreaks()` en `Markdown.tsx` convierte newlines a line breaks markdown (doble espacio) sin tocar code blocks, headings ni lists. Sin deps nuevas.
- **Trust protection** — `ProfileUpdateSchema` changed from `.passthrough()` to `.strip()` — unknown fields (trustLevel, trustScore) silently dropped.
- **Contacts system improved** — New `shadow_contact_update` MCP tool. `contact_add` deduplicates by name. TeamPage shows all fields (slackId, preferredChannel, notesMd, lastMentionedAt) with expandable cards.
- **Trigger buttons reflect running state** — New `GET /api/jobs/running` endpoint + `useRunningJobs` hook (SSE-aware). ScheduleRibbon, ProjectDetailPage, ReposPage buttons show "Running..." and disabled when job queued/running. Replaces local 15s setTimeout. Also fixed repo-profile trigger missing repoId param.
- **Project context in heartbeat** — Active projects now inject full `contextMd` (from project-profile) into extract/observe prompts. Enables cross-repo awareness in memories and observations.

## Audit 2026-04-06/07 (comprehensive codebase audit)

Full audit report archived in `internal/AUDIT-2026-04-06.md` (not tracked). ~100 findings, all actionable items resolved.

**P0 fixes (data loss prevention):**
- JSONL rotation: atomic rename-then-append pattern (no more lost hook writes)
- Runner worktree cleanup after completion (was leaking disk indefinitely)

**P1 bug fixes (20):**
- Migrations sorted by version before applying
- pendingActivityCount resets each daemon tick
- detectWorkHours uses Intl.DateTimeFormat with user timezone
- MCP pagination: native DB filters for kind/projectId (was post-filter JS with limit:100)
- Trust gate error properly typed
- listObservations LIMIT/OFFSET wrapped in Number()
- Thought loop retries on DB error (was dying silently)
- remote-sync lastFetchedAt only on success
- execSync → execFileSync in repo-watcher (no shell spawning)
- Focus mode: single canonical isFocusModeActive() (was 3 divergent checks)
- drainAll kills remaining jobs after timeout
- Agent SDK passes pack.allowedTools (was hardcoded [])
- schedules.ts: Intl.DateTimeFormat timezone (was fragile toLocaleString anti-pattern)
- N+1 in project detail: native projectId filters for observations/suggestions
- HeartbeatRecord → JobRecord migration completed (dashboard type mismatch fixed)
- repo_add validates path is directory + git repo

**Dead code removed:**
- observeAllRepos, activityObserve, killActiveChild, llmActive variable, legacy layer constants, heartbeat DB methods + mapper, cosineSimilarity re-export, discoverMcpServers unexported

**API hardening:**
- Zod validation on 10 POST endpoints (parseBody/parseOptionalBody helpers)
- clampLimit (max 200) + clampOffset (min 0) on all pagination
- activity/summary uses native startedAfter DB filter (was limit:500 + JS filter)

**Config completeness:**
- 18 config fields + 10 models + 3 efforts mapped to SHADOW_* env vars
- SQLite PRAGMAs: synchronous=NORMAL, temp_store=MEMORY

**God class refactors (4):**
- server.ts 1316 → 203 lines + 8 route modules (`web/routes/*.ts`) + helpers.ts
- activities.ts 1278 → 5 lines barrel + 6 phase modules (`analysis/*.ts`) + shared.ts; directory renamed heartbeat/ → analysis/
- database.ts 2145 → 372 lines façade + 7 domain stores (`storage/stores/*.ts`) + mappers.ts
- cli.ts 1807 → 56 lines dispatcher + 6 command modules (`cli/cmd-*.ts`)

**Documentation:**
- CLAUDE.md fully updated with new project structure, 53 tools, dashboard routes, analysis/ directory, storage/stores/, web/routes/, cli/cmd-*

**FTS5 dedup:** sanitizeFtsQuery extracted to memory/search.ts, reused from database.ts
**removeEntityReferences:** wrapped in transaction (was N+1)
**ORDER BY tiebreakers:** id ASC added to paginated queries

## Session 2026-04-07 (MCP centralization + plugin)

- **Centralize MCP server in daemon** — MCP tools now execute inside the daemon via `POST /api/mcp` (Streamable HTTP transport). Eliminates the ephemeral `npx tsx mcp serve` process: no more dual-writer SQLite, tsx cache bugs, or startup overhead. DaemonSharedState passed to ToolContext for live access (replaces daemon.json disk reads). SSE `mcp:tool_call` events emitted on mutating tool calls for real-time dashboard updates. `mcp serve` kept as stdio fallback.
- **Claude Code plugin validation** — Fixed `hooks.json` format (added `"hooks"` wrapper), added missing UserPromptSubmit + Stop hooks with portable scripts (`scripts/user-prompt.sh`, `scripts/stop.sh`). Inlined mcpServers in `plugin.json` (HTTP transport). Fixed hooks path (`./hooks/hooks.json` relative to plugin root). `claude plugin validate` passes.
- **Getting Started guide** — `GETTING_STARTED.md` with prerequisites, installation steps, MCP registration (HTTP + plugin), verification, first steps, architecture diagram, configuration reference.

## Session 2026-04-06 (job system stabilization + suggest v3)

- **Parallel job execution** — JobQueue class mirroring RunQueue pattern. maxConcurrentJobs=3 LLM + IO unlimited. Per-job adapter tracking via AsyncLocalStorage. 10 handlers extracted from runtime.ts → job-handlers.ts. Runtime main loop simplified from ~400 to ~80 lines.
- **Activity page** — Unified jobs+runs timeline replacing Jobs+Usage+Events pages. LiveStatusBar (SSE real-time), MetricCards, ScheduleRibbon (grouped by function: Analysis/Knowledge/Sync/Digests), per-type expanded views with PhasePipeline visual, deep links Activity↔resources.
- **Workspace** — Renamed from Runs. Same UX, new name reflecting future evolution to developer view.
- **Sidebar restructured** — 15 → 12 items grouped by intention (Action/System/Configure). Removed Dashboard, Jobs, Usage, Events from nav.
- **Digests reader** — Prev/Next navigation, tabs (Daily/Weekly/Brag), regenerate, created/updated timestamps. Backfill for missed days/weeks on wake.
- **Repos page redesign** — Structured profile cards (Overview, Active Areas, Suggestion Guidance). Summary field added to repo-profile prompt + README signal.
- **Corrections system** — `kind: 'correction'` memories consumed by consolidate. loadPendingCorrections injected in extract + repo-profile prompts. enforceCorrections archives/edits contradicting memories via LLM. Promotes correction to `taught` after processing. CorrectionPanel (global sidebar + contextual on repo cards). MCP tool `shadow_correct`.
- **Memory merge in consolidate** — LLM-evaluated combination of similar memories (Opus high). 4 phases: layer-maintenance → corrections → merge → meta-patterns. Trivial dedup for exact title duplicates. No artificial cap (20% safeguard). 246→192 memories consolidated.
- **Suggest v3** — 3 specialized jobs: `suggest` (incremental, reactive post-heartbeat, threshold 1), `suggest-deep` (full codebase review with tool access, Opus high), `suggest-project` (cross-repo analysis for multi-repo projects).
- **Project profile** — New `project-profile` job synthesizing cross-repo context. Reactive after repo-profile for 2+ repo projects. Stored as contextMd on project record (migration v32). Structured display in ProjectDetailPage.
- **Reactive repo-profile** — No longer on 24h timer. Triggered by remote-sync when commits detected (2h min gap). Git log check replaces 7-day filter.
- **Job output enrichment** — Results include titles+IDs (not just counts) for deep linking. observationItems, memoryItems, suggestionItems with clickable links to resources.
- **SSE events** — job:started, job:phase, job:complete emitted from JobQueue. Dashboard already wired.
- **Generic trigger** — POST /api/jobs/trigger/:type for all 13 job types with entity selector (repo/project). Buttons ≤6 entities inline, >6 dropdown.
- **Guide Jobs tab** — Documentation of all 13 job types with chain diagram, phases, models, triggers.
- **Heartbeat scheduling fix** — Seed lastHeartbeatAt from DB on startup. Sync shared state before enqueue. Eliminates rapid re-enqueue after wake/restart.
- **Digest backfill** — Daily/weekly digests generated retroactively for missed days. Weekly backfill loop fix (periodEnd comparison).
- **Queued state** — Jobs show "queued" with orange border instead of type-specific "no output" messages.

## Audit 2026-04-06 (backlog review vs code)

- **Tests ShadowDatabase CRUD + FTS5 + migraciones** — `database.test.ts` (519 líneas): migrations, repos CRUD, memories CRUD+FTS5, observations+dedup, suggestions, jobs lifecycle, projects+entity cascade. SQLite in-memory.
- **Integration tests job orchestration** — `job-queue.test.ts` (303 líneas): claiming, concurrency, priority, same-type exclusion, scheduling, failure handling, drain.
- **Execute plan — verificación de resultado** — `runVerification()` en runner/service.ts ejecuta build/lint/test post-ejecución. Resultado verified/needs_review/unverified. Diff capturado.
- **Idle Escalation** — `consecutiveIdleTicks` en runtime.ts. Heartbeat interval se duplica tras 10 ticks idle. Sleep multiplier hasta 4x (max 120s).
- **Events → Activity feed** (parcial) — ActivityPage reemplaza Events en sidebar. Jobs+runs unificados con filtros, LiveStatusBar, ScheduleRibbon. Falta obs/suggs como items independientes.

## Session 2026-04-04 (mega-refactor C+D+E+F)

- **Project-aware analysis** — active project detection (3 signals, top 3, threshold ≥ 3), project context in extract/observe/suggest prompts, cross_project observation kind
- **MCP Enrichment** — 2-phase plan(Sonnet)+execute(Opus) with user MCPs, enrichment_cache (migration v30), configurable from ProfilePage (toggle + interval)
- **Dashboard overhaul** — ProjectDetailPage, SystemDetailPage, clickable cards with mini-counters, MorningProjects, MorningEnrichment
- **MCP tools expansion** (42→52) — shadow_active_projects, shadow_project_detail, shadow_enrichment_query, shadow_enrichment_config, projectId/kind filters on observations/suggestions
- **Status line** — active project indicator (📋), ghost states for enrich (mint/teal) + sync (pink), 2 new ANSI colors
- **Guide page** — modular guide updated with new phases, observation kinds, MCP tools, config vars, fixed box-drawing rendering
- **Reflect 2-phase** — Sonnet extracts deltas → Opus evolves soul. Removed Active focus + Project status (redundant with project detection). Soul snapshots before each update.
- **Soul history** — GET /api/soul/history + expandable timeline in ProfilePage
- **Enrichment settings** — toggle + interval selector in ProfilePage, stored in profile preferences, daemon reads from profile
- **Suggest cap removed** — was 30, blocked generation. Now unlimited (paginated + ranked)
- **Jobs page legend** — remote-sync + context-enrich in schedule header with countdowns, fixed isActive for non-LLM jobs
- **Suggestion kind colors** — refactor=purple, bug=red, improvement=blue, feature=green (SuggestionsPage + ProjectDetailPage)
- **ProjectDetailPage UX** — ScoreBar replaces text scores, deep links with ?highlight=, clickable items

## Session 2026-04-04 (earlier)

- **Trust L3 — confidence gate** — Plan-first para L3, confidence evaluation (Sonnet high), auto child run si confidence=high + 0 doubts. Safe fallback. Schema v21 (confidence, doubts_json).
- **Draft PR button** — POST /api/runs/:id/draft-pr, push branch + gh pr create --draft. Botón en RunsPage, desactivado si no hay GitHub remote. Schema v22 (pr_url).
- **Execution runs write permissions** — allowedTools Edit/Write/Bash para execution runs. Plan-only runs solo MCP + read.
- **RunsPage redesign** — Status borders, pipeline visual (plan→exec→PR), action hierarchy (primary/secondary), collapsible details, colored filter tabs, parent/child grouping inline, ConfidenceIndicator (3-dot), RunPipeline, ScoreBar components.
- **SuggestionsPage redesign** — Status borders, expandable cards, action hierarchy (Accept primary, Snooze/Dismiss secondary), inline dismiss con dropdown de razones, ScoreBar compacto, colored filters, "All caught up" empty state.
- **ObservationsPage redesign** — Severity borders (rojo/naranja/azul), severity icons, prominent action buttons (Resolve primary), severity filter, fix empty state bug, colored filters.
- **DashboardPage clickable cards** — MetricCard con href + trend support. Todas las cards navegan a su página con filtro.
- **MorningPage layout** — 2-column grid (reduce scroll ~50%), yesterday's daily digest, "View all" links, clickable memories.
- **Job timeout kills child process** — runJobType con timeout integrado + killActiveChild(). Flag cancelled previene sobreescritura. Eliminados Promise.race externos redundantes. Heartbeats max ~8min.
- **Auto-sync remoteUrl** — collectRepoContext detecta git remote y actualiza DB en cada heartbeat.
- **Session for executed runs** — Endpoint session acepta cualquier status (no solo completed).
- **Draft PR branch validation** — Verifica que el branch existe antes de intentar push.

## Session 2026-04-03

- **Fix: jobs colgados tras restart** — `cleanOrphanedJobsOnStartup()` falla ALL running jobs al arrancar (no espera 10min). Kill orphaned claude processes. Child PID tracking con SIGTERM en shutdown.
- **Dashboard polish** — durationMs en stale/orphan, statusline "suggesting", morning running vs skip con fase, colores alineados, setPhase escribe activity al job en DB
- **Feedback optimization** — `getThumbsState()` con índice dedicado, inline en responses (eliminó HTTP request extra)
- **Server-side filters + URL persistence + pagination** — `useFilterParams` hook, `Pagination` component, offset/limit en DB + API, kind filter server-side en suggestions, migrations v12+v13

## Prioridad alta (completada 2026-04-02)

- **Analyze prompt con contexto de observaciones existentes** — Analyze recibe observaciones activas + feedback de dismiss
- **Feedback loop: dismiss/accept enriquecen futuras sugerencias** — Suggest prompt recibe dismissed notes, accepted history, pending titles
- **Observaciones auto-resolve por condición** — LLM en analyze revisa activas contra estado actual + observe-cleanup phase con MCP
- **Run result truncado a 500 chars** — Resultado completo guardado sin truncar

## Prioridad media (completada 2026-04-02)

- **Sugerencias operativas no son útiles** — Suggest prompt instruye: solo técnicas, no operativas
- **Sugerencias aceptadas/dismissed influyen en futuras** — Historial de feedback en suggest prompt
- **Dashboard — markdown rendering** — react-markdown con estilos Tailwind en Runs, Suggestions, Morning, Memories
- **Dashboard — sidebar badges con contadores** — Suggestions, Observations, Runs. Se actualiza cada 15s
- **Morning page mejorada** — Recent jobs, memories learned, runs to review, suggestions, observations
- **Memorias con trazabilidad al heartbeat** — `source_id` column, heartbeat ID en createMemory
- **Markdown en MemoriesPage + body expandible** — Body renderizado, tags, scope, confidence, source, dates
- **Suggestions — filtro por kind** — FilterTabs dinámicas derivadas de los kinds presentes
- **Extraer timeAgo/formatTokens a utils/format.ts** — 4 funciones extraídas de 7 páginas

## Prioridad baja (completada 2026-04-02)

- **KeepAlive genera procesos zombie** — `KeepAlive.Crashed: true`
- **patterns.ts dead code** — Eliminado (104 líneas)
- **logLevel config sin usar** — Eliminado debug block
- **Prompts split en 2 llamadas** — Extract + Observe separados, effort levels
- **Effort level configurable por fase** — `--effort` flag, defaults por fase
- **MCP tool shadow_memory_update** — Cambiar layer, body, tags, kind, scope
- **Status line path frágil** — tsx binstub con fallback npx
- **ASCII art mascota** — Ghost `{•‿•}` con 13 estados × 3 variantes, colores ANSI
- **Emoji Guide actualizada** — Ghost mascot table, status line examples
- **CLAUDE.md actualizado** — 37 tools, 15 routes, Current State completo
- **Memorias mal clasificadas en core** — Prompt afinado, 4 archivadas, 8 movidas a hot

## Long-term / Features (completada 2026-04-02)

- **Validación Zod de resultados LLM por tipo de job** — schemas.ts con ExtractResponseSchema, ObserveResponseSchema, SuggestResponseSchema. safeParse en activities.ts reemplaza `as {}` casts.
- **JSON repair para LLM outputs truncados** — repairJson() cierra estructuras abiertas, safeParseJson() pipeline completo con Zod + recovery parcial.
- **Suggestion Snooze** — pending → snoozed → re-pending. Dropdown 3h/6h/1d/3d/7d. Engine + daemon tick + API + MCP tool + CLI + dashboard (SuggestionsPage + MorningPage).

## Completada 2026-04-03

- **Suggestion quality control** — Dedup por similaridad (3+ palabras), quality filter (impact>=3, confidence>=60), prompt tightening (max 3, no micro-optimizations), pending cap 30, ranked API
- **Ghost mascot live phase tracking** — setPhase() escribe al daemon.json en tiempo real. Status line muestra analyzing/suggesting/consolidating/reflecting/cleaning
- **Ghost mascot nuevos** — Reflect `{-_-}~` (blue), cleanup `{•_•}🧹` (yellow), emojis actualizados para learning/analyzing/ready
- **Pulsing heart** — ♥︎/♡ alterna cada 15s en status line
- **shadow teach rewrite** — System prompt en teaching mode, personalidad SOUL.md, --allowedTools, --topic flag
- **totalInteractions counter** — Incrementa en createInteraction(), bondLevel eliminado de UI
- **Fix daemon hang** — 8min Promise.race timeout en heartbeat/suggest/consolidate/reflect/runner. Stale run detector (10min). lastHeartbeatAt siempre se actualiza.
- **Stale run detector** — Runs stuck en 'running' >10min se marcan failed automáticamente
- **Parent↔child run links** — Badges clickables ↑parent/↓child en RunsPage, auto-status propagation, child→executed (no to review)
- **Eliminado anti-loop.ts** — Código muerto (0 callers), reemplazado por job system. Ejecutado desde plan generado por Shadow.
- **shadow teach** — Sesión interactiva Claude CLI con MCP tools para enseñar
- **Fix cyan color** — --color-cyan añadido al CSS theme, watching/learning visibles en emoji guide
- **Cleanup phase visible** — Añadida al state machine, aparece en detalles del heartbeat
- **L2 validado end-to-end** — Accept → plan → execute → worktree + branch. Limitación conocida: escritura bloqueada en --print mode (para L3).

## Long-term / Arquitectura (completada 2026-04-02 — 2026-04-04)

- **Feedback loop completo** — Tabla feedback, 👍/👎 toggle, razones en dismiss/resolve/discard
- **Job system** — Jobs table, scheduler, heartbeat/suggest/consolidate/reflect como jobs independientes
- **Trust L2 complete** — Plan + Open Session + Execute con MCP delegation
- **Reflect job** — Soul reflection diaria con Opus, feedback + memorias sintetizados
- **Runs paralelos** — RunQueue con maxConcurrentRuns. Concurrent execution via ClaudeCliAdapter instances.
- **Concepto de Proyecto** — First-class entity. Project-aware analysis, active project detection, momentum scoring, MCP tools (shadow_project_detail, shadow_active_projects), dashboard detail page.
- **Semantic search (sqlite-vec)** — Hybrid FTS5 + vector search via RRF (k=60). shadow_search MCP tool. Backfill on startup.
- **UI preparada para escala (+40 repos)** — Paginación offset/limit + filtros server-side con URL persistence en Suggestions, Observations, Memories, Runs, Jobs. (parcial: falta agrupación por repo, búsqueda global)
- **Comunicación externa via MCP servers** — MCP Enrichment: Shadow discovers user MCPs from settings.json and queries them for context. (parcial: reads external data, no direct communication)
