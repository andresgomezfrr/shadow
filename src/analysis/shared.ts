import { readFileSync, renameSync, appendFileSync, unlinkSync, existsSync, statSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ShadowConfig } from '../config/load-config.js';
import type { ShadowDatabase } from '../storage/database.js';
import type { EntityLink } from '../storage/models.js';

import type { HeartbeatContext } from './state-machine.js';
import { log } from '../log.js';

// --- Entity auto-linking ---

/** Cache of system/project names, loaded once per heartbeat phase to avoid repeated full-table scans */
export type EntityNameCache = { systems: { id: string; name: string }[]; projects: { id: string; name: string }[] };

export function loadEntityNameCache(db: ShadowDatabase): EntityNameCache {
  return {
    systems: db.listSystems().map(s => ({ id: s.id, name: s.name })),
    projects: db.listProjects().map(p => ({ id: p.id, name: p.name })),
  };
}

/** Build entity links from a repo: repo → its projects → their systems */
export function autoLinkFromRepo(db: ShadowDatabase, repoId: string): EntityLink[] {
  const entities: EntityLink[] = [{ type: 'repo', id: repoId }];
  try {
    const projects = db.findProjectsForRepo(repoId);
    for (const p of projects) {
      entities.push({ type: 'project', id: p.id });
      for (const sysId of p.systemIds) {
        if (!entities.some(e => e.type === 'system' && e.id === sysId)) {
          entities.push({ type: 'system', id: sysId });
        }
      }
    }
  } catch { /* best effort */ }
  return entities;
}

/** Detect mentions of registered systems/projects in text */
export function detectEntityMentions(db: ShadowDatabase, text: string, cache?: EntityNameCache): EntityLink[] {
  const entities: EntityLink[] = [];
  const lower = text.toLowerCase();
  try {
    const c = cache ?? loadEntityNameCache(db);
    for (const sys of c.systems) {
      if (sys.name.length >= 3 && lower.includes(sys.name.toLowerCase())) {
        entities.push({ type: 'system', id: sys.id });
      }
    }
    for (const proj of c.projects) {
      if (proj.name.length >= 3 && lower.includes(proj.name.toLowerCase())) {
        entities.push({ type: 'project', id: proj.id });
      }
    }
  } catch { /* best effort */ }
  return entities;
}

/** Combine entity links from repo + name detection, deduplicated */
export function buildEntityLinks(db: ShadowDatabase, repoId: string | null, text: string, cache?: EntityNameCache): EntityLink[] {
  const entities: EntityLink[] = [];
  if (repoId) entities.push(...autoLinkFromRepo(db, repoId));
  entities.push(...detectEntityMentions(db, text, cache));
  // Deduplicate
  const seen = new Set<string>();
  return entities.filter(e => {
    const key = `${e.type}:${e.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Atomically update entities_json + entity_links junction on an existing memory/observation/suggestion */
export function persistEntityLinks(db: ShadowDatabase, table: 'memories' | 'observations' | 'suggestions', id: string, entities: EntityLink[]): void {
  if (entities.length === 0) return;
  try {
    db.updateEntityLinks(table, id, entities);
  } catch { /* best effort */ }
}

// --- Consume-and-delete rotation ---

/**
 * Rotate a JSONL file for consumption. Returns the path to the .rotating file to read, or null if nothing to process.
 * Handles orphaned .rotating files from crashed heartbeats by appending new data to them.
 */
export function rotateForConsume(basePath: string): string | null {
  const rotatingPath = basePath + '.rotating';

  // Case A: orphaned .rotating from crashed heartbeat — append new data to it
  if (existsSync(rotatingPath)) {
    try {
      const current = readFileSync(basePath, 'utf8');
      if (current.trim()) appendFileSync(rotatingPath, current);
      unlinkSync(basePath);
    } catch { /* no main file — orphan has all the data */ }
    return rotatingPath;
  }

  // Case B: normal — check main file has content, then rename
  try {
    const stat = statSync(basePath);
    if (stat.size === 0) return null;
    renameSync(basePath, rotatingPath);
    return rotatingPath;
  } catch {
    return null;
  }
}

/** Delete a .rotating file after consumption. Safe to call with null. */
export function cleanupRotating(rotatingPath: string | null): void {
  if (!rotatingPath) return;
  try {
    unlinkSync(rotatingPath);
  } catch (e) {
    // ENOENT is fine — file already gone from a prior cleanup attempt.
    // Anything else (EACCES, EBUSY, EIO) is worth logging so stuck files
    // don't accumulate silently — the cleanup job sweep below will catch
    // leftovers older than 24h (audit A-07).
    const errno = (e as NodeJS.ErrnoException).code;
    if (errno !== 'ENOENT') {
      log.error(`[shared] failed to unlink ${rotatingPath}: ${errno ?? 'unknown'}`);
    }
  }
}

/**
 * Sweep a data directory for orphaned `.rotating` files older than maxAgeMs
 * (default 24h). A crashed heartbeat can leave these behind; the next run
 * reclaims them by appending new data, but if the user disables heartbeats
 * or the data files go idle, they would sit forever. Called from the daily
 * cleanup job. Returns the count of files successfully deleted.
 */
export function purgeStaleRotatingFiles(dataDir: string, maxAgeMs = 24 * 60 * 60 * 1000): number {
  let purged = 0;
  try {
    const entries = readdirSync(dataDir);
    const cutoff = Date.now() - maxAgeMs;
    for (const name of entries) {
      if (!name.endsWith('.rotating')) continue;
      const full = resolve(dataDir, name);
      try {
        const stat = statSync(full);
        if (stat.mtimeMs < cutoff) {
          unlinkSync(full);
          purged++;
          log.error(`[shared] purged stale rotating file: ${name} (age ${Math.round((Date.now() - stat.mtimeMs) / 3_600_000)}h)`);
        }
      } catch (e) {
        log.error(`[shared] failed to stat/unlink ${name}:`, e instanceof Error ? e.message : e);
      }
    }
  } catch (e) {
    log.error('[shared] failed to read dataDir for rotating sweep:', e instanceof Error ? e.message : e);
  }
  return purged;
}

// --- Interaction loading ---

export type InteractionEntry = {
  ts: string; tool: string; file: string; cmd: string;
  session?: string; cwd?: string; detail?: Record<string, unknown>;
};

/** Load ALL entries from a JSONL file (typically .rotating). No time filter. */
export function loadAllInteractions(filePath: string): InteractionEntry[] {
  try {
    const content = readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    const entries: InteractionEntry[] = [];
    for (const line of lines) {
      try {
        const e = JSON.parse(line) as Record<string, unknown>;
        entries.push({
          ts: (e.ts as string) ?? '',
          tool: (e.tool as string) ?? '',
          file: (e.file as string) ?? '',
          cmd: (e.cmd as string) ?? '',
          session: e.session as string | undefined,
          cwd: e.cwd as string | undefined,
          detail: e.detail as Record<string, unknown> | undefined,
        });
      } catch { /* skip malformed lines */ }
    }
    return entries;
  } catch {
    return [];
  }
}

export function formatInteractions(interactions: InteractionEntry[]): string {
  if (interactions.length === 0) return '';

  // Group by file with per-tool breakdown
  const fileTools = new Map<string, Map<string, number>>();
  const toolCounts = new Map<string, number>();
  const bashActivities: { cmd: string; output?: string }[] = [];
  const grepActivities: { pattern: string; matches: number }[] = [];
  const globActivities: { pattern: string; matches: number }[] = [];

  for (const i of interactions) {
    toolCounts.set(i.tool, (toolCounts.get(i.tool) ?? 0) + 1);
    if (i.file) {
      let tools = fileTools.get(i.file);
      if (!tools) { tools = new Map(); fileTools.set(i.file, tools); }
      tools.set(i.tool, (tools.get(i.tool) ?? 0) + 1);
    }
    // Collect key activities from detail
    if (i.tool === 'Bash' && i.detail) {
      const output = i.detail.output as string | undefined;
      bashActivities.push({ cmd: i.cmd, output });
    } else if (i.tool === 'Grep' && i.detail) {
      grepActivities.push({ pattern: (i.detail.pattern as string) ?? '', matches: (i.detail.matches as number) ?? 0 });
    } else if (i.tool === 'Glob' && i.detail) {
      globActivities.push({ pattern: (i.detail.pattern as string) ?? '', matches: (i.detail.matches as number) ?? 0 });
    }
  }

  const lines: string[] = [`${interactions.length} tool calls:`];

  // Top files with per-tool breakdown
  const topFiles = [...fileTools.entries()]
    .map(([file, tools]) => ({ file, total: [...tools.values()].reduce((a, b) => a + b, 0), tools }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 15);
  if (topFiles.length > 0) {
    lines.push('\nFiles worked on:');
    for (const { file, total, tools } of topFiles) {
      const breakdown = [...tools.entries()].map(([t, c]) => `${c} ${t.toLowerCase()}${c > 1 ? 's' : ''}`).join(', ');
      lines.push(`  - ${file} (${total}x: ${breakdown})`);
    }
  }

  // Key activities: Bash commands with output
  const keyActivities: string[] = [];
  for (const b of bashActivities.slice(0, 5)) {
    if (b.cmd) {
      const cmdShort = b.cmd.length > 80 ? b.cmd.slice(0, 80) + '...' : b.cmd;
      if (b.output) {
        const outShort = b.output.length > 200 ? b.output.slice(0, 200) + '...' : b.output;
        keyActivities.push(`  - Bash: \`${cmdShort}\` → ${outShort}`);
      } else {
        keyActivities.push(`  - Bash: \`${cmdShort}\``);
      }
    }
  }
  for (const g of grepActivities.slice(0, 3)) {
    keyActivities.push(`  - Grep: "${g.pattern}" → ${g.matches} files`);
  }
  for (const g of globActivities.slice(0, 3)) {
    keyActivities.push(`  - Glob: "${g.pattern}" → ${g.matches} files`);
  }
  if (keyActivities.length > 0) {
    lines.push('\nKey activities:');
    lines.push(...keyActivities);
  }

  // Tool breakdown
  lines.push('\nTool breakdown: ' + [...toolCounts.entries()].sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t}: ${c}`).join(', '));

  return lines.join('\n');
}

// --- Conversation loading ---

export type ConversationTurn = { ts: string; role: string; text: string; session: string; cwd?: string };

/** Load ALL entries from a conversations JSONL file (typically .rotating). No time filter. */
export function loadAllConversations(filePath: string): ConversationTurn[] {
  try {
    const content = readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    const entries: ConversationTurn[] = [];
    for (const line of lines) {
      try {
        const e = JSON.parse(line) as ConversationTurn;
        entries.push({
          ts: e.ts ?? '',
          role: e.role ?? '',
          text: e.text ?? '',
          session: e.session ?? 'unknown',
          cwd: e.cwd,
        });
      } catch { /* skip */ }
    }
    return entries;
  } catch {
    return [];
  }
}

export function formatConversations(conversations: ConversationTurn[]): string {
  if (conversations.length === 0) return '';

  // Group by session
  const sessions = new Map<string, ConversationTurn[]>();
  for (const turn of conversations) {
    const sid = turn.session || 'unknown';
    const list = sessions.get(sid) ?? [];
    list.push(turn);
    sessions.set(sid, list);
  }

  const lines: string[] = [`${conversations.length} conversation turns across ${sessions.size} session(s):`];

  for (const [sid, turns] of sessions) {
    const cwd = turns.find(t => t.cwd)?.cwd;
    const header = cwd
      ? `\nSession ${sid.slice(0, 8)}... (${turns.length} turns, ${cwd}):`
      : `\nSession ${sid.slice(0, 8)}... (${turns.length} turns):`;
    lines.push(header);
    for (const turn of turns) {
      const prefix = turn.role === 'user' ? '  User' : '  Claude';
      lines.push(`  ${prefix}: "${turn.text}"`);
    }
  }

  return lines.join('\n');
}

// --- Events loading ---

export type EventEntry = {
  ts: string; event: string; session?: string; error_type?: string; cwd?: string;
};

/** Load ALL entries from an events JSONL file (typically .rotating). */
export function loadAllEvents(filePath: string): EventEntry[] {
  try {
    const content = readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    const entries: EventEntry[] = [];
    for (const line of lines) {
      try {
        const e = JSON.parse(line) as EventEntry;
        entries.push({
          ts: e.ts ?? '',
          event: e.event ?? '',
          session: e.session,
          error_type: e.error_type,
          cwd: e.cwd,
        });
      } catch { /* skip */ }
    }
    return entries;
  } catch {
    return [];
  }
}

export function formatEvents(events: EventEntry[]): string {
  if (events.length === 0) return '';

  const counts = new Map<string, number>();
  const errorTypes = new Map<string, number>();
  for (const e of events) {
    counts.set(e.event, (counts.get(e.event) ?? 0) + 1);
    if (e.event === 'stop_failure' && e.error_type) {
      errorTypes.set(e.error_type, (errorTypes.get(e.error_type) ?? 0) + 1);
    }
  }

  const parts: string[] = [];
  const failures = counts.get('stop_failure') ?? 0;
  if (failures > 0) {
    const breakdown = [...errorTypes.entries()].map(([t, c]) => `${t}×${c}`).join(', ');
    parts.push(`${failures} API error${failures > 1 ? 's' : ''} (${breakdown})`);
  }
  const subagents = counts.get('subagent_start') ?? 0;
  if (subagents > 0) {
    parts.push(`${subagents} subagent spawn${subagents > 1 ? 's' : ''}`);
  }

  return parts.join(', ');
}

// --- Model / effort helpers ---

type ModelPhase = 'analyze' | 'suggest' | 'consolidate' | 'runner' | 'summarize' | 'extract' | 'observe' | 'reflectDelta' | 'reflectEvolve' | 'moodPhrase';

export function getModel(ctx: HeartbeatContext, phase: ModelPhase): string {
  const prefs = ctx.profile.preferences as Record<string, unknown> | undefined;
  const models = prefs?.models as Record<string, string> | undefined;
  return models?.[phase] ?? ctx.config.models[phase];
}

export function getEffort(ctx: HeartbeatContext, phase: 'analyze' | 'suggest' | 'consolidate' | 'runner'): string {
  const prefs = ctx.profile.preferences as Record<string, unknown> | undefined;
  const efforts = prefs?.efforts as Record<string, string> | undefined;
  return efforts?.[phase] ?? ctx.config.efforts[phase];
}
