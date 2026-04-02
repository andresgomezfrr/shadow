# Plan: Feedback Loop Completo

## Overview

Cada punto de decisión del usuario debe capturar feedback. Shadow usa ese feedback para mejorar sus prompts y decisiones futuras. Es el combustible del sistema de trust.

## Puntos de feedback

### Ya implementados
- **Dismiss sugerencia** — razón en `feedbackNote`, se pasa al suggest prompt ✓
- **Accept sugerencia** — el patrón accept/dismiss se pasa al suggest prompt ✓

### Por implementar

#### Observaciones
- **Resolve/acknowledge** — añadir razón opcional: "ya no aplica", "no es actionable", "demasiado genérico"
- Se pasa al observe prompt como "razones de resolución anteriores"

#### Memorias
- **Forget (archivar)** — razón obligatoria: "incorrecto", "demasiado detallado", "mal clasificada como core", "duplicada"
- **Update (modificar)** — registrar qué cambió y por qué: "movida de core a hot porque es un detalle de implementación"
- Se pasa al extract prompt como "correcciones de memorias anteriores"

#### Runs
- **Discard** — razón: "plan no realista", "falta contexto", "no prioritario", "ya implementado"
- Se pasa al runner prompt y al suggest evaluator

#### Feedback positivo
- **👍 / 👎** en memorias, observaciones, sugerencias — "más de esto" / "menos de esto"
- Botones simples en el dashboard, un click

## Storage

Opción A: campo `feedbackNote` + `feedbackRating` en cada tabla (observations, memories, runs)
Opción B: tabla unificada `feedback` con target_kind + target_id + note + rating

**Recomiendo B** — una tabla unificada es más fácil de consultar y pasar al LLM.

```sql
CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  target_kind TEXT NOT NULL,  -- 'observation' | 'suggestion' | 'memory' | 'run'
  target_id TEXT NOT NULL,
  action TEXT NOT NULL,       -- 'dismiss' | 'resolve' | 'archive' | 'modify' | 'discard' | 'thumbs_up' | 'thumbs_down'
  note TEXT,
  created_at TEXT NOT NULL
);
```

## Consumo en prompts

### Extract prompt
```
### Memory corrections (learn from these)
- "Shadow daemon graceful shutdown..." — archived: "implementation detail, should be hot not core"
- "Status line broken..." — archived: "bug fix already resolved, not permanent knowledge"
```

### Observe prompt
```
### Resolved observations (learn what's not useful)
- "15 archivos sin commitear" — resolved: "operational, not actionable"
- "ObservationsPage editado 10 veces" — resolved: "activity log, not an observation"
```

### Suggest prompt (ya parcial)
```
### User feedback on suggestions
- "Commitear archivos pendientes" — dismissed: "operational, not a code suggestion"
- "Tests para ObservationsPage" — accepted (this is what user values)
```

### Reflect job (futuro)
Lee TODO el feedback acumulado para sintetizar la identidad de Shadow.

## Implementación incremental

1. **Tabla feedback** — migration
2. **UI: razón en resolve observación** — como dismiss sugerencia (prompt)
3. **UI: razón en forget/update memoria** — prompt obligatorio
4. **UI: razón en discard run** — prompt
5. **UI: 👍/👎 en cards** — botones simples
6. **Pasar feedback a prompts** — query últimos 10-20 entries por tipo
