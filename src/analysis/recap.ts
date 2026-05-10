import type { ShadowDatabase } from '../storage/database.js';

// Recap ad-hoc de actividad reciente — diferente de `digest` (diario fijo).
// Diseñado para "qué ha pasado en las últimas N horas" tras una pausa o
// cambio de contexto. Sólo agrupa stats, no llama al LLM.
//
// Implementación: pull de audit_events con limit alto (2000 por defecto) y
// filtro in-memory por timestamp. Si el histórico crece y este patrón empieza
// a quedarse corto, añadir un overload `listAuditEvents({since, limit})` en
// tracking.ts ESE día — no antes (validate-then-plan).

export type RecapResult = {
  hours: number;
  windowStart: string;
  windowEnd: string;
  totalEvents: number;
  byAction: Record<string, number>;
  byInterface: Record<string, number>;
  byActor: Record<string, number>;
  byTargetKind: Record<string, number>;
  topActions: Array<{ action: string; count: number }>;
  notes: string[];
};

const DEFAULT_PULL_LIMIT = 2000;

export function buildRecap(db: ShadowDatabase, hours: number, pullLimit = DEFAULT_PULL_LIMIT): RecapResult {
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error(`Invalid hours: ${hours}. Must be a positive number.`);
  }

  const now = Date.now();
  const windowEnd = new Date(now).toISOString();
  const windowStart = new Date(now - hours * 3_600_000).toISOString();

  const events = db.listAuditEvents(pullLimit).filter((e) => e.createdAt >= windowStart);

  const byAction: Record<string, number> = {};
  const byInterface: Record<string, number> = {};
  const byActor: Record<string, number> = {};
  const byTargetKind: Record<string, number> = {};

  for (const ev of events) {
    byAction[ev.action] = (byAction[ev.action] ?? 0) + 1;
    byInterface[ev.interface] = (byInterface[ev.interface] ?? 0) + 1;
    byActor[ev.actor] = (byActor[ev.actor] ?? 0) + 1;
    const tk = ev.targetKind ?? '(none)';
    byTargetKind[tk] = (byTargetKind[tk] ?? 0) + 1;
  }

  const topActions = Object.entries(byAction)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([action, count]) => ({ action, count }));

  const notes: string[] = [];
  if (events.length === pullLimit) {
    // Hit el techo del pull — ventana puede estar truncada en el extremo viejo.
    notes.push(`Pulled max ${pullLimit} events; window may be incomplete for older periods.`);
  }
  if (events.length === 0) {
    notes.push('No audit events in window — daemon was likely idle or stopped.');
  }

  return {
    hours,
    windowStart,
    windowEnd,
    totalEvents: events.length,
    byAction,
    byInterface,
    byActor,
    byTargetKind,
    topActions,
    notes,
  };
}

export function renderRecapMarkdown(r: RecapResult): string {
  const lines: string[] = [];
  lines.push(`# Recap — últimas ${r.hours}h`);
  lines.push(`\nVentana: ${r.windowStart} → ${r.windowEnd}`);
  lines.push(`Total: **${r.totalEvents}** audit events`);
  if (r.topActions.length > 0) {
    lines.push('\n## Top actions');
    for (const a of r.topActions) lines.push(`- \`${a.action}\` × ${a.count}`);
  }
  const interfaces = Object.entries(r.byInterface).sort(([, a], [, b]) => b - a);
  if (interfaces.length > 0) {
    lines.push('\n## Por interface');
    for (const [name, count] of interfaces) lines.push(`- ${name}: ${count}`);
  }
  if (r.notes.length > 0) {
    lines.push('\n## Notas');
    for (const n of r.notes) lines.push(`- ${n}`);
  }
  return lines.join('\n') + '\n';
}
