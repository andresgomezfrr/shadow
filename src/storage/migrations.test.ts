import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sqliteVec from 'sqlite-vec';

import { applyMigrations, getAppliedSchemaVersion, LATEST_SCHEMA_VERSION, migrations } from './migrations.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = resolve(__dirname, '__snapshots__', 'migrations.schema.json');

function freshDb(): DatabaseSync {
  // Las migrations usan vec0 (sqlite-vec) — debe cargarse antes de aplicar.
  // ShadowDatabase hace esto en su constructor (database.ts:177); replicado aquí
  // para tener un :memory: aislado y reproducible.
  const db = new DatabaseSync(':memory:', { allowExtension: true });
  sqliteVec.load(db);
  return db;
}

type SchemaObject = { type: string; name: string; tbl_name: string | null; sql: string };

function dumpSchema(db: DatabaseSync): SchemaObject[] {
  // Ignora objetos sqlite internos (sqlite_*) y los autogenerados por triggers /
  // FTS5 / vec0 (con __ prefix o _content / _docsize / _config sufijos) para
  // que el snapshot sea reproducible entre runs.
  const rows = db.prepare(`
    SELECT type, name, tbl_name, COALESCE(sql, '') AS sql
    FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY type, name
  `).all() as SchemaObject[];

  // Normaliza whitespace en SQL — los migrations usan template literals con
  // indentación variable; un trim + collapse evita falsos diffs por formato.
  return rows.map((r) => ({
    type: r.type,
    name: r.name,
    tbl_name: r.tbl_name,
    sql: r.sql.replace(/\s+/g, ' ').trim(),
  }));
}

describe('migrations — apply + invariants', () => {
  it('applies cleanly on a fresh :memory: database', () => {
    const db = freshDb();
    assert.doesNotThrow(() => applyMigrations(db));
    db.close();
  });

  it('schema_migrations records every migration exactly once', () => {
    const db = freshDb();
    applyMigrations(db);
    const rows = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{ version: number }>;
    const recordedVersions = rows.map((r) => r.version);
    const expectedVersions = migrations.map((m) => m.version).sort((a, b) => a - b);
    assert.deepEqual(recordedVersions, expectedVersions);
    db.close();
  });

  it('getAppliedSchemaVersion returns LATEST_SCHEMA_VERSION after apply', () => {
    const db = freshDb();
    applyMigrations(db);
    assert.equal(getAppliedSchemaVersion(db), LATEST_SCHEMA_VERSION);
    db.close();
  });

  it('migration versions are unique', () => {
    const seen = new Set<number>();
    const dupes: number[] = [];
    for (const m of migrations) {
      if (seen.has(m.version)) dupes.push(m.version);
      seen.add(m.version);
    }
    assert.deepEqual(dupes, [], `duplicate migration versions: ${dupes.join(',')}`);
  });

  it('migration names are unique', () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const m of migrations) {
      if (seen.has(m.name)) dupes.push(m.name);
      seen.add(m.name);
    }
    assert.deepEqual(dupes, [], `duplicate migration names: ${dupes.join(',')}`);
  });

  it('re-applying is a no-op (idempotent)', () => {
    const db = freshDb();
    applyMigrations(db);
    const v1 = getAppliedSchemaVersion(db);
    const before = db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number };
    assert.doesNotThrow(() => applyMigrations(db));
    const v2 = getAppliedSchemaVersion(db);
    const after = db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number };
    assert.equal(v1, v2);
    assert.equal(before.n, after.n);
    db.close();
  });
});

describe('migrations — golden schema snapshot', () => {
  it('schema matches frozen snapshot (set UPDATE_SNAPSHOTS=1 to regenerate)', () => {
    const db = freshDb();
    applyMigrations(db);
    const actual = dumpSchema(db);
    db.close();

    const shouldUpdate = process.env.UPDATE_SNAPSHOTS === '1';

    if (!existsSync(SNAPSHOT_PATH) || shouldUpdate) {
      mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true });
      writeFileSync(SNAPSHOT_PATH, JSON.stringify(actual, null, 2) + '\n', 'utf-8');
      // Cuando se genera por primera vez (CI fresh) seguimos pasando el test
      // para no romper el bootstrap; en runs sucesivos la comparación es estricta.
      return;
    }

    const expected = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf-8')) as SchemaObject[];

    // Quick diagnostic: cuántos objetos por tipo
    const countsActual = Object.fromEntries(
      Object.entries(actual.reduce<Record<string, number>>((acc, r) => { acc[r.type] = (acc[r.type] ?? 0) + 1; return acc; }, {})),
    );
    const countsExpected = Object.fromEntries(
      Object.entries(expected.reduce<Record<string, number>>((acc, r) => { acc[r.type] = (acc[r.type] ?? 0) + 1; return acc; }, {})),
    );
    assert.deepEqual(
      countsActual,
      countsExpected,
      `schema object counts diverged.\n  expected: ${JSON.stringify(countsExpected)}\n  actual:   ${JSON.stringify(countsActual)}`,
    );

    // Strict compare object-by-object para errores precisos.
    const byKey = (rows: SchemaObject[]) => Object.fromEntries(rows.map((r) => [`${r.type}:${r.name}`, r]));
    const expectedMap = byKey(expected);
    const actualMap = byKey(actual);

    const missingInActual = Object.keys(expectedMap).filter((k) => !(k in actualMap));
    const newInActual = Object.keys(actualMap).filter((k) => !(k in expectedMap));
    assert.deepEqual(missingInActual, [], `dropped schema objects (run with UPDATE_SNAPSHOTS=1 if intentional): ${missingInActual.join(', ')}`);
    assert.deepEqual(newInActual, [], `new schema objects (run with UPDATE_SNAPSHOTS=1 if intentional): ${newInActual.join(', ')}`);

    // SQL diff
    for (const key of Object.keys(expectedMap)) {
      assert.equal(
        actualMap[key].sql,
        expectedMap[key].sql,
        `SQL diverged for ${key} (run with UPDATE_SNAPSHOTS=1 if intentional)`,
      );
    }
  });
});
