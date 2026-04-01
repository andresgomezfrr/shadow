import type { ShadowDatabase } from '../storage/database.js';
import type { ObservationRecord, MemoryRecord } from '../storage/models.js';
import type { ObjectivePack } from '../backend/types.js';

import { observeAllRepos } from '../observation/watcher.js';
import { findRelevantMemories } from '../memory/retrieval.js';
import { maintainMemoryLayers } from '../memory/layers.js';
import { selectAdapter } from '../backend/index.js';

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

export async function activityAnalyze(
  ctx: HeartbeatContext,
  observations: ObservationRecord[],
): Promise<{ patternsDetected: number; memoriesCreated: number; llmCalls: number; tokensUsed: number }> {
  if (observations.length === 0) {
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

  // Get relevant memories for context
  const relevantMemories = findRelevantMemories(ctx.db, {
    filePaths,
    topics: [...new Set(topics)],
    repoId: repoIds.size === 1 ? [...repoIds][0] : undefined,
  });

  // Build the analysis prompt
  const observationSummaries = observations.map((obs) =>
    `- [${obs.severity}] ${obs.kind}: ${obs.title} (repo: ${obs.repoId})`,
  ).join('\n');

  const memorySummaries = relevantMemories.map((mem) =>
    `- [${mem.layer}/${mem.kind}] ${mem.title}: ${mem.bodyMd.slice(0, 200)}`,
  ).join('\n');

  const prompt = [
    'Analyze the following observations from the developer\'s repositories.',
    'Identify patterns, potential issues, and insights. Return structured JSON with:',
    '{ "insights": [{ "kind": string, "title": string, "bodyMd": string, "confidence": number, "tags": string[] }] }',
    '',
    '## Recent Observations',
    observationSummaries,
    '',
    relevantMemories.length > 0 ? `## Relevant Memories\n${memorySummaries}\n` : '',
    'Respond with JSON only.',
  ].join('\n');

  const pack: ObjectivePack = {
    repos: [],
    title: 'Heartbeat Analysis',
    goal: 'Analyze recent observations for patterns and insights',
    prompt,
    relevantMemories,
    model: ctx.config.models.analyze,
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
      model: ctx.config.models.analyze,
      inputTokens: result.inputTokens ?? 0,
      outputTokens: result.outputTokens ?? 0,
    });

    // Parse insights from LLM response
    if (result.status === 'success' && result.output) {
      try {
        const parsed = JSON.parse(result.output) as {
          insights?: Array<{
            kind?: string;
            title?: string;
            bodyMd?: string;
            confidence?: number;
            tags?: string[];
          }>;
        };

        if (parsed.insights && Array.isArray(parsed.insights)) {
          for (const insight of parsed.insights) {
            if (!insight.title || !insight.bodyMd) continue;

            ctx.db.createMemory({
              repoId: repoIds.size === 1 ? [...repoIds][0] : null,
              layer: 'warm',
              scope: 'repo',
              kind: insight.kind ?? 'pattern',
              title: insight.title,
              bodyMd: insight.bodyMd,
              tags: insight.tags ?? [],
              sourceType: 'analyze',
              confidenceScore: insight.confidence ?? 60,
              relevanceScore: 0.5,
            });
            memoriesCreated++;
            if (insight.kind === 'pattern') patternsDetected++;
          }
        }
      } catch {
        // Failed to parse LLM output — not fatal
      }
    }
  } catch {
    // LLM call failed — continue without analysis
    // This is expected during early development / when backend is not configured
  }

  // Mark all observations as processed
  for (const obs of observations) {
    ctx.db.markObservationProcessed(obs.id);
  }

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
    model: ctx.config.models.suggest,
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
      model: ctx.config.models.suggest,
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
      model: ctx.config.models.consolidate,
    };

    try {
      const adapter = selectAdapter(ctx.config);
      const result = await adapter.execute(pack);
      llmCalls = 1;
      tokensUsed = (result.inputTokens ?? 0) + (result.outputTokens ?? 0);

      ctx.db.recordLlmUsage({
        source: 'heartbeat_consolidate',
        sourceId: null,
        model: ctx.config.models.consolidate,
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
