import { resolve, basename } from 'node:path';

import type { ShadowDatabase } from '../storage/database.js';
import type { ShadowConfig } from '../config/load-config.js';
import type { UserProfileRecord } from '../storage/models.js';
import { applyTrustDelta } from '../profile/trust.js';
import { loadPersonality } from '../personality/loader.js';

export type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (params: Record<string, unknown>) => Promise<unknown>;
};

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export function createMcpTools(db: ShadowDatabase, config: ShadowConfig): McpTool[] {
  // Helper: get current trust level from the default profile
  function getTrustLevel(): number {
    const profile = db.getProfile('default');
    return profile?.trustLevel ?? 0;
  }

  function trustGate(required: number): { ok: true } | { ok: false; error: unknown } {
    const current = getTrustLevel();
    if (current < required) {
      return {
        ok: false,
        error: {
          isError: true,
          message: `Insufficient trust level: current ${current}, required >= ${required}`,
        },
      };
    }
    return { ok: true };
  }

  // Personality loader uses shared module

  function deriveMood(db: ShadowDatabase): string {
    const recent = db.listRecentInteractions(10);
    if (recent.length === 0) return 'neutral';
    const sentiments = recent.map(i => i.sentiment).filter(Boolean);
    const positive = sentiments.filter(s => s === 'positive').length;
    const negative = sentiments.filter(s => s === 'negative').length;
    if (positive > negative + 2) return 'positive';
    if (negative > positive + 2) return 'concerned';
    return 'neutral';
  }

  function deriveGreeting(profile: UserProfileRecord, db: ShadowDatabase): string {
    if (profile.focusMode === 'focus') return 'focus_mode_active';

    const lastInteraction = db.listRecentInteractions(1)[0];
    if (!lastInteraction) return 'first_session_ever';

    const hoursSince = (Date.now() - new Date(lastInteraction.createdAt).getTime()) / (1000 * 60 * 60);
    if (hoursSince > 24) return `back_after_${Math.round(hoursSince)}h`;
    if (hoursSince > 8) return 'new_day';
    if (hoursSince > 2) return `back_after_${Math.round(hoursSince)}h`;
    return 'continuing_session';
  }

  const trustNames: Record<number, string> = {
    1: 'observer', 2: 'advisor', 3: 'assistant', 4: 'partner', 5: 'shadow',
  };

  const tools: McpTool[] = [
    // -----------------------------------------------------------------------
    // Shadow check-in — personality + context + proactive voice
    // -----------------------------------------------------------------------
    {
      name: 'shadow_check_in',
      description: 'Get Shadow\'s current personality, mood, context, and pending updates. Call this at the start of a conversation to adopt Shadow\'s persona, or when the user greets Shadow.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: async () => {
        const profile = db.ensureProfile();
        // Trust: each check_in increases trust
        try { applyTrustDelta(db, 'check_in'); } catch { /* ignore */ }
        const personality = loadPersonality(config.resolvedDataDir, profile.personalityLevel);
        const mood = deriveMood(db);
        const greeting = deriveGreeting(profile, db);
        const pendingEvents = db.listPendingEvents();
        const pendingSuggestions = db.countPendingSuggestions();
        const recentObs = db.listObservations({ status: 'active', limit: 5 });
        const usage = db.getUsageSummary('day');

        return {
          personality,
          personalityLevel: profile.personalityLevel,
          displayName: profile.displayName,
          locale: profile.locale,
          trustLevel: profile.trustLevel,
          trustName: trustNames[profile.trustLevel] ?? 'observer',
          trustScore: profile.trustScore,
          proactivityLevel: profile.proactivityLevel,
          focusMode: profile.focusMode,
          focusUntil: profile.focusUntil,
          mood,
          greeting,
          pendingEvents: pendingEvents.map(e => ({
            kind: e.kind,
            priority: e.priority,
            message: (e.payload as Record<string, unknown>).message ?? e.kind,
          })),
          pendingSuggestions,
          recentObservations: recentObs.map(o => ({
            kind: o.kind,
            title: o.title,
            repoId: o.repoId,
            votes: o.votes,
            severity: o.severity,
            createdAt: o.createdAt,
          })),
          todayTokens: usage.totalInputTokens + usage.totalOutputTokens,
          todayLlmCalls: usage.totalCalls,
        };
      },
    },

    // -----------------------------------------------------------------------
    // Read-only tools
    // -----------------------------------------------------------------------
    {
      name: 'shadow_status',
      description: 'Returns a summary of Shadow status including trust level, repos, suggestions, events, and LLM usage.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: async () => {
        const profile = db.getProfile('default');
        const repos = db.listRepos();
        const pendingSuggestions = db.countPendingSuggestions();
        const pendingEvents = db.listPendingEvents();
        const usage = db.getUsageSummary('day');
        return {
          trustLevel: profile?.trustLevel ?? 0,
          trustScore: profile?.trustScore ?? 0,
          bondLevel: profile?.bondLevel ?? 0,
          totalInteractions: profile?.totalInteractions ?? 0,
          proactivityLevel: profile?.proactivityLevel ?? config.proactivityLevel,
          repoCount: repos.length,
          pendingSuggestions,
          pendingEvents: pendingEvents.length,
          usageToday: {
            totalInputTokens: usage.totalInputTokens,
            totalOutputTokens: usage.totalOutputTokens,
            totalCalls: usage.totalCalls,
          },
        };
      },
    },
    {
      name: 'shadow_repos',
      description: 'Returns a list of tracked repositories. Optionally filter by name substring.',
      inputSchema: {
        type: 'object',
        properties: {
          filter: { type: 'string', description: 'Optional name filter substring' },
        },
        additionalProperties: false,
      },
      handler: async (params) => {
        const filter = params.filter as string | undefined;
        let repos = db.listRepos();
        if (filter) {
          const lower = filter.toLowerCase();
          repos = repos.filter((r) => r.name.toLowerCase().includes(lower));
        }
        return repos;
      },
    },
    {
      name: 'shadow_observations',
      description: 'Returns recent observations. Optionally filter by repoId, status, and limit results.',
      inputSchema: {
        type: 'object',
        properties: {
          repoId: { type: 'string', description: 'Filter by repository ID' },
          status: { type: 'string', description: 'Filter by status: active (default), acknowledged, resolved, expired, all' },
          limit: { type: 'number', description: 'Maximum number of results (default 20)' },
        },
        additionalProperties: false,
      },
      handler: async (params) => {
        const repoId = params.repoId as string | undefined;
        const status = (params.status as string | undefined) ?? 'active';
        const limit = (params.limit as number | undefined) ?? 20;
        return db.listObservations({ repoId, status, limit });
      },
    },
    {
      name: 'shadow_suggestions',
      description: 'Returns suggestions. Optionally filter by status (pending, accepted, dismissed).',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filter by status: pending, accepted, dismissed' },
        },
        additionalProperties: false,
      },
      handler: async (params) => {
        const status = params.status as string | undefined;
        return db.listSuggestions({ status });
      },
    },
    {
      name: 'shadow_memory_search',
      description: 'Searches Shadow memory using full-text search.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query string' },
          limit: { type: 'number', description: 'Maximum number of results (default 10)' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      handler: async (params) => {
        const query = params.query as string;
        const limit = (params.limit as number | undefined) ?? 10;
        return db.searchMemories(query, { limit });
      },
    },
    {
      name: 'shadow_profile',
      description: 'Returns the current user profile.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: async () => {
        return db.ensureProfile('default');
      },
    },
    {
      name: 'shadow_events',
      description: 'Returns pending (undelivered) events.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: async () => {
        return db.listPendingEvents();
      },
    },
    {
      name: 'shadow_contacts',
      description: 'Returns contacts. Optionally filter by team.',
      inputSchema: {
        type: 'object',
        properties: {
          team: { type: 'string', description: 'Filter by team name' },
        },
        additionalProperties: false,
      },
      handler: async (params) => {
        const team = params.team as string | undefined;
        return db.listContacts(team ? { team } : undefined);
      },
    },
    {
      name: 'shadow_projects',
      description: 'Returns tracked projects. Optionally filter by status.',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filter by status: active (default), completed, on-hold, archived' },
        },
        additionalProperties: false,
      },
      handler: async (params) => {
        const status = params.status as string | undefined;
        return db.listProjects(status ? { status } : undefined);
      },
    },
    {
      name: 'shadow_systems',
      description: 'Returns tracked systems. Optionally filter by kind.',
      inputSchema: {
        type: 'object',
        properties: {
          kind: { type: 'string', description: 'Filter by system kind' },
        },
        additionalProperties: false,
      },
      handler: async (params) => {
        const kind = params.kind as string | undefined;
        return db.listSystems(kind ? { kind } : undefined);
      },
    },

    // -----------------------------------------------------------------------
    // Write tools (trust-gated)
    // -----------------------------------------------------------------------
    {
      name: 'shadow_memory_teach',
      description: 'Teach Shadow something new by creating a memory entry. Requires trust level >= 1.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Memory title' },
          body: { type: 'string', description: 'Memory body in markdown' },
          layer: { type: 'string', description: 'Memory layer (default: working)' },
          scope: { type: 'string', description: 'Memory scope (default: global)' },
          kind: { type: 'string', description: 'Memory kind: taught, tech_stack, design_decision, workflow, problem_solved, team_knowledge, preference (default: taught)' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags for searchability' },
        },
        required: ['title', 'body'],
        additionalProperties: false,
      },
      handler: async (params) => {
        const gate = trustGate(1);
        if (!gate.ok) return gate.error;

        const title = params.title as string;
        const body = params.body as string;
        const layer = (params.layer as string | undefined) ?? 'working';
        const scope = (params.scope as string | undefined) ?? 'global';
        const kind = (params.kind as string | undefined) ?? 'taught';
        const tags = (params.tags as string[] | undefined) ?? [];

        const memory = db.createMemory({
          layer,
          scope,
          kind,
          title,
          bodyMd: body,
          tags,
          sourceType: 'mcp',
        });
        // Trust: teaching increases trust
        try { applyTrustDelta(db, 'memory_taught'); } catch { /* ignore */ }
        return memory;
      },
    },
    {
      name: 'shadow_suggest_accept',
      description: 'Accept a suggestion by ID. Requires trust level >= 1.',
      inputSchema: {
        type: 'object',
        properties: {
          suggestionId: { type: 'string', description: 'The suggestion ID to accept' },
        },
        required: ['suggestionId'],
        additionalProperties: false,
      },
      handler: async (params) => {
        const gate = trustGate(1);
        if (!gate.ok) return gate.error;

        const suggestionId = params.suggestionId as string;
        const suggestion = db.getSuggestion(suggestionId);
        if (!suggestion) {
          return { isError: true, message: `Suggestion not found: ${suggestionId}` };
        }

        const { acceptSuggestion } = await import('../suggestion/engine.js');
        const result = acceptSuggestion(db, suggestionId);
        if (!result.ok) return { isError: true, message: 'Cannot accept — suggestion not pending' };

        return { accepted: true, suggestionId, runCreated: result.runCreated };
      },
    },
    {
      name: 'shadow_suggest_dismiss',
      description: 'Dismiss a suggestion by ID with an optional note. Requires trust level >= 1.',
      inputSchema: {
        type: 'object',
        properties: {
          suggestionId: { type: 'string', description: 'The suggestion ID to dismiss' },
          note: { type: 'string', description: 'Optional feedback note explaining the dismissal' },
        },
        required: ['suggestionId'],
        additionalProperties: false,
      },
      handler: async (params) => {
        const gate = trustGate(1);
        if (!gate.ok) return gate.error;

        const suggestionId = params.suggestionId as string;
        const note = params.note as string | undefined;
        const suggestion = db.getSuggestion(suggestionId);
        if (!suggestion) {
          return { isError: true, message: `Suggestion not found: ${suggestionId}` };
        }

        db.updateSuggestion(suggestionId, {
          status: 'dismissed',
          feedbackNote: note ?? null,
          resolvedAt: new Date().toISOString(),
        });

        return { dismissed: true, suggestionId };
      },
    },
    {
      name: 'shadow_suggest_snooze',
      description: 'Snooze a suggestion for a given number of hours. Requires trust level >= 1.',
      inputSchema: {
        type: 'object',
        properties: {
          suggestionId: { type: 'string', description: 'The suggestion ID to snooze' },
          hours: { type: 'number', description: 'Hours to snooze (default: 72 = 3 days)' },
        },
        required: ['suggestionId'],
        additionalProperties: false,
      },
      handler: async (params) => {
        const gate = trustGate(1);
        if (!gate.ok) return gate.error;

        const suggestionId = params.suggestionId as string;
        const hours = (params.hours as number) ?? 72;
        const suggestion = db.getSuggestion(suggestionId);
        if (!suggestion) {
          return { isError: true, message: `Suggestion not found: ${suggestionId}` };
        }

        const { snoozeSuggestion } = await import('../suggestion/engine.js');
        const until = new Date(Date.now() + hours * 3600_000).toISOString();
        const result = snoozeSuggestion(db, suggestionId, until);
        if (!result.ok) return { isError: true, message: 'Cannot snooze — suggestion not pending' };

        return { snoozed: true, suggestionId, until };
      },
    },
    {
      name: 'shadow_observation_ack',
      description: 'Acknowledge an observation by ID, marking it as seen. Requires trust level >= 1.',
      inputSchema: {
        type: 'object',
        properties: {
          observationId: { type: 'string', description: 'Observation ID to acknowledge' },
        },
        required: ['observationId'],
        additionalProperties: false,
      },
      handler: async (params) => {
        const gate = trustGate(1);
        if (!gate.ok) return gate.error;
        const id = params.observationId as string;
        const obs = db.getObservation(id);
        if (!obs) return { isError: true, message: `Observation not found: ${id}` };
        if (obs.status !== 'active') return { isError: true, message: `Observation is ${obs.status}, not active` };
        db.updateObservationStatus(id, 'acknowledged');
        return { ok: true, observationId: id, status: 'acknowledged' };
      },
    },
    {
      name: 'shadow_observation_resolve',
      description: 'Resolve an observation by ID with an optional reason. Requires trust level >= 1.',
      inputSchema: {
        type: 'object',
        properties: {
          observationId: { type: 'string', description: 'Observation ID to resolve' },
          reason: { type: 'string', description: 'Why this observation is being resolved' },
        },
        required: ['observationId'],
        additionalProperties: false,
      },
      handler: async (params) => {
        const gate = trustGate(1);
        if (!gate.ok) return gate.error;
        const id = params.observationId as string;
        const obs = db.getObservation(id);
        if (!obs) return { isError: true, message: `Observation not found: ${id}` };
        if (obs.status === 'resolved') return { isError: true, message: 'Already resolved' };
        db.updateObservationStatus(id, 'resolved');
        db.createFeedback({ targetKind: 'observation', targetId: id, action: 'resolve', note: params.reason as string | undefined });
        return { ok: true, observationId: id, status: 'resolved' };
      },
    },
    {
      name: 'shadow_observation_reopen',
      description: 'Reopen a resolved or acknowledged observation, setting it back to active. Requires trust level >= 1.',
      inputSchema: {
        type: 'object',
        properties: {
          observationId: { type: 'string', description: 'Observation ID to reopen' },
        },
        required: ['observationId'],
        additionalProperties: false,
      },
      handler: async (params) => {
        const gate = trustGate(1);
        if (!gate.ok) return gate.error;
        const id = params.observationId as string;
        const obs = db.getObservation(id);
        if (!obs) return { isError: true, message: `Observation not found: ${id}` };
        if (obs.status === 'active') return { isError: true, message: 'Already active' };
        db.updateObservationStatus(id, 'active');
        return { ok: true, observationId: id, status: 'active' };
      },
    },
    {
      name: 'shadow_observe',
      description: 'Trigger an observation cycle. Optionally specify a repoId. Requires trust level >= 2.',
      inputSchema: {
        type: 'object',
        properties: {
          repoId: { type: 'string', description: 'Optional repository ID to observe' },
        },
        additionalProperties: false,
      },
      handler: async (params) => {
        const gate = trustGate(2);
        if (!gate.ok) return gate.error;

        const repoId = params.repoId as string | undefined;

        if (repoId) {
          const repo = db.getRepo(repoId);
          if (!repo) {
            return { isError: true, message: `Repository not found: ${repoId}` };
          }
          // Mark repo as observed
          db.updateRepo(repoId, { lastObservedAt: new Date().toISOString() });
          return {
            triggered: true,
            repoId,
            message: `Observation triggered for repo: ${repo.name}`,
          };
        }

        // Observe all repos
        const repos = db.listRepos();
        const now = new Date().toISOString();
        for (const repo of repos) {
          db.updateRepo(repo.id, { lastObservedAt: now });
        }
        return {
          triggered: true,
          repoCount: repos.length,
          message: `Observation triggered for ${repos.length} repositories`,
        };
      },
    },

    // -----------------------------------------------------------------------
    // New write tools — repo, contact, system, profile, focus, memory, events
    // -----------------------------------------------------------------------
    {
      name: 'shadow_repo_add',
      description: 'Register a new repository for Shadow to watch. Requires trust level >= 1.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to the repository' },
          name: { type: 'string', description: 'Display name (defaults to directory name)' },
          defaultBranch: { type: 'string', description: 'Default branch (defaults to main)' },
          languageHint: { type: 'string', description: 'Primary language hint' },
        },
        required: ['path'],
        additionalProperties: false,
      },
      handler: async (params) => {
        const gate = trustGate(1);
        if (!gate.ok) return gate.error;

        const repoPath = resolve(params.path as string);
        const name = (params.name as string | undefined) ?? (basename(repoPath) || repoPath);

        const existing = db.findRepoByPath(repoPath);
        if (existing) return { isError: true, message: `Repo already registered: ${existing.name} (${existing.id})` };

        return db.createRepo({
          path: repoPath,
          name,
          defaultBranch: (params.defaultBranch as string | undefined) ?? 'main',
          languageHint: (params.languageHint as string | undefined) ?? null,
        });
      },
    },
    {
      name: 'shadow_repo_remove',
      description: 'Stop watching a repository. Requires trust level >= 1.',
      inputSchema: {
        type: 'object',
        properties: {
          repoId: { type: 'string', description: 'Repository ID to remove' },
        },
        required: ['repoId'],
        additionalProperties: false,
      },
      handler: async (params) => {
        const gate = trustGate(1);
        if (!gate.ok) return gate.error;

        const repoId = params.repoId as string;
        const repo = db.getRepo(repoId);
        if (!repo) return { isError: true, message: `Repo not found: ${repoId}` };

        db.deleteRepo(repoId);
        return { ok: true, removed: repoId, name: repo.name };
      },
    },
    {
      name: 'shadow_contact_add',
      description: 'Add a team member to Shadow\'s contacts. Requires trust level >= 1.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Contact name' },
          role: { type: 'string', description: 'Role (e.g., backend, frontend, devops)' },
          team: { type: 'string', description: 'Team name' },
          email: { type: 'string', description: 'Email address' },
          slackId: { type: 'string', description: 'Slack user ID or handle' },
          githubHandle: { type: 'string', description: 'GitHub username' },
          notesMd: { type: 'string', description: 'Additional notes in markdown' },
          preferredChannel: { type: 'string', description: 'Preferred contact channel: slack, email, github' },
        },
        required: ['name'],
        additionalProperties: false,
      },
      handler: async (params) => {
        const gate = trustGate(1);
        if (!gate.ok) return gate.error;

        return db.createContact({
          name: params.name as string,
          role: (params.role as string | undefined) ?? null,
          team: (params.team as string | undefined) ?? null,
          email: (params.email as string | undefined) ?? null,
          slackId: (params.slackId as string | undefined) ?? null,
          githubHandle: (params.githubHandle as string | undefined) ?? null,
          notesMd: (params.notesMd as string | undefined) ?? null,
          preferredChannel: (params.preferredChannel as string | undefined) ?? null,
        });
      },
    },
    {
      name: 'shadow_contact_remove',
      description: 'Remove a contact. Requires trust level >= 1.',
      inputSchema: {
        type: 'object',
        properties: {
          contactId: { type: 'string', description: 'Contact ID to remove' },
        },
        required: ['contactId'],
        additionalProperties: false,
      },
      handler: async (params) => {
        const gate = trustGate(1);
        if (!gate.ok) return gate.error;

        const contactId = params.contactId as string;
        const contact = db.getContact(contactId);
        if (!contact) return { isError: true, message: `Contact not found: ${contactId}` };

        db.deleteContact(contactId);
        return { ok: true, removed: contactId, name: contact.name };
      },
    },
    {
      name: 'shadow_system_add',
      description: 'Register an infrastructure system or service. Requires trust level >= 1.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'System name' },
          kind: { type: 'string', description: 'Type: infra, service, tool, platform, database, queue, monitoring' },
          url: { type: 'string', description: 'URL or endpoint' },
          description: { type: 'string', description: 'Description of the system' },
          accessMethod: { type: 'string', description: 'Access method: mcp, api, cli, manual' },
          healthCheck: { type: 'string', description: 'Health check command or URL' },
        },
        required: ['name', 'kind'],
        additionalProperties: false,
      },
      handler: async (params) => {
        const gate = trustGate(1);
        if (!gate.ok) return gate.error;

        return db.createSystem({
          name: params.name as string,
          kind: params.kind as string,
          url: (params.url as string | undefined) ?? null,
          description: (params.description as string | undefined) ?? null,
          accessMethod: (params.accessMethod as string | undefined) ?? null,
          healthCheck: (params.healthCheck as string | undefined) ?? null,
        });
      },
    },
    {
      name: 'shadow_system_remove',
      description: 'Remove a registered system. Requires trust level >= 1.',
      inputSchema: {
        type: 'object',
        properties: {
          systemId: { type: 'string', description: 'System ID to remove' },
        },
        required: ['systemId'],
        additionalProperties: false,
      },
      handler: async (params) => {
        const gate = trustGate(1);
        if (!gate.ok) return gate.error;

        const systemId = params.systemId as string;
        const system = db.getSystem(systemId);
        if (!system) return { isError: true, message: `System not found: ${systemId}` };

        db.deleteSystem(systemId);
        return { ok: true, removed: systemId, name: system.name };
      },
    },
    {
      name: 'shadow_project_add',
      description: 'Create a project that groups repos, systems, and contacts. Requires trust level >= 1.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Project name (unique)' },
          kind: { type: 'string', description: 'Type: long-term, sprint, or task' },
          description: { type: 'string', description: 'Project description' },
          repoIds: { type: 'array', items: { type: 'string' }, description: 'Repo IDs to link' },
          systemIds: { type: 'array', items: { type: 'string' }, description: 'System IDs to link' },
          contactIds: { type: 'array', items: { type: 'string' }, description: 'Contact IDs to link' },
          startDate: { type: 'string', description: 'Start date (ISO format)' },
          endDate: { type: 'string', description: 'End date (ISO format, for sprints/tasks)' },
        },
        required: ['name'],
        additionalProperties: false,
      },
      handler: async (params) => {
        const gate = trustGate(1);
        if (!gate.ok) return gate.error;

        return db.createProject({
          name: params.name as string,
          kind: (params.kind as string | undefined) ?? 'long-term',
          description: (params.description as string | undefined) ?? null,
          repoIds: (params.repoIds as string[] | undefined) ?? [],
          systemIds: (params.systemIds as string[] | undefined) ?? [],
          contactIds: (params.contactIds as string[] | undefined) ?? [],
          startDate: (params.startDate as string | undefined) ?? null,
          endDate: (params.endDate as string | undefined) ?? null,
        });
      },
    },
    {
      name: 'shadow_project_remove',
      description: 'Remove a project. Requires trust level >= 1.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project ID to remove' },
        },
        required: ['projectId'],
        additionalProperties: false,
      },
      handler: async (params) => {
        const gate = trustGate(1);
        if (!gate.ok) return gate.error;

        const projectId = params.projectId as string;
        const project = db.getProject(projectId);
        if (!project) return { isError: true, message: `Project not found: ${projectId}` };

        db.deleteProject(projectId);
        return { ok: true, removed: projectId, name: project.name };
      },
    },
    {
      name: 'shadow_project_update',
      description: 'Update a project (repos, systems, contacts, status, etc). Requires trust level >= 1.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project ID to update' },
          name: { type: 'string', description: 'New project name' },
          description: { type: 'string', description: 'New description' },
          kind: { type: 'string', description: 'New kind: long-term, sprint, task' },
          status: { type: 'string', description: 'New status: active, completed, on-hold, archived' },
          repoIds: { type: 'array', items: { type: 'string' }, description: 'Replace linked repo IDs' },
          systemIds: { type: 'array', items: { type: 'string' }, description: 'Replace linked system IDs' },
          contactIds: { type: 'array', items: { type: 'string' }, description: 'Replace linked contact IDs' },
          startDate: { type: 'string', description: 'Start date (ISO)' },
          endDate: { type: 'string', description: 'End date (ISO)' },
          notesMd: { type: 'string', description: 'Notes in markdown' },
        },
        required: ['projectId'],
        additionalProperties: false,
      },
      handler: async (params) => {
        const gate = trustGate(1);
        if (!gate.ok) return gate.error;

        const projectId = params.projectId as string;
        const project = db.getProject(projectId);
        if (!project) return { isError: true, message: `Project not found: ${projectId}` };

        const updates: Record<string, unknown> = {};
        for (const key of ['name', 'description', 'kind', 'status', 'repoIds', 'systemIds', 'contactIds', 'startDate', 'endDate', 'notesMd']) {
          if (params[key] !== undefined) updates[key] = params[key];
        }

        return db.updateProject(projectId, updates as Parameters<typeof db.updateProject>[1]);
      },
    },
    {
      name: 'shadow_profile_set',
      description: 'Update a user profile field. Requires trust level >= 1. Fields: proactivityLevel (1-10), personalityLevel (1-5), timezone, displayName.',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Profile field name (e.g., proactivityLevel, personalityLevel, timezone, displayName)' },
          value: { type: 'string', description: 'New value for the field' },
        },
        required: ['key', 'value'],
        additionalProperties: false,
      },
      handler: async (params) => {
        const gate = trustGate(1);
        if (!gate.ok) return gate.error;

        const key = params.key as string;
        const rawValue = params.value as string;
        const numericFields = ['proactivityLevel', 'personalityLevel', 'trustLevel', 'trustScore', 'bondLevel'];
        const parsedValue = numericFields.includes(key) ? Number(rawValue) : rawValue;

        db.updateProfile('default', { [key]: parsedValue });
        return { ok: true, set: key, value: parsedValue };
      },
    },
    {
      name: 'shadow_focus',
      description: 'Enter focus mode — sets proactivity to 1 (silent). Optionally specify a duration like "2h" or "30m". Requires trust level >= 1.',
      inputSchema: {
        type: 'object',
        properties: {
          duration: { type: 'string', description: 'Optional duration: "2h", "30m", "1h". Omit for indefinite focus.' },
        },
        additionalProperties: false,
      },
      handler: async (params) => {
        const gate = trustGate(1);
        if (!gate.ok) return gate.error;

        const duration = params.duration as string | undefined;
        let focusUntil: string | null = null;

        if (duration) {
          const match = duration.match(/^(\d+)\s*(h|m|min|hour|hours|minutes?)$/i);
          if (match) {
            const amount = parseInt(match[1], 10);
            const unit = match[2].toLowerCase();
            const ms = unit.startsWith('h') ? amount * 60 * 60 * 1000 : amount * 60 * 1000;
            focusUntil = new Date(Date.now() + ms).toISOString();
          }
        }

        const profile = db.ensureProfile();
        db.updateProfile('default', { focusMode: 'focus', focusUntil });

        return {
          ok: true,
          mode: 'focus',
          previousProactivity: profile.proactivityLevel,
          until: focusUntil ?? 'indefinite (use shadow_available to exit)',
        };
      },
    },
    {
      name: 'shadow_available',
      description: 'Exit focus mode, restore previous proactivity level. Requires trust level >= 1.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: async () => {
        const gate = trustGate(1);
        if (!gate.ok) return gate.error;

        db.updateProfile('default', { focusMode: null, focusUntil: null });
        const profile = db.ensureProfile();
        return { ok: true, mode: 'available', proactivityLevel: profile.proactivityLevel };
      },
    },
    {
      name: 'shadow_memory_forget',
      description: 'Archive (forget) a memory by ID with a reason. Requires trust level >= 1.',
      inputSchema: {
        type: 'object',
        properties: {
          memoryId: { type: 'string', description: 'Memory ID to archive' },
          reason: { type: 'string', description: 'Why this memory is being archived' },
        },
        required: ['memoryId'],
        additionalProperties: false,
      },
      handler: async (params) => {
        const gate = trustGate(1);
        if (!gate.ok) return gate.error;

        const memoryId = params.memoryId as string;
        const memory = db.getMemory(memoryId);
        if (!memory) return { isError: true, message: `Memory not found: ${memoryId}` };

        db.updateMemory(memoryId, { archivedAt: new Date().toISOString() });
        const reason = params.reason as string | undefined;
        db.createFeedback({ targetKind: 'memory', targetId: memoryId, action: 'archive', note: reason });
        return { ok: true, archived: memoryId, title: memory.title };
      },
    },
    {
      name: 'shadow_memory_update',
      description: 'Update a memory: change layer, body, tags, kind, or scope. Requires trust level >= 1.',
      inputSchema: {
        type: 'object',
        properties: {
          memoryId: { type: 'string', description: 'Memory ID to update' },
          layer: { type: 'string', description: 'New layer: core, hot, warm, cool, cold' },
          body: { type: 'string', description: 'New body markdown' },
          kind: { type: 'string', description: 'New kind' },
          scope: { type: 'string', description: 'New scope' },
          tags: { type: 'array', items: { type: 'string' }, description: 'New tags' },
          reason: { type: 'string', description: 'Why this memory is being modified' },
        },
        required: ['memoryId'],
        additionalProperties: false,
      },
      handler: async (params) => {
        const gate = trustGate(1);
        if (!gate.ok) return gate.error;
        const id = params.memoryId as string;
        const memory = db.getMemory(id);
        if (!memory) return { isError: true, message: `Memory not found: ${id}` };
        const updates: Record<string, unknown> = {};
        if (params.layer) updates.layer = params.layer;
        if (params.body) updates.bodyMd = params.body;
        if (params.kind) updates.kind = params.kind;
        if (params.scope) updates.scope = params.scope;
        if (params.tags) updates.tags = params.tags;
        if (Object.keys(updates).length === 0) return { isError: true, message: 'No updates provided' };
        db.updateMemory(id, updates as Parameters<typeof db.updateMemory>[1]);
        const reason = params.reason as string | undefined;
        db.createFeedback({ targetKind: 'memory', targetId: id, action: 'modify', note: reason ?? `updated: ${Object.keys(updates).join(', ')}` });
        return { ok: true, memoryId: id, updated: Object.keys(updates) };
      },
    },
    {
      name: 'shadow_events_ack',
      description: 'Acknowledge all pending events. Requires trust level >= 1.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: async () => {
        const gate = trustGate(1);
        if (!gate.ok) return gate.error;

        const count = db.deliverAllEvents();
        return { ok: true, acknowledged: count };
      },
    },

    // -----------------------------------------------------------------------
    // Feedback + Soul
    // -----------------------------------------------------------------------
    {
      name: 'shadow_feedback',
      description: 'List recent user feedback (thumbs up/down, dismiss reasons, archive reasons, corrections).',
      inputSchema: {
        type: 'object',
        properties: {
          targetKind: { type: 'string', description: 'Filter by kind: observation, suggestion, memory, run' },
          limit: { type: 'number', description: 'Max entries (default 30)' },
        },
        additionalProperties: false,
      },
      handler: async (params) => {
        const targetKind = params.targetKind as string | undefined;
        const limit = (params.limit as number | undefined) ?? 30;
        return db.listFeedback(targetKind, limit);
      },
    },
    {
      name: 'shadow_soul',
      description: 'Read Shadow\'s current soul reflection — the synthesized understanding of the developer.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: async () => {
        const all = db.listMemories({ archived: false });
        const soul = all.find(m => m.kind === 'soul_reflection');
        if (!soul) return { exists: false, body: null };
        return { exists: true, body: soul.bodyMd, updatedAt: soul.updatedAt };
      },
    },
    {
      name: 'shadow_soul_update',
      description: 'Update Shadow\'s soul reflection. Creates if first time, updates if exists. Requires trust level >= 1.',
      inputSchema: {
        type: 'object',
        properties: {
          body: { type: 'string', description: 'The new soul reflection in markdown' },
        },
        required: ['body'],
        additionalProperties: false,
      },
      handler: async (params) => {
        const gate = trustGate(1);
        if (!gate.ok) return gate.error;
        const body = params.body as string;
        const all = db.listMemories({ archived: false });
        const existing = all.find(m => m.kind === 'soul_reflection');
        if (existing) {
          db.updateMemory(existing.id, { bodyMd: body });
          return { ok: true, action: 'updated', memoryId: existing.id };
        }
        const mem = db.createMemory({
          layer: 'core', scope: 'personal', kind: 'soul_reflection',
          title: 'Shadow soul reflection', bodyMd: body,
          sourceType: 'reflect', confidenceScore: 95, relevanceScore: 1.0,
        });
        return { ok: true, action: 'created', memoryId: mem.id };
      },
    },

    // -----------------------------------------------------------------------
    // Other read-only tools
    // -----------------------------------------------------------------------
    {
      name: 'shadow_memory_list',
      description: 'List memories with optional filters by layer and scope.',
      inputSchema: {
        type: 'object',
        properties: {
          layer: { type: 'string', description: 'Filter by layer: core, hot, warm, cool, cold' },
          scope: { type: 'string', description: 'Filter by scope: personal, repo, team, system, cross-repo' },
        },
        additionalProperties: false,
      },
      handler: async (params) => {
        return db.listMemories({
          layer: params.layer as string | undefined,
          scope: params.scope as string | undefined,
          archived: false,
        });
      },
    },
    {
      name: 'shadow_run_list',
      description: 'List task runs with optional status filter.',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filter by status: queued, running, completed, failed' },
        },
        additionalProperties: false,
      },
      handler: async (params) => {
        return db.listRuns({ status: params.status as string | undefined });
      },
    },
    {
      name: 'shadow_run_view',
      description: 'View details of a specific run.',
      inputSchema: {
        type: 'object',
        properties: {
          runId: { type: 'string', description: 'Run ID to view' },
        },
        required: ['runId'],
        additionalProperties: false,
      },
      handler: async (params) => {
        const runId = params.runId as string;
        const run = db.getRun(runId);
        if (!run) return { isError: true, message: `Run not found: ${runId}` };
        return run;
      },
    },
    {
      name: 'shadow_usage',
      description: 'Returns LLM token usage summary for a given period.',
      inputSchema: {
        type: 'object',
        properties: {
          period: { type: 'string', description: 'Time period: day, week, month (default: day)' },
        },
        additionalProperties: false,
      },
      handler: async (params) => {
        const period = (params.period as 'day' | 'week' | 'month' | undefined) ?? 'day';
        return db.getUsageSummary(period);
      },
    },
    {
      name: 'shadow_daily_summary',
      description: 'Get a comprehensive summary of today\'s engineering activity: repos touched, memories created, suggestions, observations, tokens used, and active hours.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: async () => {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const sinceIso = todayStart.toISOString();

        const profile = db.ensureProfile();
        const repos = db.listRepos();
        const observations = db.listObservations({ status: 'active', limit: 100 });
        const todayObs = observations.filter(o => o.createdAt > sinceIso);
        const memories = db.listMemories({ archived: false });
        const todayMemories = memories.filter(m => m.createdAt > sinceIso);
        const suggestions = db.listSuggestions({ status: 'pending' });
        const usage = db.getUsageSummary('day');
        const events = db.listPendingEvents();

        return {
          date: todayStart.toISOString().split('T')[0],
          user: profile.displayName ?? 'unknown',
          trustLevel: profile.trustLevel,
          trustScore: profile.trustScore,
          activity: {
            observationsToday: todayObs.length,
            memoriesCreatedToday: todayMemories.length,
            pendingSuggestions: suggestions.length,
            pendingEvents: events.length,
          },
          topObservations: todayObs.slice(0, 5).map(o => ({ kind: o.kind, title: o.title, repo: o.repoId })),
          newMemories: todayMemories.map(m => ({ layer: m.layer, kind: m.kind, title: m.title })),
          pendingSuggestions: suggestions.slice(0, 5).map(s => ({ kind: s.kind, title: s.title, impact: s.impactScore })),
          repos: repos.map(r => ({ name: r.name, lastObserved: r.lastObservedAt })),
          tokens: {
            input: usage.totalInputTokens,
            output: usage.totalOutputTokens,
            totalCalls: usage.totalCalls,
            byModel: usage.byModel,
          },
        };
      },
    },
  ];

  return tools;
}

// ---------------------------------------------------------------------------
// JSON-RPC handler
// ---------------------------------------------------------------------------

type JsonRpcRequest = {
  jsonrpc: string;
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: string;
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

export async function handleJsonRpcRequest(
  tools: McpTool[],
  request: unknown,
): Promise<unknown> {
  const req = request as JsonRpcRequest;
  const id = req.id ?? null;

  if (req.method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      },
    } satisfies JsonRpcResponse;
  }

  if (req.method === 'tools/call') {
    const params = req.params ?? {};
    const toolName = params.name as string | undefined;
    const toolArgs = (params.arguments as Record<string, unknown>) ?? {};

    if (!toolName) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: 'Missing tool name in params.name' },
      } satisfies JsonRpcResponse;
    }

    const tool = tools.find((t) => t.name === toolName);
    if (!tool) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Tool not found: ${toolName}` },
      } satisfies JsonRpcResponse;
    }

    try {
      const result = await tool.handler(toolArgs);
      return {
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
      } satisfies JsonRpcResponse;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: `Tool execution failed: ${message}` },
      } satisfies JsonRpcResponse;
    }
  }

  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${req.method}` },
  } satisfies JsonRpcResponse;
}
