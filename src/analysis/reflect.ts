import { selectAdapter } from '../backend/index.js';

import type { HeartbeatContext } from './state-machine.js';

export async function activityReflect(
  ctx: HeartbeatContext,
  opts?: { onPhase?: (phase: string) => void },
): Promise<{ llmCalls: number; tokensUsed: number; skipped: boolean; soulUpdated?: boolean; reason?: string }> {
  const lastReflect = ctx.db.getLastJob('reflect');
  const sinceIso = lastReflect?.finishedAt ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const adapter = selectAdapter(ctx.config);
  const existingSoul = ctx.db.listMemories({ archived: false }).find(m => m.kind === 'soul_reflection');

  // ========== PHASE 1: Extract deltas (Sonnet, cheap) ==========
  opts?.onPhase?.('reflect-delta');

  // Gather only NEW data since last reflect
  const newMemories = ctx.db.listMemories({ archived: false })
    .filter(m => m.kind !== 'soul_reflection' && m.kind !== 'soul_snapshot' && m.createdAt > sinceIso)
    .map(m => `- [${m.layer}/${m.kind}] ${m.title}: ${m.bodyMd.slice(0, 80)}`);

  const newFeedback = ctx.db.listFeedback(undefined, 50)
    .filter(f => f.note && f.createdAt > sinceIso)
    .map(f => `- [${f.targetKind}] ${f.action}: ${f.note}`);

  const newObservations = ctx.db.listObservations({ status: 'open', limit: 20 })
    .filter(o => o.createdAt > sinceIso)
    .map(o => `- [${o.kind}/${o.severity}] ${o.title}`);

  const resolvedObs = ctx.db.listObservations({ status: 'done', limit: 10 })
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
  opts?.onPhase?.('reflect-evolve');

  // Minimal entity context (names only, not full dumps)
  const projects = ctx.db.listProjects({ status: 'active' });
  const repos = ctx.db.listRepos();
  const entityContext = [
    projects.length > 0 ? `Projects: ${projects.map(p => p.name).join(', ')}` : '',
    `Repos: ${repos.length} (${repos.slice(0, 5).map(r => r.name).join(', ')})`,
    `Bond: L${ctx.profile.bondTier} (${ctx.profile.bondAxes.depth}d/${ctx.profile.bondAxes.momentum}m/${ctx.profile.bondAxes.alignment}a/${ctx.profile.bondAxes.autonomy}u)`,
    `Proactivity: ${ctx.profile.proactivityLevel}/10`,
  ].filter(Boolean).join(' | ');

  const evolvePrompt = [
    'You are Shadow, evolving your soul — your identity and understanding of the developer.',
    'Below is your current soul and a change report of what happened since you last reflected.',
    '',
    'You have access to Shadow\'s MCP tools. Use them to verify your understanding:',
    '- shadow_memory_search to check if patterns/decisions are still valid',
    '- shadow_active_projects to see what projects are currently active',
    '- shadow_observations to check current risks and opportunities',
    '- shadow_suggestions to see what\'s been proposed recently',
    '',
    'Evolve the soul: update what changed, REMOVE what is no longer relevant.',
    'The soul must stabilize in size over time — condense, don\'t accumulate.',
    'Each section should have 5-8 key points max. Replace obsolete items with new ones.',
    'If a pattern, project, or preference is no longer active, drop it.',
    '',
    existingSoul ? `## Current soul\n${existingSoul.bodyMd}\n` : '',
    '',
    `## Context\n${entityContext}\n`,
    `## Change report (since last reflect)\n${changeReport}\n`,
    '',
    'Structure as markdown with these exact sections:',
    '',
    '## Shadow\'s voice',
    'How Shadow should speak to this developer. Tone, humor calibration,',
    'expressiveness, language patterns, when to push vs stay quiet.',
    'What makes this relationship unique. Evolved from interactions.',
    '',
    '## Developer profile',
    'Who they are, their role, expertise areas, what they\'re working on.',
    '',
    '## Decision patterns',
    'What principles drive their decisions? What do they consistently accept/reject?',
    '',
    '## Tensions & gaps',
    'Blind spots, neglected areas, stated priorities vs actual activity.',
    'Items Shadow should proactively watch for. Priority conflicts.',
    '',
    'When done, call shadow_soul_update with the complete evolved soul markdown.',
  ].filter(Boolean).join('\n');

  const expectedSections = ['## Shadow\'s voice', '## Developer profile', '## Decision patterns', '## Tensions & gaps'];
  const originalSoulMd = existingSoul?.bodyMd ?? null;

  try {
    const result = await adapter.execute({
      repos: [], title: 'Shadow Reflect', goal: 'Evolve soul reflection',
      prompt: evolvePrompt, relevantMemories: [], model: 'opus', effort: 'high',
      systemPrompt: null, allowedTools: ['mcp__shadow__*'],
    });
    llmCalls++;
    tokensUsed += (result.inputTokens ?? 0) + (result.outputTokens ?? 0);
    ctx.db.recordLlmUsage({
      source: 'reflect_evolve', sourceId: null, model: 'opus',
      inputTokens: result.inputTokens ?? 0, outputTokens: result.outputTokens ?? 0,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[shadow:reflect] Phase 2 error: ${msg}`);
  }

  // Validate: check if soul was updated in DB (LLM uses shadow_soul_update MCP tool)
  opts?.onPhase?.('reflect-validate');
  const currentSoul = ctx.db.listMemories({ archived: false }).find(m => m.kind === 'soul_reflection');
  if (currentSoul && currentSoul.bodyMd !== originalSoulMd) {
    const missing = expectedSections.filter(s => !currentSoul.bodyMd.includes(s));
    if (missing.length > 0) {
      console.error(`[shadow:reflect] Soul updated but missing sections: ${missing.join(', ')} — reverting`);
      if (originalSoulMd) ctx.db.updateMemory(currentSoul.id, { bodyMd: originalSoulMd });
      return { llmCalls, tokensUsed, skipped: false, soulUpdated: false, reason: `Soul missing sections: ${missing.join(', ')}` };
    }
    console.error(`[shadow:reflect] Soul evolved (${originalSoulMd?.length ?? 0} → ${currentSoul.bodyMd.length} chars). Tokens: ${tokensUsed}`);
    return { llmCalls, tokensUsed, skipped: false, soulUpdated: true };
  }

  console.error('[shadow:reflect] Soul not updated — LLM did not call shadow_soul_update');
  return { llmCalls, tokensUsed, skipped: false, soulUpdated: false, reason: 'LLM did not update the soul' };
}
