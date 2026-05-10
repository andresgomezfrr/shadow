import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';

import { ConfigSchema } from '../config/schema.js';
import type { ShadowConfig } from '../config/schema.js';
import { ShadowDatabase } from '../storage/database.js';
import { buildRecap, renderRecapMarkdown } from './recap.js';

function createTestDb(): { db: ShadowDatabase; cleanup: () => void } {
  const dbPath = join(tmpdir(), `shadow-recap-test-${randomUUID()}.db`);
  const parsed = ConfigSchema.parse({});
  const config: ShadowConfig = {
    ...parsed,
    resolvedDataDir: tmpdir(),
    resolvedDatabasePath: dbPath,
    resolvedArtifactsDir: join(tmpdir(), 'artifacts'),
  };
  const db = new ShadowDatabase(config);
  return {
    db,
    cleanup: () => {
      db.close();
      try { unlinkSync(dbPath); } catch {}
      try { unlinkSync(dbPath + '-wal'); } catch {}
      try { unlinkSync(dbPath + '-shm'); } catch {}
    },
  };
}

function seedAuditEvent(db: ShadowDatabase, action: string, iface: string, ageHours: number): void {
  // createAuditEvent escribe `createdAt` automático, no podemos backdate
  // desde la API pública. Bypass: insert directo.
  const id = randomUUID();
  const createdAt = new Date(Date.now() - ageHours * 3_600_000).toISOString();
  db.rawDb.prepare(
    'INSERT INTO audit_events (id, actor, interface, action, target_kind, target_id, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, 'user', iface, action, 'memory', null, '{}', createdAt);
}

describe('buildRecap', () => {
  let db: ShadowDatabase;
  let cleanup: () => void;

  before(() => {
    ({ db, cleanup } = createTestDb());
    db.ensureProfile();
  });
  after(() => cleanup());

  it('throws on non-positive hours', () => {
    assert.throws(() => buildRecap(db, 0), /Invalid hours/);
    assert.throws(() => buildRecap(db, -1), /Invalid hours/);
    assert.throws(() => buildRecap(db, NaN), /Invalid hours/);
  });

  it('counts only events within the time window', () => {
    seedAuditEvent(db, 'memory_teach', 'mcp', 2);   // dentro
    seedAuditEvent(db, 'memory_teach', 'mcp', 5);   // dentro
    seedAuditEvent(db, 'memory_update', 'cli', 10); // dentro
    seedAuditEvent(db, 'memory_forget', 'mcp', 30); // fuera

    const recap = buildRecap(db, 24);
    assert.equal(recap.totalEvents, 3);
    assert.equal(recap.byAction.memory_teach, 2);
    assert.equal(recap.byAction.memory_update, 1);
    assert.equal(recap.byAction.memory_forget, undefined);
  });

  it('groups by interface', () => {
    const recap = buildRecap(db, 24);
    assert.equal(recap.byInterface.mcp, 2);
    assert.equal(recap.byInterface.cli, 1);
  });

  it('topActions returns descending counts', () => {
    const recap = buildRecap(db, 24);
    assert.equal(recap.topActions[0].action, 'memory_teach');
    assert.equal(recap.topActions[0].count, 2);
    assert.ok(recap.topActions.length <= 10);
  });

  it('window ISO strings are aligned', () => {
    const recap = buildRecap(db, 24);
    assert.ok(!Number.isNaN(Date.parse(recap.windowStart)));
    assert.ok(!Number.isNaN(Date.parse(recap.windowEnd)));
    assert.ok(Date.parse(recap.windowStart) < Date.parse(recap.windowEnd));
  });

  it('notes mention empty window when no events match', () => {
    const fresh = createTestDb();
    try {
      fresh.db.ensureProfile();
      const recap = buildRecap(fresh.db, 1);
      assert.equal(recap.totalEvents, 0);
      assert.ok(recap.notes.some((n) => /No audit events/.test(n)));
    } finally {
      fresh.cleanup();
    }
  });

  it('notes mention pull-limit truncation when hit', () => {
    const fresh = createTestDb();
    try {
      fresh.db.ensureProfile();
      // Seed 50 events recientes, pull limit 50 → noticia de potencial truncation
      for (let i = 0; i < 50; i++) {
        seedAuditEvent(fresh.db, `action_${i}`, 'mcp', 0.1);
      }
      const recap = buildRecap(fresh.db, 24, 50);
      assert.equal(recap.totalEvents, 50);
      assert.ok(recap.notes.some((n) => /Pulled max/.test(n)));
    } finally {
      fresh.cleanup();
    }
  });
});

describe('renderRecapMarkdown', () => {
  let db: ShadowDatabase;
  let cleanup: () => void;

  before(() => {
    ({ db, cleanup } = createTestDb());
    db.ensureProfile();
    seedAuditEvent(db, 'memory_teach', 'mcp', 1);
    seedAuditEvent(db, 'memory_update', 'cli', 2);
  });
  after(() => cleanup());

  it('emits markdown with heading, total, top actions', () => {
    const recap = buildRecap(db, 24);
    const md = renderRecapMarkdown(recap);
    assert.match(md, /^# Recap — últimas 24h/);
    assert.match(md, /Total: \*\*2\*\*/);
    assert.match(md, /## Top actions/);
    assert.match(md, /`memory_teach`/);
  });
});
