# Plan: Job System — Replace Monolithic Heartbeat

## Overview

El heartbeat actual hace demasiado en un solo ciclo: extract + observe + suggest + consolidate + notify. Cada fase tiene cadencia y recursos diferentes. Separar en **jobs tipados** con cadencias independientes.

## Job Types

| Job | Cadencia | Model | Effort | Qué hace |
|---|---|---|---|---|
| `heartbeat` | 15min | sonnet | medium | extract (memories + mood) + observe (observations + auto-resolve) |
| `suggest` | tras cada heartbeat con actividad | opus | high | genera sugerencias técnicas |
| `consolidate` | 6h | sonnet | medium | promueve/demote memorias entre layers |
| `reflect` | 24h | opus | high | sintetiza feedback + memorias → actualiza SOUL dinámico |
| `evaluate` | (futuro L4) por sugerencia | opus | high | evalúa si una sugerencia merece auto-ejecución |

## Arquitectura

### Base de datos

Reutilizar la tabla `heartbeats` o crear una nueva `jobs`:

```sql
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,           -- 'heartbeat' | 'suggest' | 'consolidate' | 'reflect' | 'evaluate'
  phase TEXT NOT NULL,          -- current phase within the job
  phases_json TEXT DEFAULT '[]',
  activity TEXT,
  status TEXT DEFAULT 'running', -- 'running' | 'completed' | 'failed'
  llm_calls INTEGER DEFAULT 0,
  tokens_used INTEGER DEFAULT 0,
  result_json TEXT DEFAULT '{}', -- job-specific output metrics
  duration_ms INTEGER,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  created_at TEXT NOT NULL
);
```

**Decisión**: ¿migrar heartbeats a jobs o mantener heartbeats y añadir jobs? Migrar es más limpio pero rompe historial.

**Recomendación**: crear tabla `jobs` nueva. Heartbeats existentes se quedan para historial. Nuevos heartbeats van a `jobs` con `type = 'heartbeat'`.

### Daemon loop

```typescript
while (running) {
  // Check each job type's schedule
  if (shouldRunJob('heartbeat', config)) await runJob('heartbeat');
  if (shouldRunJob('suggest', config))   await runJob('suggest');
  if (shouldRunJob('consolidate', config)) await runJob('consolidate');
  if (shouldRunJob('reflect', config))   await runJob('reflect');
  
  // Process queued runs (existing)
  if (hasQueuedRuns()) await processNextRun();
  
  // Deliver events
  deliverPendingEvents();
  
  await sleep(sleepMs);
}
```

Cada `shouldRunJob` comprueba:
- Última ejecución de ese tipo (from `jobs` table)
- Cadencia configurada
- Condiciones (e.g., suggest solo si heartbeat previo tuvo actividad)

### Dashboard

La vista Heartbeats se renombra a **Jobs** (o se mantiene pero muestra todos los tipos):
- Filter tabs: All | Heartbeat | Suggest | Consolidate | Reflect
- Cada job type tiene su color/badge
- Reflect jobs se destacan (son los más interesantes para el usuario)

## Reflect Job — El más nuevo

### Input
- Todas las memorias core + hot
- Feedback acumulado (tabla feedback) desde última reflexión
- Historial de accept/dismiss de sugerencias
- Observaciones resueltas con razones
- Perfil actual del usuario

### Output
Un documento markdown que se guarda como memoria core especial (`kind: 'soul_reflection'`):

```markdown
## Shadow's understanding of Andrés (2026-04-02)

### Work style
- Prefers action over discussion — "don't ask, just do it"
- Iterates heavily on UI before committing — reaches full parity first
- Values technical suggestions, dismisses operational reminders

### What he values in Shadow
- Plans that include file contents and full context
- Suggestions that are actionable code changes, not housekeeping
- Quick feedback loops — corrections should improve future behavior

### What to avoid
- Creating core memories for bug fixes or implementation details
- Generating "commit your files" type suggestions
- Blocking functionality behind trust gates — advisory, not restrictive

### Current focus
- Shadow project: observation lifecycle, suggestion pipeline, dashboard UX
- Trust system design and implementation
```

### Cómo se consume
Este documento se incluye como contexto en TODOS los prompts de Shadow — extract, observe, suggest, runner. Es la "personalidad aprendida" que complementa SOUL.md (personalidad definida por el usuario).

## Implementación incremental

### Fase 1: Separar suggest del heartbeat
- Suggest ya corre como fase separada dentro del heartbeat
- Moverlo a un job independiente que se dispara tras heartbeat con actividad
- Crea registro en `jobs` table

### Fase 2: Job infrastructure
- Tabla `jobs`
- `shouldRunJob()` scheduler
- Dashboard view actualizada

### Fase 3: Reflect job
- Requiere feedback loop implementado primero
- Implementar el job de reflexión
- Guardar output como memoria `soul_reflection`
- Inyectar en prompts

### Fase 4: Evaluate job (L4)
- Evalúa sugerencias para auto-ejecución
- Requiere trust L4
