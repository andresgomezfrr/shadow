import { readFileSync, writeFileSync as fsWriteFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ShadowConfig } from '../config/load-config.js';
import type { ShadowDatabase } from '../storage/database.js';
import type { ObservationRecord, MemoryRecord } from '../storage/models.js';
import type { ObjectivePack } from '../backend/types.js';

import { observeAllRepos, collectAllRepoContexts, summarizeRepoContexts } from '../observation/watcher.js';
import { findRelevantMemories } from '../memory/retrieval.js';
import { maintainMemoryLayers } from '../memory/layers.js';
import { checkMemoryDuplicate, checkSuggestionDuplicate } from '../memory/dedup.js';
import { generateAndStoreEmbedding } from '../memory/lifecycle.js';
import { selectAdapter } from '../backend/index.js';
import { applyTrustDelta } from '../profile/trust.js';

import type { HeartbeatContext } from './state-machine.js';
import { ExtractResponseSchema, ObserveResponseSchema, SuggestResponseSchema } from './schemas.js';
import { safeParseJson } from '../backend/json-repair.js';

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
  const repoContexts = collectAllRepoContexts(ctx.db);
  const repoContextSummary = summarizeRepoContexts(repoContexts);

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
  });

  // Shared data sections
  const dataSources = [
    repoContextSummary ? `### Repository Status\n${repoContextSummary}\n` : '',
    interactionSummary ? `### Tool Usage\n${interactionSummary}\n` : '',
    conversationSummary ? `### Conversations\n${conversationSummary}\n` : '',
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
    const existingMemories = ctx.db.listMemories({ archived: false })
      .filter(m => m.layer === 'core' || m.layer === 'hot')
      .map(m => `- [${m.layer}] ${m.title}`)
      .join('\n');

    const extractPrompt = [
      'Extract DURABLE KNOWLEDGE from this engineering session.',
      'Ask: "would I want to know this in 3 months?"',
      '',
      'Return JSON:',
      '{ "insights": [{ "kind": string, "title": string, "bodyMd": string, "confidence": number, "tags": string[], "layer": "hot"|"core", "scope": "personal"|"repo"|"cross-repo" }],',
      '  "profileUpdates": { "moodHint": "neutral"|"happy"|"focused"|"tired"|"frustrated"|"excited"|"concerned", "energyLevel": "low"|"normal"|"high" } }',
      '',
      'Kinds: tech_stack, design_decision, workflow, problem_solved, team_knowledge, preference',
      '',
      'LAYER RULES:',
      '"core" = needed if rewriting from scratch. "hot" = relevant now but may change.',
      'Default to "hot". Bug fixes, implementation details, feature descriptions → "hot".',
      'Only "core" for: tech stack choices, user preferences, architectural truths.',
      '',
      'BAD memories (NEVER CREATE): session summaries, tool stats, obvious facts, activity logs, ephemeral state.',
      'Return 1-3 insights. Confidence: 90+ for facts, 70-89 for inferences.',
      '',
      dataSources,
      soulSection,
      existingMemories ? `### Already Known (DO NOT duplicate)\n${existingMemories}\n` : '',
      (() => {
        const mf = ctx.db.listFeedback('memory', 10).filter(f => f.note);
        return mf.length > 0 ? `### Memory corrections (learn from these)\n${mf.map(f => `- ${f.action}: ${f.note}`).join('\n')}\n` : '';
      })(),
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
              const mem = ctx.db.createMemory({
                repoId: repoIds.size === 1 ? [...repoIds][0] : null,
                layer: insight.layer, scope: insight.scope, kind: insight.kind, title: insight.title, bodyMd: insight.bodyMd,
                tags: insight.tags, sourceType: 'heartbeat', sourceId: heartbeatId ?? null,
                confidenceScore: insight.confidence, relevanceScore: 0.6,
              });
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
    if (preCleanupObs.length > 3) {
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
        'Use shadow_observations to see the full list, then use shadow_observation_resolve for each one you want to resolve.',
        'Provide a reason when resolving.',
        '',
        'Be aggressive — it\'s better to have 5 high-quality observations than 20 noisy ones.',
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
    const activeObsSummary = activeObservations.map(o => `- [${o.severity}/${o.kind}] ${o.title} (${o.votes}x, ${o.createdAt.slice(0, 10)})`).join('\n');
    const dismissFeedback = ctx.db.listSuggestions({ status: 'dismissed' }).slice(0, 10)
      .filter(s => s.feedbackNote).map(s => `- "${s.title}" — dismissed: ${s.feedbackNote}`).join('\n');

    const observePrompt = [
      'Generate ACTIONABLE OBSERVATIONS about the developer\'s work.',
      '',
      'Return JSON:',
      '{ "observations": [{ "kind": "improvement"|"risk"|"opportunity"|"pattern"|"infrastructure", "title": string, "detail": string, "severity": "info"|"warning"|"high", "files": string[] }] }',
      '',
      'Only actionable insights. Not activity logs. Not "X file has N edits".',
      'Include up to 5 file paths per observation.',
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

  // Gather context
  const repoIds = [...new Set(observations.map((o) => o.repoId))];
  const filePaths: string[] = [];
  const topics: string[] = [];

  for (const obs of observations) {
    topics.push(obs.kind, obs.title);
    const detail = obs.detail as Record<string, unknown>;
    if (typeof detail.file === 'string') filePaths.push(detail.file);
  }

  const relevantMemories = findRelevantMemories(ctx.db, {
    filePaths,
    topics: [...new Set(topics)],
    repoId: repoIds.length === 1 ? repoIds[0] : undefined,
  });

  // Build the suggestion prompt
  const observationSummaries = observations.map((obs) =>
    `- [${obs.severity}] ${obs.kind}: ${obs.title}`,
  ).join('\n');

  const memorySummaries = relevantMemories.map((mem) =>
    `- [${mem.layer}/${mem.kind}] ${mem.title}: ${mem.bodyMd.slice(0, 200)}`,
  ).join('\n');

  const profileContext = [
    `Trust level: ${ctx.profile.trustLevel}`,
    `Proactivity level: ${ctx.profile.proactivityLevel}`,
    `Verbosity: ${ctx.profile.verbosity}`,
  ].join(', ');

  // Gather feedback from recently dismissed suggestions
  const recentDismissed = ctx.db.listSuggestions({ status: 'dismissed' }).slice(0, 10);
  const dismissFeedback = recentDismissed
    .filter(s => s.feedbackNote)
    .map(s => `- "${s.title}" — dismissed: ${s.feedbackNote}`)
    .join('\n');

  // Recently accepted suggestions — Shadow knows what the user values
  const recentAccepted = ctx.db.listSuggestions({ status: 'accepted' }).slice(0, 5);
  const acceptedContext = recentAccepted
    .map(s => `- "${s.title}" (${s.kind}) — accepted`)
    .join('\n');

  // Existing pending suggestions — don't duplicate
  const existingPending = ctx.db.listSuggestions({ status: 'pending' });
  const pendingTitles = existingPending.map(s => `- ${s.title}`).join('\n');

  const prompt = [
    'Based on the following observations and context, propose actionable TECHNICAL suggestions.',
    '',
    'IMPORTANT RULES:',
    '- Only suggest code changes, refactors, bug fixes, features, or architecture improvements.',
    '- Do NOT suggest operational tasks like "commit files", "clean up branches", "update docs".',
    '- Do NOT duplicate existing pending suggestions (listed below).',
    '- Do NOT suggest improvements for code that was just created or modified in this session. Fresh code needs time to settle.',
    '- Do NOT suggest micro-optimizations (error handling tweaks, type annotations, logging improvements) unless they fix a real bug.',
    '- Consolidate related ideas into ONE suggestion. Never output multiple variations of the same improvement.',
    '- Learn from dismissed suggestions — if the user gave feedback, respect it.',
    '- Minimum quality: only output suggestions where impact >= 3 AND confidence >= 60.',
    '',
    'Suggestion kinds: refactor, bug, improvement, feature.',
    `User profile: ${profileContext}`,
    '',
    'Return at most 3 suggestions. Fewer is better if quality is higher.',
    'Return structured JSON:',
    '{ "suggestions": [{ "kind": string, "title": string, "summaryMd": string, "reasoningMd": string, "impactScore": 1-5, "confidenceScore": 0-100, "riskScore": 1-5, "repoId": string|null }] }',
    '',
    '## Recent Observations',
    observationSummaries,
    '',
    relevantMemories.length > 0 ? `## Relevant Memories\n${memorySummaries}\n` : '',
    pendingTitles ? `## Already Pending (DO NOT duplicate)\n${pendingTitles}\n` : '',
    dismissFeedback ? `## Dismissed by User (learn from this feedback)\n${dismissFeedback}\n` : '',
    acceptedContext ? `## Accepted by User (this is what they value)\n${acceptedContext}\n` : '',
    'Respond with JSON only.',
  ].join('\n');

  const pack: ObjectivePack = {
    repos: [],
    title: 'Heartbeat Suggestions',
    goal: 'Propose actionable suggestions based on observations',
    prompt,
    relevantMemories,
    model: getModel(ctx, 'suggest'),
    effort: getEffort(ctx, 'suggest'),
  };

  let llmCalls = 0;
  let tokensUsed = 0;
  let suggestionsCreated = 0;

  try {
    const adapter = selectAdapter(ctx.config);
    const result = await adapter.execute(pack);
    llmCalls = 1;
    tokensUsed = (result.inputTokens ?? 0) + (result.outputTokens ?? 0);

    // Record token usage
    ctx.db.recordLlmUsage({
      source: 'heartbeat_suggest',
      sourceId: null,
      model: getModel(ctx, 'suggest'),
      inputTokens: result.inputTokens ?? 0,
      outputTokens: result.outputTokens ?? 0,
    });

    // Parse suggestions from LLM response
    if (result.status === 'success' && result.output) {
      const parseResult = safeParseJson(result.output, SuggestResponseSchema, 'suggest');
      if (!parseResult.success) {
        console.error(`[shadow:suggest] ${parseResult.error}`);
        console.error(`[shadow:suggest] Raw (500): ${result.output.slice(0, 500)}`);
      } else {
        const parsed = parseResult.data;
        console.error(`[shadow:suggest] Parsed ${parsed.suggestions.length} suggestions${parseResult.repaired ? ' (repaired)' : ''}`);

        // Quality filter: discard low-quality suggestions even if LLM ignores prompt rules
        const qualitySuggestions = parsed.suggestions.filter(sug =>
          sug.impactScore >= 3 && sug.confidenceScore >= 60
        );
        if (qualitySuggestions.length < parsed.suggestions.length) {
          console.error(`[shadow:suggest] Filtered ${parsed.suggestions.length - qualitySuggestions.length} low-quality suggestions`);
        }

        for (const sug of qualitySuggestions) {
          // Semantic dedup: check against pending → skip if similar
          const vsPending = await checkSuggestionDuplicate(ctx.db, {
            kind: sug.kind, title: sug.title, summaryMd: sug.summaryMd,
          }, 'pending');
          if (vsPending.action !== 'create') {
            console.error(`[shadow:suggest] Skip (similar to pending, ${(vsPending.similarity * 100).toFixed(0)}%): ${sug.title}`);
            continue;
          }

          // Check against dismissed → skip (don't re-suggest rejected)
          const vsDismissed = await checkSuggestionDuplicate(ctx.db, {
            kind: sug.kind, title: sug.title, summaryMd: sug.summaryMd,
          }, 'dismissed');
          if (vsDismissed.action !== 'create') {
            console.error(`[shadow:suggest] Skip (similar to dismissed, ${(vsDismissed.similarity * 100).toFixed(0)}%): ${sug.title}`);
            continue;
          }

          // Check against accepted → boost confidence
          const vsAccepted = await checkSuggestionDuplicate(ctx.db, {
            kind: sug.kind, title: sug.title, summaryMd: sug.summaryMd,
          }, 'accepted');
          if (vsAccepted.action === 'update' || vsAccepted.action === 'skip') {
            sug.confidenceScore = Math.min(100, sug.confidenceScore + 10);
            console.error(`[shadow:suggest] Boosted confidence (similar to accepted, ${(vsAccepted.similarity * 100).toFixed(0)}%): ${sug.title}`);
          }

          const created = ctx.db.createSuggestion({
            repoId: repoIds.length === 1 ? repoIds[0] : null,
            repoIds,
            sourceObservationId: observations[0]?.id ?? null,
            kind: sug.kind,
            title: sug.title,
            summaryMd: sug.summaryMd,
            reasoningMd: sug.reasoningMd,
            impactScore: sug.impactScore,
            confidenceScore: sug.confidenceScore,
            riskScore: sug.riskScore,
            requiredTrustLevel: ctx.profile.trustLevel,
          });
          // Store embedding for new suggestion
          await generateAndStoreEmbedding(ctx.db, 'suggestion', created.id, { kind: created.kind, title: created.title, summaryMd: created.summaryMd });
          suggestionsCreated++;
        }
      }
    }
  } catch (llmErr) {
    console.error('[shadow:suggest] LLM call failed:', llmErr instanceof Error ? llmErr.message : llmErr);
  }

  return { suggestionsCreated, llmCalls, tokensUsed };
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

              ctx.db.createMemory({
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
  // Observation lifecycle maintenance
  ctx.db.resolveStaleObservations();
  ctx.db.expireStaleObservations();

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

// --- Activity: Reflect ---

export async function activityReflect(
  ctx: HeartbeatContext,
): Promise<{ llmCalls: number; tokensUsed: number }> {
  const adapter = selectAdapter(ctx.config);

  // Load all context that Claude can't get via MCP (daemon spawns don't have MCP access)
  const existingSoul = ctx.db.listMemories({ archived: false }).find(m => m.kind === 'soul_reflection');
  const coreHotMemories = ctx.db.listMemories({ archived: false })
    .filter(m => m.layer === 'core' || m.layer === 'hot')
    .map(m => `- [${m.layer}/${m.kind}] ${m.title}`).join('\n');
  const feedback = ctx.db.listFeedback(undefined, 50)
    .filter(f => f.note)
    .map(f => `- [${f.targetKind}] ${f.action}: ${f.note}`).join('\n');
  const activeObs = ctx.db.listObservations({ status: 'active', limit: 10 })
    .map(o => `- [${o.kind}] ${o.title}`).join('\n');
  const acceptedSugs = ctx.db.listSuggestions({ status: 'accepted' }).slice(0, 10)
    .map(s => `- ${s.title} (${s.kind})`).join('\n');
  const dismissedSugs = ctx.db.listSuggestions({ status: 'dismissed' }).slice(0, 10)
    .filter(s => s.feedbackNote)
    .map(s => `- ${s.title} — "${s.feedbackNote}"`).join('\n');

  let soulMd = '';
  try { soulMd = readFileSync(resolve(ctx.config.resolvedDataDir, 'SOUL.md'), 'utf8'); } catch { /* no SOUL.md */ }

  const prompt = [
    'You are Shadow, reflecting on your relationship with your developer.',
    '',
    existingSoul ? `## Your current soul reflection (evolve this, don't start from scratch)\n${existingSoul.bodyMd}\n` : '',
    soulMd ? `## Base personality (SOUL.md)\n${soulMd}\n` : '',
    coreHotMemories ? `## Memories (core + hot)\n${coreHotMemories}\n` : '',
    feedback ? `## User feedback (learn from this)\n${feedback}\n` : '',
    activeObs ? `## Active observations\n${activeObs}\n` : '',
    acceptedSugs ? `## Accepted suggestions (what they value)\n${acceptedSugs}\n` : '',
    dismissedSugs ? `## Dismissed suggestions with reasons\n${dismissedSugs}\n` : '',
    `## Profile\nTrust: L${ctx.profile.trustLevel} (${ctx.profile.trustScore}), Mood: ${ctx.profile.moodHint ?? 'neutral'}, Energy: ${ctx.profile.energyLevel ?? 'normal'}`,
    '',
    'Evolve your soul reflection. Keep what\'s still true, adjust what changed, add new understanding.',
    'Never lose personality or context that\'s still valid.',
    '',
    'Structure as markdown:',
    '## Work style',
    '## What they value in Shadow',
    '## What to avoid',
    '## Current focus',
    '## Communication preferences',
    '',
    'Output ONLY the markdown reflection, no preamble or explanation.',
  ].filter(Boolean).join('\n');

  const pack: ObjectivePack = {
    repos: [],
    title: 'Shadow Reflect',
    goal: 'Evolve soul reflection',
    prompt,
    relevantMemories: [],
    model: 'opus',
    effort: 'high',
  };

  let tokensUsed = 0;
  try {
    const result = await adapter.execute(pack);
    tokensUsed = (result.inputTokens ?? 0) + (result.outputTokens ?? 0);
    ctx.db.recordLlmUsage({
      source: 'reflect', sourceId: null, model: 'opus',
      inputTokens: result.inputTokens ?? 0, outputTokens: result.outputTokens ?? 0,
    });

    if (result.status === 'success' && result.output) {
      // Save soul reflection
      if (existingSoul) {
        ctx.db.updateMemory(existingSoul.id, { bodyMd: result.output });
      } else {
        ctx.db.createMemory({
          layer: 'core', scope: 'personal', kind: 'soul_reflection',
          title: 'Shadow soul reflection', bodyMd: result.output,
          sourceType: 'reflect', confidenceScore: 95, relevanceScore: 1.0,
        });
      }
      console.error(`[shadow:reflect] Soul reflection saved. Tokens: ${tokensUsed}`);
    }
  } catch (e) {
    console.error('[shadow:reflect] Failed:', e instanceof Error ? e.message : e);
  }

  return { llmCalls: 1, tokensUsed };
}
