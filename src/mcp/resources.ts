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

import type { ShadowDatabase } from '../storage/database.js';

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
