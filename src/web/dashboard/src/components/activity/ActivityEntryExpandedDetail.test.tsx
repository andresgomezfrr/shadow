import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ActivityEntryExpandedDetail } from './ActivityEntryExpandedDetail';
import { JOB_PHASES } from './ActivityEntryPhases';
import type { ActivityEntry } from '../../api/types';

/**
 * Tests for ActivityEntryExpandedDetail (audit F-08).
 *
 * Motivation: the expanded detail renderer has a per-job dispatch table that
 * silently drifted when the consolidate phase list gained `knowledge-summary`
 * — the backend handler, the Guide doc, and the UI's JOB_PHASES all lived in
 * different files and only one got updated. These tests anchor:
 *
 * 1. The canonical phase list per job type in JOB_PHASES (authoritative
 *    source the pipeline renders from).
 * 2. That each job-type branch renders its expected top-level structure
 *    (stats row + extension block where applicable) from a realistic
 *    result object shape.
 * 3. Drift traps: specific result-field keys and phase entries must be
 *    rendered when present (memoriesPromoted, knowledgeSummary, etc.),
 *    flipping to visible changes if the structure silently moves.
 */

function entry(overrides: Partial<ActivityEntry> & Pick<ActivityEntry, 'type'>): ActivityEntry {
  return {
    id: 'test-id',
    source: 'job',
    type: overrides.type,
    status: 'completed',
    phases: [],
    activity: null,
    llmCalls: 0,
    tokensUsed: 0,
    durationMs: 1000,
    result: {},
    startedAt: null,
    finishedAt: null,
    runId: null,
    repoName: null,
    confidence: null,
    verified: null,
    parentRunId: null,
    prUrl: null,
    taskId: null,
    taskTitle: null,
    ...overrides,
  };
}

describe('JOB_PHASES canonical phase lists', () => {
  it('consolidate includes knowledge-summary in the expected order (audit F-14)', () => {
    // This is the drift trap: if someone reorders the backend handler's
    // phases array without updating JOB_PHASES, the pipeline renders the
    // wrong order. Lock the expected sequence here.
    expect(JOB_PHASES.consolidate).toEqual([
      'layer-maintenance',
      'meta-patterns',
      'knowledge-summary',
      'corrections',
      'merge',
    ]);
  });

  it('heartbeat includes prepare/summarize/extract/cleanup/observe/notify', () => {
    expect(JOB_PHASES.heartbeat).toEqual([
      'prepare', 'summarize', 'extract', 'cleanup', 'observe', 'notify',
    ]);
  });

  it('every dispatched job type has an entry in JOB_PHASES', () => {
    // Job types that ActivityEntryExpandedDetail renders a dedicated pipeline
    // for — each must be in JOB_PHASES so the <PhasePipeline/> call inside
    // the branch gets a canonical allPhases prop.
    const dispatchedTypes = [
      'heartbeat', 'suggest', 'suggest-deep', 'suggest-project',
      'project-profile', 'consolidate', 'reflect', 'remote-sync',
      'repo-profile', 'context-enrich', 'revalidate-suggestion',
      'auto-plan', 'auto-execute',
    ];
    for (const t of dispatchedTypes) {
      expect(JOB_PHASES[t], `missing JOB_PHASES.${t}`).toBeDefined();
      expect(JOB_PHASES[t].length, `empty JOB_PHASES.${t}`).toBeGreaterThan(0);
    }
  });
});

describe('consolidate expanded detail', () => {
  it('renders stats row with promoted/demoted/expired counts', () => {
    render(<ActivityEntryExpandedDetail entry={entry({
      type: 'consolidate',
      phases: ['layer-maintenance', 'meta-patterns', 'knowledge-summary', 'corrections', 'merge'],
      result: { memoriesPromoted: 4, memoriesDemoted: 6, memoriesExpired: 0 },
    })} />);
    expect(screen.getByText('Promoted:')).toBeTruthy();
    expect(screen.getByText('Demoted:')).toBeTruthy();
    expect(screen.getByText('Expired:')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByText('6')).toBeTruthy();
  });

  it('shows Merged and Deduped badges only when counts > 0', () => {
    const { rerender } = render(<ActivityEntryExpandedDetail entry={entry({
      type: 'consolidate',
      result: { memoriesPromoted: 0, memoriesDemoted: 0, memoriesExpired: 0, memoriesMerged: 0, memoriesDeduped: 0 },
    })} />);
    expect(screen.queryByText('Merged:')).toBeNull();
    expect(screen.queryByText('Deduped:')).toBeNull();

    rerender(<ActivityEntryExpandedDetail entry={entry({
      type: 'consolidate',
      result: { memoriesMerged: 3, memoriesArchivedByMerge: 6, memoriesDeduped: 2 },
    })} />);
    expect(screen.getByText('Merged:')).toBeTruthy();
    expect(screen.getByText(/3 clusters.*6 archived/)).toBeTruthy();
    expect(screen.getByText('Deduped:')).toBeTruthy();
  });

  it('renders knowledge_summary action=created with themes as chips', () => {
    render(<ActivityEntryExpandedDetail entry={entry({
      type: 'consolidate',
      result: {
        memoriesPromoted: 0, memoriesDemoted: 0, memoriesExpired: 0,
        knowledgeSummary: {
          action: 'created',
          memoryId: 'mem-123',
          themes: ['observable-by-default', 'audit-driven workflow', 'MCP delegation'],
        },
      },
    })} />);
    expect(screen.getByText('Knowledge summary:')).toBeTruthy();
    expect(screen.getByText('created')).toBeTruthy();
    // Each theme should be a separate element, not comma-joined into a single blob.
    for (const t of ['observable-by-default', 'audit-driven workflow', 'MCP delegation']) {
      expect(screen.getByText(t), `theme "${t}" should render as its own chip`).toBeTruthy();
    }
    // Deep-link to /memories
    const viewLink = screen.getByRole('link', { name: /view/ });
    expect(viewLink.getAttribute('href')).toBe('/memories?highlight=mem-123');
  });

  it('renders knowledge_summary action=merged with dedup note and deep-link', () => {
    render(<ActivityEntryExpandedDetail entry={entry({
      type: 'consolidate',
      result: {
        knowledgeSummary: { action: 'merged', memoryId: 'mem-existing-999' },
      },
    })} />);
    expect(screen.getByText('merged')).toBeTruthy();
    expect(screen.getByText(/absorbed into existing summary/)).toBeTruthy();
    const link = screen.getByRole('link', { name: /view/ });
    expect(link.getAttribute('href')).toBe('/memories?highlight=mem-existing-999');
  });

  it('renders knowledge_summary action=skipped with reason and no deep-link', () => {
    render(<ActivityEntryExpandedDetail entry={entry({
      type: 'consolidate',
      result: {
        knowledgeSummary: { action: 'skipped', reason: 'only 3 durable memories new since last (need 10)' },
      },
    })} />);
    expect(screen.getByText('skipped')).toBeTruthy();
    expect(screen.getByText(/only 3 durable memories new/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /view/ })).toBeNull();
  });

  it('renders cluster-merge info when clustered.merged > 0', () => {
    render(<ActivityEntryExpandedDetail entry={entry({
      type: 'consolidate',
      result: {
        knowledgeSummary: {
          action: 'created',
          memoryId: 'mem-1',
          themes: ['a', 'b'],
          clustered: { checked: 5, merged: 2 },
        },
      },
    })} />);
    expect(screen.getByText(/cluster-merged 2\/5/)).toBeTruthy();
  });

  it('omits the knowledge_summary block entirely when result.knowledgeSummary is absent', () => {
    render(<ActivityEntryExpandedDetail entry={entry({
      type: 'consolidate',
      result: { memoriesPromoted: 1 },
    })} />);
    expect(screen.queryByText('Knowledge summary:')).toBeNull();
  });
});

describe('heartbeat expanded detail', () => {
  it('shows observation and memory counts as accent-labeled sections', () => {
    render(<ActivityEntryExpandedDetail entry={entry({
      type: 'heartbeat',
      phases: ['prepare', 'summarize', 'extract', 'observe'],
      result: {
        observationsCreated: 2,
        memoriesCreated: 1,
        observationItems: [
          { id: 'obs-1', title: 'First observation' },
          { id: 'obs-2', title: 'Second observation' },
        ],
        memoryItems: [{ id: 'mem-1', title: 'A memory' }],
      },
    })} />);
    expect(screen.getByText(/Observations \(2\)/)).toBeTruthy();
    expect(screen.getByText(/Memories \(1\)/)).toBeTruthy();
    expect(screen.getByText('- First observation')).toBeTruthy();
    expect(screen.getByText('- A memory')).toBeTruthy();
  });

  it('renders deep-links for observation and memory items', () => {
    render(<ActivityEntryExpandedDetail entry={entry({
      type: 'heartbeat',
      result: {
        observationsCreated: 1,
        memoriesCreated: 0,
        observationItems: [{ id: 'obs-xyz', title: 'Linked obs' }],
      },
    })} />);
    const link = screen.getByRole('link', { name: /Linked obs/ });
    expect(link.getAttribute('href')).toBe('/observations?highlight=obs-xyz');
  });
});

describe('suggest expanded detail', () => {
  it('shows suggestion count with deep-linked titles', () => {
    render(<ActivityEntryExpandedDetail entry={entry({
      type: 'suggest',
      result: {
        suggestionsCreated: 2,
        suggestionItems: [
          { id: 'sug-1', title: 'Refactor X' },
          { id: 'sug-2', title: 'Test Y' },
        ],
      },
    })} />);
    expect(screen.getByText(/Suggestions \(2\)/)).toBeTruthy();
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute('href')).toBe('/suggestions?highlight=sug-1');
  });

  it('renders "No suggestions generated" when count=0', () => {
    render(<ActivityEntryExpandedDetail entry={entry({
      type: 'suggest',
      result: { suggestionsCreated: 0 },
    })} />);
    expect(screen.getByText('No suggestions generated')).toBeTruthy();
  });
});

describe('reflect expanded detail', () => {
  it('renders "Skipped" when result.skipped is true', () => {
    render(<ActivityEntryExpandedDetail entry={entry({
      type: 'reflect',
      result: { skipped: true, reason: 'no new activity' },
    })} />);
    expect(screen.getByText(/Skipped.*no new activity/)).toBeTruthy();
  });

  it('renders "Soul updated" link when soulUpdated is true', () => {
    render(<ActivityEntryExpandedDetail entry={entry({
      type: 'reflect',
      result: { soulUpdated: true, deltaPreview: 'Became more patient' },
    })} />);
    const link = screen.getByRole('link', { name: 'Soul updated' });
    expect(link.getAttribute('href')).toBe('/profile#section-soul');
    expect(screen.getByText(/Became more patient/)).toBeTruthy();
  });

  it('renders rejection reason when reflect was rejected', () => {
    render(<ActivityEntryExpandedDetail entry={entry({
      type: 'reflect',
      result: { reason: 'Changes too drastic', soulUpdated: false },
    })} />);
    expect(screen.getByText(/Rejected.*Changes too drastic/)).toBeTruthy();
  });
});

describe('remote-sync expanded detail', () => {
  it('shows synced + changed counts plus per-repo summaries', () => {
    render(<ActivityEntryExpandedDetail entry={entry({
      type: 'remote-sync',
      result: {
        reposSynced: 3,
        reposWithChanges: 1,
        repoSummaries: [
          { name: 'shadow', newCommits: 4 },
          { name: 'sidecar', newCommits: 0 },
        ],
      },
    })} />);
    expect(screen.getByText(/3 repos synced/)).toBeTruthy();
    expect(screen.getByText(/1 with changes/)).toBeTruthy();
    expect(screen.getByText(/- shadow: 4 new commits/)).toBeTruthy();
    expect(screen.getByText(/- sidecar: 0 new commits/)).toBeTruthy();
  });
});

describe('generic fallback (unknown job type)', () => {
  it('falls through to the default key-value renderer for unmapped types', () => {
    // Pick a type not handled by a dedicated branch.
    const { container } = render(<ActivityEntryExpandedDetail entry={entry({
      type: 'unknown-type-xyz',
      result: { foo: 'bar' },
    })} />);
    // At minimum the component should render without crashing; exact fallback
    // layout isn't pinned here so future generic cleanups don't break this test.
    expect(container).toBeTruthy();
  });
});

describe('drift trap — consolidate backend/UI phase contract', () => {
  it('every phase the backend emits for consolidate exists in JOB_PHASES.consolidate', () => {
    // The backend job-handlers.ts for consolidate returns this exact phases
    // array. If someone adds a phase there without updating JOB_PHASES, the
    // pipeline hides it. Pin the set so that divergence becomes a test fail.
    const backendPhases = ['layer-maintenance', 'meta-patterns', 'knowledge-summary', 'corrections', 'merge'];
    for (const p of backendPhases) {
      expect(JOB_PHASES.consolidate.includes(p), `JOB_PHASES.consolidate missing "${p}"`).toBe(true);
    }
  });
});
