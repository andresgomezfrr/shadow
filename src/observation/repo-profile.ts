import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ShadowDatabase } from '../storage/database.js';
import type { RepoRecord } from '../storage/models.js';
import type { ShadowConfig } from '../config/schema.js';
import { selectAdapter } from '../backend/index.js';
import { safeParseJson } from '../backend/json-repair.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Git/FS signal gathering (no LLM)
// ---------------------------------------------------------------------------

const GIT_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_SSH_COMMAND: 'ssh -o BatchMode=yes',
};

function exec(cmd: string, cwd: string, timeoutMs = 5_000): string | null {
  try {
    return execSync(cmd, {
      cwd,
      encoding: 'utf-8',
      timeout: timeoutMs,
      stdio: 'pipe',
      env: { ...process.env, ...GIT_ENV },
    }).trim();
  } catch {
    return null;
  }
}

interface RepoSignals {
  contributors: string | null;
  recentCommits: string | null;
  remoteBranches: string | null;
  tags: string | null;
  monthlyCommitCount: number;
  topLevel: string | null;
  hasCi: boolean;
  ciWorkflows: string[];
  packageInfo: string | null;
  diffStats: string | null;
  ghPrList: string | null;
  readme: string | null;
}

function gatherRepoSignals(repo: RepoRecord): RepoSignals {
  const cwd = repo.path;

  const contributors = exec('git shortlog -sn --all', cwd);
  const recentCommits = exec('git log -20 --format="%H|%s|%an|%cr"', cwd);
  const remoteBranches = exec('git branch -r', cwd);
  const tags = exec('git tag --sort=-creatordate', cwd);
  const monthlyLog = exec('git log --since=30d --oneline', cwd);
  const monthlyCommitCount = monthlyLog ? monthlyLog.split('\n').filter(Boolean).length : 0;
  const topLevel = exec('ls -1', cwd);
  const diffStats = exec('git diff --stat HEAD~10', cwd);

  // CI detection
  const workflowsDir = join(cwd, '.github', 'workflows');
  let hasCi = false;
  let ciWorkflows: string[] = [];
  if (existsSync(workflowsDir)) {
    hasCi = true;
    const ls = exec('ls -1', workflowsDir);
    ciWorkflows = ls ? ls.split('\n').filter(Boolean) : [];
  }

  // Package info (best-effort)
  let packageInfo: string | null = null;
  for (const file of ['package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml', 'pom.xml']) {
    const p = join(cwd, file);
    if (existsSync(p)) {
      try {
        const content = readFileSync(p, 'utf-8');
        // For package.json, extract just name, scripts, and key deps
        if (file === 'package.json') {
          const pkg = JSON.parse(content);
          packageInfo = JSON.stringify({
            name: pkg.name,
            scripts: pkg.scripts ? Object.keys(pkg.scripts) : [],
            dependencies: pkg.dependencies ? Object.keys(pkg.dependencies).slice(0, 15) : [],
            devDependencies: pkg.devDependencies ? Object.keys(pkg.devDependencies).slice(0, 10) : [],
          }, null, 2);
        } else {
          packageInfo = content.slice(0, 500);
        }
      } catch { /* ignore */ }
      break;
    }
  }

  // GitHub PRs (best-effort, silent fail)
  const ghPrList = exec('gh pr list --json number,title,state,author --limit 10', cwd, 10_000);

  // README for summary context
  let readme: string | null = null;
  for (const file of ['README.md', 'readme.md', 'README']) {
    const p = join(cwd, file);
    if (existsSync(p)) {
      try { readme = readFileSync(p, 'utf-8').slice(0, 500); } catch { /* ignore */ }
      break;
    }
  }

  return {
    contributors,
    recentCommits,
    remoteBranches,
    tags,
    monthlyCommitCount,
    topLevel,
    hasCi,
    ciWorkflows,
    packageInfo,
    diffStats,
    ghPrList,
    readme,
  };
}

// ---------------------------------------------------------------------------
// LLM analysis
// ---------------------------------------------------------------------------

const RepoContextResponseSchema = z.object({
  contextMd: z.string(),
});

function formatSignals(repo: RepoRecord, signals: RepoSignals): string {
  const sections: string[] = [];

  sections.push(`Repository: ${repo.name}\nPath: ${repo.path}`);

  if (signals.contributors) {
    sections.push(`### Contributors\n${signals.contributors}`);
  }
  if (signals.recentCommits) {
    sections.push(`### Recent Commits (last 20)\n${signals.recentCommits}`);
  }
  if (signals.remoteBranches) {
    sections.push(`### Remote Branches\n${signals.remoteBranches}`);
  }
  if (signals.tags) {
    const tagList = signals.tags.split('\n').slice(0, 5).join(', ');
    sections.push(`### Recent Tags\n${tagList || 'none'}`);
  }
  sections.push(`### Monthly Activity\n${signals.monthlyCommitCount} commits in last 30 days`);
  if (signals.topLevel) {
    sections.push(`### Top-Level Structure\n${signals.topLevel}`);
  }
  sections.push(`### CI/CD\n${signals.hasCi ? `Present: ${signals.ciWorkflows.join(', ')}` : 'None detected'}`);
  if (signals.packageInfo) {
    sections.push(`### Package Info\n${signals.packageInfo}`);
  }
  if (signals.diffStats) {
    sections.push(`### Recent Changes (diff stat HEAD~10)\n${signals.diffStats}`);
  }
  if (signals.ghPrList) {
    sections.push(`### Open Pull Requests\n${signals.ghPrList}`);
  }
  if (signals.readme) {
    sections.push(`### README (first 500 chars)\n${signals.readme}`);
  }

  return sections.join('\n\n');
}

async function analyzeRepoContext(
  signals: RepoSignals,
  repo: RepoRecord,
  config: ShadowConfig,
  db: ShadowDatabase,
): Promise<{ contextMd: string; llmCalls: number; tokensUsed: number }> {
  const adapter = selectAdapter(config);
  const model = config.models.repoProfile;

  // Load corrections relevant to this repo
  const { loadPendingCorrections } = await import('../memory/retrieval.js');
  const correctionsSection = loadPendingCorrections(db, [{ type: 'repo', id: repo.id }]);

  const prompt = `You are Shadow, an engineering companion analyzing a repository to understand its context.
This analysis will be used to calibrate what kind of suggestions are appropriate for this repo.

${formatSignals(repo, signals)}

Produce a structured context summary in markdown with EXACTLY this format:

## ${repo.name}
**Summary**: (2-3 sentences: what this repo does, why it exists, and who uses it. Written for someone seeing this repo for the first time.)
**Type**: (library / service / tool / monolith / monorepo / etc.)
**Stack**: (languages, frameworks, key dependencies)
**Phase**: (prototype / active-development / stabilizing / maintenance / legacy)
**Team**: (solo / small-team / large-team — based on contributor data)
**CI/CD**: (none / basic / full — based on workflow files)
**Active areas**: (which parts of the codebase are being actively worked on, from recent commits and diff stats)
**Open PRs**: (summary if PR data available, otherwise "N/A")
**Valuable suggestions**: (what kind of suggestions would genuinely help this repo — be specific)
**Avoid suggesting**: (what kind of suggestions are NOT appropriate given the repo's context — be specific based on team size, phase, CI maturity)
${correctionsSection ? `\n${correctionsSection}\nYou MUST respect these corrections in your analysis.\n` : ''}
Be concise. Each field 1-2 lines max. Respond with JSON: { "contextMd": "..." }`;

  const result = await adapter.execute({
    repos: [],
    title: `Repo Profile: ${repo.name}`,
    goal: 'Analyze repository context for suggestion calibration',
    prompt,
    relevantMemories: [],
    model,
    effort: 'low',
  });

  const tokens = (result.inputTokens ?? 0) + (result.outputTokens ?? 0);

  if (result.status === 'success' && result.output) {
    const parsed = safeParseJson(result.output, RepoContextResponseSchema, 'repo-profile');
    if (parsed.success) {
      return { contextMd: parsed.data.contextMd, llmCalls: 1, tokensUsed: tokens };
    }
    // Fallback: if the LLM returned raw markdown instead of JSON
    if (result.output.includes('**Type**:') || result.output.includes('## ')) {
      return { contextMd: result.output.trim(), llmCalls: 1, tokensUsed: tokens };
    }
    console.error(`[shadow:repo-profile] Parse failed for ${repo.name}: ${parsed.error}`);
  } else {
    console.error(`[shadow:repo-profile] LLM call failed for ${repo.name}: status=${result.status}`);
  }

  return { contextMd: '', llmCalls: 1, tokensUsed: tokens };
}

// ---------------------------------------------------------------------------
// Main entry point — profile a batch of repos
// ---------------------------------------------------------------------------

export async function profileRepos(
  db: ShadowDatabase,
  config: ShadowConfig,
  batchSize: number,
  force = false,
  onProgress?: (name: string, index: number, total: number) => void,
): Promise<{ reposProfiled: number; llmCalls: number; tokensUsed: number }> {
  const repos = db.listRepos();

  // Filter: never profiled OR has new commits since last profile (git log check)
  const candidates = repos
    .filter(r => {
      if (force) return true;
      if (!r.contextUpdatedAt) return true; // never profiled
      // Only re-profile if repo has new commits since last profile
      const newCommits = exec(`git log --since="${r.contextUpdatedAt}" --oneline`, r.path);
      return newCommits !== null && newCommits.trim().length > 0;
    })
    .sort((a, b) => {
      if (!a.contextUpdatedAt) return -1;
      if (!b.contextUpdatedAt) return 1;
      return new Date(a.contextUpdatedAt).getTime() - new Date(b.contextUpdatedAt).getTime();
    })
    .slice(0, batchSize);

  if (candidates.length === 0) {
    console.error('[shadow:repo-profile] No repos with new commits, skipping');
    return { reposProfiled: 0, llmCalls: 0, tokensUsed: 0 };
  }

  let totalLlmCalls = 0;
  let totalTokens = 0;

  for (let i = 0; i < candidates.length; i++) {
    const repo = candidates[i];
    onProgress?.(repo.name, i + 1, candidates.length);
    console.error(`[shadow:repo-profile] Profiling: ${repo.name}`);
    const signals = gatherRepoSignals(repo);
    const { contextMd, llmCalls, tokensUsed } = await analyzeRepoContext(signals, repo, config, db);

    if (contextMd) {
      db.updateRepo(repo.id, { contextMd, contextUpdatedAt: new Date().toISOString() });
      console.error(`[shadow:repo-profile] ${repo.name}: ${contextMd.length} chars context saved`);
    }

    db.recordLlmUsage({
      source: 'repo_profile',
      sourceId: repo.id,
      model: config.models.repoProfile,
      inputTokens: 0, // adapter doesn't always separate, use total
      outputTokens: tokensUsed,
    });

    totalLlmCalls += llmCalls;
    totalTokens += tokensUsed;
  }

  return { reposProfiled: candidates.length, llmCalls: totalLlmCalls, tokensUsed: totalTokens };
}
