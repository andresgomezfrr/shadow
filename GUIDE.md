# Shadow — User Guide

Shadow es tu compañero de ingenieria. Interactuas con el a traves de **Claude CLI** — hablas naturalmente y Claude usa los tools de Shadow automaticamente.

---

## Setup (una vez)

```bash
cd shadow
npm install
npm run dev -- init
npm run dev -- daemon start
```

`shadow init` hace tres cosas:
1. Crea la base de datos en `~/.shadow/shadow.db`
2. Genera `~/.shadow/SOUL.md` — la personalidad de Shadow (editable)
3. Escribe la identidad de Shadow en `~/.claude/CLAUDE.md`

Configura Shadow como MCP server en Claude Code. Añade a `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "shadow": {
      "command": "npx",
      "args": ["tsx", "/ruta/completa/a/shadow/src/cli.ts", "mcp", "serve"]
    }
  }
}
```

Reinicia Claude Code. Listo — ya puedes hablar con Shadow.

---

## Uso diario — todo via Claude CLI

Abre Claude CLI en cualquier terminal y habla naturalmente:

### Registrar repos

```
"Shadow, registra el repo ~/workspace/api como 'api'"
"Añade tambien ~/workspace/frontend, llamalo 'frontend'"
"Que repos tienes registrados?"
```

### Observar repos

```
"Que has visto ultimamente en mis repos?"
"Ejecuta una observacion en todos los repos"
"Observa solo el repo api"
```

### Memoria

Shadow tiene 5 capas de memoria — `core` es permanente, el resto decae con el tiempo.

```
"Recuerda que nuestro Kafka esta en AWS MSK con 3 brokers en eu-west-1"
→ Shadow guarda esto en la capa core (permanente)

"Recuerda que estamos en sprint 14, el objetivo es cerrar el refactor de auth"
→ Shadow guarda en la capa hot (activa, 14 dias)

"Que sabes sobre el deploy?"
→ Shadow busca en su memoria

"Que tienes en memoria permanente?"
→ Shadow lista memorias de la capa core

"Olvida la memoria sobre el sprint 14, ya termino"
```

### Equipo

```
"Añade a Carlos como contacto, es backend del equipo platform, su github es carlos-dev"
"Añade a Ana, es devops, su email es ana@company.com"
"Quienes estan en el equipo platform?"
"Elimina a Carlos de los contactos"
```

### Sistemas e infraestructura

```
"Registra nuestro postgres como sistema, es una base de datos RDS en eu-west-1"
"Añade grafana como sistema de monitoring, la URL es https://grafana.internal"
"Que sistemas tenemos registrados?"
"Que bases de datos conoces?"
```

### Sugerencias

El daemon genera sugerencias automaticamente analizando tus repos.

```
"Tienes alguna sugerencia?"
"Muestrame las sugerencias pendientes"
"Acepta la sugerencia del refactor"
"Rechaza esa sugerencia, no aplica a nuestro caso"
```

### Modo focus

```
"Necesito concentrarme 2 horas"
→ Shadow entra en focus mode, no molesta

"Ya estoy disponible"
→ Shadow vuelve a la normalidad

"Pon focus mode 30 minutos"
```

### Perfil y confianza

```
"Cual es mi nivel de confianza?"
"Sube mi proactividad a 7"
"Baja la personalidad a 2, quiero respuestas mas tecnicas"
"Pon mi timezone a Europe/Madrid"
```

### Eventos y estado

```
"Hay algun evento pendiente?"
"Marca todos los eventos como leidos"
"Dame un resumen de tu estado"
"Cuantos tokens has gastado hoy?"
"Cuanto has gastado esta semana?"
```

### Runs (ejecucion de tareas)

```
"Hay algun run pendiente?"
"Muestrame el detalle del ultimo run"
```

---

## Como funciona por detras

```
Tu terminal                          Shadow (background)
    |                                      |
    |  Abres Claude CLI                    |  Daemon corriendo
    |  "que has visto en mis repos?"       |  Heartbeat cada 15 min
    |          |                           |      |
    |    Claude CLI                        |  1. Observe (git commands)
    |    usa MCP tool:                     |  2. Analyze (Claude Sonnet)
    |    shadow_observations               |  3. Suggest (Claude Opus)
    |          |                           |  4. Consolidate memory
    |    Shadow DB                         |  5. Notify events
    |    devuelve datos                    |
    |          |                           |
    |    Claude te resume                  |
    |    los hallazgos                     |
```

### Auto-aprendizaje

Mientras usas Claude CLI con Shadow como MCP server:
- Shadow observa que temas/repos/archivos se discuten
- En el siguiente heartbeat, analiza las interacciones y crea memorias
- Si detecta conocimiento fundacional, lo promueve a `core` (permanente)

No tienes que enseñarle todo explicitamente — aprende de tus sesiones.

---

## Comandos directos (solo admin)

Estos son los unicos comandos que se ejecutan directamente, no via Claude:

```bash
# Setup inicial
npm run dev -- init

# Daemon
npm run dev -- daemon start
npm run dev -- daemon stop
npm run dev -- daemon status

# Diagnostico
npm run dev -- doctor

# Teaching interactivo (abre sesion Claude CLI con MCP de Shadow)
npm run dev -- teach
```

Todo lo demas se hace hablando con Claude.

---

## Configuracion

Variables de entorno (o en `.env`):

```bash
SHADOW_BACKEND=cli                    # cli (defecto) | api
SHADOW_PROACTIVITY_LEVEL=5            # 1-10
SHADOW_PERSONALITY_LEVEL=4            # 1-5 (4 = Tam-like)
SHADOW_MODEL_ANALYZE=sonnet           # Modelo para analisis
SHADOW_MODEL_SUGGEST=opus             # Modelo para sugerencias
SHADOW_MODEL_CONSOLIDATE=sonnet       # Modelo para consolidacion
SHADOW_MODEL_RUNNER=sonnet            # Modelo para ejecucion
SHADOW_HEARTBEAT_INTERVAL_MS=900000   # 15 min
```

---

## Personalidad

Shadow tiene personalidad configurable (1-5). Se define en `~/.shadow/SOUL.md`.

| Nivel | Tono |
|-------|------|
| 1 | Tecnico. Sin personalidad. Conciso. |
| 2 | Profesional. Ocasionalmente calido. |
| 3 | Amigable. Conversacional pero enfocado. |
| 4 | **Compañero (defecto)**. Cercano, personal, recuerda contexto. |
| 5 | Expresivo. Playful. Vinculo profundo. |

Para cambiarlo: "Shadow, pon tu personalidad a nivel 3" o edita `~/.shadow/SOUL.md` directamente.

Cuando abres Claude CLI, Shadow se presenta segun su personalidad porque:
1. `~/.claude/CLAUDE.md` le dice a Claude que ES Shadow
2. Claude llama `shadow_check_in` para obtener personalidad, mood, y contexto
3. Shadow responde con su voz, no con la de Claude

---

## 52 MCP Tools disponibles

### Personalidad
`shadow_check_in` — personalidad, mood, contexto, eventos pendientes. Claude lo llama automaticamente.

### Lectura (25)
`shadow_status`, `shadow_repos`, `shadow_projects`, `shadow_active_projects`, `shadow_project_detail`, `shadow_observations`, `shadow_suggestions`, `shadow_memory_search`, `shadow_memory_list`, `shadow_search`, `shadow_profile`, `shadow_events`, `shadow_contacts`, `shadow_systems`, `shadow_run_list`, `shadow_run_view`, `shadow_usage`, `shadow_daily_summary`, `shadow_feedback`, `shadow_soul`, `shadow_digests`, `shadow_digest`, `shadow_enrichment_config`, `shadow_enrichment_query`, `shadow_relation_list`

### Escritura (26)
`shadow_repo_add`, `shadow_repo_remove`, `shadow_project_add`, `shadow_project_remove`, `shadow_project_update`, `shadow_contact_add`, `shadow_contact_remove`, `shadow_system_add`, `shadow_system_remove`, `shadow_memory_teach`, `shadow_memory_forget`, `shadow_memory_update`, `shadow_suggest_accept`, `shadow_suggest_dismiss`, `shadow_suggest_snooze`, `shadow_observation_ack`, `shadow_observation_resolve`, `shadow_observation_reopen`, `shadow_observe`, `shadow_profile_set`, `shadow_focus`, `shadow_available`, `shadow_events_ack`, `shadow_soul_update`, `shadow_relation_add`, `shadow_relation_remove`
