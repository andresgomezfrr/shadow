import { execFileSync } from 'node:child_process';

import type { ShadowDatabase } from '../storage/database.js';
import type { ShadowConfig } from '../config/load-config.js';
import { selectAdapter } from '../backend/index.js';

// --- Helpers ---

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoStr(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function getCurrentQuarter(): string {
  const now = new Date();
  const q = Math.floor(now.getMonth() / 3) + 1;
  return `Q${q}`;
}

function getQuarterLabel(): string {
  const now = new Date();
  const q = Math.floor(now.getMonth() / 3) + 1;
  const labels: Record<number, string> = { 1: 'Jan–Mar', 2: 'Apr–Jun', 3: 'Jul–Sep', 4: 'Oct–Dec' };
  return `Q${q} (${labels[q]})`;
}

function getRecentCommits(db: ShadowDatabase, since: string): string[] {
  const repos = db.listRepos();
  const commits: string[] = [];
  for (const repo of repos) {
    try {
      const log = execFileSync('git', ['log', `--since=${since}`, '--format=%s (%h)', '--no-merges'], {
        cwd: repo.path, timeout: 5000, encoding: 'utf8',
      });
      const lines = log.trim().split('\n').filter(Boolean);
      if (lines.length > 0) {
        commits.push(`**${repo.name}**: ${lines.join(', ')}`);
      }
    } catch { /* skip */ }
  }
  return commits;
}

// --- Daily Digest ---

export async function activityDailyDigest(
  db: ShadowDatabase,
  config: ShadowConfig,
  targetDate?: string,
): Promise<{ contentMd: string; tokensUsed: number }> {
  const today = targetDate ?? todayStr();
  const yesterday = targetDate
    ? (() => { const d = new Date(targetDate); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); })()
    : daysAgoStr(1);

  // Gather data
  const commits = getRecentCommits(db, yesterday);
  const memoriesCreated = db.listMemories({ archived: false, limit: 100 })
    .filter(m => m.createdAt >= yesterday && m.sourceType === 'heartbeat')
    .map(m => `- [${m.kind}] ${m.title}`);
  const obsCreated = db.listObservations({ status: 'active', limit: 50 })
    .filter(o => o.createdAt >= yesterday)
    .map(o => `- [${o.severity}/${o.kind}] ${o.title}`);
  const obsResolved = db.listObservations({ status: 'resolved', limit: 50 })
    .filter(o => o.createdAt >= yesterday);
  const sugAccepted = db.listSuggestions({ status: 'accepted' })
    .filter(s => s.resolvedAt && s.resolvedAt >= yesterday);

  const prompt = [
    'Generate a standup summary for today in 3-5 bullet points.',
    'Format: what I did, what I plan next, blockers (if any).',
    'Natural language, concise, oriented for a team standup.',
    'Write in the same language as the data below.',
    '',
    '## Recent Commits',
    commits.length > 0 ? commits.join('\n') : 'No commits today.',
    '',
    '## Knowledge Learned',
    memoriesCreated.length > 0 ? memoriesCreated.slice(0, 10).join('\n') : 'No new memories.',
    '',
    '## Observations',
    `Created: ${obsCreated.length}, Resolved: ${obsResolved.length}`,
    obsCreated.length > 0 ? obsCreated.slice(0, 5).join('\n') : '',
    '',
    sugAccepted.length > 0 ? `## Suggestions Accepted\n${sugAccepted.map(s => `- ${s.title}`).join('\n')}` : '',
    '',
    'Respond with markdown only. No JSON wrapping.',
  ].filter(Boolean).join('\n');

  const profile = db.ensureProfile();
  const prefs = profile.preferences as Record<string, unknown> | undefined;
  const prefModels = prefs?.models as Record<string, string> | undefined;
  const model = prefModels?.digestDaily ?? config.models.digestDaily;

  const adapter = selectAdapter(config);
  const result = await adapter.execute({
    repos: [], title: 'Daily Digest', goal: 'Generate standup summary',
    prompt, relevantMemories: [], model,
    systemPrompt: null, allowedTools: [],
  });

  const tokensUsed = (result.inputTokens ?? 0) + (result.outputTokens ?? 0);
  db.recordLlmUsage({ source: 'digest_daily', sourceId: null, model, inputTokens: result.inputTokens ?? 0, outputTokens: result.outputTokens ?? 0 });

  const contentMd = result.output ?? '*(No digest generated)*';

  // Upsert: if today's daily already exists, update it
  const existing = db.listDigests({ kind: 'daily', limit: 1 });
  if (existing.length > 0 && existing[0].periodStart === today) {
    db.updateDigest(existing[0].id, { contentMd, tokensUsed });
  } else {
    db.createDigest({ kind: 'daily', periodStart: today, periodEnd: today, contentMd, model, tokensUsed });
  }

  return { contentMd, tokensUsed };
}

// --- Weekly Digest ---

export async function activityWeeklyDigest(
  db: ShadowDatabase,
  config: ShadowConfig,
  targetWeekStart?: string,
): Promise<{ contentMd: string; tokensUsed: number }> {
  const weekAgo = targetWeekStart ?? daysAgoStr(7);
  const today = targetWeekStart
    ? (() => { const d = new Date(targetWeekStart); d.setDate(d.getDate() + 6); return d.toISOString().slice(0, 10); })()
    : todayStr();

  // Gather daily digests of the week
  const dailies = db.listDigests({ kind: 'daily', limit: 7 })
    .filter(d => d.periodStart >= weekAgo)
    .map(d => `### ${d.periodStart}\n${d.contentMd}`);

  const commits = getRecentCommits(db, weekAgo);
  const memories = db.listMemories({ archived: false, limit: 200 })
    .filter(m => m.createdAt >= weekAgo)
    .map(m => `- [${m.kind}] ${m.title}`);
  const sugAccepted = db.listSuggestions({ status: 'accepted' })
    .filter(s => s.resolvedAt && s.resolvedAt >= weekAgo);
  const highObs = db.listObservations({ status: 'active', limit: 20 })
    .filter(o => o.severity === 'high' || o.severity === 'warning');

  const prompt = [
    'Generate a weekly summary for a 1:1 with my manager.',
    'Include: achievements, key decisions, risks/blockers, next steps.',
    '5-10 bullets max. Professional but concise.',
    'Write in the same language as the data below.',
    '',
    dailies.length > 0 ? `## Daily Summaries This Week\n${dailies.join('\n\n')}` : '',
    '',
    '## Commits This Week',
    commits.length > 0 ? commits.join('\n') : 'No commits.',
    '',
    `## Knowledge Learned (${memories.length} memories)`,
    memories.slice(0, 15).join('\n'),
    '',
    sugAccepted.length > 0 ? `## Suggestions Accepted\n${sugAccepted.map(s => `- ${s.title}`).join('\n')}` : '',
    highObs.length > 0 ? `## Active Risks\n${highObs.map(o => `- [${o.severity}] ${o.title}`).join('\n')}` : '',
    '',
    'Respond with markdown only.',
  ].filter(Boolean).join('\n');

  const profile = db.ensureProfile();
  const prefs = profile.preferences as Record<string, unknown> | undefined;
  const prefModels = prefs?.models as Record<string, string> | undefined;
  const model = prefModels?.digestWeekly ?? config.models.digestWeekly;

  const adapter = selectAdapter(config);
  const result = await adapter.execute({
    repos: [], title: 'Weekly Digest', goal: 'Generate 1:1 summary',
    prompt, relevantMemories: [], model,
    systemPrompt: null, allowedTools: [],
  });

  const tokensUsed = (result.inputTokens ?? 0) + (result.outputTokens ?? 0);
  db.recordLlmUsage({ source: 'digest_weekly', sourceId: null, model, inputTokens: result.inputTokens ?? 0, outputTokens: result.outputTokens ?? 0 });

  const contentMd = result.output ?? '*(No digest generated)*';

  const existing = db.listDigests({ kind: 'weekly', limit: 1 });
  if (existing.length > 0 && existing[0].periodStart >= weekAgo) {
    db.updateDigest(existing[0].id, { contentMd, tokensUsed });
  } else {
    db.createDigest({ kind: 'weekly', periodStart: weekAgo, periodEnd: today, contentMd, model, tokensUsed });
  }

  return { contentMd, tokensUsed };
}

// --- Brag Doc ---

export async function activityBragDoc(
  db: ShadowDatabase,
  config: ShadowConfig,
): Promise<{ contentMd: string; tokensUsed: number }> {
  const today = todayStr();
  const year = new Date().getFullYear();
  const quarter = getCurrentQuarter();
  const quarterLabel = getQuarterLabel();

  // Get existing brag doc
  const existing = db.getLatestDigest('brag');
  const existingContent = existing?.contentMd ?? '';

  // Gather recent weekly digests since last brag doc update
  const lastUpdate = existing?.updatedAt ?? daysAgoStr(30);
  const weeklies = db.listDigests({ kind: 'weekly', limit: 10 })
    .filter(d => d.createdAt > lastUpdate)
    .map(d => `### Week of ${d.periodStart}\n${d.contentMd}`);

  // Key memories since last update
  const memories = db.listMemories({ archived: false, limit: 200 })
    .filter(m => m.createdAt > lastUpdate && ['problem_solved', 'design_decision', 'convention'].includes(m.kind))
    .map(m => `- [${m.kind}] ${m.title}: ${m.bodyMd.slice(0, 100)}`);

  const sugAccepted = db.listSuggestions({ status: 'accepted' })
    .filter(s => s.resolvedAt && s.resolvedAt > lastUpdate);

  const prompt = [
    `Update this brag doc by adding achievements from the last week to the current quarter (${quarter}).`,
    '',
    'RULES:',
    `- Structure: sections by quarter (## ${quarter} (${quarterLabel})), within: ### High Impact / ### Medium Impact`,
    '- Each item: what I did, why it matters, measurable impact if possible',
    '- Past quarters MUST NOT be modified — only add to the current quarter',
    '- Consolidate redundant items within the quarter',
    '- The document must be self-sufficient for a performance review',
    `- If no existing content, start with: # Brag Doc — ${year}`,
    '',
    existingContent ? `## Current Brag Doc\n\`\`\`markdown\n${existingContent}\n\`\`\`\n` : `Start a new brag doc for ${year}.`,
    '',
    weeklies.length > 0 ? `## Recent Weekly Digests\n${weeklies.join('\n\n')}` : '',
    memories.length > 0 ? `## Key Achievements\n${memories.slice(0, 20).join('\n')}` : '',
    sugAccepted.length > 0 ? `## Suggestions Implemented\n${sugAccepted.map(s => `- ${s.title}`).join('\n')}` : '',
    '',
    'Respond with the FULL updated brag doc in markdown. No JSON wrapping.',
  ].filter(Boolean).join('\n');

  const profile = db.ensureProfile();
  const prefs = profile.preferences as Record<string, unknown> | undefined;
  const prefModels = prefs?.models as Record<string, string> | undefined;
  const model = prefModels?.digestBrag ?? config.models.digestBrag;

  const adapter = selectAdapter(config);
  const result = await adapter.execute({
    repos: [], title: 'Brag Doc', goal: 'Update quarterly brag doc',
    prompt, relevantMemories: [], model,
    systemPrompt: null, allowedTools: [],
  });

  const tokensUsed = (result.inputTokens ?? 0) + (result.outputTokens ?? 0);
  db.recordLlmUsage({ source: 'digest_brag', sourceId: null, model, inputTokens: result.inputTokens ?? 0, outputTokens: result.outputTokens ?? 0 });

  const contentMd = result.output ?? existingContent;

  // Upsert: always one active brag doc
  if (existing) {
    db.updateDigest(existing.id, { contentMd, tokensUsed });
  } else {
    db.createDigest({ kind: 'brag', periodStart: `${year}-01-01`, periodEnd: today, contentMd, model, tokensUsed });
  }

  return { contentMd, tokensUsed };
}
