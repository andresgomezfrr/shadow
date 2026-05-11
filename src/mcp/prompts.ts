// MCP Prompts primitive — completes the trinity (tools + resources + prompts).
//
// Each prompt is a parameterizable template that the MCP client can invoke
// as a slash-command. The `render(args)` function composes text from DB state
// and returns a list of messages following MCP 2025-06-18 spec. Shadow does
// NOT call the LLM inside render() — prompts are template-only; the caller
// (Claude Code) is responsible for the reasoning.

import type { ShadowDatabase } from '../storage/database.js';
import type { ShadowConfig } from '../config/load-config.js';
import { plansDir, readPlansDir } from './resources.js';
import { getDaemonState } from '../daemon/runtime.js';

export type PromptArgument = {
  name: string;
  description: string;
  required?: boolean;
};

export type McpPromptMessage = {
  role: 'user' | 'assistant';
  content: { type: 'text'; text: string };
};

export type McpPromptResult = {
  description?: string;
  messages: McpPromptMessage[];
};

export type McpPrompt = {
  name: string;
  description: string;
  arguments?: PromptArgument[];
  render: (args: Record<string, unknown>) => Promise<McpPromptResult>;
};

function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`Missing required argument: ${key}`);
  }
  return v;
}

function userMessage(text: string): McpPromptMessage {
  return { role: 'user', content: { type: 'text', text } };
}

export function createMcpPrompts(db: ShadowDatabase, config: ShadowConfig): McpPrompt[] {
  return [
    {
      name: 'shadow_morning_brief',
      description: 'Snapshot del estado al inicio del día: mood, observations HIGH, suggestions, plans activos, alerts. Sin args. Claude compone el brief con prioridades.',
      render: async () => {
        const profile = db.ensureProfile();
        const openHighObs = db.listObservations({ status: 'open', severity: 'high', limit: 20 });
        const openSug = db.listSuggestions({ status: 'open', limit: 20 });
        const plans = readPlansDir(plansDir());
        const digests = db.listDigests({ limit: 1 });
        const state = getDaemonState(config);
        const alerts = state.alerts ?? [];

        const lines: string[] = [];
        lines.push('Snapshot Shadow para el inicio del día:');
        lines.push('');
        lines.push(`- Mood última sesión: ${profile.moodHint ?? 'neutral'}`);
        lines.push(`- Bond tier: ${profile.bondTier ?? 1}`);
        lines.push(`- Locale: ${profile.locale}`);
        if (profile.focusMode) lines.push(`- Focus mode: ${profile.focusMode} (until ${profile.focusUntil ?? 'no expiry'})`);
        lines.push('');
        lines.push(`Observations HIGH abiertas (${openHighObs.length}):`);
        for (const o of openHighObs.slice(0, 5)) lines.push(`  - [${o.severity}] ${o.title} (${o.votes}v)`);
        if (openHighObs.length > 5) lines.push(`  ... +${openHighObs.length - 5} más`);
        lines.push('');
        lines.push(`Suggestions abiertas: ${openSug.length}`);
        lines.push(`Plans activos (~/.claude/plans/): ${plans.length}`);
        for (const p of plans.slice(0, 5)) lines.push(`  - ${p.filename}${p.firstHeading ? ` — ${p.firstHeading}` : ''}`);
        lines.push('');
        lines.push(`Daemon alerts: ${alerts.length}`);
        for (const a of alerts.slice(0, 3)) lines.push(`  - [${a.severity}] ${a.message}`);
        lines.push('');
        if (digests[0]) lines.push(`Último digest (${digests[0].kind}, ${digests[0].periodEnd ?? 'n/a'}):\n${digests[0].contentMd.slice(0, 800)}`);
        lines.push('');
        lines.push('Compón un morning brief: 3-5 puntos de prioridades para hoy, alineados con el foco actual. Identifica qué retomar, qué bloquear, qué posponer.');

        return { messages: [userMessage(lines.join('\n'))] };
      },
    },
    {
      name: 'shadow_scope_check',
      description: 'Verifica si una tarea propuesta aligna con el foco actual. Útil antes de empezar trabajo nuevo para evitar context bleed entre proyectos.',
      arguments: [
        { name: 'task', description: 'Descripción corta de la tarea propuesta', required: true },
      ],
      render: async (args) => {
        const task = requireString(args, 'task');
        const profile = db.ensureProfile();
        const projects = db.listProjects({ status: 'active' });
        const topProject = projects[0];

        const lines: string[] = [];
        lines.push(`Tarea propuesta: "${task}"`);
        lines.push('');
        lines.push(`Foco actual: ${profile.focusMode ?? 'normal'}`);
        if (topProject) {
          lines.push(`Proyecto principal: ${topProject.name} (kind: ${topProject.kind}, status: ${topProject.status})`);
        }
        if (projects.length > 1) {
          lines.push(`Otros proyectos activos: ${projects.slice(1, 5).map((p) => p.name).join(', ')}`);
        }
        lines.push('');
        lines.push('Verifica si la tarea aligna con el foco:');
        lines.push('- Si es del proyecto principal: aprueba con voto explícito + razón.');
        lines.push('- Si es de un proyecto secundario: warnea, sugiere posponer si hay items críticos abiertos en el principal.');
        lines.push('- Si no aligna con ningún proyecto activo: rechaza explícitamente con razón.');
        lines.push('');
        lines.push('Reconcilia contradicciones explícitamente. No cross-project context bleed.');

        return { messages: [userMessage(lines.join('\n'))] };
      },
    },
    {
      name: 'shadow_audit_block',
      description: 'Genera instrucciones de commit para cerrar un bloque de trabajo: subject conciso, trailer apropiado, sin Co-Authored-By, sin Shadow branding.',
      arguments: [
        { name: 'summary', description: 'Resumen corto del trabajo realizado en el bloque', required: true },
      ],
      render: async (args) => {
        const summary = requireString(args, 'summary');

        const lines: string[] = [];
        lines.push(`Cierre de bloque. Resumen del trabajo:`);
        lines.push(`"${summary}"`);
        lines.push('');
        lines.push('Compón el commit siguiendo las convenciones de este repo:');
        lines.push('');
        lines.push('1. **Subject** (≤72 chars, modo imperativo): tipo(scope): qué cambia');
        lines.push('   Tipos válidos: feat, fix, refactor, test, ci, docs, chore, perf');
        lines.push('2. **Cuerpo** (opcional, lineas ≤80 chars): contexto si subject solo no basta. Why > what.');
        lines.push('3. **Trailer** apropiado:');
        lines.push('   - `[audit <hash>]` si cierra un audit-block trackeado');
        lines.push('   - `[obs <id-prefix>]` si resuelve una observation');
        lines.push('   - `[run <id-prefix>]` si materializa un run');
        lines.push('4. **NO Co-Authored-By**. **NO Shadow branding**.');
        lines.push('');
        lines.push('Después del commit:');
        lines.push('- Push transcript → build-log al cerrar bloque, no diferir.');
        lines.push('- Si quedan observations relacionadas abiertas, sugiere `shadow_observation_resolve`.');

        return { messages: [userMessage(lines.join('\n'))] };
      },
    },
    {
      name: 'shadow_naming_vote',
      description: 'Propone N candidatos de naming para un dominio dado, con voto + reasoning lore-fit y verificación de disponibilidad pendiente.',
      arguments: [
        { name: 'domain', description: 'Dominio o concepto que necesita nombre (ej: "endpoint de awakening completion", "criatura helper", "modelo DB v60")', required: true },
        { name: 'count', description: 'Número de candidatos a proponer (default 5, max 10)', required: false },
      ],
      render: async (args) => {
        const domain = requireString(args, 'domain');
        const rawCount = args.count;
        const count = Math.min(10, Math.max(1, typeof rawCount === 'number' ? rawCount : typeof rawCount === 'string' ? parseInt(rawCount, 10) || 5 : 5));

        const lines: string[] = [];
        lines.push(`Propón ${count} candidatos de naming para el dominio:`);
        lines.push(`"${domain}"`);
        lines.push('');
        lines.push('Criterios obligatorios:');
        lines.push('- **Si el dominio menciona Athrelaris** o conceptos relacionados (Embers, Bond, Awakening, Memory Shards, Sivareth, affinities Fire/Water/Air/Earth), prioriza lore-fit.');
        lines.push('- Single-word > compound salvo justificación clara.');
        lines.push('- Lenguaje según contexto (ES/EN); no mezclar salvo razón explícita.');
        lines.push('- **Verifica disponibilidad antes de proponer**: npm, GitHub repo, dominios si aplica. Anota los gaps explícitamente; no dar por sentado.');
        lines.push('');
        lines.push(`Para cada uno de los ${count} candidatos devuelve:`);
        lines.push('- **Nombre**');
        lines.push('- **Razón lore-fit / semántica** (1-2 líneas)');
        lines.push('- **Voto** (con reasoning) — opinión propia, no menú neutral');
        lines.push('- **Verificaciones de disponibilidad pendientes**');

        return { messages: [userMessage(lines.join('\n'))] };
      },
    },
  ];
}

export function listPrompts(prompts: McpPrompt[]): Array<Omit<McpPrompt, 'render'>> {
  return prompts.map(({ render: _omit, ...rest }) => rest);
}

export async function getPrompt(
  prompts: McpPrompt[],
  name: string,
  args: Record<string, unknown>,
): Promise<McpPromptResult> {
  const p = prompts.find((x) => x.name === name);
  if (!p) throw new Error(`Prompt not found: ${name}`);
  return await p.render(args);
}
