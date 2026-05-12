import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { colorize, matchesFilter, readLastLines } from './cmd-logs.js';

const SAMPLE = [
  '2026-05-12T10:00:00.000Z INFO [schema] Applied 57 migrations',
  '2026-05-12T10:01:00.000Z WARN [embeddings] cold start took 2500ms',
  '2026-05-12T10:02:00.000Z ERROR [job-queue] Job heartbeat/abc failed: connection refused',
  '2026-05-12T10:03:00.000Z INFO [daemon] tick',
];

describe('colorize', () => {
  it('returns line unchanged when color disabled', () => {
    assert.equal(colorize(SAMPLE[2], false), SAMPLE[2]);
  });

  it('wraps ERROR lines in red ANSI', () => {
    const out = colorize(SAMPLE[2], true);
    assert.match(out, /^\x1b\[31m/);
    assert.match(out, /\x1b\[0m$/);
  });

  it('wraps WARN lines in yellow ANSI', () => {
    const out = colorize(SAMPLE[1], true);
    assert.match(out, /^\x1b\[33m/);
  });

  it('leaves INFO lines untinted', () => {
    const out = colorize(SAMPLE[0], true);
    assert.equal(out, SAMPLE[0]);
  });

  it('dims lines that do not match the level regex', () => {
    const weird = 'no level here at all';
    const out = colorize(weird, true);
    assert.match(out, /^\x1b\[2m/);
  });
});

describe('matchesFilter', () => {
  it('returns true when filter is undefined', () => {
    assert.equal(matchesFilter(SAMPLE[0], undefined), true);
  });

  it('matches exact component', () => {
    assert.equal(matchesFilter(SAMPLE[0], 'schema'), true);
    assert.equal(matchesFilter(SAMPLE[1], 'embeddings'), true);
  });

  it('matches partial component (substring)', () => {
    assert.equal(matchesFilter(SAMPLE[2], 'job'), true);
  });

  it('excludes lines without the filter', () => {
    assert.equal(matchesFilter(SAMPLE[0], 'embed'), false);
  });

  it('returns false when line has no component bracket and filter is set', () => {
    assert.equal(matchesFilter('plain line no brackets', 'x'), false);
  });
});

describe('readLastLines', () => {
  it('returns last N lines', () => {
    const dir = mkdtempSync(join(tmpdir(), 'shadow-tail-test-'));
    const path = join(dir, 'test.log');
    try {
      writeFileSync(path, SAMPLE.join('\n') + '\n');
      const out = readLastLines(path, 2);
      assert.equal(out.length, 2);
      assert.equal(out[0], SAMPLE[2]);
      assert.equal(out[1], SAMPLE[3]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns all lines when N is larger than file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'shadow-tail-test-'));
    const path = join(dir, 'test.log');
    try {
      writeFileSync(path, SAMPLE.join('\n') + '\n');
      const out = readLastLines(path, 100);
      assert.equal(out.length, SAMPLE.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('handles file without trailing newline', () => {
    const dir = mkdtempSync(join(tmpdir(), 'shadow-tail-test-'));
    const path = join(dir, 'test.log');
    try {
      writeFileSync(path, SAMPLE.join('\n')); // no trailing \n
      const out = readLastLines(path, 1);
      assert.equal(out.length, 1);
      assert.equal(out[0], SAMPLE[3]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
