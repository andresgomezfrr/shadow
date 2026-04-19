import type { ShadowDatabase } from '../storage/database.js';
import type { ProjectRecord } from '../storage/models.js';

// --- Types ---

export type ActiveProject = {
  projectId: string;
  projectName: string;
  score: number;
};

type Signal = {
  projectId: string;
  weight: number;
};

// --- Detection ---

/**
 * Detect which projects the developer is actively working on based on:
 * 1. File paths in interactions → repos → projects (weight 2)
 * 2. Conversation keyword mentions of project names (weight 1)
 * 3. Active observations linked to projects (weight 0.5)
 * 4. Repos with recent remote commits → projects (weight 1)
 *
 * Returns top 3 projects with score >= threshold.
 */
export function detectActiveProjects(
  db: ShadowDatabase,
  interactions: Array<{ file: string; tool: string; ts: string }>,
  conversations: Array<{ text: string }>,
  remoteSyncResults?: Array<{ repoId: string; newRemoteCommits: number }>,
): ActiveProject[] {
  const projects = db.listProjects({ status: 'active' });
  if (projects.length === 0) return [];

  // Build repo→project index — one query, not per-repo (audit D-05)
  const repoToProjects = db.buildRepoProjectsMap();
  const repos = db.listRepos();

  // Build path→repo index (path prefix matching)
  const pathToRepo = new Map<string, string>();
  for (const repo of repos) {
    pathToRepo.set(repo.path, repo.id);
  }

  const signals: Signal[] = [];

  // Signal 1: File paths → repos → projects (weight 2 per write interaction)
  const writeTools = new Set(['Edit', 'Write', 'Bash', 'NotebookEdit']);
  for (const interaction of interactions) {
    if (!interaction.file) continue;
    const weight = writeTools.has(interaction.tool) ? 2 : 0.5;

    for (const [repoPath, repoId] of pathToRepo) {
      if (interaction.file.startsWith(repoPath)) {
        const linked = repoToProjects.get(repoId);
        if (linked) {
          for (const project of linked) {
            signals.push({ projectId: project.id, weight });
          }
        }
        break;
      }
    }
  }

  // Signal 2: Conversation mentions of project names (weight 1)
  const allText = conversations.map(c => c.text).join(' ').toLowerCase();
  for (const project of projects) {
    if (project.name.length < 3) continue;
    const nameLC = project.name.toLowerCase();
    // Count occurrences (rough)
    let idx = 0;
    let count = 0;
    while ((idx = allText.indexOf(nameLC, idx)) !== -1) {
      count++;
      idx += nameLC.length;
    }
    if (count > 0) {
      signals.push({ projectId: project.id, weight: count });
    }
  }

  // Signal 3: Active observations linked to projects (weight 0.5)
  const activeObs = db.listObservations({ status: 'open', limit: 30 });
  for (const obs of activeObs) {
    const projectLinks = (obs.entities ?? []).filter(e => e.type === 'project');
    for (const link of projectLinks) {
      signals.push({ projectId: link.id, weight: 0.5 });
    }
  }

  // Signal 4: Repos with recent remote commits → projects (weight 1)
  if (remoteSyncResults) {
    for (const rs of remoteSyncResults) {
      if (rs.newRemoteCommits <= 0) continue;
      const linked = repoToProjects.get(rs.repoId);
      if (linked) {
        for (const project of linked) {
          signals.push({ projectId: project.id, weight: 1 });
        }
      }
    }
  }

  // Aggregate scores
  const scoreMap = new Map<string, number>();
  for (const sig of signals) {
    scoreMap.set(sig.projectId, (scoreMap.get(sig.projectId) ?? 0) + sig.weight);
  }

  // Threshold: at least 3 total weight to be considered active
  const ACTIVE_THRESHOLD = 3;

  return [...scoreMap.entries()]
    .filter(([, score]) => score >= ACTIVE_THRESHOLD)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([projectId, score]) => {
      const project = projects.find(p => p.id === projectId);
      return {
        projectId,
        projectName: project?.name ?? 'unknown',
        score,
      };
    });
}

// --- Momentum ---

/**
 * Compute project momentum: how active has a project been over a time window.
 * Based on commit frequency in linked repos + memory creation rate.
 * Returns 0-100 score.
 */
export function computeProjectMomentum(
  db: ShadowDatabase,
  projectId: string,
  windowDays = 7,
): number {
  const project = db.getProject(projectId);
  if (!project) return 0;

  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  // Count memories linked to this project in the window
  const recentMemories = db.countMemories({ archived: false, createdSince: since, entityType: 'project', entityId: projectId });

  // Count observations linked to this project in the window
  const recentObs = db.countObservations({ status: 'open', entityType: 'project', entityId: projectId, createdSince: since });

  // Count suggestions linked to this project in the window
  const recentSugs = db.countSuggestions({ entityType: 'project', entityId: projectId, createdSince: since });

  // Weighted score: memories × 3 + observations × 2 + suggestions × 1
  const rawScore = recentMemories * 3 + recentObs * 2 + recentSugs;

  // Normalize to 0-100 (10+ signals = 100)
  return Math.min(100, Math.round(rawScore * 10));
}
