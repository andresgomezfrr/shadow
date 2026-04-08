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
      const expectedSections = ['## Developer profile', '## Decision patterns', '## Blind spots', '## What Shadow should watch for', '## Communication preferences'];
      const missing = expectedSections.filter(s => !result.output!.includes(s));
      if (missing.length > 0) {
        console.error(`[shadow:reflect] Rejected: output missing sections: ${missing.join(', ')}`);
        return { llmCalls, tokensUsed, skipped: false, soulUpdated: false, reason: `malformed output: missing ${missing.join(', ')}` };
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
      return { llmCalls, tokensUsed, skipped: false, soulUpdated: true };
    }
  } catch (e) {
    console.error('[shadow:reflect] Phase 2 failed:', e instanceof Error ? e.message : e);
  }

  return { llmCalls, tokensUsed, skipped: false };
}
