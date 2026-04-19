import { z } from 'zod';
import type { McpTool, ToolContext } from './types.js';
import { mcpSchema, ok, err } from './types.js';

const ListTasksSchema = z.object({
  status: z.enum(['open', 'active', 'blocked', 'done']).optional().describe('Filter by status'),
  repoId: z.string().optional().describe('Filter by repo ID'),
  projectId: z.string().optional().describe('Filter by project ID'),
  limit: z.number().optional().describe('Max results (default 20)'),
});

const ExternalRefSchema = z.object({
  source: z.string().describe('Source system name'),
  key: z.string().describe('Ticket or issue key'),
  url: z.string().describe('URL to the external resource'),
});

const CreateTaskSchema = z.object({
  title: z.string().min(1).describe('Task title'),
  status: z.enum(['open', 'active', 'blocked']).optional().describe('Initial status (default: open)'),
  suggestionId: z.string().optional().describe('Link to a suggestion that originated this task'),
  contextMd: z.string().optional().describe('Rich context in markdown'),
  externalRefs: z.array(ExternalRefSchema).optional().describe('External ticket references'),
  repoIds: z.array(z.string()).optional().describe('Associated repo IDs'),
  projectId: z.string().optional().describe('Parent project ID'),
  sessionId: z.string().optional().describe('Claude session ID for resuming work'),
  sessionRepoPath: z.string().optional().describe('Working directory path for the session'),
});

const UpdateTaskSchema = z.object({
  id: z.string().describe('Task ID'),
  title: z.string().optional(),
  status: z.enum(['open', 'active', 'blocked', 'done']).optional(),
  contextMd: z.string().optional(),
  externalRefs: z.array(ExternalRefSchema).optional().describe('Replace all external refs'),
  repoIds: z.array(z.string()).optional().describe('Replace all repo IDs'),
  projectId: z.string().nullable().optional(),
  sessionId: z.string().nullable().optional(),
  sessionRepoPath: z.string().nullable().optional(),
  prUrls: z.array(z.string()).optional().describe('Replace all PR URLs'),
});

const TaskIdSchema = z.object({
  id: z.string().describe('Task ID'),
});

export function taskTools(ctx: ToolContext): McpTool[] {
  return [
    {
      name: 'shadow_tasks',
      description: 'List tasks (work containers) with optional filters: status (open/active/blocked/done), repoId, projectId. Use when the user asks what they\'re working on, what\'s blocked, or when you need a task ID for execute/close/update.',
      inputSchema: mcpSchema(ListTasksSchema),
      handler: async (params) => {
        const input = ListTasksSchema.parse(params);
        const tasks = ctx.db.listTasks({
          status: input.status,
          repoId: input.repoId,
          projectId: input.projectId,
          limit: input.limit ?? 20,
        });
        return ok({ tasks, total: ctx.db.countTasks({ status: input.status }) });
      },
    },
    {
      name: 'shadow_task_create',
      description: 'Create a new task — a work container for tracking ongoing work. Can link to external tickets (Jira, GitHub), repos, projects, and a Claude session for resuming later.',
      inputSchema: mcpSchema(CreateTaskSchema),
      handler: async (params) => {
        const input = CreateTaskSchema.parse(params);
        const task = ctx.db.createTask({
          title: input.title,
          status: input.status ?? 'open',
          suggestionId: input.suggestionId,
          contextMd: input.contextMd,
          externalRefs: input.externalRefs,
          repoIds: input.repoIds,
          projectId: input.projectId,
          sessionId: input.sessionId,
          sessionRepoPath: input.sessionRepoPath,
        });
        return ok({ task, message: `Task "${task.title}" created` });
      },
    },
    {
      name: 'shadow_task_update',
      description: 'Update a task — change status, add context, link session, add PRs or external refs. All states can transition freely.',
      inputSchema: mcpSchema(UpdateTaskSchema),
      handler: async (params) => {
        const input = UpdateTaskSchema.parse(params);
        const task = ctx.db.getTask(input.id);
        if (!task) return err(`Task ${input.id} not found`);
        const updates: Record<string, unknown> = {};
        for (const key of ['title', 'status', 'contextMd', 'externalRefs', 'repoIds', 'projectId', 'sessionId', 'sessionRepoPath', 'prUrls'] as const) {
          const value = input[key];
          if (value !== undefined) updates[key] = value;
        }
        if (updates.status === 'done' && !task.closedAt) updates.closedAt = new Date().toISOString();
        if (updates.status && updates.status !== 'done') updates.closedAt = null;
        ctx.db.updateTask(input.id, updates as Parameters<typeof ctx.db.updateTask>[1]);
        return ok({ task: ctx.db.getTask(input.id), message: 'Task updated' });
      },
    },
    {
      name: 'shadow_task_close',
      description: 'Mark a task as done, setting closedAt and transitioning status to done. Use when the user confirms the work is complete. Task remains visible in the workspace; use shadow_task_archive to hide.',
      inputSchema: mcpSchema(TaskIdSchema),
      handler: async (params) => {
        const input = TaskIdSchema.parse(params);
        const task = ctx.db.getTask(input.id);
        if (!task) return err(`Task ${input.id} not found`);
        ctx.db.updateTask(input.id, { status: 'done', closedAt: new Date().toISOString() });
        return ok({ task: ctx.db.getTask(input.id), message: `Task "${task.title}" closed` });
      },
    },
    {
      name: 'shadow_task_archive',
      description: 'Archive a task by ID to hide it from the default workspace view without deleting it. Use after the work is long-finished and the user wants a cleaner list. Requires trust level >= 1.',
      inputSchema: mcpSchema(TaskIdSchema),
      handler: async (params) => {
        const input = TaskIdSchema.parse(params);
        const task = ctx.db.getTask(input.id);
        if (!task) return err(`Task ${input.id} not found`);
        ctx.db.updateTask(input.id, { archived: true });
        return ok({ taskId: input.id, archived: true });
      },
    },
    {
      name: 'shadow_task_execute',
      description: 'Create a run from a task — spawns the runner to execute the task\'s context against its linked repos, and transitions the task to active. Use when the user wants Shadow to start working on a queued task autonomously. Requires trust level >= 2.',
      inputSchema: mcpSchema(TaskIdSchema),
      handler: async (params) => {
        const input = TaskIdSchema.parse(params);
        const task = ctx.db.getTask(input.id);
        if (!task) return err(`Task ${input.id} not found`);
        if (task.repoIds.length === 0) return err('Task has no repos linked — add repoIds first');
        const run = ctx.db.createRun({
          repoId: task.repoIds[0],
          repoIds: task.repoIds,
          taskId: task.id,
          suggestionId: task.suggestionId,
          kind: 'task',
          prompt: task.contextMd ?? task.title,
        });
        ctx.db.updateTask(input.id, { status: 'active' });
        return ok({ runId: run.id, taskId: input.id });
      },
    },
    {
      name: 'shadow_task_remove',
      description: 'Permanently delete a task by ID. Use only when the user explicitly wants the task gone (created in error, duplicate); prefer shadow_task_archive for completed work you want hidden.',
      inputSchema: mcpSchema(TaskIdSchema),
      handler: async (params) => {
        const input = TaskIdSchema.parse(params);
        const task = ctx.db.getTask(input.id);
        if (!task) return err(`Task ${input.id} not found`);
        ctx.db.deleteTask(input.id);
        return ok({ message: `Task "${task.title}" deleted` });
      },
    },
  ];
}
