import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestToolContext, callTool, assertNotFound, seedRepo, seedTask, seedProject } from './_test-helpers.js';
import { taskTools } from './tasks.js';
import type { McpTool } from './types.js';

// ---------------------------------------------------------------------------
// shadow_tasks (list)
// ---------------------------------------------------------------------------

describe('shadow_tasks', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let repoId: string;
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 2 });
    tools = taskTools(env.ctx);
    db = env.db;
    repoId = seedRepo(db).id;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns empty for fresh DB', async () => {
    const result = await callTool(tools, 'shadow_tasks', {}) as { data: { tasks: unknown[]; total: number } };
    assert.equal(result.data.tasks.length, 0);
    assert.equal(result.data.total, 0);
  });

  it('returns tasks after creation', async () => {
    seedTask(db, [repoId]);
    seedTask(db, [repoId]);
    const result = await callTool(tools, 'shadow_tasks', {}) as { data: { tasks: any[]; total: number } };
    assert.equal(result.data.tasks.length, 2);
  });

  it('filters by status', async () => {
    db.createTask({ title: 'blocked-task', status: 'blocked', repoIds: [repoId] });
    const result = await callTool(tools, 'shadow_tasks', { status: 'blocked' }) as { data: { tasks: any[]; total: number } };
    assert.ok(result.data.tasks.length >= 1);
    assert.ok(result.data.tasks.every((t: any) => t.status === 'blocked'));
  });

  it('filters by projectId', async () => {
    const project = seedProject(db);
    db.createTask({ title: 'project-task', projectId: project.id, repoIds: [repoId] });
    const result = await callTool(tools, 'shadow_tasks', { projectId: project.id }) as { data: { tasks: any[] } };
    assert.ok(result.data.tasks.length >= 1);
  });
});

// ---------------------------------------------------------------------------
// shadow_task_create
// ---------------------------------------------------------------------------

describe('shadow_task_create', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let repoId: string;
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = taskTools(env.ctx);
    db = env.db;
    repoId = seedRepo(db).id;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('creates task with minimal fields', async () => {
    const result = await callTool(tools, 'shadow_task_create', { title: 'Simple task' }) as { data: { task: any; message: string } };
    assert.ok(result.data.task.id);
    assert.equal(result.data.task.title, 'Simple task');
    assert.equal(result.data.task.status, 'open');
  });

  it('creates task with all optional fields', async () => {
    const result = await callTool(tools, 'shadow_task_create', {
      title: 'Full task',
      status: 'active',
      contextMd: '## Context\nSome markdown',
      repoIds: [repoId],
      sessionId: 'session-123',
      sessionRepoPath: '/tmp/test',
    }) as { data: { task: any } };
    assert.equal(result.data.task.title, 'Full task');
    assert.equal(result.data.task.status, 'active');
    assert.equal(result.data.task.contextMd, '## Context\nSome markdown');
    assert.deepEqual(result.data.task.repoIds, [repoId]);
  });

  it('creates task with external refs', async () => {
    const result = await callTool(tools, 'shadow_task_create', {
      title: 'Jira task',
      externalRefs: [{ source: 'jira', key: 'PROJ-123', url: 'https://jira.example.com/PROJ-123' }],
    }) as { data: { task: any } };
    assert.ok(result.data.task.externalRefs.length === 1);
    assert.equal(result.data.task.externalRefs[0].source, 'jira');
  });
});

// ---------------------------------------------------------------------------
// shadow_task_update
// ---------------------------------------------------------------------------

describe('shadow_task_update', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = taskTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns not-found for nonexistent task', async () => {
    const result = await callTool(tools, 'shadow_task_update', { id: 'nonexistent', title: 'x' });
    assertNotFound(result);
  });

  it('updates status', async () => {
    const task = seedTask(db);
    const result = await callTool(tools, 'shadow_task_update', { id: task.id, status: 'active' }) as { data: { task: any } };
    assert.equal(result.data.task.status, 'active');
  });

  it('sets closedAt when status becomes done', async () => {
    const task = seedTask(db);
    const result = await callTool(tools, 'shadow_task_update', { id: task.id, status: 'done' }) as { data: { task: any } };
    assert.equal(result.data.task.status, 'done');
    assert.ok(result.data.task.closedAt);
  });

  it('clears closedAt when reopened from done', async () => {
    const task = seedTask(db);
    await callTool(tools, 'shadow_task_update', { id: task.id, status: 'done' });
    const result = await callTool(tools, 'shadow_task_update', { id: task.id, status: 'open' }) as { data: { task: any } };
    assert.equal(result.data.task.status, 'open');
    assert.equal(result.data.task.closedAt, null);
  });

  it('updates title', async () => {
    const task = seedTask(db);
    const result = await callTool(tools, 'shadow_task_update', { id: task.id, title: 'New title' }) as { data: { task: any } };
    assert.equal(result.data.task.title, 'New title');
  });
});

// ---------------------------------------------------------------------------
// shadow_task_close
// ---------------------------------------------------------------------------

describe('shadow_task_close', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = taskTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns not-found', async () => {
    const result = await callTool(tools, 'shadow_task_close', { id: 'nonexistent' });
    assertNotFound(result);
  });

  it('closes task', async () => {
    const task = seedTask(db);
    const result = await callTool(tools, 'shadow_task_close', { id: task.id }) as { data: { task: any; message: string } };
    assert.equal(result.data.task.status, 'done');
    assert.ok(result.data.task.closedAt);
    assert.ok(result.data.message.includes(task.title));
  });
});

// ---------------------------------------------------------------------------
// shadow_task_archive
// ---------------------------------------------------------------------------

describe('shadow_task_archive', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = taskTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns not-found', async () => {
    const result = await callTool(tools, 'shadow_task_archive', { id: 'nonexistent' });
    assertNotFound(result);
  });

  it('archives task', async () => {
    const task = seedTask(db);
    const result = await callTool(tools, 'shadow_task_archive', { id: task.id }) as any;
    assert.equal(result.ok, true);
    assert.equal(result.data.archived, true);
    const updated = db.getTask(task.id)!;
    assert.equal(updated.archived, true);
  });
});

// ---------------------------------------------------------------------------
// shadow_task_execute
// ---------------------------------------------------------------------------

describe('shadow_task_execute', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let repoId: string;
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 2 });
    tools = taskTools(env.ctx);
    db = env.db;
    repoId = seedRepo(db).id;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns not-found', async () => {
    const result = await callTool(tools, 'shadow_task_execute', { id: 'nonexistent' });
    assertNotFound(result);
  });

  it('rejects task with no repos', async () => {
    const task = seedTask(db, []);
    const result = await callTool(tools, 'shadow_task_execute', { id: task.id }) as any;
    assert.equal(result.ok, false);
    assert.ok((result.error as string).includes('no repos'));
  });

  it('creates run from task and sets task to active', async () => {
    const task = seedTask(db, [repoId]);
    const result = await callTool(tools, 'shadow_task_execute', { id: task.id }) as any;
    assert.equal(result.ok, true);
    assert.ok(result.data.runId);
    const updated = db.getTask(task.id)!;
    assert.equal(updated.status, 'active');
    const run = db.getRun(result.data.runId as string)!;
    assert.equal(run.taskId, task.id);
  });
});

// ---------------------------------------------------------------------------
// shadow_task_remove
// ---------------------------------------------------------------------------

describe('shadow_task_remove', () => {
  let tools: McpTool[];
  let db: ReturnType<typeof createTestToolContext>['db'];
  let cleanup: () => void;

  before(() => {
    const env = createTestToolContext({ trustLevel: 1 });
    tools = taskTools(env.ctx);
    db = env.db;
    cleanup = env.cleanup;
  });
  after(() => cleanup());

  it('returns not-found', async () => {
    const result = await callTool(tools, 'shadow_task_remove', { id: 'nonexistent' });
    assertNotFound(result);
  });

  it('deletes task', async () => {
    const task = seedTask(db);
    const result = await callTool(tools, 'shadow_task_remove', { id: task.id }) as any;
    assert.ok(result.data.message);
    assert.equal(db.getTask(task.id), null);
  });
});
