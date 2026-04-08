import { z } from 'zod';
import { resolve, basename } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

import { mcpSchema, type McpTool, type ToolContext } from './types.js';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const ReposSchema = z.object({
  filter: z.string().describe('Optional name filter substring').optional(),
});

const RepoAddSchema = z.object({
  path: z.string().describe('Absolute path to the repository'),
  name: z.string().describe('Display name (defaults to directory name)').optional(),
  defaultBranch: z.string().describe('Default branch (defaults to main)').optional(),
  languageHint: z.string().describe('Primary language hint').optional(),
});

const RepoUpdateSchema = z.object({
  repoId: z.string().describe('Repository ID to update'),
  name: z.string().describe('New display name').optional(),
  remoteUrl: z.string().describe('Remote URL').optional(),
  defaultBranch: z.string().describe('Default branch').optional(),
  languageHint: z.string().describe('Primary language hint').optional(),
  testCommand: z.string().describe('Command to run tests (e.g., "npm test")').optional(),
  lintCommand: z.string().describe('Command to run linter (e.g., "npm run lint")').optional(),
  buildCommand: z.string().describe('Command to build the project (e.g., "npm run build")').optional(),
});

const RepoRemoveSchema = z.object({
  repoId: z.string().describe('Repository ID to remove'),
});

const ContactsSchema = z.object({
  team: z.string().describe('Filter by team name').optional(),
});

const ContactAddSchema = z.object({
  name: z.string().describe('Contact name'),
  role: z.string().describe('Role (e.g., backend, frontend, devops)').optional(),
  team: z.string().describe('Team name').optional(),
  email: z.string().describe('Email address').optional(),
  slackId: z.string().describe('Slack user ID or handle').optional(),
  githubHandle: z.string().describe('GitHub username').optional(),
  notesMd: z.string().describe('Additional notes in markdown').optional(),
  preferredChannel: z.string().describe('Preferred contact channel: slack, email, github').optional(),
});

const ContactRemoveSchema = z.object({
  contactId: z.string().describe('Contact ID to remove'),
});

const SystemsSchema = z.object({
  kind: z.string().describe('Filter by system kind').optional(),
});

const SystemAddSchema = z.object({
  name: z.string().describe('System name'),
  kind: z.string().describe('Type: infra, service, tool, platform, database, queue, monitoring'),
  url: z.string().describe('URL or endpoint').optional(),
  description: z.string().describe('Description of the system').optional(),
  accessMethod: z.string().describe('Access method: mcp, api, cli, manual').optional(),
  healthCheck: z.string().describe('Health check command or URL').optional(),
  logsLocation: z.string().describe('Where to find logs (e.g., "CloudWatch /auth/*", "docker logs auth")').optional(),
  deployMethod: z.string().describe('How to deploy (e.g., "ArgoCD auto-deploy on merge to main")').optional(),
  debugGuide: z.string().describe('How to debug (e.g., "Start with JWT endpoint, check Redis pool")').optional(),
});

const SystemRemoveSchema = z.object({
  systemId: z.string().describe('System ID to remove'),
});

const ProjectsSchema = z.object({
  status: z.string().describe('Filter by status: active (default), completed, on-hold, archived').optional(),
});

const ProjectAddSchema = z.object({
  name: z.string().describe('Project name (unique)'),
  kind: z.string().describe('Type: long-term, sprint, or task').optional(),
  description: z.string().describe('Project description').optional(),
  repoIds: z.array(z.string()).describe('Repo IDs to link').optional(),
  systemIds: z.array(z.string()).describe('System IDs to link').optional(),
  contactIds: z.array(z.string()).describe('Contact IDs to link').optional(),
  startDate: z.string().describe('Start date (ISO format)').optional(),
  endDate: z.string().describe('End date (ISO format, for sprints/tasks)').optional(),
});

const ProjectRemoveSchema = z.object({
  projectId: z.string().describe('Project ID to remove'),
});

const ProjectUpdateSchema = z.object({
  projectId: z.string().describe('Project ID to update'),
  name: z.string().describe('New project name').optional(),
  description: z.string().describe('New description').optional(),
  kind: z.string().describe('New kind: long-term, sprint, task').optional(),
  status: z.string().describe('New status: active, completed, on-hold, archived').optional(),
  repoIds: z.array(z.string()).describe('Replace linked repo IDs').optional(),
  systemIds: z.array(z.string()).describe('Replace linked system IDs').optional(),
  contactIds: z.array(z.string()).describe('Replace linked contact IDs').optional(),
  startDate: z.string().describe('Start date (ISO)').optional(),
  endDate: z.string().describe('End date (ISO)').optional(),
  notesMd: z.string().describe('Notes in markdown').optional(),
});

const ProjectDetailSchema = z.object({
  projectId: z.string().describe('Project ID').optional(),
  name: z.string().describe('Project name (alternative to projectId)').optional(),
});

const RelationAddSchema = z.object({
  sourceType: z.enum(['repo', 'project', 'system', 'contact']).describe('Source entity type'),
  sourceId: z.string().describe('Source entity ID'),
  relation: z.enum(['depends_on', 'uses', 'owned_by', 'related_to', 'part_of', 'deploys_to', 'consumes']).describe('Relationship type'),
  targetType: z.enum(['repo', 'project', 'system', 'contact']).describe('Target entity type'),
  targetId: z.string().describe('Target entity ID'),
});

const RelationListSchema = z.object({
  sourceType: z.string().describe('Filter by source entity type').optional(),
  sourceId: z.string().describe('Filter by source entity ID').optional(),
  targetType: z.string().describe('Filter by target entity type').optional(),
  targetId: z.string().describe('Filter by target entity ID').optional(),
  relation: z.string().describe('Filter by relationship type').optional(),
});

const RelationRemoveSchema = z.object({
  relationId: z.string().describe('The relation ID to remove'),
});

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export function entityTools(ctx: ToolContext): McpTool[] {
  const { db, config, trustGate } = ctx;

  return [
    // ---- Repos ----
    {
      name: 'shadow_repos',
      description: 'Returns a list of tracked repositories. Optionally filter by name substring.',
      inputSchema: mcpSchema(ReposSchema),
      handler: async (params) => {
        const { filter } = ReposSchema.parse(params);
        let repos = db.listRepos();
        if (filter) {
          const lower = filter.toLowerCase();
          repos = repos.filter((r) => r.name.toLowerCase().includes(lower));
        }
        return repos;
      },
    },
    {
      name: 'shadow_repo_add',
      description: 'Register a new repository for Shadow to watch. Requires trust level >= 1.',
      inputSchema: mcpSchema(RepoAddSchema),
      handler: async (params) => {
        const gate = trustGate(1);
        if (!gate.ok) return gate.error;

        const { path: rawPath, name, defaultBranch, languageHint } = RepoAddSchema.parse(params);
        const repoPath = resolve(rawPath);

        // Validate path is a directory
        if (!existsSync(repoPath) || !statSync(repoPath).isDirectory()) {
          return { isError: true, message: `Path does not exist or is not a directory: ${repoPath}` };
        }

        // Validate it's a git repository
        try {
          execFileSync('git', ['rev-parse', '--git-dir'], { cwd: repoPath, stdio: 'pipe', timeout: 5_000 });
        } catch {
          return { isError: true, message: `Not a git repository: ${repoPath}` };
        }

        const repoName = name ?? (basename(repoPath) || repoPath);

        const existing = db.findRepoByPath(repoPath);
        if (existing) return { isError: true, message: `Repo already registered: ${existing.name} (${existing.id})` };

        return db.createRepo({
          path: repoPath,
          name: repoName,
          defaultBranch: defaultBranch ?? 'main',
          languageHint: languageHint ?? null,
        });
      },
    },
    {
      name: 'shadow_repo_update',
      description: 'Update a tracked repository (name, commands, branch, etc). Requires trust level >= 1.',
      inputSchema: mcpSchema(RepoUpdateSchema),
      handler: async (params) => {
        const gate = trustGate(1);
        if (!gate.ok) return gate.error;

        const p = RepoUpdateSchema.parse(params);
        const repo = db.getRepo(p.repoId);
        if (!repo) return { isError: true, message: `Repo not found: ${p.repoId}` };

        const updates: Record<string, unknown> = {};
        for (const key of ['name', 'remoteUrl', 'defaultBranch', 'languageHint', 'testCommand', 'lintCommand', 'buildCommand'] as const) {
          if (p[key] !== undefined) updates[key] = p[key];
        }

        if (Object.keys(updates).length === 0) return { isError: true, message: 'No fields to update' };

        db.updateRepo(p.repoId, updates as Parameters<typeof db.updateRepo>[1]);
        return db.getRepo(p.repoId);
      },
    },
    {
      name: 'shadow_repo_remove',
      description: 'Stop watching a repository. Requires trust level >= 1.',
      inputSchema: mcpSchema(RepoRemoveSchema),
      handler: async (params) => {
        const gate = trustGate(1);
        if (!gate.ok) return gate.error;

        const { repoId } = RepoRemoveSchema.parse(params);
        const repo = db.getRepo(repoId);
        if (!repo) return { isError: true, message: `Repo not found: ${repoId}` };

        db.deleteRepo(repoId);
        return { ok: true, removed: repoId, name: repo.name };
      },
    },

    // ---- Contacts ----
    {
      name: 'shadow_contacts',
      description: 'Returns contacts. Optionally filter by team.',
      inputSchema: mcpSchema(ContactsSchema),
      handler: async (params) => {
        const { team } = ContactsSchema.parse(params);
        return db.listContacts(team ? { team } : undefined);
      },
    },
    {
      name: 'shadow_contact_add',
      description: 'Add a team member to Shadow\'s contacts. Requires trust level >= 1.',
      inputSchema: mcpSchema(ContactAddSchema),
      handler: async (params) => {
        const gate = trustGate(1);
        if (!gate.ok) return gate.error;

        const p = ContactAddSchema.parse(params);
        return db.createContact({
          name: p.name,
          role: p.role ?? null,
          team: p.team ?? null,
          email: p.email ?? null,
          slackId: p.slackId ?? null,
          githubHandle: p.githubHandle ?? null,
          notesMd: p.notesMd ?? null,
          preferredChannel: p.preferredChannel ?? null,
        });
      },
    },
    {
      name: 'shadow_contact_remove',
      description: 'Remove a contact. Requires trust level >= 1.',
      inputSchema: mcpSchema(ContactRemoveSchema),
      handler: async (params) => {
        const gate = trustGate(1);
        if (!gate.ok) return gate.error;

        const { contactId } = ContactRemoveSchema.parse(params);
        const contact = db.getContact(contactId);
        if (!contact) return { isError: true, message: `Contact not found: ${contactId}` };

        db.deleteContact(contactId);
        return { ok: true, removed: contactId, name: contact.name };
      },
    },

    // ---- Systems ----
    {
      name: 'shadow_systems',
      description: 'Returns tracked systems. Optionally filter by kind.',
      inputSchema: mcpSchema(SystemsSchema),
      handler: async (params) => {
        const { kind } = SystemsSchema.parse(params);
        return db.listSystems(kind ? { kind } : undefined);
      },
    },
    {
      name: 'shadow_system_add',
      description: 'Register an infrastructure system or service with operational knowledge. Requires trust level >= 1.',
      inputSchema: mcpSchema(SystemAddSchema),
      handler: async (params) => {
        const gate = trustGate(1);
        if (!gate.ok) return gate.error;

        const p = SystemAddSchema.parse(params);
        return db.createSystem({
          name: p.name,
          kind: p.kind,
          url: p.url ?? null,
          description: p.description ?? null,
          accessMethod: p.accessMethod ?? null,
          healthCheck: p.healthCheck ?? null,
          logsLocation: p.logsLocation ?? null,
          deployMethod: p.deployMethod ?? null,
          debugGuide: p.debugGuide ?? null,
        });
      },
    },
    {
      name: 'shadow_system_remove',
      description: 'Remove a registered system. Requires trust level >= 1.',
      inputSchema: mcpSchema(SystemRemoveSchema),
      handler: async (params) => {
        const gate = trustGate(1);
        if (!gate.ok) return gate.error;

        const { systemId } = SystemRemoveSchema.parse(params);
        const system = db.getSystem(systemId);
        if (!system) return { isError: true, message: `System not found: ${systemId}` };

        db.deleteSystem(systemId);
        return { ok: true, removed: systemId, name: system.name };
      },
    },

    // ---- Projects ----
    {
      name: 'shadow_projects',
      description: 'Returns tracked projects. Optionally filter by status.',
      inputSchema: mcpSchema(ProjectsSchema),
      handler: async (params) => {
        const { status } = ProjectsSchema.parse(params);
        return db.listProjects(status ? { status } : undefined);
      },
    },
    {
      name: 'shadow_project_add',
      description: 'Create a project that groups repos, systems, and contacts. Requires trust level >= 1.',
      inputSchema: mcpSchema(ProjectAddSchema),
      handler: async (params) => {
        const gate = trustGate(1);
        if (!gate.ok) return gate.error;

        const p = ProjectAddSchema.parse(params);
        return db.createProject({
          name: p.name,
          kind: p.kind ?? 'long-term',
          description: p.description ?? null,
          repoIds: p.repoIds ?? [],
          systemIds: p.systemIds ?? [],
          contactIds: p.contactIds ?? [],
          startDate: p.startDate ?? null,
          endDate: p.endDate ?? null,
        });
      },
    },
    {
      name: 'shadow_project_remove',
      description: 'Remove a project. Requires trust level >= 1.',
      inputSchema: mcpSchema(ProjectRemoveSchema),
      handler: async (params) => {
        const gate = trustGate(1);
        if (!gate.ok) return gate.error;

        const { projectId } = ProjectRemoveSchema.parse(params);
        const project = db.getProject(projectId);
        if (!project) return { isError: true, message: `Project not found: ${projectId}` };

        db.deleteProject(projectId);
        return { ok: true, removed: projectId, name: project.name };
      },
    },
    {
      name: 'shadow_project_update',
      description: 'Update a project (repos, systems, contacts, status, etc). Requires trust level >= 1.',
      inputSchema: mcpSchema(ProjectUpdateSchema),
      handler: async (params) => {
        const gate = trustGate(1);
        if (!gate.ok) return gate.error;

        const p = ProjectUpdateSchema.parse(params);
        const project = db.getProject(p.projectId);
        if (!project) return { isError: true, message: `Project not found: ${p.projectId}` };

        const updates: Record<string, unknown> = {};
        for (const key of ['name', 'description', 'kind', 'status', 'repoIds', 'systemIds', 'contactIds', 'startDate', 'endDate', 'notesMd'] as const) {
          if (p[key] !== undefined) updates[key] = p[key];
        }

        return db.updateProject(p.projectId, updates as Parameters<typeof db.updateProject>[1]);
      },
    },
    {
      name: 'shadow_active_projects',
      description: 'Returns projects detected as actively being worked on, based on recent interactions and conversations. Includes activity scores and momentum.',
      inputSchema: mcpSchema(z.object({})),
      handler: async () => {
        const { readFileSync } = await import('node:fs');
        const { detectActiveProjects, computeProjectMomentum } = await import('../../analysis/project-detection.js');

        // Load recent interactions (last 2h)
        const sinceMs = Date.now() - 2 * 60 * 60 * 1000;
        let interactions: Array<{ file: string; tool: string; ts: string }> = [];
        try {
          const intPath = resolve(config.resolvedDataDir, 'interactions.jsonl');
          const lines = readFileSync(intPath, 'utf8').trim().split('\n').filter(Boolean);
          interactions = lines.flatMap(line => {
            try {
              const e = JSON.parse(line) as { ts: string; tool: string; file?: string };
              return new Date(e.ts).getTime() > sinceMs ? [{ ts: e.ts, tool: e.tool, file: e.file ?? '' }] : [];
            } catch { return []; }
          });
        } catch { /* no file */ }

        // Load recent conversations
        let conversations: Array<{ text: string }> = [];
        try {
          const convPath = resolve(config.resolvedDataDir, 'conversations.jsonl');
          const lines = readFileSync(convPath, 'utf8').trim().split('\n').filter(Boolean);
          conversations = lines.flatMap(line => {
            try {
              const e = JSON.parse(line) as { ts: string; text?: string };
              return new Date(e.ts).getTime() > sinceMs && e.text ? [{ text: e.text }] : [];
            } catch { return []; }
          });
        } catch { /* no file */ }

        const active = detectActiveProjects(db, interactions, conversations);
        return active.map(ap => ({
          ...ap,
          momentum: computeProjectMomentum(db, ap.projectId, 7),
        }));
      },
    },
    {
      name: 'shadow_project_detail',
      description: 'Returns detailed view of a project including linked repos, systems, contacts, and counts of observations, suggestions, and memories related to it.',
      inputSchema: mcpSchema(ProjectDetailSchema),
      handler: async (params) => {
        const p = ProjectDetailSchema.parse(params);
        let project = p.projectId ? db.getProject(p.projectId) : null;
        if (!project && p.name) {
          project = db.findProjectByName(p.name);
        }
        if (!project) return { error: 'Project not found' };

        const repos = project.repoIds.map(id => db.getRepo(id)).filter(Boolean).map(r => ({ id: r!.id, name: r!.name, path: r!.path }));
        const systems = project.systemIds.map(id => db.getSystem(id)).filter(Boolean).map(s => ({ id: s!.id, name: s!.name, kind: s!.kind }));
        const contacts = project.contactIds.map(id => db.getContact(id)).filter(Boolean).map(c => ({ id: c!.id, name: c!.name, role: c!.role }));

        const observations = db.listObservations({ status: 'active', limit: 50 })
          .filter(o => (o.entities ?? []).some(e => e.type === 'project' && e.id === project!.id));
        const suggestions = db.listSuggestions({ status: 'pending' })
          .filter(s => (s.entities ?? []).some(e => e.type === 'project' && e.id === project!.id));
        const memories = db.listMemories({ archived: false })
          .filter(m => (m.entities ?? []).some(e => e.type === 'project' && e.id === project!.id));

        let enrichment: unknown[] = [];
        try {
          enrichment = db.listEnrichment({ limit: 10 })
            .filter(e => e.entityType === 'project' && e.entityId === project!.id)
            .map(e => ({ source: e.source, summary: e.summary, createdAt: e.createdAt }));
        } catch { /* enrichment_cache may not exist yet */ }

        // Compute momentum
        let momentum = 0;
        try {
          const { computeProjectMomentum } = await import('../../analysis/project-detection.js');
          momentum = computeProjectMomentum(db, project.id, 7);
        } catch { /* */ }

        return {
          ...project,
          repos, systems, contacts,
          momentum,
          counts: {
            observations: observations.length,
            suggestions: suggestions.length,
            memories: memories.length,
          },
          topObservations: observations.slice(0, 5).map(o => ({ id: o.id, kind: o.kind, severity: o.severity, title: o.title })),
          topSuggestions: suggestions.slice(0, 5).map(s => ({ id: s.id, kind: s.kind, title: s.title, impactScore: s.impactScore })),
          recentMemories: memories.slice(0, 5).map(m => ({ id: m.id, kind: m.kind, layer: m.layer, title: m.title })),
          enrichment,
        };
      },
    },

    // ---- Relations ----
    {
      name: 'shadow_relation_add',
      description: 'Add a relationship between two entities (e.g., "repo X depends_on system Y"). Requires trust >= 1.',
      inputSchema: mcpSchema(RelationAddSchema),
      handler: async (params) => {
        const gate = trustGate(1);
        if (!gate.ok) return gate.error;
        const p = RelationAddSchema.parse(params);
        return db.createRelation({
          sourceType: p.sourceType,
          sourceId: p.sourceId,
          relation: p.relation,
          targetType: p.targetType,
          targetId: p.targetId,
          sourceOrigin: 'manual',
        });
      },
    },
    {
      name: 'shadow_relation_list',
      description: 'List entity relationships. Optionally filter by source/target type and ID.',
      inputSchema: mcpSchema(RelationListSchema),
      handler: async (params) => {
        const p = RelationListSchema.parse(params);
        return db.listRelations({
          sourceType: p.sourceType,
          sourceId: p.sourceId,
          targetType: p.targetType,
          targetId: p.targetId,
          relation: p.relation,
        });
      },
    },
    {
      name: 'shadow_relation_remove',
      description: 'Remove an entity relationship by ID. Requires trust >= 1.',
      inputSchema: mcpSchema(RelationRemoveSchema),
      handler: async (params) => {
        const gate = trustGate(1);
        if (!gate.ok) return gate.error;
        const { relationId } = RelationRemoveSchema.parse(params);
        db.deleteRelation(relationId);
        return { ok: true };
      },
    },
  ];
}
