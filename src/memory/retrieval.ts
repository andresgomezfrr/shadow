import type { ShadowDatabase } from '../storage/database.js';
import type { MemoryRecord, MemorySearchResult } from '../storage/models.js';

/**
 * Search memories by text query using FTS5.
 * Delegates directly to db.searchMemories() which handles BM25 ranking.
 */
export function searchMemories(
  db: ShadowDatabase,
  query: string,
  options?: {
    layer?: string;
    scope?: string;
    repoId?: string;
    limit?: number;
  },
): MemorySearchResult[] {
  return db.searchMemories(query, options);
}

/**
 * Extract meaningful search terms from a file path.
 * e.g. "src/auth/handler.ts" → ["auth", "handler"]
 */
function extractTermsFromPath(filePath: string): string[] {
  return filePath
    .replace(/\\/g, '/')
    .split('/')
    .flatMap((segment) => {
      // Strip file extension
      const name = segment.replace(/\.[^.]+$/, '');
      // Split camelCase and kebab-case/snake_case
      return name
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .split(/[-_\s]+/)
        .map((t) => t.toLowerCase())
        .filter((t) => t.length > 2);
    })
    // Filter out common noise segments
    .filter((t) => !['src', 'lib', 'dist', 'build', 'index', 'test', 'tests', 'spec', 'node_modules'].includes(t));
}

/**
 * Find memories relevant to a set of file paths and/or topics.
 * Builds an FTS5 query from the context and returns ranked results.
 * Touches each returned memory to track usage.
 */
export function findRelevantMemories(
  db: ShadowDatabase,
  context: {
    filePaths?: string[];
    topics?: string[];
    repoId?: string;
  },
  limit?: number,
): MemoryRecord[] {
  const terms = new Set<string>();

  if (context.filePaths) {
    for (const fp of context.filePaths) {
      for (const term of extractTermsFromPath(fp)) {
        terms.add(term);
      }
    }
  }

  if (context.topics) {
    for (const topic of context.topics) {
      const cleaned = topic.trim().toLowerCase();
      if (cleaned.length > 0) {
        terms.add(cleaned);
      }
    }
  }

  if (terms.size === 0) {
    return [];
  }

  // Build FTS5 query: OR between all terms
  const ftsQuery = [...terms].join(' OR ');

  const results = db.searchMemories(ftsQuery, {
    repoId: context.repoId,
    limit: limit ?? 10,
  });

  const memories = results.map((r) => r.memory);

  // Touch all returned memories to track access
  touchMemories(
    db,
    memories.map((m) => m.id),
  );

  return memories;
}

/**
 * Touch (increment access count) for all provided memory IDs.
 * Call this after injecting memories into a prompt to track usage.
 */
export function touchMemories(db: ShadowDatabase, memoryIds: string[]): void {
  for (const id of memoryIds) {
    db.touchMemory(id);
  }
}
