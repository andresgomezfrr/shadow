import { describe, it } from 'node:test';
import assert from 'node:assert';

/**
 * Smoke tests for the memory module split (retrieval.ts → corrections.ts).
 *
 * Context (audit obs 81dd8035): the split repointed 5 dynamic imports across
 * the daemon and analysis layers. Dynamic imports don't show up in typecheck
 * — a wrong path only explodes at runtime when the job actually runs. These
 * tests verify the contract: every module that a dynamic import targets
 * still exposes the symbols the caller expects.
 *
 * If someone moves or renames an export without updating the caller's import
 * path, one of these tests fails immediately instead of waiting for the
 * corresponding job to fire in production.
 */

describe('memory module exports — dynamic import contract', () => {
  it('corrections.js exports loadPendingCorrections, enforceCorrections, mergeRelatedMemories', async () => {
    const mod = await import('./corrections.js');
    assert.strictEqual(typeof mod.loadPendingCorrections, 'function',
      'loadPendingCorrections must be exported from corrections.js (consumed by observation/repo-profile, daemon/handlers/suggest, analysis/extract)');
    assert.strictEqual(typeof mod.enforceCorrections, 'function',
      'enforceCorrections must be exported from corrections.js (consumed by daemon/job-handlers consolidate phase)');
    assert.strictEqual(typeof mod.mergeRelatedMemories, 'function',
      'mergeRelatedMemories must be exported from corrections.js (consumed by daemon/job-handlers consolidate phase)');
  });

  it('retrieval.js exports searchMemories, findRelevantMemories, touchMemories', async () => {
    const mod = await import('./retrieval.js');
    assert.strictEqual(typeof mod.searchMemories, 'function',
      'searchMemories must stay in retrieval.js');
    assert.strictEqual(typeof mod.findRelevantMemories, 'function',
      'findRelevantMemories must stay in retrieval.js (consumed by analysis/suggest and analysis/extract as static imports)');
    assert.strictEqual(typeof mod.touchMemories, 'function',
      'touchMemories must stay in retrieval.js');
  });

  it('index.js re-exports the public memory surface from both files', async () => {
    const mod = await import('./index.js');
    // retrieval.ts exports
    assert.strictEqual(typeof mod.searchMemories, 'function');
    assert.strictEqual(typeof mod.findRelevantMemories, 'function');
    assert.strictEqual(typeof mod.touchMemories, 'function');
    // corrections.ts exports
    assert.strictEqual(typeof mod.loadPendingCorrections, 'function');
    assert.strictEqual(typeof mod.enforceCorrections, 'function');
    assert.strictEqual(typeof mod.mergeRelatedMemories, 'function');
  });

  it('corrections.js does NOT accidentally leak retrieval symbols (which would signal a merge-back)', async () => {
    const mod = await import('./corrections.js') as Record<string, unknown>;
    assert.strictEqual(mod.searchMemories, undefined, 'searchMemories belongs to retrieval, not corrections');
    assert.strictEqual(mod.findRelevantMemories, undefined, 'findRelevantMemories belongs to retrieval, not corrections');
    assert.strictEqual(mod.touchMemories, undefined, 'touchMemories belongs to retrieval, not corrections');
  });

  it('retrieval.js does NOT accidentally leak corrections symbols (which would signal a merge-back)', async () => {
    const mod = await import('./retrieval.js') as Record<string, unknown>;
    assert.strictEqual(mod.loadPendingCorrections, undefined, 'loadPendingCorrections belongs to corrections, not retrieval');
    assert.strictEqual(mod.enforceCorrections, undefined, 'enforceCorrections belongs to corrections, not retrieval');
    assert.strictEqual(mod.mergeRelatedMemories, undefined, 'mergeRelatedMemories belongs to corrections, not retrieval');
  });
});
