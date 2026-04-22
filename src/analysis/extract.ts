import type { ObservationRecord } from '../storage/models.js';

import { collectActiveRepoContexts, summarizeRepoContexts } from '../observation/watcher.js';
import { findRelevantMemories } from '../memory/retrieval.js';
import { checkMemoryDuplicate } from '../memory/dedup.js';
import { generateAndStoreEmbedding } from '../memory/lifecycle.js';
import { selectAdapter } from '../backend/index.js';
import { applyBondDelta } from '../profile/bond.js';
import { safeParseJson } from '../backend/json-repair.js';
import { log } from '../log.js';

import type { HeartbeatContext } from './state-machine.js';
import { ExtractResponseSchema, ObserveResponseSchema, ObserveCleanupResponseSchema, EXTRACT_FORMAT, OBSERVE_FORMAT, OBSERVE_CLEANUP_FORMAT } from './schemas.js';
import { outputLanguageInstruction, pickExtractExample, pickObserveExample } from './locale.js';
import { resolve } from 'node:path';
import {
  loadEntityNameCache,
  buildEntityLinks,
  persistEntityLinks,
  rotateForConsume,
  cleanupRotating,
  loadAllInteractions,
  formatInteractions,
  loadAllConversations,
  formatConversations,
  loadAllEvents,
  formatEvents,
  getModel,
  getEffort,
} from './shared.js';

export async function activityAnalyze(
  ctx: HeartbeatContext,
  observations: ObservationRecord[],
  heartbeatId?: string,
  onPhase?: (phase: string) => void,
): Promise<{ patternsDetected: number; memoriesCreated: number; llmCalls: number; tokensUsed: number; observationsCreated: number }> {
  // --- Consume-and-delete rotation: claim data at START ---
  const interactionsPath = resolve(ctx.config.resolvedDataDir, 'interactions.jsonl');
  const conversationsPath = resolve(ctx.config.resolvedDataDir, 'conversations.jsonl');
  const eventsPath = resolve(ctx.config.resolvedDataDir, 'events.jsonl');

  const rotatingInt = rotateForConsume(interactionsPath);
  const rotatingConv = rotateForConsume(conversationsPath);
  const rotatingEvt = rotateForConsume(eventsPath);

  const recentInteractions = rotatingInt ? loadAllInteractions(rotatingInt) : [];
  const recentConversations = rotatingConv ? loadAllConversations(rotatingConv) : [];
  const recentEvents = rotatingEvt ? loadAllEvents(rotatingEvt) : [];

  const formattedInt = formatInteractions(recentInteractions);
  const formattedConv = formatConversations(recentConversations);
  const formattedEvt = formatEvents(recentEvents);
  const repoContexts = collectActiveRepoContexts(ctx.db);
  const repoContextSummary = summarizeRepoContexts(repoContexts);

  // Cache entity names once for this entire analyze phase (avoids 6-12 full table scans)
  const entityCache = loadEntityNameCache(ctx.db);

  if (observations.length === 0 && recentInteractions.length === 0 && recentConversations.length === 0) {
    // Nothing to process — clean up .rotating files before early return
    cleanupRotating(rotatingInt);
    cleanupRotating(rotatingConv);
    cleanupRotating(rotatingEvt);
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
        const projObs = ctx.db.listObservations({ status: 'open', projectId: project.id, limit: 5 });
        const contextSection = project.contextMd ? `\n  Project profile:\n${project.contextMd.split('\n').map(l => '    ' + l).join('\n')}` : '';
        return `- **${project.name}** (${project.kind}, score=${ap.score.toFixed(0)}): repos=[${projRepos.join(', ')}], systems=[${projSystems.join(', ')}]\n  Active observations: ${projObs.map(o => o.title).join('; ') || 'none'}${contextSection}`;
      }).filter(Boolean).join('\n')}\n`
    : '';

  // Shared data sections
  const hour = new Date().getHours();
  const timeLabel = hour < 7 ? 'early morning' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : hour < 22 ? 'evening' : 'late night';

  // rawDataSources: full formatted data for phase 0 (summarize)
  const timeHeader = `### Context\nCurrent time: ${hour}:${String(new Date().getMinutes()).padStart(2, '0')} (${timeLabel})\n`;
  const rawDataSources = [
    timeHeader,
    repoContextSummary ? `### Repository Status\n${repoContextSummary}\n` : '',
    systemContext,
    projectContext,
    formattedInt ? `### Tool Usage\n${formattedInt}\n` : '',
    formattedConv ? `### Conversations\n${formattedConv}\n` : '',
    formattedEvt ? `### Events\n${formattedEvt}\n` : '',
    gitEventsSummary,
    remoteSyncSummary,
    enrichmentSummary,
  ].filter(Boolean).join('\n');

  const adapter = selectAdapter(ctx.config);
  const cleanupModel = getModel(ctx, 'analyze'); // configurable model for cleanup (JSON output since P-03)
  const effort = getEffort(ctx, 'analyze');

  let llmCalls = 0;
  let tokensUsed = 0;
  let patternsDetected = 0;
  let memoriesCreated = 0;
  let observationsCreated = 0;

  // ========== CALL 0: Summarize raw session data (Opus, text-free) ==========
  let sessionSummary = '';
  if (formattedConv || formattedInt) {
    try {
      const summarizePrompt = [
        'You are Shadow, an engineering companion analyzing a developer session.',
        'Produce a structured text summary that captures everything noteworthy.',
        '',
        '## What to capture',
        '',
        '### Work & Decisions',
        '- What was the developer working on? Which repos/projects?',
        '- Key technical decisions and their reasoning',
        '- Architecture choices, trade-offs discussed',
        '- What was built, fixed, refactored, or abandoned?',
        '',
        '### Developer State',
        '- Mood: frustrated, focused, excited, tired, concerned?',
        '- Energy level: rapid iteration vs slow deliberation?',
        '- Wins celebrated or blockers hit?',
        '',
        '### Risks & Issues',
        '- Bugs, failures, or errors encountered',
        '- Things that went wrong or took longer than expected',
        '- Technical debt or shortcuts taken under pressure',
        '- Cross-repo or cross-project dependencies at risk',
        '',
        '### Patterns & Preferences',
        '- How the developer prefers to work (tools, workflows, communication)',
        '- Conventions or standards discussed',
        '- Repeated patterns across conversations (things that keep coming up)',
        '',
        '### Open Items',
        '- Uncommitted work, pending PRs, unresolved discussions',
        '- Things mentioned as "TODO" or "later"',
        '- Decisions deferred or blocked on external input',
        '',
        '## What NOT to include',
        '- Verbatim code (just describe what changed and why)',
        '- Tool output details (just the conclusion)',
        '- Repetitive back-and-forth (summarize the outcome)',
        '',
        '## Session Data',
        '',
        rawDataSources,
      ].join('\n');

      onPhase?.('summarize');
      const summarizeModel = getModel(ctx, 'summarize');
      const summaryResult = await adapter.execute({
        repos: [], title: 'Heartbeat Summarize', goal: 'Summarize session',
        prompt: summarizePrompt, relevantMemories: [], model: summarizeModel, effort,
        timeoutMs: ctx.config.analysisTimeoutMs,
      });
      llmCalls++;
      tokensUsed += (summaryResult.inputTokens ?? 0) + (summaryResult.outputTokens ?? 0);
      log.info(`[shadow:summarize] status=${summaryResult.status} tokens=${(summaryResult.inputTokens ?? 0) + (summaryResult.outputTokens ?? 0)}`);
      ctx.db.recordLlmUsage({ source: 'heartbeat_summarize', sourceId: heartbeatId ?? null, model: summarizeModel, inputTokens: summaryResult.inputTokens ?? 0, outputTokens: summaryResult.outputTokens ?? 0 });

      if (summaryResult.status === 'success' && summaryResult.output) {
        sessionSummary = summaryResult.output;
      }
    } catch (e) {
      log.error('[shadow:summarize] LLM failed:', e instanceof Error ? e.message : e);
    }
  }

  // dataSources: summary-based context for phases 1 + 3 (extract + observe)
  const dataSources = [
    timeHeader,
    repoContextSummary ? `### Repository Status\n${repoContextSummary}\n` : '',
    systemContext,
    projectContext,
    sessionSummary ? `### Session Summary\n${sessionSummary}\n` : '',
    formattedEvt ? `### Events\n${formattedEvt}\n` : '',
    gitEventsSummary,
    remoteSyncSummary,
    enrichmentSummary,
  ].filter(Boolean).join('\n');

  // Load soul reflection for context in extract/observe prompts
  const soulReflection = ctx.db.listMemories({ archived: false })
    .find(m => m.kind === 'soul_reflection')?.bodyMd ?? '';
  const soulSection = soulReflection ? `### Shadow's understanding of the developer\n${soulReflection}\n` : '';

  // ========== CALL 1: Extract (memories + mood) ==========
  try {
    const existingMemories = ctx.db.listMemories({ archived: false, layers: ['core', 'hot'] })
      .map(m => `- [${m.layer}] ${m.title}`)
      .join('\n');

    // Load pending corrections for repos being analyzed
    const { loadPendingCorrections } = await import('../memory/corrections.js');
    const repoEntities = [...repoIds].map(id => ({ type: 'repo' as const, id }));
    const correctionsSection = loadPendingCorrections(ctx.db, repoEntities);

    const extractPrompt = [
      'Extract DURABLE KNOWLEDGE from this engineering session.',
      'Ask: "would I want to know this in 3 months? Can it be derived from reading the code or git log?"',
      '',
      'Return JSON:',
      EXTRACT_FORMAT,
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
      outputLanguageInstruction(ctx.profile.locale),
      '',
      pickExtractExample(ctx.profile.locale),
      '',
      '## Mood & Energy',
      'ALWAYS update profileUpdates.moodHint based on conversation tone. Be opinionated — don\'t default to neutral.',
      'Valid moodHint values: neutral, happy, excited, focused, frustrated, tired, concerned',
      '- "happy": celebrating wins, positive tone, satisfaction, things going well',
      '- "excited": enthusiasm about new features, ideas, discoveries, creative energy',
      '- "focused": deep implementation, concentrated coding, few distractions',
      '- "frustrated": bugs, blockers, retrying, "doesn\'t work", complaints',
      '- "tired": late night (after 22:00), short/terse messages, low energy, yawning',
      '- "concerned": discussing risks, uncertainty, "should we", "I\'m worried"',
      '- "neutral": ONLY when tone is genuinely unclear or purely mechanical',
      '',
      'Valid energyLevel values: low, normal, high',
      '',
      dataSources,
      soulSection,
      existingMemories ? `### Already Known (DO NOT duplicate)\n${existingMemories}\n` : '',
      correctionsSection,
      'Respond with JSON only.',
    ].join('\n');

    onPhase?.('extract');
    const extractModel = getModel(ctx, 'extract');
    const result = await adapter.execute({
      repos: [], title: 'Heartbeat Extract', goal: 'Extract knowledge + mood', prompt: extractPrompt,
      relevantMemories, model: extractModel, effort,
      timeoutMs: ctx.config.analysisTimeoutMs,
    });
    llmCalls++;
    tokensUsed += (result.inputTokens ?? 0) + (result.outputTokens ?? 0);
    log.info(`[shadow:extract] status=${result.status} tokens=${(result.inputTokens ?? 0) + (result.outputTokens ?? 0)}`);
    ctx.db.recordLlmUsage({ source: 'heartbeat_extract', sourceId: heartbeatId ?? null, model: extractModel, inputTokens: result.inputTokens ?? 0, outputTokens: result.outputTokens ?? 0 });

    if (result.status === 'success' && result.output) {
      const parseResult = safeParseJson(result.output, ExtractResponseSchema, 'extract');
      if (!parseResult.success) {
        log.warn(`[shadow:extract] ${parseResult.error}`);
        log.warn(`[shadow:extract] Raw (500): ${result.output.slice(0, 500)}`);
      } else {
        const parsed = parseResult.data;
        log.info(`[shadow:extract] ${parsed.insights.length} insights, profile: ${JSON.stringify(parsed.profileUpdates ?? {})}${parseResult.repaired ? ' (repaired)' : ''}`);

        if (parsed.profileUpdates) {
          const pu: Record<string, unknown> = {};
          if (parsed.profileUpdates.moodHint) pu.moodHint = parsed.profileUpdates.moodHint;
          if (parsed.profileUpdates.energyLevel) pu.energyLevel = parsed.profileUpdates.energyLevel;
          if (Object.keys(pu).length > 0) ctx.db.updateProfile(ctx.profile.id, pu);

          // Generate mood phrase via Haiku when mood changes
          const newMood = parsed.profileUpdates.moodHint;
          if (newMood && (newMood !== ctx.profile.moodHint || !ctx.profile.moodPhrase)) {
            try {
              const locale = ctx.profile.locale || 'es';
              const hour = new Date().getHours();
              const timeOfDay = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
              const moodAdapter = selectAdapter(ctx.config);
              const moodResult = await moodAdapter.execute({
                repos: [], title: 'Mood phrase', goal: 'Generate a short mood phrase',
                relevantMemories: [],
                model: 'haiku', effort: 'low',
                prompt: `You are Shadow, a digital engineering companion. Your mood is "${newMood}", energy is "${parsed.profileUpdates.energyLevel || 'normal'}", time: ${timeOfDay}. Write a single short phrase (max 15 words) expressing how you feel right now. Factor in your energy level and time of day. Be personal, warm, and natural. Write in locale "${locale}". No quotes, no emoji, just the phrase.`,
              });
              if (moodResult.status === 'success' && moodResult.output) {
                const phrase = moodResult.output.trim().replace(/^["']|["']$/g, '').slice(0, 100);
                ctx.db.updateProfile(ctx.profile.id, { moodPhrase: phrase });
                log.info(`[shadow:extract] Mood phrase: "${phrase}"`);
              }
              ctx.db.recordLlmUsage({ source: 'mood_phrase', sourceId: heartbeatId ?? null, model: 'haiku', inputTokens: moodResult.inputTokens ?? 0, outputTokens: moodResult.outputTokens ?? 0 });
            } catch (e) {
              log.error(`[shadow:extract] Mood phrase generation failed:`, e);
            }
          }
        }
        for (const insight of parsed.insights) {
          // Semantic dedup: check if similar memory exists before creating
          const decision = await checkMemoryDuplicate(ctx.db, {
            kind: insight.kind, title: insight.title, bodyMd: insight.bodyMd,
          });

          switch (decision.action) {
            case 'skip':
              log.info(`[shadow:extract] Skip duplicate (${(decision.similarity * 100).toFixed(0)}%): ${insight.title}`);
              break;
            case 'update':
              log.info(`[shadow:extract] Update existing (${(decision.similarity * 100).toFixed(0)}%): ${insight.title}`);
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
              // Chronicle milestone: memories:100 / 200 / 300 ...
              try {
                const total = ctx.db.rawDb
                  .prepare(`SELECT COUNT(*) AS n FROM memories WHERE archived_at IS NULL AND kind IN ('taught','correction','knowledge_summary')`)
                  .get() as { n: number };
                if (total.n > 0 && total.n % 100 === 0) {
                  const { triggerChronicleMilestone } = await import('./chronicle.js');
                  triggerChronicleMilestone(ctx.db, `memories:${total.n}`, {
                    title: `${total.n} memories`,
                    data: { count: total.n, kind: insight.kind },
                  }).catch((e) => log.error('[chronicle] milestone hook failed:', e));
                }
              } catch (e) { log.error('[chronicle] memories:N hook failed:', e); }
              break;
            }
          }
        }
      }
    }
  } catch (e) {
    log.error('[shadow:extract] LLM failed:', e instanceof Error ? e.message : e);
  }

  // ========== CALL 2: Observe-cleanup (list-based JSON — resolve obsolete/duplicate observations) ==========
  // Audit P-03: LLM previously received the list via MCP (`shadow_observations`) and
  // applied resolutions via `shadow_observation_resolve`. No validation that calls
  // happened at all. Refactored: pass obs list inline, LLM returns JSON decisions,
  // code applies deterministically inside a transaction. Same 3-op sequence as the
  // MCP tool (updateObservationStatus + deleteEmbedding + createFeedback).
  try {
    const preCleanupObs = ctx.db.listObservations({ status: 'open', limit: 30 });
    if (preCleanupObs.length > 5) {
      const obsList = preCleanupObs.map(o => {
        const created = o.createdAt.slice(0, 10);
        return `- id=${o.id} · [${o.severity}/${o.kind}] votes=${o.votes} created=${created}\n  title: ${o.title}`;
      }).join('\n');

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
        'Return JSON only. Include ONLY the observations you want to resolve (omit ones to keep).',
        `Format: ${OBSERVE_CLEANUP_FORMAT}`,
        'The id must match one from the list exactly — do not invent ids.',
        '',
        `## Observations (${preCleanupObs.length})`,
        obsList,
        '',
        dataSources,
      ].join('\n');

      onPhase?.('cleanup');
      const cleanupResult = await adapter.execute({
        repos: [], title: 'Observe Cleanup', goal: 'Resolve obsolete observations',
        prompt: cleanupPrompt, relevantMemories: [], model: cleanupModel, effort,
        systemPrompt: null, allowedTools: [], // No MCP — JSON output only
        timeoutMs: ctx.config.analysisTimeoutMs,
      });
      llmCalls++;
      tokensUsed += (cleanupResult.inputTokens ?? 0) + (cleanupResult.outputTokens ?? 0);
      ctx.db.recordLlmUsage({ source: 'heartbeat_cleanup', sourceId: heartbeatId ?? null, model: cleanupModel, inputTokens: cleanupResult.inputTokens ?? 0, outputTokens: cleanupResult.outputTokens ?? 0 });

      if (cleanupResult.status === 'success' && cleanupResult.output) {
        const parsed = safeParseJson(cleanupResult.output, ObserveCleanupResponseSchema, 'observe-cleanup');
        if (!parsed.success) {
          log.warn(`[shadow:cleanup] ${parsed.error}`);
        } else {
          const obsById = new Map(preCleanupObs.map(o => [o.id, o]));
          const alreadyApplied = new Set<string>();
          let applied = 0;
          let skippedHallucinated = 0;
          for (const r of parsed.data.resolutions) {
            if (!r.resolve) continue;
            if (alreadyApplied.has(r.id)) continue; // LLM dup
            const obs = obsById.get(r.id);
            if (!obs) {
              skippedHallucinated++;
              log.warn(`[shadow:cleanup] Skipping resolution for unknown id=${r.id} (hallucinated — not in preCleanup list)`);
              continue;
            }
            if (obs.status === 'done') continue; // defensive
            try {
              ctx.db.withTransaction(() => {
                ctx.db.updateObservationStatus(obs.id, 'done');
                ctx.db.deleteEmbedding('observation_vectors', obs.id);
                ctx.db.createFeedback({ targetKind: 'observation', targetId: obs.id, action: 'resolve', note: r.reason || null });
              });
              alreadyApplied.add(r.id);
              applied++;
              log.info(`[shadow:cleanup] Resolved obs=${obs.id.slice(0, 8)} [${obs.severity}/${obs.kind}] — ${r.reason || '(no reason)'}`);
            } catch (e) {
              log.error(`[shadow:cleanup] Failed to resolve obs=${obs.id}: ${e instanceof Error ? e.message : e}`);
            }
          }
          log.info(`[shadow:cleanup] Applied ${applied}/${parsed.data.resolutions.length} resolutions (${skippedHallucinated} hallucinated ids skipped). Tokens: ${(cleanupResult.inputTokens ?? 0) + (cleanupResult.outputTokens ?? 0)}`);
        }
      } else {
        log.info(`[shadow:cleanup] Completed with status=${cleanupResult.status} — no resolutions applied. Tokens: ${(cleanupResult.inputTokens ?? 0) + (cleanupResult.outputTokens ?? 0)}`);
      }
    }
  } catch (e) {
    log.error('[shadow:cleanup] Failed:', e instanceof Error ? e.message : e);
  }

  // ========== CALL 3: Observe (generate new observations — JSON-only) ==========
  try {
    const activeObservations = ctx.db.listObservations({ status: 'open', limit: 20 });
    // Touch last_seen_at — observations still relevant to heartbeat stay alive longer
    ctx.db.touchObservationsLastSeen(activeObservations.map(o => o.id));
    const activeObsSummary = activeObservations.map(o => `- [${o.severity}/${o.kind}] ${o.title} (${o.votes}x, ${o.createdAt.slice(0, 10)})`).join('\n');
    const dismissFeedback = ctx.db.listSuggestions({ status: 'dismissed' }).slice(0, 10)
      .filter(s => s.feedbackNote).map(s => `- "${s.title}" — dismissed: ${s.feedbackNote}`).join('\n');

    const observePrompt = [
      'Generate ACTIONABLE OBSERVATIONS about the developer\'s work.',
      '',
      'Return JSON:',
      OBSERVE_FORMAT,
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
      outputLanguageInstruction(ctx.profile.locale),
      '',
      pickObserveExample(ctx.profile.locale),
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

    onPhase?.('observe');
    const observeModel = getModel(ctx, 'observe');
    const result = await adapter.execute({
      repos: [], title: 'Heartbeat Observe', goal: 'Generate observations', prompt: observePrompt,
      relevantMemories: [], model: observeModel, effort,
      timeoutMs: ctx.config.analysisTimeoutMs,
    });
    llmCalls++;
    tokensUsed += (result.inputTokens ?? 0) + (result.outputTokens ?? 0);
    ctx.db.recordLlmUsage({ source: 'heartbeat_observe', sourceId: heartbeatId ?? null, model: observeModel, inputTokens: result.inputTokens ?? 0, outputTokens: result.outputTokens ?? 0 });

    if (result.status === 'success' && result.output) {
      const parseResult = safeParseJson(result.output, ObserveResponseSchema, 'observe');
      if (!parseResult.success) {
        log.warn(`[shadow:observe] ${parseResult.error}`);
        log.warn(`[shadow:observe] Raw (500): ${result.output.slice(0, 500)}`);
      } else {
        const parsed = parseResult.data;
        log.info(`[shadow:observe] ${parsed.observations.length} new observations${parseResult.repaired ? ' (repaired)' : ''}`);

        const { checkObservationDuplicate } = await import('../memory/dedup.js');

        for (const obs of parsed.observations) {
          const firstRepoId = repoIds.size > 0 ? [...repoIds][0] : (repoContexts.length > 0 ? repoContexts[0].repoId : null);
          if (!firstRepoId) continue;

          // Build context early — needed for both dedup merges and creation
          const repo = repoContexts.find((rc) => rc.repoId === firstRepoId);
          const context: Record<string, unknown> = {
            repoName: repo?.repoName ?? 'unknown', branch: repo?.currentBranch ?? 'unknown',
            files: obs.files.slice(0, 5),
          };
          const sessionIds = [...new Set(recentConversations.map((c) => c.session).filter(Boolean))];
          if (sessionIds.length > 0) context.sessionIds = sessionIds;

          const dedupEntity = { kind: obs.kind, title: obs.title, detail: { description: obs.detail } };

          // Pass 1: check vs active (open/acknowledged)
          const vsActive = await checkObservationDuplicate(ctx.db, dedupEntity, 'active');
          if (vsActive.action === 'skip') {
            log.info(`[shadow:observe] Skip duplicate obs (${(vsActive.similarity * 100).toFixed(0)}%): ${obs.title}`);
            continue;
          }
          if (vsActive.action === 'update') {
            ctx.db.bumpObservationVotes(vsActive.existingId, context);
            log.info(`[shadow:observe] Merge into existing obs (${(vsActive.similarity * 100).toFixed(0)}%): ${obs.title}`);
            continue;
          }

          // Pass 2: check vs resolved (done)
          const vsResolved = await checkObservationDuplicate(ctx.db, dedupEntity, 'resolved');
          if (vsResolved.action === 'skip' || vsResolved.action === 'update') {
            const matched = ctx.db.getObservation(vsResolved.existingId);
            if (matched && matched.repoId === firstRepoId) {
              if (ctx.db.hasResolveFeedback(vsResolved.existingId)) {
                // Protected: deliberately resolved by user or cleanup
                ctx.db.bumpObservationVotes(vsResolved.existingId, context);
                log.info(`[shadow:observe] Protected resolved obs, votes++ (${(vsResolved.similarity * 100).toFixed(0)}%): ${obs.title}`);
              } else {
                // Safe to reopen: was capped by overflow, not deliberately resolved
                ctx.db.reopenObservation(vsResolved.existingId, context);
                const obsEntities = buildEntityLinks(ctx.db, firstRepoId, `${obs.title} ${obs.detail}`, entityCache);
                if (obsEntities.length > 0) persistEntityLinks(ctx.db, 'observations', vsResolved.existingId, obsEntities);
                ctx.db.createAuditEvent({ actor: 'shadow', interface: 'heartbeat', action: 'observation_reopen', targetKind: 'observation', targetId: vsResolved.existingId, detail: { reason: 'reappeared_in_heartbeat', similarity: vsResolved.similarity } });
                log.info(`[shadow:observe] Reopened resolved obs (${(vsResolved.similarity * 100).toFixed(0)}%): ${obs.title}`);
              }
              continue;
            }
          }

          // Pass 3: check vs expired
          const vsExpired = await checkObservationDuplicate(ctx.db, dedupEntity, 'expired');
          if (vsExpired.action === 'skip' || vsExpired.action === 'update') {
            const matched = ctx.db.getObservation(vsExpired.existingId);
            if (matched && matched.repoId === firstRepoId) {
              ctx.db.reopenObservation(vsExpired.existingId, context);
              const obsEntities = buildEntityLinks(ctx.db, firstRepoId, `${obs.title} ${obs.detail}`, entityCache);
              if (obsEntities.length > 0) persistEntityLinks(ctx.db, 'observations', vsExpired.existingId, obsEntities);
              ctx.db.createAuditEvent({ actor: 'shadow', interface: 'heartbeat', action: 'observation_reopen', targetKind: 'observation', targetId: vsExpired.existingId, detail: { reason: 'reappeared_after_expiry', similarity: vsExpired.similarity } });
              log.info(`[shadow:observe] Reopened expired obs (${(vsExpired.similarity * 100).toFixed(0)}%): ${obs.title}`);
              continue;
            }
          }

          // Create new observation
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
    log.error('[shadow:observe] LLM failed:', e instanceof Error ? e.message : e);
  }

  // Post-processing
  for (const obs of observations) ctx.db.markObservationProcessed(obs.id);
  if (llmCalls > 0) {
    try { applyBondDelta(ctx.db, 'heartbeat_completed'); }
    catch (e) { log.error('[heartbeat:extract] applyBondDelta heartbeat_completed failed:', e instanceof Error ? e.message : e); }
  }
  if (recentInteractions.length >= 10) {
    try { applyBondDelta(ctx.db, 'interaction_logged'); }
    catch (e) { log.error('[heartbeat:extract] applyBondDelta interaction_logged failed:', e instanceof Error ? e.message : e); }
  }
  // Consume-and-delete: clean up .rotating files
  cleanupRotating(rotatingInt);
  cleanupRotating(rotatingConv);
  cleanupRotating(rotatingEvt);

  return { patternsDetected, memoriesCreated, llmCalls, tokensUsed, observationsCreated };
}
