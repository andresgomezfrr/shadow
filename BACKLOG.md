# Shadow — Backlog

Backlog de mejoras, features e issues pendientes. Creado 2026-04-02.

---

## Arquitectura / Modelo de datos

### Concepto de Proyecto (long-term)
Entidad contenedora que agrupa repos, memorias, sugerencias y observaciones. Un proyecto es algo permanente (ej: "Shadow", "Platform"). Varios proyectos componen un Sistema. Actualmente no existe esta agrupación — todo está suelto o asociado a repos individuales.

### Concepto de Tarea/Iniciativa (short/mid-term)
Agrupación temporal (1-2 semanas) que incluye repos, PRs, docs y tickets involucrados. Diferente de Proyecto: tiene ciclo de vida acotado, con inicio y fin. Algo como un "work stream" o "sprint goal".

### Dos tipos de heartbeat/jobs
Separar el heartbeat actual en:
- **(a) Frecuente** — actividad reciente: conversaciones, interacciones, estado actual.
- **(b) Mantenimiento** — rota entre repos progresivamente, no revisa todos en cada iteración. Escala mejor con +40 repos.

---

## Observaciones

### Enriched context
Observaciones deben incluir: repo name, file paths involucrados, session ID donde se discutió. Actualmente solo tienen kind + title + detail string.

### Vote system (dedup)
Cuando la misma observación se detecta de nuevo, no duplicar — incrementar `votes` en la existente. Mayor votes = mayor prioridad en dashboard. Parcialmente implementado, revisar.

### Lifecycle de observaciones
Estados: `active` → `acknowledged` → `resolved` → `expired`. Dashboard morning brief solo debe mostrar `active`.

### Schema changes para observaciones
Añadir columnas a `observations`:
- `votes INTEGER DEFAULT 1`
- `status TEXT DEFAULT 'active'` (active/acknowledged/resolved/expired)
- `first_seen_at TEXT`
- `last_seen_at TEXT`
- `context_json TEXT` (repo name, files, session ID)

---

## Memorias

### Memorias mal clasificadas en core
Revisar qué memorias están en layer `core` que no deberían. Posible problema en el criterio de clasificación del prompt de analyze.

### Semantic search (sqlite-vec)
Búsqueda híbrida FTS5 + vector search para memorias. Requiere modelo de embeddings.

---

## Dashboard / UI

### UI preparada para escala (+40 repos)
Todas las vistas deben funcionar bien con muchos repos: paginación, filtros, agrupación, rendimiento. No solo repos page, sino observaciones, memorias, sugerencias, etc.

### Emoji Guide desactualizada
La página del dashboard no refleja el status bar actual. Actualizar con los emojis vigentes.

### Dashboard observations page
Renderizar observaciones LLM con contexto enriquecido (repo badges, file lists, vote count). Agrupar por kind.

### Events: clarificar propósito
La página Events no muestra nada aunque hay heartbeats que generaron eventos. Investigar si se marcan como delivered antes de poder verlos. Clarificar si Events tiene sentido como concepto separado o se solapa con heartbeats/observaciones.

---

## Status bar

### ASCII art mascota
Evaluar añadir un animalito/mascota en one-line ASCII art en el status bar que reaccione y se mueva, representando a Shadow visualmente.

---

## Calidad

### Tests
Zero test coverage. Mínimo: database CRUD, FTS5 search, heartbeat state machine, observation creation.

### Suggest phase
Trust necesita 15+ (level 2) para generar sugerencias. Considerar acelerar crecimiento de trust o boost manual para testing.

---

## Known issues

- `[object Object]` en observations page para algunos detail fields (arrays de objetos)
- `observationsCreated` en heartbeat siempre muestra 0 — las observaciones se crean en analyze, no en observe. El counter necesita actualizarse.
- Observaciones antiguas de git aún en DB. Purgar con: `DELETE FROM observations WHERE source_kind = 'repo'`
