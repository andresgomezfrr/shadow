# Shadow — Backlog

Actualizado 2026-04-02.

---

## Prioridad alta

### Analyze prompt con contexto de observaciones existentes
El analyze repite las mismas observaciones porque no sabe qué ya observó. Pasar observaciones activas al prompt para evitar duplicación y generar insights más profundos.

### Feedback loop: dismiss/accept enriquecen memorias y futuras sugerencias
Las notas de dismiss y los patrones de accept/dismiss deberían guardarse como memorias o pasarse al suggest prompt. Shadow no aprende del feedback real del usuario.

### Observaciones auto-resolve por condición
"15 archivos sin commitear" debería resolverse sola tras un commit. El heartbeat verifica condiciones previas de observaciones activas y las resuelve automáticamente. Incluir nota de resolución automática.

### Run result truncado a 500 chars
Los planes de implementación generados se truncan. Guardar el resultado completo en `result_summary_md` o leer del artifact file en el dashboard.

---

## Prioridad media

### Sugerencias operativas no son útiles
Shadow genera "commitear archivos" — no es una sugerencia de código. Afinar el prompt del suggest para que genere solo sugerencias técnicas actionables.

### Sugerencias aceptadas/dismissed influyen en futuras
Si el usuario siempre accepta "refactor" y dismissea "docs", Shadow debería adaptarse. Pasar historial de accept/dismiss al prompt del suggest.

### Dashboard — markdown rendering
Resultados de runs y sugerencias contienen markdown que se renderiza como texto plano. Usar react-markdown para tablas, code blocks, headers.

### Dashboard — sidebar badges con contadores
Mostrar en el sidebar: pending suggestions, runs to review, observaciones active. El usuario sabe dónde hay cosas pendientes sin navegar.

### Morning page mejorada
No resume bien la actividad. Incluir: qué aprendió Shadow (memorias nuevas), sugerencias pendientes, runs to review, estado de repos.

### Memorias con trazabilidad al heartbeat
No se puede ver "qué aprendió Shadow en este heartbeat". Añadir `heartbeat_id` o `source_id` a memories.

---

## Prioridad baja

### Logs del daemon en dashboard
Los `console.error` del heartbeat van a `daemon.stderr.log` pero no son accesibles desde el dashboard. Endpoint `/api/logs` + página.

### KeepAlive genera procesos zombie
El plist con `KeepAlive: true` relanza el daemon tras stop, causando duplicados y EADDRINUSE. Cambiar a `KeepAlive: false` + `RunAtLoad: true`.

---

## Long-term / Arquitectura

### Concepto de Proyecto
Entidad contenedora que agrupa repos, memorias, sugerencias y observaciones. Un proyecto es permanente (ej: "Shadow", "Platform").

### Concepto de Tarea/Iniciativa
Agrupación temporal (1-2 semanas) que incluye repos, PRs, docs y tickets. Ciclo de vida acotado.

### Dos tipos de heartbeat
- **(a) Frecuente** — actividad reciente: conversaciones, interacciones.
- **(b) Mantenimiento** — rota entre repos, no revisa todos cada vez. Escala con +40 repos.

### Semantic search (sqlite-vec)
Búsqueda híbrida FTS5 + vector search para memorias.

### UI preparada para escala (+40 repos)
Paginación real, filtros, agrupación, rendimiento en todas las vistas.

### Execute plan — verificación de resultado
Revisar diff generado, correr tests, presentar resumen de cambios. Merge desde dashboard a trust 4+.

---

## Deuda técnica

### Tests
Zero test coverage. Mínimo: database CRUD, FTS5 search, heartbeat state machine, observation dedup, suggestion lifecycle, run pipeline.

### Memorias mal clasificadas en core
Revisar criterio del prompt de analyze para layer core vs hot.

### Emoji Guide desactualizada
No refleja el status bar actual.

### Events: clarificar propósito
Los eventos se marcan delivered inmediatamente. Investigar si la página tiene sentido o se solapa con heartbeats/observaciones.

### Status line path frágil
Si cambia la versión de node, el path hardcodeado en el plist se rompe. Hacer dinámico.
