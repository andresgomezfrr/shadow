# Shadow — Backlog

Actualizado 2026-04-12. Items completados en [COMPLETED.md](COMPLETED.md).

---

## Auditoría #2 — Pendiente (2026-04-11)

### P3: Tablas sin mecanismo de limpieza
`interactions`, `event_queue`, `llm_usage`, `jobs`, `feedback` crecen sin límite. Sin retention policy ni cleanup job. Implementar como job type `cleanup` (IO, daily). Bajo impacto actual, relevante a largo plazo.

---

## Prioridad media — Tests

### Tests WorkspacePage filtros + lifecycle
Renderizado por filtro, transiciones de estado del feed unificado y context panel.

---

## Prioridad media — Runner

### Pendiente de evaluar
- **Plan demasiado largo**: repos con archivos grandes pueden saturar contexto. Evaluar file size hints en briefing o exclusión de archivos grandes.

---

## Prioridad media — Workspace & Runs

### Detectar PRs creados fuera de Shadow
Si un run tiene worktree pero no prUrl, detectar si existe un PR con `gh pr list --head shadow/{id}`.

---

## Prioridad media — Dashboard UX

### Evaluar: bond por repo en vez de global *(2026-04-08)*
Bond global vs per-repo. Shadow puede saber mucho de un repo y poco de otro. Hablar antes de diseñar.

---

## Prioridad media — Infraestructura de datos

### MCP server ordering en dashboard *(2026-04-08)*
Drag-drop para reordenar MCP servers en Enrichment. El orden como hint para el LLM.

---

## Prioridad baja

### Logs del daemon en dashboard
Los `console.error` van a `daemon.stderr.log` pero no son accesibles desde el dashboard.

---

## Long-term — Autonomy evolution

### L5 — auto-merge selectivo
Autonomía por repo/scope configurable. Shadow mergea donde tiene permiso. Requiere evaluación post-L4.

### Unlockables content (v49 follow-up)
8 placeholder slots seeded en v49 con `kind='placeholder'` y `title='???'`. Ir llenándolos con contenido real (ghost variants, status phrase pools, theme overrides, badge emojis) vía direct DB update o futura MCP tool `shadow_unlock_define`.

### Drop v49 legacy columns (v50 cleanup)
Después de al menos un mes en v49, dropear `user_profile.trust_level`, `trust_score`, `bond_level`, `suggestions.required_trust_level`, `interactions.trust_delta`. Todos están unused desde v49 pero se mantuvieron por la convención ADD-only de las migraciones anteriores.

---

## Long-term — Arquitectura

### Evaluar: asegurar entity linking en memorias, observaciones, sugerencias y runs *(2026-04-08)*
Auditar si siempre estamos asociando `entities_json` cuando la información lo permite.

### Soporte monorepo: un repo, múltiples proyectos con path prefixes *(2026-04-08)*
Path prefixes por proyecto, detección de fronteras (BUILD.bazel, package.json), heartbeat scoping, entity linking granular.

---

## Long-term — Features (evaluar)

### Circuit breaker para LLM calls
Tras N fallos consecutivos, abrir circuito y saltar calls por cooldown.

### Scoring de señal en conversaciones
Ponderar conversaciones por densidad antes del prompt de analyze.

### Seguridad: CSP headers + rate limiting
Dashboard sin Content-Security-Policy. Sin rate limiting en API/MCP.

### `shadow docs check` — drift detection
Comparar CLAUDE.md contra código real: tools count, routes, schema tables.

### LLM Memory Extraction post-Run
Cuando un run completa, analizar output con LLM para extraer memorias.

### Suggestion Expiry → Preference Memory
Sugerencia expirada sin respuesta → memoria de preferencia implícita.

### Configurable allowedTools → [`docs/plan-allowed-tools-config.md`](docs/plan-allowed-tools-config.md)
User configura qué MCPs externos puede usar Shadow.

### Correct button en Observations y Memories pages
Extender CorrectionPanel contextual a observation cards y memory cards.
