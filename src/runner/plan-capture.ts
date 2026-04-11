import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface PlanCapture {
  /** Full plan content (from file on disk, or JSONL Write input as fallback) */
  content: string | null;
  /** Claude's brief text before ExitPlanMode */
  brief: string | null;
  /** Absolute path to the plan .md file */
  filePath: string | null;
}

/**
 * Extract plan content from a Claude Code session transcript.
 *
 * In --permission-mode plan, Claude writes the plan to ~/.claude/plans/*.md
 * via the Write tool, then calls ExitPlanMode. The JSON result field is empty
 * because the final assistant message after ExitPlanMode has no content.
 *
 * This parses the session JSONL to find:
 * 1. The Write tool call that created the plan file → filePath + content fallback
 * 2. The last assistant text before ExitPlanMode → brief
 * Then reads the plan file from disk (preferred over JSONL content).
 */
export function capturePlanFromSession(sessionId: string, cwd: string): PlanCapture {
  const NULL_CAPTURE: PlanCapture = { content: null, brief: null, filePath: null };

  // Build JSONL path: ~/.claude/projects/{cwd-dashed}/{sessionId}.jsonl
  const projectSlug = cwd.replaceAll('/', '-');
  const jsonlPath = join(homedir(), '.claude', 'projects', projectSlug, `${sessionId}.jsonl`);

  let raw: string;
  try {
    raw = readFileSync(jsonlPath, 'utf-8');
  } catch {
    return NULL_CAPTURE;
  }

  let planFilePath: string | null = null;
  let planContentFromWrite: string | null = null;
  let brief: string | null = null;
  let lastAssistantText: string | null = null;

  for (const line of raw.split('\n')) {
    if (!line) continue;
    let entry: { type?: string; message?: { content?: unknown[] } };
    try { entry = JSON.parse(line); } catch { continue; }

    if (entry.type !== 'assistant') continue;
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (typeof block !== 'object' || block === null) continue;
      const b = block as Record<string, unknown>;

      if (b.type === 'text' && typeof b.text === 'string') {
        lastAssistantText = b.text;
      }

      if (b.type === 'tool_use') {
        if (b.name === 'Write') {
          const input = b.input as Record<string, string> | undefined;
          const fp = input?.file_path ?? '';
          if (fp.includes('/plans/') && fp.endsWith('.md')) {
            planFilePath = fp;
            planContentFromWrite = input?.content ?? null;
          }
        }
        if (b.name === 'ExitPlanMode') {
          brief = lastAssistantText;
        }
      }
    }
  }

  // Read plan file from disk (preferred — may have been updated after initial Write)
  let content: string | null = null;
  if (planFilePath) {
    try {
      content = readFileSync(planFilePath, 'utf-8');
    } catch {
      content = planContentFromWrite; // fallback to JSONL Write input
    }
  }

  return { content, brief, filePath: planFilePath };
}
