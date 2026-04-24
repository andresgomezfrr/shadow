# Security Policy

## Supported Versions

Shadow is in active development and follows a rolling-main model. Only the
latest release on `main` receives security updates. Older tagged versions
are not backported — pin to a tag only if you accept that risk.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security problems.**

Instead, report privately by emailing **andresgomezfrr@gmail.com** with:

- A description of the issue and the impact you expect
- Steps to reproduce (commands, config, minimal example)
- The version of Shadow (`shadow status`) and your platform (macOS/Linux, Node
  version)
- Any proof-of-concept, logs, or additional context

You should get an acknowledgement within a few days. A fix timeline depends on
severity and complexity, but we aim to triage critical issues within one week.

## Scope

Shadow is a **local-first** tool that runs as a daemon on your own machine
with your own Claude credentials. Interesting attack surface includes:

- The local HTTP dashboard (`http://localhost:3700`) — not authenticated, so
  any process on the machine that can reach loopback can read/write state
- SQLite database (`~/.shadow/shadow.db`) — contains memories, conversations,
  and potentially sensitive project knowledge
- Hooks installed into Claude Code (`~/.claude/settings/hooks.json`) —
  execute shell commands on every tool use
- The `auto-execute` / `auto-plan` jobs (opt-in, off by default) — can run
  Claude with permission to edit files and run builds

**Out of scope**: reports that require root on the host, physical access, or
assume the user has already been compromised (e.g. malicious `~/.shadow`
contents). Issues in third-party dependencies should be reported upstream;
we'll track the advisory and bump once fixed.

## Credits

Researchers who report valid issues will be credited in the release notes for
the fixing version, unless they prefer to stay anonymous.
