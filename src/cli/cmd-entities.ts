import type { Command } from 'commander';
import type { ShadowConfig } from '../config/load-config.js';
import type { WithDb } from './types.js';
import { basename, resolve } from 'node:path';

export function registerEntityCommands(program: Command, _config: ShadowConfig, withDb: WithDb): void {
  // --- repo ---

  const repo = program.command('repo').description('manage watched repositories');

  repo
    .command('add <path>')
    .description('register a repo to watch')
    .option('--name <name>', 'override repo display name')
    .option('--remote-url <remoteUrl>', 'store the remote URL explicitly')
    .option('--default-branch <branch>', 'default branch', 'main')
    .option('--language <lang>', 'language hint (typescript, python, etc.)')
    .action((repoPath: string, options: { name?: string; remoteUrl?: string; defaultBranch: string; language?: string }) => {
      const resolvedPath = resolve(repoPath);
      return withDb((db) =>
        db.createRepo({
          path: resolvedPath,
          name: options.name ?? (basename(resolvedPath.replace(/\/$/, '')) || resolvedPath),
          remoteUrl: options.remoteUrl ?? null,
          defaultBranch: options.defaultBranch,
          languageHint: options.language ?? null,
        }),
      );
    });

  repo
    .command('list')
    .description('list watched repos')
    .action(() => withDb((db) => db.listRepos()));

  repo
    .command('remove <repoId>')
    .description('stop watching a repo')
    .action((repoId: string) =>
      withDb((db) => {
        const existing = db.getRepo(repoId);
        if (!existing) {
          return { error: `repo not found: ${repoId}` };
        }
        db.deleteRepo(repoId);
        return { ok: true, removed: repoId, name: existing.name };
      }),
    );

  // --- contact ---

  const contact = program.command('contact').description('manage team contacts');

  contact
    .command('add <name>')
    .description('add a team member')
    .option('--role <role>', 'role (e.g., backend, frontend, devops)')
    .option('--team <team>', 'team name')
    .option('--email <email>', 'email address')
    .option('--slack <slackId>', 'Slack user ID or handle')
    .option('--github <github>', 'GitHub handle')
    .action((name: string, options: { role?: string; team?: string; email?: string; slack?: string; github?: string }) =>
      withDb((db) =>
        db.createContact({
          name,
          role: options.role ?? null,
          team: options.team ?? null,
          email: options.email ?? null,
          slackId: options.slack ?? null,
          githubHandle: options.github ?? null,
        }),
      ),
    );

  contact
    .command('list')
    .description('list team contacts')
    .option('--team <team>', 'filter by team')
    .action((options: { team?: string }) =>
      withDb((db) => db.listContacts({ team: options.team })),
    );

  contact
    .command('remove <contactId>')
    .description('remove a contact')
    .action((contactId: string) =>
      withDb((db) => {
        const existing = db.getContact(contactId);
        if (!existing) return { error: `contact not found: ${contactId}` };
        db.deleteContact(contactId);
        return { ok: true, removed: contactId, name: existing.name };
      }),
    );

  // --- project ---

  const project = program.command('project').description('manage projects (groups of repos, systems, contacts)');

  project
    .command('add <name>')
    .description('create a project')
    .option('--kind <kind>', 'type: long-term, sprint, task', 'long-term')
    .option('--description <desc>', 'project description')
    .option('--repos <repos>', 'comma-separated repo names to link')
    .option('--systems <systems>', 'comma-separated system names to link')
    .option('--start <date>', 'start date (ISO format)')
    .option('--end <date>', 'end date (ISO format)')
    .action((name: string, options: { kind: string; description?: string; repos?: string; systems?: string; start?: string; end?: string }) =>
      withDb((db) => {
        const repoIds = options.repos
          ? options.repos.split(',').map((n) => {
              const repo = db.findRepoByName(n.trim());
              if (!repo) throw new Error(`Repo not found: ${n.trim()}`);
              return repo.id;
            })
          : [];
        const systemIds = options.systems
          ? options.systems.split(',').map((n) => {
              const sys = db.findSystemByName(n.trim());
              if (!sys) throw new Error(`System not found: ${n.trim()}`);
              return sys.id;
            })
          : [];
        return db.createProject({
          name,
          kind: options.kind,
          description: options.description ?? null,
          repoIds,
          systemIds,
          startDate: options.start ?? null,
          endDate: options.end ?? null,
        });
      }),
    );

  project
    .command('list')
    .description('list projects')
    .option('--status <status>', 'filter by status: active, completed, on-hold, archived')
    .action((options: { status?: string }) =>
      withDb((db) => db.listProjects(options.status ? { status: options.status } : undefined)),
    );

  project
    .command('remove <projectId>')
    .description('remove a project')
    .action((projectId: string) =>
      withDb((db) => {
        const existing = db.getProject(projectId);
        if (!existing) return { error: `project not found: ${projectId}` };
        db.deleteProject(projectId);
        return { ok: true, removed: projectId, name: existing.name };
      }),
    );

  // --- system ---

  const system = program.command('system').description('manage known systems/infrastructure');

  system
    .command('add <name>')
    .description('register a system or infrastructure component')
    .requiredOption('--kind <kind>', 'type (infra, service, tool, platform, database, queue, monitoring)')
    .option('--url <url>', 'URL or endpoint')
    .option('--description <desc>', 'description of the system')
    .option('--access <method>', 'access method (mcp, api, cli, manual)')
    .option('--health-check <cmd>', 'health check command or URL')
    .action((name: string, options: { kind: string; url?: string; description?: string; access?: string; healthCheck?: string }) =>
      withDb((db) =>
        db.createSystem({
          name,
          kind: options.kind,
          url: options.url ?? null,
          description: options.description ?? null,
          accessMethod: options.access ?? null,
          healthCheck: options.healthCheck ?? null,
        }),
      ),
    );

  system
    .command('list')
    .description('list known systems')
    .option('--kind <kind>', 'filter by kind')
    .action((options: { kind?: string }) =>
      withDb((db) => db.listSystems({ kind: options.kind })),
    );

  system
    .command('remove <systemId>')
    .description('remove a system')
    .action((systemId: string) =>
      withDb((db) => {
        const existing = db.getSystem(systemId);
        if (!existing) return { error: `system not found: ${systemId}` };
        db.deleteSystem(systemId);
        return { ok: true, removed: systemId, name: existing.name };
      }),
    );
}
