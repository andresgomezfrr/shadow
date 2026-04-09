import { z } from 'zod';
import type { McpTool, ToolContext } from './types.js';
import { mcpSchema } from './types.js';

export function taskTools(ctx: ToolContext): McpTool[] {
  return [
    {
      name: 'shadow_tasks',
      description: 'List tasks with optional filters (status, repoId, projectId). Returns task containers for ongoing work.',
      inputSchema: mcpSchema(z.object({
        status: z.enum(['todo', 'in_progress', 'blocked', 'closed']).optional().describe('Filter by status'),
        repoId: z.string().optional().describe('Filter by repo ID'),
        projectId: z.string().optional().describe('Filter by project ID'),
        limit: z.number().optional().describe('Max results (default 20)'),
      })),
      handler: async (params) => {
        const tasks = ctx.db.listTasks({
          status: params.status as string | undefined,
          repoId: params.repoId as string | undefined,
          projectId: params.projectId as string | undefined,
          limit: (params.limit as number) ?? 20,
        });
        return { tasks, total: ctx.db.countTasks({ status: params.status as string | undefined }) };
      },
    },
    {
      name: 'shadow_task_create',
      description: 'Create a new task — a work container for tracking ongoing work. Can link to external tickets (Jira, GitHub), repos, projects, and a Claude session for resuming later.',
      inputSchema: mcpSchema(z.object({
        title: z.string().describe('Task title'),
        status: z.enum(['todo', 'in_progress', 'blocked']).optional().describe('Initial status (default: todo)'),
        contextMd: z.string().optional().describe('Rich context in markdown (e.g., from Jira ticket details)'),
        externalRefs: z.array(z.object({
          source: z.string().describe('Source system (e.g., "jira", "github", "linear")'),
          key: z.string().describe('Ticket key (e.g., "PROJ-123")'),
          url: z.string().describe('URL to the ticket'),
        })).optional().describe('External ticket references'),
        repoIds: z.array(z.string()).optional().describe('Associated repo IDs'),
        projectId: z.string().optional().describe('Parent project ID'),
        sessionId: z.string().optional().describe('Claude session ID for resuming work'),
        sessionRepoPath: z.string().optional().describe('Working directory path for the session'),
      })),
      handler: async (params) => {
        const gate = ctx.trustGate(1);
        if (!gate.ok) return gate.error;
        const task = ctx.db.createTask({
          title: params.title as string,
          status: (params.status as string) ?? 'todo',
          contextMd: params.contextMd as string | undefined,
          externalRefs: params.externalRefs as { source: string; key: string; url: string }[] | undefined,
          repoIds: params.repoIds as string[] | undefined,
          projectId: params.projectId as string | undefined,
          sessionId: params.sessionId as string | undefined,
          sessionRepoPath: params.sessionRepoPath as string | undefined,
        });
        return { task, message: `Task "${task.title}" created` };
      },
    },
    {
      name: 'shadow_task_update',
      description: 'Update a task — change status, add context, link session, add PRs or external refs. All states can transition freely.',
      inputSchema: mcpSchema(z.object({
        id: z.string().describe('Task ID'),
        title: z.string().optional(),
        status: z.enum(['todo', 'in_progress', 'blocked', 'closed']).optional(),
        contextMd: z.string().optional(),
        externalRefs: z.array(z.object({
          source: z.string(),
          key: z.string(),
          url: z.string(),
        })).optional().describe('Replace all external refs'),
        repoIds: z.array(z.string()).optional().describe('Replace all repo IDs'),
        projectId: z.string().nullable().optional(),
        sessionId: z.string().nullable().optional(),
        sessionRepoPath: z.string().nullable().optional(),
        prUrls: z.array(z.string()).optional().describe('Replace all PR URLs'),
      })),
      handler: async (params) => {
        const gate = ctx.trustGate(1);
        if (!gate.ok) return gate.error;
        const id = params.id as string;
        const task = ctx.db.getTask(id);
        if (!task) return { isError: true, message: `Task ${id} not found` };
        const updates: Record<string, unknown> = {};
        for (const key of ['title', 'status', 'contextMd', 'externalRefs', 'repoIds', 'projectId', 'sessionId', 'sessionRepoPath', 'prUrls']) {
          if (params[key] !== undefined) updates[key] = params[key];
        }
        if (updates.status === 'closed' && !task.closedAt) updates.closedAt = new Date().toISOString();
        if (updates.status && updates.status !== 'closed') updates.closedAt = null;
        ctx.db.updateTask(id, updates as Parameters<typeof ctx.db.updateTask>[1]);
        return { task: ctx.db.getTask(id), message: 'Task updated' };
      },
    },
    {
      name: 'shadow_task_close',
      description: 'Close a task (mark as closed/done).',
      inputSchema: mcpSchema(z.object({
        id: z.string().describe('Task ID'),
      })),
      handler: async (params) => {
        const gate = ctx.trustGate(1);
        if (!gate.ok) return gate.error;
        const id = params.id as string;
        const task = ctx.db.getTask(id);
        if (!task) return { isError: true, message: `Task ${id} not found` };
        ctx.db.updateTask(id, { status: 'closed', closedAt: new Date().toISOString() });
        return { task: ctx.db.getTask(id), message: `Task "${task.title}" closed` };
      },
    },
    {
      name: 'shadow_task_remove',
      description: 'Permanently delete a task.',
      inputSchema: mcpSchema(z.object({
        id: z.string().describe('Task ID'),
      })),
      handler: async (params) => {
        const gate = ctx.trustGate(1);
        if (!gate.ok) return gate.error;
        const id = params.id as string;
        const task = ctx.db.getTask(id);
        if (!task) return { isError: true, message: `Task ${id} not found` };
        ctx.db.deleteTask(id);
        return { message: `Task "${task.title}" deleted` };
      },
    },
  ];
}
