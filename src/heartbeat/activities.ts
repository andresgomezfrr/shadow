import { readFileSync, writeFileSync as fsWriteFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ShadowConfig } from '../config/load-config.js';
import type { ShadowDatabase } from '../storage/database.js';
import type { ObservationRecord, MemoryRecord, EntityLink } from '../storage/models.js';
import type { ObjectivePack } from '../backend/types.js';

import { observeAllRepos, collectActiveRepoContexts, summarizeRepoContexts } from '../observation/watcher.js';
import { findRelevantMemories } from '../memory/retrieval.js';
import { maintainMemoryLayers } from '../memory/layers.js';
import { checkMemoryDuplicate, checkSuggestionDuplicate } from '../memory/dedup.js';
import { generateAndStoreEmbedding } from '../memory/lifecycle.js';
import { selectAdapter } from '../backend/index.js';
import { applyTrustDelta } from '../profile/trust.js';

import type { HeartbeatContext } from './state-machine.js';
import { ExtractResponseSchema, ObserveResponseSchema, SuggestResponseSchema } from './schemas.js';
import { safeParseJson } from '../backend/json-repair.js';

// --- Entity auto-linking ---

/** Cache of system/project names, loaded once per heartbeat phase to avoid repeated full-table scans */
type EntityNameCache = { systems: { id: string; name: string }[]; projects: { id: string; name: string }[] };

function loadEntityNameCache(db: ShadowDatabase): EntityNameCache {
  return {
    systems: db.listSystems().map(s => ({ id: s.id, name: s.name })),
    projects: db.listProjects().map(p => ({ id: p.id, name: p.name })),
  };
}

/** Build entity links from a repo: repo → its projects → their systems */
function autoLinkFromRepo(db: ShadowDatabase, repoId: string): EntityLink[] {
  const entities: EntityLink[] = [{ type: 'repo', id: repoId }];
  try {
    const projects = db.findProjectsForRepo(repoId);
    for (const p of projects) {
      entities.push({ type: 'project', id: p.id });
      for (const sysId of p.systemIds) {
        if (!entities.some(e => e.type === 'system' && e.id === sysId)) {
          entities.push({ type: 'system', id: sysId });
        }
      }
    }
  } catch { /* best effort */ }
  return entities;
}

/** Detect mentions of registered systems/projects in text */
function detectEntityMentions(db: ShadowDatabase, text: string, cache?: EntityNameCache): EntityLink[] {
  const entities: EntityLink[] = [];
  const lower = text.toLowerCase();
  try {
    const c = cache ?? loadEntityNameCache(db);
    for (const sys of c.systems) {
      if (sys.name.length >= 3 && lower.includes(sys.name.toLowerCase())) {
        entities.push({ type: 'system', id: sys.id });
      }
    }
    for (const proj of c.projects) {
      if (proj.name.length >= 3 && lower.includes(proj.name.toLowerCase())) {
        entities.push({ type: 'project', id: proj.id });
      }
    }
  } catch { /* best effort */ }
  return entities;
}

/** Combine entity links from repo + name detection, deduplicated */
function buildEntityLinks(db: ShadowDatabase, repoId: string | null, text: string, cache?: EntityNameCache): EntityLink[] {
  const entities: EntityLink[] = [];
  if (repoId) entities.push(...autoLinkFromRepo(db, repoId));
  entities.push(...detectEntityMentions(db, text, cache));
  // Deduplicate
  const seen = new Set<string>();
  return entities.filter(e => {
    const key = `${e.type}:${e.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Update entities_json on an existing memory/observation */
function persistEntityLinks(db: ShadowDatabase, table: 'memories' | 'observations' | 'suggestions', id: string, entities: EntityLink[]): void {
  if (entities.length === 0) return;
  try {
    db.rawDb.prepare(`UPDATE ${table} SET entities_json = ? WHERE id = ?`).run(JSON.stringify(entities), id);
  } catch { /* best effort */ }
}

// --- Activity: Observe ---

export async function activityObserve(
  ctx: HeartbeatContext,
): Promise<{ observationsCreated: number; reposObserved: string[] }> {
  const results = await observeAllRepos(ctx.db);

  let observationsCreated = 0;
  const reposObserved: string[] = [];

  for (const result of results) {
    observationsCreated += result.observations.length;
    reposObserved.push(result.repoId);
  }

  return { observationsCreated, reposObserved };
}

// --- Activity: Analyze ---

function loadRecentInteractions(config: ShadowConfig, sinceIso?: string): { file: string; tool: string; cmd: string; ts: string }[] {
  const interactionsPath = resolve(config.resolvedDataDir, 'interactions.jsonl');
  try {
    const content = readFileSync(interactionsPath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    const since = sinceIso ? new Date(sinceIso).getTime() : Date.now() - 60 * 60 * 1000; // default: last 1h
    const entries: { file: string; tool: string; cmd: string; ts: string }[] = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as { ts: string; tool: string; file?: string; cmd?: string };
        if (new Date(entry.ts).getTime() > since) {
          entries.push({
            ts: entry.ts,
            tool: entry.tool,
            file: entry.file ?? '',
            cmd: entry.cmd ?? '',
          });
        }
      } catch { /* skip malformed lines */ }
    }
    return entries;
  } catch {
    return [];
  }
}

function summarizeInteractions(interactions: { file: string; tool: string; cmd: string; ts: string }[]): string {
  if (interactions.length === 0) return '';

  // Group by file/repo to show what was worked on
  const fileCounts = new Map<string, number>();
  const toolCounts = new Map<string, number>();

  for (const i of interactions) {
    if (i.file) {
      fileCounts.set(i.file, (fileCounts.get(i.file) ?? 0) + 1);
    }
    toolCounts.set(i.tool, (toolCounts.get(i.tool) ?? 0) + 1);
  }

  const lines: string[] = [`${interactions.length} tool calls in Claude CLI sessions:`];

  // Top files touched
  const topFiles = [...fileCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (topFiles.length > 0) {
    lines.push('\nFiles worked on:');
    for (const [file, count] of topFiles) {
      lines.push(`  - ${file} (${count}x)`);
    }
  }

  // Tool usage breakdown
  lines.push('\nTool usage:');
  for (const [tool, count] of [...toolCounts.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`  - ${tool}: ${count}`);
  }

  return lines.join('\n');
}

// --- Conversation loading ---

type ConversationTurn = { ts: string; role: string; text: string; session: string };

function loadRecentConversations(config: ShadowConfig, sinceIso: string): ConversationTurn[] {
  const convPath = resolve(config.resolvedDataDir, 'conversations.jsonl');
  try {
    const content = readFileSync(convPath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    const since = new Date(sinceIso).getTime();
    const entries: ConversationTurn[] = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as ConversationTurn;
        if (new Date(entry.ts).getTime() > since) {
          entries.push(entry);
        }
      } catch { /* skip */ }
    }
    return entries;
  } catch {
    return [];
  }
}

function summarizeConversations(conversations: ConversationTurn[]): string {
  if (conversations.length === 0) return '';

  // Group by session
  const sessions = new Map<string, ConversationTurn[]>();
  for (const turn of conversations) {
    const sid = turn.session || 'unknown';
    const list = sessions.get(sid) ?? [];
    list.push(turn);
    sessions.set(sid, list);
  }

  const lines: string[] = [`${conversations.length} conversation turns across ${sessions.size} session(s):`];

  for (const [sid, turns] of sessions) {
    lines.push(`\nSession ${sid.slice(0, 8)}... (${turns.length} turns):`);
    for (const turn of turns.slice(-10)) { // last 10 turns per session
      const prefix = turn.role === 'user' ? '  User' : '  Claude';
      const text = turn.text.slice(0, 200);
      lines.push(`  ${prefix}: "${text}${turn.text.length > 200 ? '...' : ''}"`);
    }
  }

  return lines.join('\n');
}

function rotateConversationsLog(config: ShadowConfig): void {
  const convPath = resolve(config.resolvedDataDir, 'conversations.jsonl');
  try {
    const content = readFileSync(convPath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const kept = lines.filter(line => {
      try {
        const entry = JSON.parse(line) as { ts: string };
        return entry.ts > twoHoursAgo;
      } catch { return false; }
    });
    fsWriteFileSync(convPath, kept.length > 0 ? kept.join('\n') + '\n' : '', 'utf8');
  } catch { /* fine */ }
}

function getModel(ctx: HeartbeatContext, phase: 'analyze' | 'suggest' | 'consolidate' | 'runner'): string {
  const prefs = ctx.profile.preferences as Record<string, unknown> | undefined;
  const models = prefs?.models as Record<string, string> | undefined;
  return models?.[phase] ?? ctx.config.models[phase];
}

function getEffort(ctx: HeartbeatContext, phase: 'analyze' | 'suggest' | 'consolidate' | 'runner'): string {
  const prefs = ctx.profile.preferences as Record<string, unknown> | undefined;
  const efforts = prefs?.efforts as Record<string, string> | undefined;
  return efforts?.[phase] ?? ctx.config.efforts[phase];
}

export async function activityAnalyze(
  ctx: HeartbeatContext,
  observations: ObservationRecord[],
  heartbeatId?: string,
): Promise<{ patternsDetected: number; memoriesCreated: number; llmCalls: number; tokensUsed: number; observationsCreated: number }> {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const recentInteractions = loadRecentInteractions(ctx.config, twoHoursAgo);
  const interactionSummary = summarizeInteractions(recentInteractions);
  const recentConversations = loadRecentConversations(ctx.config, twoHoursAgo);
  const conversationSummary = summarizeConversations(recentConversations);
  const repoContexts = collectActiveRepoContexts(ctx.db);
  const repoContextSummary = summarizeRepoContexts(repoContexts);

  // Cache entity names once for this entire analyze phase (avoids 6-12 full table scans)
  const entityCache = loadEntityNameCache(ctx.db);

  if (observations.length === 0 && recentInteractions.length === 0 && recentConversations.length === 0) {
    return { patternsDetected: 0, memoriesCreated: 0, llmCalls: 0, tokensUsed: 0, observationsCreated: 0 };
  }

  const filePaths: string[] = [];
  const topics: string[] = [];
  const repoIds = new Set<string>();
  for (const obs of observations) {
    repoIds.add(obs.repoId);
    topics.push(obs.kind);
    if (obs.title) topics.push(obs.title);
    const detail = obs.detail as Record<string, unknown>;
    if (typeof detail.file === 'string') filePaths.push(detail.file);
  }
  for (const i of recentInteractions) {
    if (i.file) filePaths.push(i.file);
  }

  const relevantMemories = findRelevantMemories(ctx.db, {
    filePaths: [...new Set(filePaths)].slice(0, 20),
    topics: [...new Set(topics)],
    repoId: repoIds.size === 1 ? [...repoIds][0] : undefined,
  }, 10, false); // touch=false: internal heartbeat lookup, don't inflate access counts

  // System context for prompts
  const systems = ctx.db.listSystems();
  const systemContext = systems.length > 0
    ? `### Registered Systems\n${systems.map(s => {
        const parts = [`- ${s.name} (${s.kind})`];
        if (s.description) parts.push(s.description);
        if (s.url) parts.push(`url: ${s.url}`);
        if (s.logsLocation) parts.push(`logs: ${s.logsLocation}`);
        if (s.deployMethod) parts.push(`deploy: ${s.deployMethod}`);
        return parts.join(' — ');
      }).join('\n')}\n`
    : '';

  // Sensor data from daemon (git events, remote sync, enrichment)
  const gitEventsSummary = ctx.pendingGitEvents?.length
    ? `### Recent Git Events\n${ctx.pendingGitEvents.map(e => `- ${e.repoName}: ${e.type} at ${e.ts}`).join('\n')}\n`
    : '';

  const remoteSyncSummary = ctx.remoteSyncResults?.length
    ? `### Remote Changes Detected\n${ctx.remoteSyncResults.map(r =>
        `- ${r.repoName}: ${r.newRemoteCommits} new remote commits` +
        (r.newCommitMessages?.length ? `\n  Recent: ${r.newCommitMessages.slice(0, 5).join(', ')}` : '') +
        (r.behindBranches?.length ? `\n  ${r.behindBranches.map(b => `${b.branch}: ${b.behind} behind, ${b.ahead} ahead`).join('; ')}` : '')
      ).join('\n')}\n`
    : '';

  const enrichmentSummary = ctx.enrichmentContext
    ? `### External Context (from MCP tools)\n${ctx.enrichmentContext}\n`
    : '';

  // Active project context (from daemon-level detection or fallback)
  const activeProjects = ctx.activeProjects ?? [];
  const projectContext = activeProjects.length > 0
    ? `### Active Projects\n${activeProjects.map(ap => {
        const project = ctx.db.getProject(ap.projectId);
        if (!project) return '';
        const projRepos = project.repoIds.map(id => ctx.db.getRepo(id)?.name).filter(Boolean);
        const projSystems = project.systemIds.map(id => ctx.db.getSystem(id)?.name).filter(Boolean);
        const projObs = ctx.db.listObservations({ status: 'active', limit: 5 })
          .filter(o => (o.entities ?? []).some(e => e.type === 'project' && e.id === project.id));
        return `- **${project.name}** (${project.kind}, score=${ap.score.toFixed(0)}): repos=[${projRepos.join(', ')}], systems=[${projSystems.join(', ')}]\n  Active observations: ${projObs.map(o => o.title).join('; ') || 'none'}`;
      }).filter(Boolean).join('\n')}\n`
    : '';

  // Shared data sections
  const dataSources = [
    repoContextSummary ? `### Repository Status\n${repoContextSummary}\n` : '',
    systemContext,
    projectContext,
    interactionSummary ? `### Tool Usage\n${interactionSummary}\n` : '',
    conversationSummary ? `### Conversations\n${conversationSummary}\n` : '',
    gitEventsSummary,
    remoteSyncSummary,
    enrichmentSummary,
  ].filter(Boolean).join('\n');

  const adapter = selectAdapter(ctx.config);
  const model = getModel(ctx, 'analyze');
  const effort = getEffort(ctx, 'analyze');

  // Load soul reflection for context in extract/observe prompts
  const soulReflection = ctx.db.listMemories({ archived: false })
    .find(m => m.kind === 'soul_reflection')?.bodyMd ?? '';
  const soulSection = soulReflection ? `### Shadow's understanding of the developer\n${soulReflection}\n` : '';

  let llmCalls = 0;
  let tokensUsed = 0;
  let patternsDetected = 0;
  let memoriesCreated = 0;
  let observationsCreated = 0;

  // ========== CALL 1: Extract (memories + mood) ==========
  try {
    const existingMemories = ctx.db.listMemories({ archived: false, layers: ['core', 'hot'] })
      .map(m => `- [${m.layer}] ${m.title}`)
      .join('\n');

    // Load pending corrections for repos being analyzed
    const { loadPendingCorrections } = await import('../memory/retrieval.js');
    const repoEntities = [...repoIds].map(id => ({ type: 'repo' as const, id }));
    const correctionsSection = loadPendingCorrections(ctx.db, repoEntities);

    const extractPrompt = [
      'Extract DURABLE KNOWLEDGE from this engineering session.',
      'Ask: "would I want to know this in 3 months? Can it be derived from reading the code or git log?"',
      '',
      'Return JSON:',
      '{ "insights": [{ "kind": string, "title": string, "bodyMd": string, "confidence": number, "tags": string[], "layer": "hot"|"core", "scope": "personal"|"repo"|"cross-repo" }],',
      '  "profileUpdates": { "moodHint": "neutral"|"happy"|"focused"|"tired"|"frustrated"|"excited"|"concerned", "energyLevel": "low"|"normal"|"high" } }',
      '',
      'Kinds: tech_stack, design_decision, workflow, problem_solved, team_knowledge, preference, convention, dependency',
      '- convention = how we do X in this repo/org (naming patterns, processes, rules)',
      '- dependency = relationship between repos, systems, or services',
      '- preference = user preferences about tools, workflows, or approaches',
      'Prefer: preference, workflow, convention, tech_stack. design_decision should be < 40% of your output.',
      '',
      'ENTITY LINKING:',
      'When an insight is about a registered system or project, include the system/project name in the tags.',
      'This helps Shadow link knowledge to the right entity for future retrieval.',
      activeProjects.length > 0 ? `\nPrioritize insights related to active projects: ${activeProjects.map(ap => ap.projectName).join(', ')}.` : '',
      '',
      'LAYER RULES:',
      '"core" requires ALL of: (a) needed if rewriting from scratch, (b) stable for 6+ months, (c) NOT derivable from code.',
      'Default to "hot". Bug fixes, implementation details, feature descriptions → "hot".',
      'Only "core" for: fundamental tech stack choices, strong user preferences, architectural truths.',
      '',
      'BAD memories (NEVER CREATE):',
      '- Session summaries ("today we worked on X", "this session focused on Y")',
      '- File edit counts ("file.ts was edited 39 times")',
      '- Commit/rename pending state ("rename pending", "not yet committed")',
      '- UI style details derivable from reading the code (colors, CSS, layout)',
      '- Obvious facts anyone can see in git log or git status',
      '- Activity logs or tool usage stats',
      '- What-was-worked-on descriptions',
      '',
      'Return 0-2 insights. ZERO is valid — return empty array if nothing durable was learned.',
      'Confidence: 90+ for verified facts, 70-89 for inferences.',
      '',
      dataSources,
      soulSection,
      existingMemories ? `### Already Known (DO NOT duplicate)\n${existingMemories}\n` : '',
      correctionsSection,
      'Respond with JSON only.',
    ].join('\n');

    const result = await adapter.execute({
      repos: [], title: 'Heartbeat Extract', goal: 'Extract knowledge + mood', prompt: extractPrompt,
      relevantMemories, model, effort,
    });
    llmCalls++;
    tokensUsed += (result.inputTokens ?? 0) + (result.outputTokens ?? 0);
    console.error(`[shadow:extract] status=${result.status} tokens=${(result.inputTokens ?? 0) + (result.outputTokens ?? 0)}`);
    ctx.db.recordLlmUsage({ source: 'heartbeat_extract', sourceId: heartbeatId ?? null, model, inputTokens: result.inputTokens ?? 0, outputTokens: result.outputTokens ?? 0 });

    if (result.status === 'success' && result.output) {
      const parseResult = safeParseJson(result.output, ExtractResponseSchema, 'extract');
      if (!parseResult.success) {
        console.error(`[shadow:extract] ${parseResult.error}`);
        console.error(`[shadow:extract] Raw (500): ${result.output.slice(0, 500)}`);
      } else {
        const parsed = parseResult.data;
        console.error(`[shadow:extract] ${parsed.insights.length} insights, profile: ${JSON.stringify(parsed.profileUpdates ?? {})}${parseResult.repaired ? ' (repaired)' : ''}`);

        if (parsed.profileUpdates) {
          const pu: Record<string, unknown> = {};
          if (parsed.profileUpdates.moodHint) pu.moodHint = parsed.profileUpdates.moodHint;
          if (parsed.profileUpdates.energyLevel) pu.energyLevel = parsed.profileUpdates.energyLevel;
          if (Object.keys(pu).length > 0) ctx.db.updateProfile(ctx.profile.id, pu);
        }
        for (const insight of parsed.insights) {
          // Semantic dedup: check if similar memory exists before creating
          const decision = await checkMemoryDuplicate(ctx.db, {
            kind: insight.kind, title: insight.title, bodyMd: insight.bodyMd,
          });

          switch (decision.action) {
            case 'skip':
              console.error(`[shadow:extract] Skip duplicate (${(decision.similarity * 100).toFixed(0)}%): ${insight.title}`);
              break;
            case 'update':
              console.error(`[shadow:extract] Update existing (${(decision.similarity * 100).toFixed(0)}%): ${insight.title}`);
              ctx.db.mergeMemoryBody(decision.existingId, insight.bodyMd, insight.tags);
              // Regenerate embedding for the updated memory
              const updated = ctx.db.getMemory(decision.existingId);
              if (updated) {
                await generateAndStoreEmbedding(ctx.db, 'memory', updated.id, { kind: updated.kind, title: updated.title, bodyMd: updated.bodyMd });
              }
              break;
            case 'create': {
              const primaryRepoId = repoIds.size === 1 ? [...repoIds][0] : null;
              const mem = ctx.db.createMemory({
                repoId: primaryRepoId,
                layer: insight.layer, scope: insight.scope, kind: insight.kind, title: insight.title, bodyMd: insight.bodyMd,
                tags: insight.tags, sourceType: 'heartbeat', sourceId: heartbeatId ?? null,
                confidenceScore: insight.confidence, relevanceScore: 0.6,
              });
              // Auto-link to projects + systems
              const entities = buildEntityLinks(ctx.db, primaryRepoId, `${insight.title} ${insight.bodyMd}`, entityCache);
              if (entities.length > 0) persistEntityLinks(ctx.db, 'memories', mem.id, entities);
              // Store embedding for new memory
              await generateAndStoreEmbedding(ctx.db, 'memory', mem.id, { kind: mem.kind, title: mem.title, bodyMd: mem.bodyMd });
              memoriesCreated++;
              if (insight.kind === 'pattern') patternsDetected++;
              break;
            }
          }
        }
      }
    }
  } catch (e) {
    console.error('[shadow:extract] LLM failed:', e instanceof Error ? e.message : e);
  }

  // ========== CALL 2: Observe-cleanup (MCP — resolve obsolete/duplicate observations) ==========
  try {
    const preCleanupObs = ctx.db.listObservations({ status: 'active', limit: 30 });
    if (preCleanupObs.length > 5) {
      const cleanupPrompt = [
        'You are Shadow\'s observation cleanup phase.',
        '',
        'Review the active observations below. For each one, decide if it should stay active or be resolved.',
        '',
        'RESOLVE an observation if:',
        '- The condition no longer applies (file was committed, issue was fixed, feature was implemented)',
        '- It\'s a duplicate of another observation about the same file or topic — keep the most recent, resolve older ones',
        '- It\'s an activity log, not an actionable insight ("X ediciones en Y" without a clear action)',
        '- It was about something that happened during active development and is no longer relevant',
        '',
        'DO NOT resolve observations with severity "high" unless you have strong evidence the condition is fully resolved.',
        'Err on the side of keeping observations active — automated expiration handles stale ones over time.',
        '',
        'Use shadow_observations to see the full list, then use shadow_observation_resolve for each one you want to resolve.',
        'Provide a reason when resolving.',
        '',
        dataSources,
      ].join('\n');

      const cleanupResult = await adapter.execute({
        repos: [], title: 'Observe Cleanup', goal: 'Resolve obsolete observations',
        prompt: cleanupPrompt, relevantMemories: [], model, effort,
        systemPrompt: null, // MCP access — Claude calls shadow_observation_resolve directly
      });
      llmCalls++;
      tokensUsed += (cleanupResult.inputTokens ?? 0) + (cleanupResult.outputTokens ?? 0);
      ctx.db.recordLlmUsage({ source: 'heartbeat_cleanup', sourceId: heartbeatId ?? null, model, inputTokens: cleanupResult.inputTokens ?? 0, outputTokens: cleanupResult.outputTokens ?? 0 });
      console.error(`[shadow:cleanup] Completed. Tokens: ${(cleanupResult.inputTokens ?? 0) + (cleanupResult.outputTokens ?? 0)}`);
    }
  } catch (e) {
    console.error('[shadow:cleanup] Failed:', e instanceof Error ? e.message : e);
  }

  // ========== CALL 3: Observe (generate new observations — JSON-only) ==========
  try {
    const activeObservations = ctx.db.listObservations({ status: 'active', limit: 20 });
    // Touch last_seen_at — observations still relevant to heartbeat stay alive longer
    ctx.db.touchObservationsLastSeen(activeObservations.map(o => o.id));
    const activeObsSummary = activeObservations.map(o => `- [${o.severity}/${o.kind}] ${o.title} (${o.votes}x, ${o.createdAt.slice(0, 10)})`).join('\n');
    const dismissFeedback = ctx.db.listSuggestions({ status: 'dismissed' }).slice(0, 10)
      .filter(s => s.feedbackNote).map(s => `- "${s.title}" — dismissed: ${s.feedbackNote}`).join('\n');

    const observePrompt = [
      'Generate ACTIONABLE OBSERVATIONS about the developer\'s work.',
      '',
      'Return JSON:',
      '{ "observations": [{ "kind": "improvement"|"risk"|"opportunity"|"pattern"|"infrastructure"|"cross_project", "title": string, "detail": string, "severity": "info"|"warning"|"high", "files": string[], "projectNames": string[] }] }',
      activeProjects.length > 0 ? `\nActive projects: ${activeProjects.map(ap => ap.projectName).join(', ')}. Prioritize observations about these. Use kind "cross_project" for observations spanning multiple projects.` : '',
      '',
      'Rules:',
      '- Return up to 3 observations. ZERO is valid — return empty array if nothing actionable.',
      '- Consolidate related issues into ONE observation (e.g., all "missing validation in X" → one observation).',
      '- If a pattern applies to multiple repos, mention all affected repos in the detail.',
      '- Each observation must be: actionable, specific, and non-obvious.',
      '- Observations can be about repos OR systems/infrastructure. For system observations, use kind "infrastructure".',
      '- Include up to 5 file paths per observation (for repo observations).',
      '',
      'NEVER create observations about:',
      '- File edit counts or number of changes ("file.ts edited 20 times")',
      '- Lists of uncommitted files (that\'s what git status is for)',
      '- Session activity descriptions ("the developer worked on X")',
      '- Things obvious from git status or git log',
      '',
      dataSources,
      soulSection,
      activeObsSummary ? `### Active Observations (DO NOT recreate these — they already exist)\n${activeObsSummary}\n` : '',
      dismissFeedback ? `### User Feedback (learn from this)\n${dismissFeedback}\n` : '',
      (() => {
        const of = ctx.db.listFeedback('observation', 10).filter(f => f.note);
        return of.length > 0 ? `### Observation feedback (learn what's not useful)\n${of.map(f => `- ${f.action}: ${f.note}`).join('\n')}\n` : '';
      })(),
      'Respond with JSON only.',
    ].join('\n');

    const result = await adapter.execute({
      repos: [], title: 'Heartbeat Observe', goal: 'Generate observations', prompt: observePrompt,
      relevantMemories: [], model, effort,
    });
    llmCalls++;
    tokensUsed += (result.inputTokens ?? 0) + (result.outputTokens ?? 0);
    ctx.db.recordLlmUsage({ source: 'heartbeat_observe', sourceId: heartbeatId ?? null, model, inputTokens: result.inputTokens ?? 0, outputTokens: result.outputTokens ?? 0 });

    if (result.status === 'success' && result.output) {
      const parseResult = safeParseJson(result.output, ObserveResponseSchema, 'observe');
      if (!parseResult.success) {
        console.error(`[shadow:observe] ${parseResult.error}`);
        console.error(`[shadow:observe] Raw (500): ${result.output.slice(0, 500)}`);
      } else {
        const parsed = parseResult.data;
        console.error(`[shadow:observe] ${parsed.observations.length} new observations${parseResult.repaired ? ' (repaired)' : ''}`);

        for (const obs of parsed.observations) {
          const firstRepoId = repoIds.size > 0 ? [...repoIds][0] : (repoContexts.length > 0 ? repoContexts[0].repoId : null);
          if (!firstRepoId) continue;

          // Semantic dedup before creating observation
          const { checkObservationDuplicate } = await import('../memory/dedup.js');
          const decision = await checkObservationDuplicate(ctx.db, {
            kind: obs.kind, title: obs.title, detail: { description: obs.detail },
          });

          if (decision.action === 'skip') {
            console.error(`[shadow:observe] Skip duplicate obs (${(decision.similarity * 100).toFixed(0)}%): ${obs.title}`);
            continue;
          }
          if (decision.action === 'update') {
            console.error(`[shadow:observe] Merge into existing obs (${(decision.similarity * 100).toFixed(0)}%): ${obs.title}`);
            // Increment votes on existing observation (dedup in DB will handle context merge)
            continue;
          }

          const repo = repoContexts.find((rc) => rc.repoId === firstRepoId);
          const context: Record<string, unknown> = {
            repoName: repo?.repoName ?? 'unknown', branch: repo?.currentBranch ?? 'unknown',
            files: obs.files.slice(0, 5),
          };
          const sessionIds = [...new Set(recentConversations.map((c) => c.session).filter(Boolean))];
          if (sessionIds.length > 0) context.sessionIds = sessionIds;
          const created = ctx.db.createObservation({
            repoId: firstRepoId, sourceKind: 'llm', sourceId: null,
            kind: obs.kind, severity: obs.severity,
            title: obs.title, detail: { description: obs.detail }, context,
          });
          // Auto-link to projects + systems (repo-based + name detection)
          const obsEntities = buildEntityLinks(ctx.db, firstRepoId, `${obs.title} ${obs.detail}`, entityCache);
          // Resolve explicit projectNames from LLM response
          if (obs.projectNames.length > 0) {
            const allProjects = ctx.db.listProjects();
            for (const pName of obs.projectNames) {
              const match = allProjects.find(p => p.name.toLowerCase() === pName.toLowerCase());
              if (match && !obsEntities.some(e => e.type === 'project' && e.id === match.id)) {
                obsEntities.push({ type: 'project', id: match.id });
              }
            }
          }
          if (obsEntities.length > 0) persistEntityLinks(ctx.db, 'observations', created.id, obsEntities);
          // Store embedding for new observation
          await generateAndStoreEmbedding(ctx.db, 'observation', created.id, { kind: created.kind, title: created.title, detail: created.detail });
          observationsCreated++;
        }
      }
    }
  } catch (e) {
    console.error('[shadow:observe] LLM failed:', e instanceof Error ? e.message : e);
  }

  // Post-processing
  for (const obs of observations) ctx.db.markObservationProcessed(obs.id);
  if (llmCalls > 0) { try { applyTrustDelta(ctx.db, 'heartbeat_completed'); } catch { /* */ } }
  if (recentInteractions.length >= 10) { try { applyTrustDelta(ctx.db, 'interaction_logged'); } catch { /* */ } }
  rotateInteractionsLog(ctx.config, new Date().toISOString());
  rotateConversationsLog(ctx.config);

  return { patternsDetected, memoriesCreated, llmCalls, tokensUsed, observationsCreated };
}


// --- Activity: Suggest ---

export async function activitySuggest(
  ctx: HeartbeatContext,
  observations: ObservationRecord[],
): Promise<{ suggestionsCreated: number; llmCalls: number; tokensUsed: number }> {
  if (observations.length === 0) {
    return { suggestionsCreated: 0, llmCalls: 0, tokensUsed: 0 };
  }

  const entityCache = loadEntityNameCache(ctx.db);
  const adapter = selectAdapter(ctx.config);

  // --- Pre-fase: group observations by repo ---
  const byRepo = new Map<string, ObservationRecord[]>();
  for (const obs of observations) {
    const rid = obs.repoId ?? '__none__';
    if (!byRepo.has(rid)) byRepo.set(rid, []);
    byRepo.get(rid)!.push(obs);
  }

  let totalCreated = 0;
  let totalLlmCalls = 0;
  let totalTokens = 0;

  for (const [repoId, repoObs] of byRepo) {
    if (repoId === '__none__') continue;
    const repo = ctx.db.getRepo(repoId);
    if (!repo) continue;

    // --- Pre-fase: gather context for this repo ---
    const topics = repoObs.flatMap(o => [o.kind, o.title]);
    const relevantMemories = findRelevantMemories(ctx.db, {
      topics: [...new Set(topics)], repoId,
    }, 10, false);

    const dismissPatterns = ctx.db.getDismissPatterns(repoId);
    const globalDismissPatterns = ctx.db.getDismissPatterns();
    const allPatterns = globalDismissPatterns.length > dismissPatterns.length ? globalDismissPatterns : dismissPatterns;
    const acceptDismissRate = ctx.db.getAcceptDismissRate(30);
    const pendingSuggestions = ctx.db.listSuggestions({ status: 'pending', repoId });
    const recentDismissed = ctx.db.listSuggestions({ status: 'dismissed' }).slice(0, 10);
    const recentAccepted = ctx.db.listSuggestions({ status: 'accepted' }).slice(0, 5);

    // --- Phase 1: Generate candidates ---
    const observationSummaries = repoObs.map(o => `- [${o.severity}] ${o.kind}: ${o.title}`).join('\n');
    const memorySummaries = relevantMemories.map(m => `- [${m.layer}/${m.kind}] ${m.title}: ${m.bodyMd.slice(0, 200)}`).join('\n');
    const pendingTitles = pendingSuggestions.map(s => `- ${s.title}`).join('\n');
    const dismissFeedback = recentDismissed.filter(s => s.feedbackNote).map(s => `- "${s.title}" — dismissed: ${s.feedbackNote}`).join('\n');
    const acceptedContext = recentAccepted.map(s => `- "${s.title}" (${s.kind}) — accepted`).join('\n');

    // Format dismiss patterns as anti-constraints
    const patternSection = allPatterns.length > 0
      ? `## Dismiss Patterns (DO NOT generate suggestions matching these)\n${allPatterns.map(p =>
          `- ${p.category}: ${p.count} dismissals${p.recentNotes.length ? ` (examples: ${p.recentNotes.slice(0, 2).map(n => `"${n}"`).join(', ')})` : ''}`
        ).join('\n')}\n`
      : '';

    // Format acceptance rate
    const rateSection = acceptDismissRate.total > 0
      ? `Acceptance rate: ${(acceptDismissRate.rate * 100).toFixed(0)}% (${acceptDismissRate.accepted} accepted / ${acceptDismissRate.dismissed} dismissed in last 30 days). Be very selective.\n`
      : '';

    // Repo context from repo-profile job
    const repoContextSection = repo.contextMd
      ? `## Repository Context\n${repo.contextMd}\n`
      : '';

    // Active projects
    const suggestActiveProjects = ctx.activeProjects ?? [];
    const projectContext = suggestActiveProjects.length > 0
      ? suggestActiveProjects.map(ap => {
          const project = ctx.db.getProject(ap.projectId);
          if (!project) return '';
          const projRepos = project.repoIds.map(id => ctx.db.getRepo(id)?.name).filter(Boolean);
          return `- **${project.name}** (${project.kind}): repos=[${projRepos.join(', ')}]`;
        }).filter(Boolean).join('\n')
      : '';

    const generatePrompt = [
      'Based on the following observations and context, propose actionable TECHNICAL suggestions for this specific repository.',
      '',
      'IMPORTANT RULES:',
      '- Only suggest code changes, refactors, bug fixes, features, or architecture improvements.',
      '- Do NOT suggest operational tasks like "commit files", "clean up branches", "update docs".',
      '- Do NOT duplicate existing pending suggestions (listed below).',
      '- Do NOT suggest improvements for code that was just created or modified in this session.',
      '- Do NOT suggest micro-optimizations unless they fix a real bug.',
      '- Consolidate related ideas into ONE suggestion.',
      '- Learn from dismissed suggestions and patterns — NEVER re-suggest dismissed patterns.',
      '- Learn from accepted suggestions — generate more in that direction.',
      '- Minimum quality: impact >= 3 AND confidence >= 60.',
      '- Include effort estimation for each suggestion.',
      '',
      rateSection,
      'Generate 1-2 high-confidence suggestions only. Zero is acceptable if nothing meets the bar.',
      'Suggestion kinds: refactor, bug, improvement, feature.',
      '',
      'Return structured JSON:',
      '{ "suggestions": [{ "kind": string, "title": string, "summaryMd": string, "reasoningMd": string, "impactScore": 1-5, "confidenceScore": 0-100, "riskScore": 1-5, "effort": "small"|"medium"|"large", "repoId": string|null }] }',
      '',
      repoContextSection,
      `## Recent Observations (${repo.name})\n${observationSummaries}\n`,
      projectContext ? `## Active Projects\n${projectContext}\n` : '',
      relevantMemories.length > 0 ? `## Relevant Memories\n${memorySummaries}\n` : '',
      pendingTitles ? `## Already Pending (DO NOT duplicate)\n${pendingTitles}\n` : '',
      patternSection,
      dismissFeedback ? `## Dismissed by User\n${dismissFeedback}\n` : '',
      acceptedContext ? `## Accepted by User (what they value)\n${acceptedContext}\n` : '',
      'Respond with JSON only.',
    ].join('\n');

    let candidates: Array<{ kind: string; title: string; summaryMd: string; reasoningMd: string | null; impactScore: number; confidenceScore: number; riskScore: number; effort: string; repoId: string | null }> = [];

    try {
      const genResult = await adapter.execute({
        repos: [], title: `Suggest: ${repo.name}`, goal: 'Generate suggestion candidates',
        prompt: generatePrompt, relevantMemories, model: getModel(ctx, 'suggest'), effort: getEffort(ctx, 'suggest'),
      });
      totalLlmCalls++;
      const genTokens = (genResult.inputTokens ?? 0) + (genResult.outputTokens ?? 0);
      totalTokens += genTokens;
      ctx.db.recordLlmUsage({ source: 'suggest_generate', sourceId: repo.id, model: getModel(ctx, 'suggest'), inputTokens: genResult.inputTokens ?? 0, outputTokens: genResult.outputTokens ?? 0 });

      if (genResult.status === 'success' && genResult.output) {
        const parseResult = safeParseJson(genResult.output, SuggestResponseSchema, 'suggest');
        if (parseResult.success) {
          candidates = parseResult.data.suggestions.filter(s => s.impactScore >= 3 && s.confidenceScore >= 60);
          console.error(`[shadow:suggest] Phase 1 (${repo.name}): ${candidates.length} candidates generated`);
        } else {
          console.error(`[shadow:suggest] Phase 1 parse failed (${repo.name}): ${parseResult.error}`);
        }
      }
    } catch (e) {
      console.error(`[shadow:suggest] Phase 1 failed (${repo.name}):`, e instanceof Error ? e.message : e);
    }

    if (candidates.length === 0) continue;

    // --- Phase 2: Validate candidates against actual code ---
    const validatePrompt = [
      'You are Shadow, validating suggestion candidates against actual code.',
      `Repository: ${repo.name}`,
      `Path: ${repo.path}`,
      '',
      repo.contextMd ? `## Repository Context\n${repo.contextMd}\n` : '',
      pendingTitles ? `## Pending suggestions already in queue\n${pendingTitles}\n` : '',
      '',
      '## Candidates to validate',
      ...candidates.map((c, i) => [
        `### Candidate ${i + 1}: ${c.title}`,
        `Kind: ${c.kind} | Impact: ${c.impactScore} | Confidence: ${c.confidenceScore} | Risk: ${c.riskScore} | Effort: ${c.effort}`,
        c.summaryMd,
        c.reasoningMd || '',
        '',
      ].join('\n')),
      '',
      'For EACH candidate:',
      '1. Use tools to read relevant code files in the repository',
      '2. Verify: Does the problem actually exist in the code?',
      '3. Verify: Is it already handled or solved?',
      '4. Verify: Is it redundant with pending suggestions?',
      '5. Judge: Given this repo\'s context, is this worth doing?',
      '',
      'Respond with JSON:',
      '{ "verdicts": [{ "title": "...", "keep": true/false, "reason": "brief explanation" }] }',
    ].join('\n');

    try {
      const { SuggestValidateResponseSchema } = await import('./schemas.js');
      const valResult = await adapter.execute({
        repos: [{ id: repo.id, name: repo.name, path: repo.path }],
        title: `Validate: ${repo.name}`, goal: 'Validate suggestion candidates against code',
        prompt: validatePrompt, relevantMemories: [],
        model: ctx.config.models.suggestValidate ?? getModel(ctx, 'suggest'),
        effort: 'high',
        allowedTools: ['Read', 'Grep', 'Glob', 'Bash'],
        systemPrompt: null,
      });
      totalLlmCalls++;
      const valTokens = (valResult.inputTokens ?? 0) + (valResult.outputTokens ?? 0);
      totalTokens += valTokens;
      ctx.db.recordLlmUsage({ source: 'suggest_validate', sourceId: repo.id, model: ctx.config.models.suggestValidate ?? getModel(ctx, 'suggest'), inputTokens: valResult.inputTokens ?? 0, outputTokens: valResult.outputTokens ?? 0 });

      if (valResult.status === 'success' && valResult.output) {
        const valParsed = safeParseJson(valResult.output, SuggestValidateResponseSchema, 'suggest-validate');
        if (valParsed.success) {
          const kept = new Set<string>();
          for (const v of valParsed.data.verdicts) {
            if (v.keep) {
              kept.add(v.title);
              console.error(`[shadow:suggest] Phase 2 KEEP (${repo.name}): "${v.title}" — ${v.reason}`);
            } else {
              console.error(`[shadow:suggest] Phase 2 DROP (${repo.name}): "${v.title}" — ${v.reason}`);
            }
          }
          // Filter candidates to only kept ones
          candidates = candidates.filter(c => kept.has(c.title));
        } else {
          console.error(`[shadow:suggest] Phase 2 parse failed (${repo.name}): ${valParsed.error}`);
          // On parse failure, keep all candidates (fail-open)
        }
      } else {
        console.error(`[shadow:suggest] Phase 2 LLM failed (${repo.name}): status=${valResult.status}`);
      }
    } catch (e) {
      console.error(`[shadow:suggest] Phase 2 failed (${repo.name}):`, e instanceof Error ? e.message : e);
      // On failure, keep all candidates (fail-open)
    }

    // --- Persist kept candidates (with semantic dedup) ---
    for (const sug of candidates) {
      const vsPending = await checkSuggestionDuplicate(ctx.db, { kind: sug.kind, title: sug.title, summaryMd: sug.summaryMd }, 'pending');
      if (vsPending.action !== 'create') {
        console.error(`[shadow:suggest] Skip (similar to pending, ${(vsPending.similarity * 100).toFixed(0)}%): ${sug.title}`);
        continue;
      }

      const vsDismissed = await checkSuggestionDuplicate(ctx.db, { kind: sug.kind, title: sug.title, summaryMd: sug.summaryMd }, 'dismissed');
      if (vsDismissed.action !== 'create') {
        console.error(`[shadow:suggest] Skip (similar to dismissed, ${(vsDismissed.similarity * 100).toFixed(0)}%): ${sug.title}`);
        continue;
      }

      const vsAccepted = await checkSuggestionDuplicate(ctx.db, { kind: sug.kind, title: sug.title, summaryMd: sug.summaryMd }, 'accepted');
      if (vsAccepted.action === 'update' || vsAccepted.action === 'skip') {
        sug.confidenceScore = Math.min(100, sug.confidenceScore + 10);
      }

      const created = ctx.db.createSuggestion({
        repoId: repo.id, repoIds: [repo.id],
        sourceObservationId: repoObs[0]?.id ?? null,
        kind: sug.kind, title: sug.title, summaryMd: sug.summaryMd, reasoningMd: sug.reasoningMd,
        impactScore: sug.impactScore, confidenceScore: sug.confidenceScore, riskScore: sug.riskScore,
        requiredTrustLevel: ctx.profile.trustLevel,
      });
      const sugEntities = buildEntityLinks(ctx.db, repo.id, `${sug.title} ${sug.summaryMd}`, entityCache);
      if (sugEntities.length > 0) persistEntityLinks(ctx.db, 'suggestions', created.id, sugEntities);
      await generateAndStoreEmbedding(ctx.db, 'suggestion', created.id, { kind: created.kind, title: created.title, summaryMd: created.summaryMd });
      totalCreated++;
    }
  }

  return { suggestionsCreated: totalCreated, llmCalls: totalLlmCalls, tokensUsed: totalTokens };
}

// --- Activity: Consolidate ---

export async function activityConsolidate(
  ctx: HeartbeatContext,
): Promise<{ memoriesPromoted: number; memoriesDemoted: number; memoriesExpired: number; llmCalls: number; tokensUsed: number }> {
  // Step 1: Run the programmatic memory layer maintenance
  const layerResult = maintainMemoryLayers(ctx.db);

  let llmCalls = 0;
  let tokensUsed = 0;

  // Step 2: Optionally synthesize meta-patterns via LLM if enough hot memories exist
  const hotMemories = ctx.db.listMemories({ layer: 'hot', archived: false });

  if (hotMemories.length >= 10) {
    const memorySummaries = hotMemories.slice(0, 20).map((mem) =>
      `- [${mem.kind}] ${mem.title}: ${mem.bodyMd.slice(0, 150)}`,
    ).join('\n');

    const prompt = [
      'Review the following high-priority memories and synthesize any meta-patterns or overarching themes.',
      'If you find a meta-pattern, return JSON:',
      '{ "metaPatterns": [{ "title": string, "bodyMd": string, "confidence": number, "tags": string[] }] }',
      'If no meta-patterns found, return: { "metaPatterns": [] }',
      '',
      '## Hot Memories',
      memorySummaries,
      '',
      'Respond with JSON only.',
    ].join('\n');

    const pack: ObjectivePack = {
      repos: [],
      title: 'Memory Consolidation',
      goal: 'Synthesize meta-patterns from accumulated memories',
      prompt,
      relevantMemories: hotMemories.slice(0, 20),
      model: getModel(ctx, 'consolidate'),
    };

    try {
      const adapter = selectAdapter(ctx.config);
      const result = await adapter.execute(pack);
      llmCalls = 1;
      tokensUsed = (result.inputTokens ?? 0) + (result.outputTokens ?? 0);

      ctx.db.recordLlmUsage({
        source: 'heartbeat_consolidate',
        sourceId: null,
        model: getModel(ctx, 'consolidate'),
        inputTokens: result.inputTokens ?? 0,
        outputTokens: result.outputTokens ?? 0,
      });

      if (result.status === 'success' && result.output) {
        try {
          const parsed = JSON.parse(result.output) as {
            metaPatterns?: Array<{
              title?: string;
              bodyMd?: string;
              confidence?: number;
              tags?: string[];
            }>;
          };

          if (parsed.metaPatterns && Array.isArray(parsed.metaPatterns)) {
            for (const pattern of parsed.metaPatterns) {
              if (!pattern.title || !pattern.bodyMd) continue;

              // Semantic dedup: check if a similar meta_pattern already exists
              const decision = await checkMemoryDuplicate(ctx.db, {
                kind: 'meta_pattern', title: pattern.title, bodyMd: pattern.bodyMd,
              });
              if (decision.action === 'skip') {
                console.error(`[shadow:consolidate] Skip duplicate meta_pattern: ${pattern.title}`);
                continue;
              }
              if (decision.action === 'update') {
                ctx.db.mergeMemoryBody(decision.existingId, pattern.bodyMd, pattern.tags);
                console.error(`[shadow:consolidate] Updated existing meta_pattern: ${pattern.title}`);
                continue;
              }

              const metaMem = ctx.db.createMemory({
                layer: 'core',
                scope: 'global',
                kind: 'meta_pattern',
                title: pattern.title,
                bodyMd: pattern.bodyMd,
                tags: pattern.tags ?? [],
                sourceType: 'consolidate',
                confidenceScore: pattern.confidence ?? 80,
                relevanceScore: 0.8,
              });
              await generateAndStoreEmbedding(ctx.db, 'memory', metaMem.id, { kind: 'meta_pattern', title: metaMem.title, bodyMd: metaMem.bodyMd });

              // Archive hot memories that are semantically covered by this meta_pattern
              const { vectorSearch } = await import('../memory/search.js');
              const similar = await vectorSearch({
                db: ctx.db.rawDb, text: pattern.title + ' ' + pattern.bodyMd,
                vecTable: 'memory_vectors', limit: 10,
              });
              for (const match of similar) {
                if (match.id === metaMem.id) continue; // Don't archive itself
                if (match.similarity < 0.65) break; // Below threshold
                const mem = ctx.db.getMemory(match.id);
                if (!mem || mem.layer !== 'hot') continue; // Only archive hot sources
                ctx.db.updateMemory(mem.id, { archivedAt: new Date().toISOString() });
                ctx.db.deleteEmbedding('memory_vectors', mem.id);
                ctx.db.createFeedback({ targetKind: 'memory', targetId: mem.id, action: 'consolidated', note: `merged into meta_pattern: ${pattern.title}` });
                console.error(`[shadow:consolidate] Archived hot source: ${mem.title}`);
              }
            }
          }
        } catch {
          // Failed to parse LLM output — not fatal
        }
      }
    } catch {
      // LLM call failed — continue with programmatic results only
    }
  }

  return {
    memoriesPromoted: layerResult.promoted,
    memoriesDemoted: layerResult.demoted,
    memoriesExpired: layerResult.expired,
    llmCalls,
    tokensUsed,
  };
}

// --- Interactions log rotation ---

function rotateInteractionsLog(config: ShadowConfig, cutoffIso: string): void {
  const interactionsPath = resolve(config.resolvedDataDir, 'interactions.jsonl');
  try {
    const content = readFileSync(interactionsPath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);

    // Keep lines from the last 2 hours as buffer (not 5 min — too aggressive)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const kept = lines.filter(line => {
      try {
        const entry = JSON.parse(line) as { ts: string };
        return entry.ts > twoHoursAgo;
      } catch { return false; }
    });

    fsWriteFileSync(interactionsPath, kept.length > 0 ? kept.join('\n') + '\n' : '', 'utf8');
  } catch { /* file doesn't exist or can't be read — fine */ }
}

// --- Activity: Notify ---

export async function activityNotify(
  ctx: HeartbeatContext,
): Promise<{ eventsQueued: number }> {
  let eventsQueued = 0;

  // Check proactivity level to decide what gets queued
  const proactivityLevel = ctx.profile.proactivityLevel;

  // Check for pending suggestions that haven't been shown yet
  const pendingSuggestions = ctx.db.listSuggestions({ status: 'pending' });
  const unshownSuggestions = pendingSuggestions.filter((s) => !s.shownAt);

  for (const suggestion of unshownSuggestions) {
    // Only queue high-impact suggestions at low proactivity levels
    if (proactivityLevel < 5 && suggestion.impactScore < 4) continue;
    // Only queue medium+ impact at medium proactivity
    if (proactivityLevel < 8 && suggestion.impactScore < 2) continue;

    ctx.db.createEvent({
      kind: 'suggestion_ready',
      priority: suggestion.impactScore + suggestion.confidenceScore / 100,
      payload: {
        suggestionId: suggestion.id,
        title: suggestion.title,
        kind: suggestion.kind,
        impactScore: suggestion.impactScore,
      },
    });
    eventsQueued++;
  }

  // Check for high-severity active observations that should trigger immediate notifications
  const recentObservations = ctx.db.listObservations({ status: 'active', limit: 50 });
  const criticalObservations = recentObservations.filter(
    (obs) => obs.severity === 'high' || obs.severity === 'critical',
  );

  for (const obs of criticalObservations) {
    // Always notify on critical/high observations regardless of proactivity level
    ctx.db.createEvent({
      kind: 'observation_alert',
      priority: obs.severity === 'critical' ? 9 : 7,
      payload: {
        observationId: obs.id,
        title: obs.title,
        kind: obs.kind,
        severity: obs.severity,
        repoId: obs.repoId,
      },
    });
    eventsQueued++;
  }

  return { eventsQueued };
}

// --- Activity: Reflect (2-phase) ---

export async function activityReflect(
  ctx: HeartbeatContext,
): Promise<{ llmCalls: number; tokensUsed: number; skipped: boolean; reason?: string }> {
  const lastReflect = ctx.db.getLastJob('reflect');
  const sinceIso = lastReflect?.finishedAt ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const adapter = selectAdapter(ctx.config);
  const existingSoul = ctx.db.listMemories({ archived: false }).find(m => m.kind === 'soul_reflection');

  // ========== PHASE 1: Extract deltas (Sonnet, cheap) ==========

  // Gather only NEW data since last reflect
  const newMemories = ctx.db.listMemories({ archived: false })
    .filter(m => m.kind !== 'soul_reflection' && m.kind !== 'soul_snapshot' && m.createdAt > sinceIso)
    .map(m => `- [${m.layer}/${m.kind}] ${m.title}: ${m.bodyMd.slice(0, 80)}`);

  const newFeedback = ctx.db.listFeedback(undefined, 50)
    .filter(f => f.note && f.createdAt > sinceIso)
    .map(f => `- [${f.targetKind}] ${f.action}: ${f.note}`);

  const newObservations = ctx.db.listObservations({ status: 'active', limit: 20 })
    .filter(o => o.createdAt > sinceIso)
    .map(o => `- [${o.kind}/${o.severity}] ${o.title}`);

  const resolvedObs = ctx.db.listObservations({ status: 'resolved', limit: 10 })
    .filter(o => o.createdAt > sinceIso)
    .map(o => `- [resolved] ${o.title}`);

  const recentSugs = ctx.db.listSuggestions({ status: 'accepted' }).slice(0, 5)
    .filter(s => s.createdAt > sinceIso)
    .map(s => `- [accepted] ${s.title}`);
  const dismissedSugs = ctx.db.listSuggestions({ status: 'dismissed' }).slice(0, 10)
    .filter(s => s.feedbackNote && s.createdAt > sinceIso)
    .map(s => `- [dismissed] ${s.title}: "${s.feedbackNote}"`);

  const totalDeltas = newMemories.length + newFeedback.length + newObservations.length + resolvedObs.length + recentSugs.length + dismissedSugs.length;

  if (totalDeltas === 0) {
    console.error('[shadow:reflect] Skipping — no changes since last reflect');
    return { llmCalls: 0, tokensUsed: 0, skipped: true, reason: 'no changes since last reflect' };
  }

  console.error(`[shadow:reflect] Phase 1: ${totalDeltas} deltas (${newMemories.length} memories, ${newFeedback.length} feedback, ${newObservations.length} observations)`);

  const deltaPrompt = [
    'Summarize what changed in this developer\'s work since the last reflection.',
    'Be concise — max 300 words. Focus on: new knowledge learned, feedback patterns, risks emerged/resolved, decisions made.',
    '',
    newMemories.length > 0 ? `## New memories learned\n${newMemories.join('\n')}\n` : '',
    newFeedback.length > 0 ? `## New feedback\n${newFeedback.join('\n')}\n` : '',
    newObservations.length > 0 ? `## New observations\n${newObservations.join('\n')}\n` : '',
    resolvedObs.length > 0 ? `## Resolved observations\n${resolvedObs.join('\n')}\n` : '',
    recentSugs.length > 0 ? `## Accepted suggestions\n${recentSugs.join('\n')}\n` : '',
    dismissedSugs.length > 0 ? `## Dismissed suggestions\n${dismissedSugs.join('\n')}\n` : '',
    '',
    'Output a concise change report. No preamble.',
  ].filter(Boolean).join('\n');

  let llmCalls = 0;
  let tokensUsed = 0;
  let changeReport = '';

  try {
    const deltaResult = await adapter.execute({
      repos: [], title: 'Reflect Delta', goal: 'Summarize changes since last reflect',
      prompt: deltaPrompt, relevantMemories: [], model: 'sonnet', effort: 'low',
    });
    llmCalls++;
    tokensUsed += (deltaResult.inputTokens ?? 0) + (deltaResult.outputTokens ?? 0);
    ctx.db.recordLlmUsage({ source: 'reflect_delta', sourceId: null, model: 'sonnet', inputTokens: deltaResult.inputTokens ?? 0, outputTokens: deltaResult.outputTokens ?? 0 });

    if (deltaResult.status === 'success' && deltaResult.output) {
      changeReport = deltaResult.output;
      console.error(`[shadow:reflect] Phase 1 complete: ${changeReport.length} chars change report`);
    } else {
      console.error('[shadow:reflect] Phase 1 failed — proceeding with raw deltas');
      changeReport = [newMemories.join('\n'), newFeedback.join('\n'), newObservations.join('\n')].filter(Boolean).join('\n');
    }
  } catch (e) {
    console.error('[shadow:reflect] Phase 1 error:', e instanceof Error ? e.message : e);
    changeReport = [newMemories.join('\n'), newFeedback.join('\n'), newObservations.join('\n')].filter(Boolean).join('\n');
  }

  // ========== PHASE 2: Evolve soul (Opus) ==========

  // Minimal entity context (names only, not full dumps)
  const projects = ctx.db.listProjects({ status: 'active' });
  const repos = ctx.db.listRepos();
  const entityContext = [
    projects.length > 0 ? `Projects: ${projects.map(p => p.name).join(', ')}` : '',
    `Repos: ${repos.length} (${repos.slice(0, 5).map(r => r.name).join(', ')})`,
    `Trust: L${ctx.profile.trustLevel} (${ctx.profile.trustScore})`,
  ].filter(Boolean).join(' | ');

  let soulMd = '';
  try { soulMd = readFileSync(resolve(ctx.config.resolvedDataDir, 'SOUL.md'), 'utf8'); } catch { /* no SOUL.md */ }

  const evolvePrompt = [
    'You are Shadow, evolving your understanding of the developer.',
    'Below is your current reflection and a change report of what happened since you last reflected.',
    'Evolve the reflection — update sections that need it, keep stable sections as-is.',
    '',
    existingSoul ? `## Current reflection\n${existingSoul.bodyMd}\n` : '',
    soulMd ? `## Base personality (SOUL.md)\n${soulMd}\n` : '',
    '',
    `## Context\n${entityContext}\n`,
    `## Change report (since last reflect)\n${changeReport}\n`,
    '',
    'Structure as markdown with these exact sections:',
    '',
    '## Developer profile',
    'Who they are, their role, expertise areas, communication style.',
    '',
    '## Decision patterns',
    'What principles drive their decisions? What do they consistently accept/reject?',
    '',
    '## Blind spots',
    'What topics/repos/systems have NOT appeared in recent activity that probably need attention?',
    'The gap between stated priorities and actual activity IS the blind spot.',
    '',
    '## What Shadow should watch for',
    'Proactive items: upcoming deadlines, dependencies at risk, patterns that predict problems.',
    '',
    '## Communication preferences',
    'How they want Shadow to communicate: tone, verbosity, when to be proactive vs silent.',
    '',
    'Output ONLY the markdown reflection, no preamble or explanation.',
  ].filter(Boolean).join('\n');

  try {
    const result = await adapter.execute({
      repos: [], title: 'Shadow Reflect', goal: 'Evolve soul reflection',
      prompt: evolvePrompt, relevantMemories: [], model: 'opus', effort: 'high',
      systemPrompt: null, allowedTools: [],
    });
    llmCalls++;
    tokensUsed += (result.inputTokens ?? 0) + (result.outputTokens ?? 0);
    ctx.db.recordLlmUsage({ source: 'reflect_evolve', sourceId: null, model: 'opus', inputTokens: result.inputTokens ?? 0, outputTokens: result.outputTokens ?? 0 });

    if (result.status === 'success' && result.output) {
      const expectedSections = ['## Developer profile', '## Decision patterns', '## Blind spots', '## What Shadow should watch for'];
      const missing = expectedSections.filter(s => !result.output!.includes(s));
      if (missing.length > 0) {
        console.error(`[shadow:reflect] Warning: output missing sections: ${missing.join(', ')}`);
      }

      // Save snapshot of previous soul before updating
      if (existingSoul) {
        const snapshotDate = new Date().toISOString().split('T')[0];
        const snapshot = ctx.db.createMemory({
          layer: 'core', scope: 'personal', kind: 'soul_snapshot',
          title: `Soul reflection snapshot — ${snapshotDate}`,
          bodyMd: existingSoul.bodyMd,
          sourceType: 'reflect', confidenceScore: 95, relevanceScore: 0.3,
        });
        ctx.db.updateMemory(snapshot.id, { archivedAt: new Date().toISOString() });
        ctx.db.updateMemory(existingSoul.id, { bodyMd: result.output });
      } else {
        ctx.db.createMemory({
          layer: 'core', scope: 'personal', kind: 'soul_reflection',
          title: 'Shadow soul reflection', bodyMd: result.output,
          sourceType: 'reflect', confidenceScore: 95, relevanceScore: 1.0,
        });
      }
      console.error(`[shadow:reflect] Soul reflection saved (2-phase). Tokens: ${tokensUsed}`);
      return { llmCalls, tokensUsed, skipped: false };
    }
  } catch (e) {
    console.error('[shadow:reflect] Phase 2 failed:', e instanceof Error ? e.message : e);
  }

  return { llmCalls, tokensUsed, skipped: false };
}
