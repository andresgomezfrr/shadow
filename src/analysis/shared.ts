import { readFileSync, renameSync, appendFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ShadowConfig } from '../config/load-config.js';
import type { ShadowDatabase } from '../storage/database.js';
import type { EntityLink } from '../storage/models.js';

import type { HeartbeatContext } from './state-machine.js';

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

/** Update entities_json on an existing memory/observation */
export function persistEntityLinks(db: ShadowDatabase, table: 'memories' | 'observations' | 'suggestions', id: string, entities: EntityLink[]): void {
  if (entities.length === 0) return;
  try {
    db.rawDb.prepare(`UPDATE ${table} SET entities_json = ? WHERE id = ?`).run(JSON.stringify(entities), id);
  } catch { /* best effort */ }
}

// --- Interaction loading ---

export function loadRecentInteractions(config: ShadowConfig, sinceIso?: string): { file: string; tool: string; cmd: string; ts: string }[] {
  const interactionsPath = resolve(config.resolvedDataDir, 'interactions.jsonl');
  try {
    const content = readFileSync(interactionsPath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    const since = sinceIso ? new Date(sinceIso).getTime() : Date.now() - 60 * 60 * 1000; // default: last 1h
    const entries: { file: string; tool: string; cmd: string; ts: string }[] = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as { ts: string; tool: string; file?: string; cmd?: string };
        if (new Date(entry.ts).getTime() > since) {
          entries.push({
            ts: entry.ts,
            tool: entry.tool,
            file: entry.file ?? '',
            cmd: entry.cmd ?? '',
          });
        }
      } catch { /* skip malformed lines */ }
    }
    return entries;
  } catch {
    return [];
  }
}

export function summarizeInteractions(interactions: { file: string; tool: string; cmd: string; ts: string }[]): string {
  if (interactions.length === 0) return '';

  // Group by file/repo to show what was worked on
  const fileCounts = new Map<string, number>();
  const toolCounts = new Map<string, number>();

  for (const i of interactions) {
    if (i.file) {
      fileCounts.set(i.file, (fileCounts.get(i.file) ?? 0) + 1);
    }
    toolCounts.set(i.tool, (toolCounts.get(i.tool) ?? 0) + 1);
  }

  const lines: string[] = [`${interactions.length} tool calls in Claude CLI sessions:`];

  // Top files touched
  const topFiles = [...fileCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (topFiles.length > 0) {
    lines.push('\nFiles worked on:');
    for (const [file, count] of topFiles) {
      lines.push(`  - ${file} (${count}x)`);
    }
  }

  // Tool usage breakdown
  lines.push('\nTool usage:');
  for (const [tool, count] of [...toolCounts.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`  - ${tool}: ${count}`);
  }

  return lines.join('\n');
}

// --- Conversation loading ---

export type ConversationTurn = { ts: string; role: string; text: string; session: string };

export function loadRecentConversations(config: ShadowConfig, sinceIso: string): ConversationTurn[] {
  const convPath = resolve(config.resolvedDataDir, 'conversations.jsonl');
  try {
    const content = readFileSync(convPath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    const since = new Date(sinceIso).getTime();
    const entries: ConversationTurn[] = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as ConversationTurn;
        if (new Date(entry.ts).getTime() > since) {
          entries.push(entry);
        }
      } catch { /* skip */ }
    }
    return entries;
  } catch {
    return [];
  }
}

export function summarizeConversations(conversations: ConversationTurn[]): string {
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
    lines.push(`\nSession ${sid.slice(0, 8)}... (${turns.length} turns):`);
    for (const turn of turns.slice(-10)) { // last 10 turns per session
      const prefix = turn.role === 'user' ? '  User' : '  Claude';
      lines.push(`  ${prefix}: "${turn.text}"`);
    }
  }

  return lines.join('\n');
}

// --- Log rotation ---

export function rotateConversationsLog(config: ShadowConfig): void {
  const convPath = resolve(config.resolvedDataDir, 'conversations.jsonl');
  const tmpPath = convPath + '.rotating';

  // Atomic rename — hooks will create a new file on their next append
  try { renameSync(convPath, tmpPath); } catch { return; }

  try {
    const content = readFileSync(tmpPath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const kept = lines.filter(line => {
      try {
        const entry = JSON.parse(line) as { ts: string };
        return entry.ts > twoHoursAgo;
      } catch { return false; }
    });
    // Append kept lines to the (possibly new) file — preserves any hook writes since rename
    if (kept.length > 0) appendFileSync(convPath, kept.join('\n') + '\n', 'utf8');
  } catch { /* read/filter error — non-fatal */ }

  try { unlinkSync(tmpPath); } catch { /* already gone */ }
}

export function rotateInteractionsLog(config: ShadowConfig, _cutoffIso: string): void {
  const interactionsPath = resolve(config.resolvedDataDir, 'interactions.jsonl');
  const tmpPath = interactionsPath + '.rotating';

  // Atomic rename — hooks will create a new file on their next append
  try { renameSync(interactionsPath, tmpPath); } catch { return; }

  try {
    const content = readFileSync(tmpPath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);

    // Keep lines from the last 2 hours as buffer (not 5 min — too aggressive)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const kept = lines.filter(line => {
      try {
        const entry = JSON.parse(line) as { ts: string };
        return entry.ts > twoHoursAgo;
      } catch { return false; }
    });

    // Append kept lines to the (possibly new) file — preserves any hook writes since rename
    if (kept.length > 0) appendFileSync(interactionsPath, kept.join('\n') + '\n', 'utf8');
  } catch { /* read/filter error — non-fatal */ }

  try { unlinkSync(tmpPath); } catch { /* already gone */ }
}

// --- Model / effort helpers ---

export function getModel(ctx: HeartbeatContext, phase: 'analyze' | 'suggest' | 'consolidate' | 'runner'): string {
  const prefs = ctx.profile.preferences as Record<string, unknown> | undefined;
  const models = prefs?.models as Record<string, string> | undefined;
  return models?.[phase] ?? ctx.config.models[phase];
}

export function getEffort(ctx: HeartbeatContext, phase: 'analyze' | 'suggest' | 'consolidate' | 'runner'): string {
  const prefs = ctx.profile.preferences as Record<string, unknown> | undefined;
  const efforts = prefs?.efforts as Record<string, string> | undefined;
  return efforts?.[phase] ?? ctx.config.efforts[phase];
}
