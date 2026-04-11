import type { ObservationRecord } from '../storage/models.js';

import { findRelevantMemories } from '../memory/retrieval.js';
import { checkSuggestionDuplicate } from '../memory/dedup.js';
import { generateAndStoreEmbedding } from '../memory/lifecycle.js';
import { selectAdapter } from '../backend/index.js';
import { safeParseJson } from '../backend/json-repair.js';

import type { HeartbeatContext } from './state-machine.js';
import { SuggestResponseSchema, SUGGEST_FORMAT, SUGGEST_VALIDATE_FORMAT } from './schemas.js';
import {
  loadEntityNameCache,
  buildEntityLinks,
  persistEntityLinks,
  getModel,
  getEffort,
} from './shared.js';

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
    const pendingSuggestions = ctx.db.listSuggestions({ status: 'open', repoId });
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

    // External context from enrichment
    const { getEnrichmentSummary } = await import('./enrichment.js');
    const enrichProjectIds = ctx.activeProjects?.map(ap => ap.projectId) ?? [];
    const enrichSummaries = enrichProjectIds.map(pid => getEnrichmentSummary(ctx.db, { projectId: pid })).filter(Boolean);
    const enrichmentSection = enrichSummaries.length > 0
      ? `## External Context (from MCP enrichment)\n${enrichSummaries.join('\n')}\n`
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
      SUGGEST_FORMAT,
      '',
      repoContextSection,
      enrichmentSection,
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
      SUGGEST_VALIDATE_FORMAT,
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
          console.error(`[shadow:suggest] Phase 2 parse failed (${repo.name}): ${valParsed.error} — discarding all candidates (fail-close)`);
          candidates = [];
        }
      } else {
        console.error(`[shadow:suggest] Phase 2 LLM failed (${repo.name}): status=${valResult.status} — discarding all candidates (fail-close)`);
        candidates = [];
      }
    } catch (e) {
      console.error(`[shadow:suggest] Phase 2 failed (${repo.name}):`, e instanceof Error ? e.message : e, '— discarding all candidates (fail-close)');
      candidates = [];
    }

    // --- Persist kept candidates (with semantic dedup) ---
    for (const sug of candidates) {
      const vsPending = await checkSuggestionDuplicate(ctx.db, { kind: sug.kind, title: sug.title, summaryMd: sug.summaryMd }, 'open');
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
