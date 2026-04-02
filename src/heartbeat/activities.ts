import { readFileSync, writeFileSync as fsWriteFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ShadowConfig } from '../config/load-config.js';
import type { ShadowDatabase } from '../storage/database.js';
import type { ObservationRecord, MemoryRecord } from '../storage/models.js';
import type { ObjectivePack } from '../backend/types.js';

import { observeAllRepos, collectAllRepoContexts, summarizeRepoContexts } from '../observation/watcher.js';
import { findRelevantMemories } from '../memory/retrieval.js';
import { maintainMemoryLayers } from '../memory/layers.js';
import { selectAdapter } from '../backend/index.js';
import { applyTrustDelta } from '../profile/trust.js';

import type { HeartbeatContext } from './state-machine.js';

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
      existingMemories ? `### Already Known (DO NOT duplicate)\n${existingMemories}\n` : '',
      'Respond with JSON only.',
    ].join('\n');

    const result = await adapter.execute({
      repos: [], title: 'Heartbeat Extract', goal: 'Extract knowledge + mood', prompt: extractPrompt,
      relevantMemories, model, effort,
    });
    llmCalls++;
    tokensUsed += (result.inputTokens ?? 0) + (result.outputTokens ?? 0);
    ctx.db.recordLlmUsage({ source: 'heartbeat_extract', sourceId: heartbeatId ?? null, model, inputTokens: result.inputTokens ?? 0, outputTokens: result.outputTokens ?? 0 });

    if (result.status === 'success' && result.output) {
      try {
        const parsed = JSON.parse(extractJson(result.output)) as {
          insights?: Array<{ kind?: string; title?: string; bodyMd?: string; confidence?: number; tags?: string[]; layer?: string; scope?: string }>;
          profileUpdates?: { moodHint?: string; energyLevel?: string };
        };
        console.error(`[shadow:extract] ${parsed.insights?.length ?? 0} insights, profile: ${JSON.stringify(parsed.profileUpdates ?? {})}`);

        if (parsed.profileUpdates) {
          const pu: Record<string, unknown> = {};
          if (parsed.profileUpdates.moodHint) pu.moodHint = parsed.profileUpdates.moodHint;
          if (parsed.profileUpdates.energyLevel) pu.energyLevel = parsed.profileUpdates.energyLevel;
          if (Object.keys(pu).length > 0) ctx.db.updateProfile(ctx.profile.id, pu);
        }
        for (const insight of parsed.insights ?? []) {
          if (!insight.title || !insight.bodyMd) continue;
          const layer = ['core', 'hot', 'warm'].includes(insight.layer ?? '') ? insight.layer! : 'hot';
          const scope = ['personal', 'repo', 'team', 'system', 'cross-repo'].includes(insight.scope ?? '') ? insight.scope! : 'personal';
          ctx.db.createMemory({
            repoId: repoIds.size === 1 ? [...repoIds][0] : null,
            layer, scope, kind: insight.kind ?? 'pattern', title: insight.title, bodyMd: insight.bodyMd,
            tags: insight.tags ?? [], sourceType: 'heartbeat', sourceId: heartbeatId ?? null,
            confidenceScore: insight.confidence ?? 60, relevanceScore: 0.6,
          });
          memoriesCreated++;
          if (insight.kind === 'pattern') patternsDetected++;
        }
      } catch (e) {
        console.error('[shadow:extract] Parse failed:', e instanceof Error ? e.message : e);
        console.error('[shadow:extract] Raw (500):', result.output.slice(0, 500));
      }
    }
  } catch (e) {
    console.error('[shadow:extract] LLM failed:', e instanceof Error ? e.message : e);
  }

  // ========== CALL 2: Observe (observations + auto-resolve) ==========
  try {
    const activeObservations = ctx.db.listObservations({ status: 'active', limit: 20 });
    const activeObsSummary = activeObservations.map(o => `- [${o.severity}/${o.kind}] ${o.title} (${o.votes}x)`).join('\n');
    const dismissFeedback = ctx.db.listSuggestions({ status: 'dismissed' }).slice(0, 10)
      .filter(s => s.feedbackNote).map(s => `- "${s.title}" — dismissed: ${s.feedbackNote}`).join('\n');

    const observePrompt = [
      'Generate ACTIONABLE OBSERVATIONS about the developer\'s work.',
      '',
      'Return JSON:',
      '{ "observations": [{ "kind": "improvement"|"risk"|"opportunity"|"pattern"|"infrastructure", "title": string, "detail": string, "severity": "info"|"warning"|"high", "files": string[] }],',
      '  "resolvedObservations": [{ "title": string, "reason": string }] }',
      '',
      'Only actionable insights. Not activity logs. Include up to 5 file paths per observation.',
      '',
      dataSources,
      activeObsSummary ? `### Active Observations (DO NOT recreate — resolve if no longer valid)\n${activeObsSummary}\n` : '',
      dismissFeedback ? `### User Feedback (learn from this)\n${dismissFeedback}\n` : '',
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
      try {
        const parsed = JSON.parse(extractJson(result.output)) as {
          observations?: Array<{ kind?: string; title?: string; detail?: string; severity?: string; files?: string[] }>;
          resolvedObservations?: Array<{ title?: string; reason?: string }>;
        };
        console.error(`[shadow:observe] ${parsed.observations?.length ?? 0} observations, ${parsed.resolvedObservations?.length ?? 0} resolved`);

        for (const obs of parsed.observations ?? []) {
          if (!obs.title) continue;
          const firstRepoId = repoIds.size > 0 ? [...repoIds][0] : (repoContexts.length > 0 ? repoContexts[0].repoId : null);
          if (!firstRepoId) continue;
          const repo = repoContexts.find((rc) => rc.repoId === firstRepoId);
          const context: Record<string, unknown> = {
            repoName: repo?.repoName ?? 'unknown', branch: repo?.currentBranch ?? 'unknown',
            files: Array.isArray(obs.files) ? obs.files.slice(0, 5) : [],
          };
          const sessionIds = [...new Set(recentConversations.map((c) => c.session).filter(Boolean))];
          if (sessionIds.length > 0) context.sessionIds = sessionIds;
          ctx.db.createObservation({
            repoId: firstRepoId, sourceKind: 'llm', sourceId: null,
            kind: obs.kind ?? 'pattern', severity: obs.severity ?? 'info',
            title: obs.title, detail: { description: obs.detail ?? '' }, context,
          });
          observationsCreated++;
        }

        for (const ro of parsed.resolvedObservations ?? []) {
          if (!ro.title) continue;
          const match = activeObservations.find(o => o.title === ro.title);
          if (match && match.status === 'active') {
            ctx.db.updateObservationStatus(match.id, 'resolved');
            console.error(`[shadow:observe] Auto-resolved: "${ro.title}" — ${ro.reason ?? 'no longer applies'}`);
          }
        }
      } catch (e) {
        console.error('[shadow:observe] Parse failed:', e instanceof Error ? e.message : e);
        console.error('[shadow:observe] Raw (500):', result.output.slice(0, 500));
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

/** Extract JSON from LLM output — handles markdown fences and preamble */
function extractJson(output: string): string {
  let s = output.trim();
  const fenceMatch = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
  if (!s.startsWith('{')) {
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start !== -1 && end !== -1) return s.slice(start, end + 1);
  }
  return s;
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
    '- Learn from dismissed suggestions — if the user gave feedback, respect it.',
    '',
    'Suggestion kinds: refactor, bug, improvement, feature.',
    `User profile: ${profileContext}`,
    '',
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
      try {
        // Extract JSON — LLM may wrap in markdown fences
        let jsonStr = result.output.trim();
        const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
          jsonStr = jsonMatch[1].trim();
        }
        if (!jsonStr.startsWith('{')) {
          const braceIdx = jsonStr.indexOf('{');
          const lastBrace = jsonStr.lastIndexOf('}');
          if (braceIdx !== -1 && lastBrace !== -1) {
            jsonStr = jsonStr.slice(braceIdx, lastBrace + 1);
          }
        }

        const parsed = JSON.parse(jsonStr) as {
          suggestions?: Array<{
            kind?: string;
            title?: string;
            summaryMd?: string;
            reasoningMd?: string;
            impactScore?: number;
            confidenceScore?: number;
            riskScore?: number;
            repoId?: string | null;
          }>;
        };

        console.error(`[shadow:suggest] Parsed ${parsed.suggestions?.length ?? 0} suggestions`);

        if (parsed.suggestions && Array.isArray(parsed.suggestions)) {
          // Dedup: skip suggestions that already exist as pending with same kind+title
          const existingPending = ctx.db.listSuggestions({ status: 'pending' });
          const existingKeys = new Set(existingPending.map((s) => `${s.kind}:${s.title}`));

          for (const sug of parsed.suggestions) {
            if (!sug.title || !sug.summaryMd) continue;
            const key = `${sug.kind ?? 'improvement'}:${sug.title}`;
            if (existingKeys.has(key)) continue;
            existingKeys.add(key);

            ctx.db.createSuggestion({
              repoId: sug.repoId ?? (repoIds.length === 1 ? repoIds[0] : null),
              repoIds,
              sourceObservationId: observations[0]?.id ?? null,
              kind: sug.kind ?? 'improvement',
              title: sug.title,
              summaryMd: sug.summaryMd,
              reasoningMd: sug.reasoningMd ?? null,
              impactScore: sug.impactScore ?? 3,
              confidenceScore: sug.confidenceScore ?? 70,
              riskScore: sug.riskScore ?? 2,
              requiredTrustLevel: ctx.profile.trustLevel,
            });
            suggestionsCreated++;
          }
        }
      } catch (parseErr) {
        console.error('[shadow:suggest] Failed to parse LLM output:', parseErr instanceof Error ? parseErr.message : parseErr);
        console.error('[shadow:suggest] Raw output (first 500 chars):', result.output.slice(0, 500));
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
