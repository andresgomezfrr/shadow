# Plan: MCP Delegation Pattern — Future Refactor

## Pattern

```
Before: Shadow injects data → LLM returns JSON → Shadow parses → Shadow writes DB
After:  Shadow gives instructions → LLM reads via MCP → LLM writes via MCP → Shadow orchestrates
```

## Where applied
- ✅ Runner (plan generation) — Claude reads files + memories via MCP
- ✅ Reflect job — Claude reads soul/feedback/memories, writes soul via MCP
- ✅ Open Session — Claude has full MCP access

## Where to apply next (when ready)

### Extract (memories) — medium priority
Currently: JSON-only, parses insights, creates memories manually.
MCP approach: Claude calls shadow_memory_teach directly. Need shadow_observation_create too.
Tradeoff: loses structured JSON control. Could create too many/few memories.
When: after L3 trust is working and Shadow has proven good judgment.

### Observe (observations) — medium priority  
Currently: JSON-only, parses observations, creates them manually.
MCP approach: Claude calls shadow_observation_create + shadow_observation_resolve.
Need: new MCP tool shadow_observation_create.
When: same as extract.

### Suggest — low priority
Currently: JSON-only, parses suggestions, creates them manually.
MCP approach: Claude calls a shadow_suggestion_create tool.
Need: new MCP tool shadow_suggestion_create.
When: after extract and observe are migrated.

## MCP tools needed for full delegation
- ✅ shadow_feedback (read) — being added with reflect
- ✅ shadow_soul / shadow_soul_update — being added with reflect
- 🔲 shadow_observation_create (write) — for observe phase
- 🔲 shadow_suggestion_create (write) — for suggest phase
- 🔲 shadow_profile_update (internal) — for mood/energy updates

## Tradeoffs
- Pro: zero parsing bugs, full context, Claude decides what matters
- Con: more tokens, slower (multiple tool calls), less predictable output count
- Recommendation: keep JSON-only for frequent jobs (15min), use MCP for daily/expensive jobs
