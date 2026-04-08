import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { selectAdapter } from '../backend/index.js';

import type { HeartbeatContext } from './state-machine.js';

export async function activityReflect(
  ctx: HeartbeatContext,
): Promise<{ llmCalls: number; tokensUsed: number; skipped: boolean; soulUpdated?: boolean; reason?: string }> {
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

  const expectedSections = ['## Developer profile', '## Decision patterns', '## Blind spots', '## What Shadow should watch for', '## Communication preferences'];
  let phase2Output: string | null = null;
  let phase2Error: string | null = null;
  let retryHint: string | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const promptToUse = attempt === 0
        ? evolvePrompt
        : evolvePrompt + `\n\nIMPORTANT: Your previous output was missing these required sections: ${retryHint}. You MUST include ALL five sections exactly as specified.`;

      const result = await adapter.execute({
        repos: [], title: 'Shadow Reflect', goal: 'Evolve soul reflection',
        prompt: promptToUse, relevantMemories: [], model: 'opus', effort: 'high',
        systemPrompt: null, allowedTools: [],
      });
      llmCalls++;
      tokensUsed += (result.inputTokens ?? 0) + (result.outputTokens ?? 0);
      ctx.db.recordLlmUsage({
        source: attempt === 0 ? 'reflect_evolve' : 'reflect_evolve_retry',
        sourceId: null, model: 'opus',
        inputTokens: result.inputTokens ?? 0, outputTokens: result.outputTokens ?? 0,
      });

      if (result.status === 'success' && result.output) {
        const missing = expectedSections.filter(s => !result.output!.includes(s));
        if (missing.length === 0) {
          phase2Output = result.output;
          break;
        }
        if (attempt === 0) {
          console.error(`[shadow:reflect] Attempt 1 rejected: missing sections: ${missing.join(', ')} — retrying`);
          retryHint = missing.join(', ');
          continue;
        }
        phase2Error = `malformed output after retry: missing ${missing.join(', ')}`;
        console.error(`[shadow:reflect] Attempt 2 also rejected: ${phase2Error}`);
      } else {
        if (attempt === 0) {
          console.error(`[shadow:reflect] Attempt 1 failed (status=${result.status}) — retrying`);
          retryHint = expectedSections.map(s => s.replace('## ', '')).join(', ');
          continue;
        }
        phase2Error = `Phase 2 returned status: ${result.status}`;
        console.error(`[shadow:reflect] Attempt 2 also failed (status=${result.status})`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (attempt === 0) {
        console.error(`[shadow:reflect] Attempt 1 error: ${msg} — retrying`);
        retryHint = expectedSections.map(s => s.replace('## ', '')).join(', ');
        continue;
      }
      phase2Error = `Phase 2 threw: ${msg}`;
      console.error(`[shadow:reflect] Attempt 2 error: ${msg}`);
    }
  }

  if (phase2Output) {
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
      ctx.db.updateMemory(existingSoul.id, { bodyMd: phase2Output });
    } else {
      ctx.db.createMemory({
        layer: 'core', scope: 'personal', kind: 'soul_reflection',
        title: 'Shadow soul reflection', bodyMd: phase2Output,
        sourceType: 'reflect', confidenceScore: 95, relevanceScore: 1.0,
      });
    }
    console.error(`[shadow:reflect] Soul reflection saved (2-phase). Tokens: ${tokensUsed}`);
    return { llmCalls, tokensUsed, skipped: false, soulUpdated: true };
  }

  if (phase2Error) {
    ctx.db.createEvent({
      kind: 'reflect_failed',
      priority: 7,
      payload: {
        message: 'Soul reflection failed after retry',
        detail: phase2Error,
      },
    });
    return { llmCalls, tokensUsed, skipped: false, soulUpdated: false, reason: phase2Error };
  }

  return { llmCalls, tokensUsed, skipped: false };
}
