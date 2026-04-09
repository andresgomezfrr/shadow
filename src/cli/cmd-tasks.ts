import type { Command } from 'commander';
import type { ShadowConfig } from '../config/load-config.js';
import type { WithDb } from './types.js';

export function registerTaskCommands(program: Command, _config: ShadowConfig, withDb: WithDb): void {
  const task = program.command('task').description('manage work tasks');

  task
    .command('list')
    .description('list tasks')
    .option('--status <status>', 'filter by status (todo, in_progress, blocked, closed)')
    .option('--limit <n>', 'max results', '20')
    .action((options: { status?: string; limit: string }) =>
      withDb((db) => {
        const tasks = db.listTasks({ status: options.status, limit: Number(options.limit) });
        return tasks.map(t => ({
          id: t.id,
          title: t.title,
          status: t.status,
          refs: t.externalRefs.map(r => `${r.source}:${r.key}`).join(', ') || '-',
          session: t.sessionId ? 'yes' : '-',
          updated: t.updatedAt,
        }));
      }),
    );

  task
    .command('create <title>')
    .description('create a new task')
    .option('--ref <url>', 'external ticket URL')
    .option('--repo <path>', 'repo path to link')
    .option('--project <id>', 'project ID')
    .option('--session <id>', 'Claude session ID')
    .option('--status <status>', 'initial status (default: todo)')
    .action((title: string, options: { ref?: string; repo?: string; project?: string; session?: string; status?: string }) =>
      withDb((db) => {
        const externalRefs = options.ref ? [{ source: 'link', key: options.ref.split('/').pop() ?? options.ref, url: options.ref }] : [];
        let repoIds: string[] = [];
        if (options.repo) {
          const repo = db.listRepos().find(r => r.path === options.repo || r.name === options.repo);
          if (repo) repoIds = [repo.id];
        }
        const task = db.createTask({
          title,
          status: options.status,
          externalRefs,
          repoIds,
          projectId: options.project,
          sessionId: options.session,
          sessionRepoPath: options.repo,
        });
        return { id: task.id, title: task.title, status: task.status };
      }),
    );

  task
    .command('update <id>')
    .description('update a task')
    .option('--status <status>', 'new status')
    .option('--title <title>', 'new title')
    .option('--add-ref <url>', 'add external ref')
    .option('--add-pr <url>', 'add PR URL')
    .option('--session <id>', 'set session ID')
    .action((id: string, options: { status?: string; title?: string; addRef?: string; addPr?: string; session?: string }) =>
      withDb((db) => {
        const task = db.getTask(id);
        if (!task) throw new Error(`Task ${id} not found`);
        const updates: Record<string, unknown> = {};
        if (options.status) {
          updates.status = options.status;
          if (options.status === 'closed') updates.closedAt = new Date().toISOString();
          else updates.closedAt = null;
        }
        if (options.title) updates.title = options.title;
        if (options.addRef) {
          const refs = [...task.externalRefs, { source: 'link', key: options.addRef.split('/').pop() ?? options.addRef, url: options.addRef }];
          updates.externalRefs = refs;
        }
        if (options.addPr) {
          updates.prUrls = [...task.prUrls, options.addPr];
        }
        if (options.session) updates.sessionId = options.session;
        db.updateTask(id, updates as Parameters<typeof db.updateTask>[1]);
        return db.getTask(id);
      }),
    );

  task
    .command('close <id>')
    .description('close a task')
    .action((id: string) =>
      withDb((db) => {
        const task = db.getTask(id);
        if (!task) throw new Error(`Task ${id} not found`);
        db.updateTask(id, { status: 'closed', closedAt: new Date().toISOString() });
        return { id, status: 'closed' };
      }),
    );

  task
    .command('remove <id>')
    .description('permanently delete a task')
    .action((id: string) =>
      withDb((db) => {
        const task = db.getTask(id);
        if (!task) throw new Error(`Task ${id} not found`);
        db.deleteTask(id);
        return { id, deleted: true };
      }),
    );
}
