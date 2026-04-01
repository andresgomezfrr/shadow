import { readFileSync, writeFileSync as fsWriteFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ShadowConfig } from '../config/load-config.js';
import type { ShadowDatabase } from '../storage/database.js';
import type { ObservationRecord, MemoryRecord } from '../storage/models.js';
import type { ObjectivePack } from '../backend/types.js';

import { observeAllRepos } from '../observation/watcher.js';
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

export async function activityAnalyze(
  ctx: HeartbeatContext,
  observations: ObservationRecord[],
): Promise<{ patternsDetected: number; memoriesCreated: number; llmCalls: number; tokensUsed: number }> {
  // Load recent interactions from Claude CLI sessions
  // Use a wider window (2h) to capture enough context, not just since last heartbeat
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const recentInteractions = loadRecentInteractions(ctx.config, twoHoursAgo);
  const interactionSummary = summarizeInteractions(recentInteractions);

  // Load recent conversations (what was actually discussed)
  const recentConversations = loadRecentConversations(ctx.config, twoHoursAgo);
  const conversationSummary = summarizeConversations(recentConversations);

  if (observations.length === 0 && recentInteractions.length === 0 && recentConversations.length === 0) {
    return { patternsDetected: 0, memoriesCreated: 0, llmCalls: 0, tokensUsed: 0 };
  }

  // Gather file paths and topics from observations for memory retrieval
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

  // Also extract file paths from interactions
  for (const i of recentInteractions) {
    if (i.file) filePaths.push(i.file);
  }

  // Get relevant memories for context
  const relevantMemories = findRelevantMemories(ctx.db, {
    filePaths: [...new Set(filePaths)].slice(0, 20),
    topics: [...new Set(topics)],
    repoId: repoIds.size === 1 ? [...repoIds][0] : undefined,
  });

  // Build the analysis prompt
  const observationSummaries = observations.length > 0
    ? observations.map((obs) =>
        `- [${obs.severity}] ${obs.kind}: ${obs.title} (repo: ${obs.repoId})`,
      ).join('\n')
    : 'No new git observations.';

  const memorySummaries = relevantMemories.map((mem) =>
    `- [${mem.layer}/${mem.kind}] ${mem.title}: ${mem.bodyMd.slice(0, 200)}`,
  ).join('\n');

  // Include ALL existing hot+core memories for dedup
  const allHotCore = ctx.db.listMemories({ archived: false });
  const existingMemories = allHotCore
    .filter(m => m.layer === 'core' || m.layer === 'hot')
    .map(m => `- [${m.layer}] ${m.title}`)
    .join('\n');

  const prompt = [
    'You are Shadow, extracting DURABLE KNOWLEDGE from engineering sessions.',
    '',
    'ONLY create memories that would be useful if the developer opened a completely',
    'different project tomorrow. Ask yourself: "would I want to know this in 3 months?"',
    '',
    'Return JSON with two fields:',
    '{ "insights": [{ "kind": string, "title": string, "bodyMd": string, "confidence": number, "tags": string[], "layer": "hot"|"core", "scope": "personal"|"repo"|"cross-repo" }],',
    '  "profileUpdates": { "moodHint": "neutral"|"happy"|"focused"|"tired"|"frustrated"|"excited"|"concerned", "energyLevel": "low"|"normal"|"high" } }',
    '',
    'For profileUpdates, infer from the conversations and activity:',
    '- moodHint: "frustrated" if user complains about bugs/issues, "excited" if celebrating wins, "focused" if deep in implementation, "tired" if working late or short messages, "happy" if positive tone, "concerned" if discussing risks/problems, "neutral" if unclear',
    '- energyLevel: "high" if lots of activity and engagement, "low" if sparse or late-night work, "normal" otherwise',
    '- Always include profileUpdates even if mood/energy seem neutral',
    '',
    'GOOD memories (CREATE THESE):',
    '- "Shadow uses SQLite with WAL mode + busy_timeout=5000 for concurrent access" (tech_stack)',
    '- "FTS5 content-sync tables: use bm25() on alias, not table name" (problem_solved)',
    '- "User prefers Spanish for conversation, English for code" (preference)',
    '- "Deploy goes through ArgoCD, main branch auto-deploys to staging" (team_knowledge)',
    '- "Auth tokens stored in httpOnly cookies, refreshed via /api/refresh" (design_decision)',
    '',
    'BAD memories (NEVER CREATE):',
    '- Session descriptions: "5 tool calls", "light session", "largest session yet"',
    '- Tool usage stats: "high Edit:Read ratio", "Grep usage declining"',
    '- Obvious facts: "cli.ts is the main file", "working on shadow repo"',
    '- Activity logs: "edited 3 files", "ran npm build"',
    '- Ephemeral state: "file remains uncommitted", "focused on X this session"',
    '',
    'Kinds: tech_stack, design_decision, workflow, problem_solved, team_knowledge, preference',
    'Layer "core" = permanent truths. "hot" = currently relevant but may change.',
    'Confidence: 90+ for explicit facts, 70-89 for strong inferences.',
    'Return 1-3 insights. Always try to find at least 1 useful thing to remember.',
    'If you see files being edited, infer what the project does and what tech stack it uses.',
    'If you see commands being run, infer the developer\'s workflow and preferences.',
    '',
    '## Data Sources',
    observations.length > 0 ? `### Git Observations\n${observationSummaries}\n` : '',
    interactionSummary ? `### Tool Usage (files edited, commands run)\n${interactionSummary}\n` : '',
    conversationSummary ? `### Conversations (what was actually discussed)\n${conversationSummary}\n` : '',
    existingMemories ? `### Already Known (DO NOT duplicate)\n${existingMemories}\n` : '',
    '',
    'IMPORTANT: Conversations are the richest source. From them extract:',
    '- What projects/features the user is working on',
    '- Design decisions discussed ("lets use React for the dashboard")',
    '- User preferences and feedback ("the memories are too granular")',
    '- Goals and intent ("I want Shadow to be a full companion")',
    '- Problems discussed and solutions found',
    '',
    'Respond with JSON only.',
  ].join('\n');

  const pack: ObjectivePack = {
    repos: [],
    title: 'Heartbeat Analysis',
    goal: 'Analyze recent observations for patterns and insights',
    prompt,
    relevantMemories,
    model: getModel(ctx, 'analyze'),
  };

  // Placeholder: log what would be sent and simulate a response
  // In production, this would call: const result = await selectAdapter(ctx.config).execute(pack);
  let llmCalls = 0;
  let tokensUsed = 0;
  let patternsDetected = 0;
  let memoriesCreated = 0;

  try {
    const adapter = selectAdapter(ctx.config);
    const result = await adapter.execute(pack);
    llmCalls = 1;
    tokensUsed = (result.inputTokens ?? 0) + (result.outputTokens ?? 0);

    // Record token usage
    ctx.db.recordLlmUsage({
      source: 'heartbeat_analyze',
      sourceId: null,
      model: getModel(ctx, 'analyze'),
      inputTokens: result.inputTokens ?? 0,
      outputTokens: result.outputTokens ?? 0,
    });

    // Parse insights from LLM response
    if (result.status === 'success' && result.output) {
      try {
        // Extract JSON from output — Claude CLI may wrap it in markdown fences
        let jsonStr = result.output.trim();
        const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
          jsonStr = jsonMatch[1].trim();
        }
        // Also try to find raw JSON object
        if (!jsonStr.startsWith('{')) {
          const braceIdx = jsonStr.indexOf('{');
          const lastBrace = jsonStr.lastIndexOf('}');
          if (braceIdx !== -1 && lastBrace !== -1) {
            jsonStr = jsonStr.slice(braceIdx, lastBrace + 1);
          }
        }

        const parsed = JSON.parse(jsonStr) as {
          insights?: Array<{
            kind?: string;
            title?: string;
            bodyMd?: string;
            confidence?: number;
            tags?: string[];
            layer?: string;
            scope?: string;
          }>;
          profileUpdates?: {
            moodHint?: string;
            energyLevel?: string;
          };
        };

        console.error(`[shadow:analyze] Parsed ${parsed.insights?.length ?? 0} insights, profileUpdates: ${JSON.stringify(parsed.profileUpdates ?? {})}`);

        // Apply profile updates (mood, energy)
        if (parsed.profileUpdates) {
          const pu: Record<string, unknown> = {};
          if (parsed.profileUpdates.moodHint) pu.moodHint = parsed.profileUpdates.moodHint;
          if (parsed.profileUpdates.energyLevel) pu.energyLevel = parsed.profileUpdates.energyLevel;
          if (Object.keys(pu).length > 0) {
            ctx.db.updateProfile(ctx.profile.id, pu);
            console.error(`[shadow:analyze] Updated profile: ${JSON.stringify(pu)}`);
          }
        }
        if (parsed.insights && Array.isArray(parsed.insights)) {
          for (const insight of parsed.insights) {
            if (!insight.title || !insight.bodyMd) continue;

            const layer = ['core', 'hot', 'warm'].includes(insight.layer ?? '') ? insight.layer! : 'hot';
            const scope = ['personal', 'repo', 'team', 'system', 'cross-repo'].includes(insight.scope ?? '') ? insight.scope! : 'personal';

            ctx.db.createMemory({
              repoId: repoIds.size === 1 ? [...repoIds][0] : null,
              layer,
              scope,
              kind: insight.kind ?? 'pattern',
              title: insight.title,
              bodyMd: insight.bodyMd,
              tags: insight.tags ?? [],
              sourceType: 'heartbeat',
              confidenceScore: insight.confidence ?? 60,
              relevanceScore: 0.6,
            });
            memoriesCreated++;
            if (insight.kind === 'pattern') patternsDetected++;
          }
        }
      } catch (parseErr) {
        // Log parse failures so we can debug
        console.error('[shadow:analyze] Failed to parse LLM output:', parseErr instanceof Error ? parseErr.message : parseErr);
        console.error('[shadow:analyze] Raw output (first 500 chars):', result.output.slice(0, 500));
      }
    }
  } catch (llmErr) {
    // Log LLM failures
    console.error('[shadow:analyze] LLM call failed:', llmErr instanceof Error ? llmErr.message : llmErr);
  }

  // Mark all observations as processed
  for (const obs of observations) {
    ctx.db.markObservationProcessed(obs.id);
  }

  // Trust: heartbeat completion + interaction logging
  if (llmCalls > 0) {
    try { applyTrustDelta(ctx.db, 'heartbeat_completed'); } catch { /* ignore */ }
  }
  if (recentInteractions.length >= 10) {
    try { applyTrustDelta(ctx.db, 'interaction_logged'); } catch { /* ignore */ }
  }

  // Rotate logs after processing
  rotateInteractionsLog(ctx.config, new Date().toISOString());
  rotateConversationsLog(ctx.config);

  return { patternsDetected, memoriesCreated, llmCalls, tokensUsed };
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

  const prompt = [
    'Based on the following observations and context, propose actionable suggestions.',
    'Suggestion kinds: refactor, bug, improvement, feature, docs.',
    `User profile: ${profileContext}`,
    '',
    'Return structured JSON:',
    '{ "suggestions": [{ "kind": string, "title": string, "summaryMd": string, "reasoningMd": string, "impactScore": 1-5, "confidenceScore": 0-100, "riskScore": 1-5, "repoId": string|null }] }',
    '',
    '## Recent Observations',
    observationSummaries,
    '',
    relevantMemories.length > 0 ? `## Relevant Memories\n${memorySummaries}\n` : '',
    'Respond with JSON only.',
  ].join('\n');

  const pack: ObjectivePack = {
    repos: [],
    title: 'Heartbeat Suggestions',
    goal: 'Propose actionable suggestions based on observations',
    prompt,
    relevantMemories,
    model: getModel(ctx, 'suggest'),
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
        const parsed = JSON.parse(result.output) as {
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

        if (parsed.suggestions && Array.isArray(parsed.suggestions)) {
          for (const sug of parsed.suggestions) {
            if (!sug.title || !sug.summaryMd) continue;

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
      } catch {
        // Failed to parse LLM output — not fatal
      }
    }
  } catch {
    // LLM call failed — continue without suggestions
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

  // Check for high-severity observations that should trigger immediate notifications
  const recentObservations = ctx.db.listObservations({ processed: false, limit: 50 });
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
