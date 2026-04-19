import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createTestToolContext, callTool, assertNotFound, seedRepo, seedProject, seedContact, seedSystem, seedObservation } from './_test-helpers.js';
import { entityTools } from './entities.js';
import type { McpTool } from './types.js';

// Use the git toplevel of wherever the tests run from — any checkout of this
// repo is a valid git directory for the repo-add tests.
const GIT_ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();

// ---------------------------------------------------------------------------
// Repos
// ---------------------------------------------------------------------------

describe('shadow_repos', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = entityTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns empty list', async () => {
    const result = await callTool(tools, 'shadow_repos', {}) as { data: unknown[] };
    assert.equal(result.data.length, 0);
  });

  it('returns repos', async () => {
    seedRepo(db, { name: 'alpha' });
    seedRepo(db, { name: 'beta' });
    const result = await callTool(tools, 'shadow_repos', {}) as { data: any[] };
    assert.equal(result.data.length, 2);
  });

  it('filters by name', async () => {
    const result = await callTool(tools, 'shadow_repos', { filter: 'alpha' }) as { data: any[] };
    assert.equal(result.data.length, 1);
    assert.equal(result.data[0].name, 'alpha');
  });
});

describe('shadow_repo_add', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = entityTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('rejects nonexistent path', async () => {
    const result = await callTool(tools, 'shadow_repo_add', { path: '/nonexistent/path/xyz' }) as any;
    assert.equal(result.ok, false);
    assert.ok((result.error as string).includes('does not exist'));
  });

  it('adds repo from real git directory', async () => {
    const result = await callTool(tools, 'shadow_repo_add', { path: GIT_ROOT, name: 'shadow-test' }) as any;
    assert.ok(result.data.id);
    assert.equal(result.data.name, 'shadow-test');
  });

  it('rejects duplicate path', async () => {
    const result = await callTool(tools, 'shadow_repo_add', { path: GIT_ROOT }) as any;
    assert.equal(result.ok, false);
    assert.ok((result.error as string).includes('already registered'));
  });
});

describe('shadow_repo_update', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = entityTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns not-found', async () => {
    const result = await callTool(tools, 'shadow_repo_update', { repoId: 'nonexistent', name: 'x' });
    assertNotFound(result);
  });

  it('rejects empty update', async () => {
    const repo = seedRepo(db);
    const result = await callTool(tools, 'shadow_repo_update', { repoId: repo.id }) as any;
    assert.equal(result.ok, false);
  });

  it('updates fields', async () => {
    const repo = seedRepo(db);
    const result = await callTool(tools, 'shadow_repo_update', { repoId: repo.id, testCommand: 'npm test', languageHint: 'ts' }) as any;
    assert.equal(result.data.testCommand, 'npm test');
    assert.equal(result.data.languageHint, 'ts');
  });
});

describe('shadow_repo_remove', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = entityTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns not-found', async () => {
    const result = await callTool(tools, 'shadow_repo_remove', { repoId: 'nonexistent' });
    assertNotFound(result);
  });

  it('removes repo', async () => {
    const repo = seedRepo(db);
    const result = await callTool(tools, 'shadow_repo_remove', { repoId: repo.id }) as any;
    assert.equal(result.ok, true);
    assert.equal(db.getRepo(repo.id), null);
  });
});

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

describe('shadow_contacts', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = entityTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns empty', async () => {
    const result = await callTool(tools, 'shadow_contacts', {}) as { data: unknown[] };
    assert.equal(result.data.length, 0);
  });

  it('returns contacts', async () => {
    seedContact(db, { name: 'Alice', team: 'backend' });
    seedContact(db, { name: 'Bob', team: 'frontend' });
    const result = await callTool(tools, 'shadow_contacts', {}) as { data: any[] };
    assert.equal(result.data.length, 2);
  });

  it('filters by team', async () => {
    const result = await callTool(tools, 'shadow_contacts', { team: 'backend' }) as { data: any[] };
    assert.ok(result.data.length >= 1);
    assert.ok(result.data.every((c: any) => c.team === 'backend'));
  });
});

describe('shadow_contact_add', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = entityTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('creates contact with all fields', async () => {
    const result = await callTool(tools, 'shadow_contact_add', {
      name: 'Carol', role: 'SRE', team: 'platform', email: 'carol@test.com',
      githubHandle: 'caroldev', slackId: 'U123',
    }) as any;
    assert.ok(result.data.id);
    assert.equal(result.data.name, 'Carol');
    assert.equal(result.data.team, 'platform');
  });

  it('rejects duplicate name', async () => {
    const result = await callTool(tools, 'shadow_contact_add', { name: 'Carol' }) as any;
    assert.equal(result.ok, false);
    assert.ok((result.error as string).includes('already exists'));
  });
});

describe('shadow_contact_update', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = entityTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns not-found', async () => {
    const result = await callTool(tools, 'shadow_contact_update', { contactId: 'nonexistent', name: 'x' });
    assertNotFound(result);
  });

  it('updates fields', async () => {
    const contact = seedContact(db, { name: 'Dave' });
    const result = await callTool(tools, 'shadow_contact_update', { contactId: contact.id, role: 'Lead', team: 'infra' }) as any;
    assert.equal(result.data.role, 'Lead');
    assert.equal(result.data.team, 'infra');
  });
});

describe('shadow_contact_remove', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = entityTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns not-found', async () => {
    const result = await callTool(tools, 'shadow_contact_remove', { contactId: 'nonexistent' });
    assertNotFound(result);
  });

  it('removes contact', async () => {
    const contact = seedContact(db);
    const result = await callTool(tools, 'shadow_contact_remove', { contactId: contact.id }) as any;
    assert.equal(result.ok, true);
    assert.equal(db.getContact(contact.id), null);
  });
});

// ---------------------------------------------------------------------------
// Systems
// ---------------------------------------------------------------------------

describe('shadow_systems', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = entityTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns empty', async () => {
    const result = await callTool(tools, 'shadow_systems', {}) as { data: unknown[] };
    assert.equal(result.data.length, 0);
  });

  it('filters by kind', async () => {
    seedSystem(db, { name: 'Redis', kind: 'database' });
    seedSystem(db, { name: 'Auth API', kind: 'service' });
    const result = await callTool(tools, 'shadow_systems', { kind: 'database' }) as { data: any[] };
    assert.ok(result.data.length >= 1);
    assert.ok(result.data.every((s: any) => s.kind === 'database'));
  });
});

describe('shadow_system_add', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = entityTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('creates system with all fields', async () => {
    const result = await callTool(tools, 'shadow_system_add', {
      name: 'Kafka', kind: 'queue', url: 'kafka://localhost:9092',
      healthCheck: 'kafkacat -b localhost', deployMethod: 'helm upgrade',
    }) as any;
    assert.ok(result.data.id);
    assert.equal(result.data.name, 'Kafka');
    assert.equal(result.data.kind, 'queue');
  });
});

describe('shadow_system_remove', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = entityTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns not-found', async () => {
    const result = await callTool(tools, 'shadow_system_remove', { systemId: 'nonexistent' });
    assertNotFound(result);
  });

  it('removes system', async () => {
    const system = seedSystem(db);
    const result = await callTool(tools, 'shadow_system_remove', { systemId: system.id }) as any;
    assert.equal(result.ok, true);
  });
});

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

describe('shadow_projects', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = entityTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns empty', async () => {
    const result = await callTool(tools, 'shadow_projects', {}) as { data: unknown[] };
    assert.equal(result.data.length, 0);
  });

  it('returns projects', async () => {
    seedProject(db);
    seedProject(db, { status: 'completed' });
    const result = await callTool(tools, 'shadow_projects', {}) as { data: any[] };
    assert.ok(result.data.length >= 1);
  });

  it('filters by status', async () => {
    const result = await callTool(tools, 'shadow_projects', { status: 'completed' }) as { data: any[] };
    assert.ok(result.data.every((p: any) => p.status === 'completed'));
  });
});

describe('shadow_project_add', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = entityTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('creates project with defaults', async () => {
    const result = await callTool(tools, 'shadow_project_add', { name: 'My Project' }) as any;
    assert.ok(result.data.id);
    assert.equal(result.data.name, 'My Project');
    assert.equal(result.data.kind, 'long-term');
    assert.equal(result.data.status, 'active');
  });

  it('creates project with linked entities', async () => {
    const repo = seedRepo(db);
    const system = seedSystem(db);
    const result = await callTool(tools, 'shadow_project_add', {
      name: 'Linked Project', kind: 'sprint',
      repoIds: [repo.id], systemIds: [system.id],
    }) as any;
    assert.deepEqual(result.data.repoIds, [repo.id]);
    assert.deepEqual(result.data.systemIds, [system.id]);
  });
});

describe('shadow_project_update', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = entityTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns not-found', async () => {
    const result = await callTool(tools, 'shadow_project_update', { projectId: 'nonexistent', name: 'x' });
    assertNotFound(result);
  });

  it('updates fields', async () => {
    const project = seedProject(db);
    const result = await callTool(tools, 'shadow_project_update', { projectId: project.id, status: 'on-hold', description: 'paused' }) as any;
    assert.equal(result.data.status, 'on-hold');
    assert.equal(result.data.description, 'paused');
  });
});

describe('shadow_project_remove', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = entityTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns not-found', async () => {
    const result = await callTool(tools, 'shadow_project_remove', { projectId: 'nonexistent' });
    assertNotFound(result);
  });

  it('removes project', async () => {
    const project = seedProject(db);
    const result = await callTool(tools, 'shadow_project_remove', { projectId: project.id }) as any;
    assert.equal(result.ok, true);
    assert.equal(db.getProject(project.id), null);
  });
});

// ---------------------------------------------------------------------------
// active_projects + project_detail
// ---------------------------------------------------------------------------

describe('shadow_active_projects', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let config: ReturnType<typeof createTestToolContext>['config'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = entityTools(env.ctx);
    db = env.db;
    config = env.config;
    mkdirSync(config.resolvedDataDir, { recursive: true });
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns empty when no projects', async () => {
    const result = await callTool(tools, 'shadow_active_projects', {}) as { data: unknown[] };
    assert.ok(Array.isArray(result.data));
    assert.equal(result.data.length, 0);
  });
});

describe('shadow_project_detail', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = entityTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns not-found', async () => {
    const result = await callTool(tools, 'shadow_project_detail', { projectId: 'nonexistent' }) as any;
    assert.ok(result.error);
  });

  it('returns detail by ID', async () => {
    const repo = seedRepo(db);
    const system = seedSystem(db);
    const project = seedProject(db, { repoIds: [repo.id], systemIds: [system.id] });
    const result = await callTool(tools, 'shadow_project_detail', { projectId: project.id }) as any;
    assert.equal(result.data.name, project.name);
    assert.equal(result.data.repos.length, 1);
    assert.equal(result.data.systems.length, 1);
    assert.ok('counts' in result.data);
    assert.ok('momentum' in result.data);
  });

  it('returns detail by name', async () => {
    const project = seedProject(db, { name: 'Unique Project Name' });
    const result = await callTool(tools, 'shadow_project_detail', { name: 'Unique Project Name' }) as any;
    assert.equal(result.data.id, project.id);
  });
});

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

describe('shadow_relation_add', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = entityTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('creates relation', async () => {
    const repo = seedRepo(db);
    const system = seedSystem(db);
    const result = await callTool(tools, 'shadow_relation_add', {
      sourceType: 'repo', sourceId: repo.id, relation: 'uses', targetType: 'system', targetId: system.id,
    }) as any;
    assert.ok(result.data.id);
    assert.equal(result.data.relation, 'uses');
  });
});

describe('shadow_relation_list', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;
  let repoId: string;
  let systemId: string;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = entityTools(env.ctx);
    db = env.db;
    const repo = seedRepo(db);
    const system = seedSystem(db);
    repoId = repo.id;
    systemId = system.id;
    db.createRelation({ sourceType: 'repo', sourceId: repoId, relation: 'depends_on', targetType: 'system', targetId: systemId, sourceOrigin: 'manual' });
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('lists all relations', async () => {
    const result = await callTool(tools, 'shadow_relation_list', {}) as { data: any[] };
    assert.ok(result.data.length >= 1);
  });

  it('filters by sourceId', async () => {
    const result = await callTool(tools, 'shadow_relation_list', { sourceId: repoId }) as { data: any[] };
    assert.ok(result.data.length >= 1);
    assert.ok(result.data.every((r: any) => r.sourceId === repoId));
  });
});

describe('shadow_relation_remove', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = entityTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('removes relation', async () => {
    const repo = seedRepo(db);
    const system = seedSystem(db);
    const rel = db.createRelation({ sourceType: 'repo', sourceId: repo.id, relation: 'uses', targetType: 'system', targetId: system.id, sourceOrigin: 'manual' });
    const result = await callTool(tools, 'shadow_relation_remove', { relationId: rel.id }) as any;
    assert.equal(result.ok, true);
  });
});
