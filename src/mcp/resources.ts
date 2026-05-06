// MCP Resources primitive — alineación con MCP 2026 roadmap.
//
// Resources representan datos read-only que el cliente puede listar y leer
// directamente, sin tener que invocar tools. Reducen el coste contextual de
// listar 100+ tools y separan datos (resources) de acciones (tools).
//
// Convención de URI: `shadow://<scope>/<resource>` (ej. `shadow://profile/soul`).
//
// Anotaciones siguen la spec MCP 2025-06-18:
//   - audience: ["user"|"assistant"] — para quién es el contenido
//   - priority: 0.0..1.0 — sugerencia de prioridad al cargar
//   - lastModified: ISO8601 — pista de freshness
//
// Diseñado para evolucionar gradual: las tools existentes (entities, data)
// siguen disponibles hasta tener confirmación de uso real.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import type { ShadowDatabase } from '../storage/database.js';

// Directorio donde Claude Code escribe los planes de plan-mode.
// Override vía env por tests + máquinas con layout no estándar.
const PLANS_DIR = process.env.SHADOW_PLANS_DIR
  ? resolve(process.env.SHADOW_PLANS_DIR)
  : join(homedir(), '.claude', 'plans');

type PlanSummary = {
  filename: string;
  path: string;
  sizeBytes: number;
  mtime: string;
  firstHeading: string | null;
};

function readPlansDir(dir: string): PlanSummary[] {
  if (!existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: PlanSummary[] = [];
  for (const name of entries) {
    if (!name.endsWith('.md')) continue;
    const path = join(dir, name);
    try {
      const st = statSync(path);
      if (!st.isFile()) continue;
      // Solo leemos el principio del archivo para sacar la primera heading;
      // los planes pueden ser grandes y no queremos cargarlos enteros.
      const head = readFileSync(path, 'utf-8').slice(0, 2048);
      const headingMatch = head.split('\n').find((l) => l.trim().startsWith('# '));
      out.push({
        filename: name,
        path,
        sizeBytes: st.size,
        mtime: new Date(st.mtimeMs).toISOString(),
        firstHeading: headingMatch ? headingMatch.replace(/^#\s+/, '').trim() : null,
      });
    } catch {
      /* skip unreadable */
    }
  }
  // mtime desc — más reciente primero
  out.sort((a, b) => (a.mtime < b.mtime ? 1 : a.mtime > b.mtime ? -1 : 0));
  return out;
}

export type ResourceAnnotations = {
  audience?: ('user' | 'assistant')[];
  priority?: number;
  lastModified?: string;
};

export type McpResource = {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  annotations?: ResourceAnnotations;
  read: () => Promise<string>;
};

export type ResourceContents = {
  uri: string;
  mimeType: string;
  text: string;
};

export function createMcpResources(db: ShadowDatabase): McpResource[] {
  return [
    {
      uri: 'shadow://profile/soul',
      name: 'Shadow soul',
      description: 'Active persona configuration: voice, developer profile, decision patterns. Same content as shadow_check_in.soul but addressable directly without a tool roundtrip.',
      mimeType: 'application/json',
      annotations: { audience: ['assistant'], priority: 0.9 },
      read: async () => {
        const profile = db.ensureProfile();
        const soulMem = db
          .listMemories({ archived: false })
          .find((m) => m.kind === 'soul_reflection');
        return JSON.stringify(
          {
            soul: soulMem?.bodyMd ?? null,
            bondTier: profile.bondTier ?? null,
            locale: profile.locale ?? null,
            proactivityLevel: profile.proactivityLevel ?? null,
            focusMode: profile.focusMode ?? null,
          },
          null,
          2,
        );
      },
    },
    {
      uri: 'shadow://observations/open',
      name: 'Open observations',
      description: 'All currently open observations across repos and projects. Read-only view; mutating actions still go through shadow_observation_ack/resolve tools.',
      mimeType: 'application/json',
      annotations: { audience: ['assistant'], priority: 0.6 },
      read: async () => {
        const items = db.listObservations({ status: 'open', limit: 100 });
        return JSON.stringify({ count: items.length, items }, null, 2);
      },
    },
    {
      uri: 'shadow://digests/latest',
      name: 'Latest digests',
      description: 'Most recent daily/weekly/brag digests. Use for catch-up context at session start.',
      mimeType: 'application/json',
      annotations: { audience: ['assistant'], priority: 0.5 },
      read: async () => {
        const items = db.listDigests({ limit: 5 });
        return JSON.stringify({ count: items.length, items }, null, 2);
      },
    },
    {
      uri: 'shadow://contacts',
      name: 'Team contacts',
      description: 'Registered team members with role, team, email, slack and github handles.',
      mimeType: 'application/json',
      annotations: { audience: ['assistant'], priority: 0.4 },
      read: async () => {
        const items = db.listContacts();
        return JSON.stringify({ count: items.length, items }, null, 2);
      },
    },
    {
      uri: 'shadow://plans/active',
      name: 'Active plan documents',
      description: 'Plans currently in ~/.claude/plans/ (one per plan-mode session). Filename + size + mtime + first heading. The body is large; fetch it via the path field when needed.',
      mimeType: 'application/json',
      annotations: { audience: ['assistant'], priority: 0.7 },
      read: async () => {
        const plans = readPlansDir(PLANS_DIR);
        return JSON.stringify({ dir: PLANS_DIR, count: plans.length, plans }, null, 2);
      },
    },
    {
      uri: 'shadow://session/last-known',
      name: 'Last-known session bookmark',
      description: 'Snapshot of the most recent activity: last 10 interactions (sentiment + topics), latest mood/thought, open counts. Use at session start to recover context instead of re-tying transcripts.',
      mimeType: 'application/json',
      annotations: { audience: ['assistant'], priority: 0.95 },
      read: async () => {
        const recent = db.listRecentInteractions(10);
        const profile = db.ensureProfile();
        const openObs = db.listObservations({ status: 'open' });
        const openSug = db.listSuggestions({ status: 'open' });
        const lastSeen = recent[0]?.createdAt ?? null;
        const hoursAgo = lastSeen
          ? Math.round(((Date.now() - new Date(lastSeen).getTime()) / 3_600_000) * 10) / 10
          : null;
        return JSON.stringify(
          {
            lastSeenAt: lastSeen,
            hoursAgo,
            lastMood: profile.moodHint ?? 'neutral',
            lastThought: profile.moodPhrase ?? null,
            energyLevel: profile.energyLevel ?? null,
            focusMode: profile.focusMode ?? null,
            recentInteractions: recent.map((i) => ({
              ts: i.createdAt,
              kind: i.kind,
              sentiment: i.sentiment,
              topics: i.topics,
              inputSummary: i.inputSummary,
            })),
            openObservationsCount: openObs.length,
            openSuggestionsCount: openSug.length,
          },
          null,
          2,
        );
      },
    },
  ];
}

export function listResources(resources: McpResource[]): Array<Omit<McpResource, 'read'>> {
  return resources.map(({ read: _unused, ...rest }) => rest);
}

export async function readResource(
  resources: McpResource[],
  uri: string,
): Promise<ResourceContents> {
  const r = resources.find((res) => res.uri === uri);
  if (!r) throw new Error(`Resource not found: ${uri}`);
  const text = await r.read();
  return { uri: r.uri, mimeType: r.mimeType, text };
}
