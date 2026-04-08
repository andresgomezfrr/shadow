import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ShadowDatabase } from '../../storage/database.js';
import type { DaemonSharedState } from '../../daemon/job-handlers.js';
import { json, clampLimit, clampOffset } from '../helpers.js';

export async function handleEntityRoutes(
  req: IncomingMessage, res: ServerResponse,
  pathname: string, params: URLSearchParams,
  db: ShadowDatabase,
  _daemonState?: DaemonSharedState,
): Promise<boolean> {

  if (req.method !== 'GET') return false;

  if (pathname === '/api/repos') {
    const repos = db.listRepos();
    return json(res, repos), true;
  }

  if (pathname === '/api/contacts') {
    const team = params.get('team') ?? undefined;
    const contacts = db.listContacts({ team });
    return json(res, contacts), true;
  }

  if (pathname === '/api/projects') {
    const status = params.get('status') ?? undefined;
    const projects = db.listProjects(status ? { status } : undefined);
    return json(res, projects), true;
  }

  if (pathname === '/api/systems') {
    const kind = params.get('kind') ?? undefined;
    const systems = db.listSystems({ kind });
    return json(res, systems), true;
  }

  // Project detail: /api/projects/:id
  const projectDetailMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (projectDetailMatch) {
    const project = db.getProject(projectDetailMatch[1]);
    if (!project) return json(res, { error: 'Project not found' }, 404), true;

    const repos = project.repoIds.map(id => db.getRepo(id)).filter(Boolean);
    const systems = project.systemIds.length > 0 ? db.getSystemsByIds(project.systemIds) : [];
    const contacts = project.contactIds.map(id => db.getContact(id)).filter(Boolean);

    const observations = db.listObservations({ status: 'active', projectId: project.id, limit: 50 });
    const suggestions = db.listSuggestions({ status: 'pending', projectId: project.id, limit: 50 });
    const memories = db.listMemories({ archived: false, limit: 500 })
      .filter(m => (m.entities ?? []).some(e => e.type === 'project' && e.id === project.id));

    const enrichLimit = clampLimit(params.get('enrichLimit'), 10);
    const enrichOffset = clampOffset(params.get('enrichOffset'));
    let enrichment: unknown[] = [];
    let enrichmentTotal = 0;
    try {
      enrichment = db.listEnrichment({ entityType: 'project', entityId: project.id, limit: enrichLimit, offset: enrichOffset });
      enrichmentTotal = db.countEnrichment({ entityType: 'project', entityId: project.id });
    } catch { /* enrichment_cache may not exist yet */ }

    return json(res, {
      ...project,
      repos: repos.map(r => ({ id: r!.id, name: r!.name, path: r!.path, lastObservedAt: r!.lastObservedAt })),
      systems: systems.map(s => ({ id: s!.id, name: s!.name, kind: s!.kind })),
      contacts: contacts.map(c => ({ id: c!.id, name: c!.name, role: c!.role, team: c!.team })),
      observations: observations.slice(0, 10).map(o => ({ id: o.id, kind: o.kind, severity: o.severity, title: o.title, votes: o.votes, createdAt: o.createdAt })),
      suggestions: suggestions.slice(0, 10).map(s => ({ id: s.id, kind: s.kind, title: s.title, impactScore: s.impactScore, confidenceScore: s.confidenceScore, riskScore: s.riskScore })),
      memories: memories.slice(0, 10).map(m => ({ id: m.id, kind: m.kind, layer: m.layer, title: m.title, createdAt: m.createdAt })),
      enrichment,
      enrichmentTotal,
      counts: {
        observations: db.countObservations({ status: 'active', projectId: project.id }),
        suggestions: db.countSuggestions({ status: 'pending', projectId: project.id }),
        memories: memories.length,
      },
    }), true;
  }

  // System detail: /api/systems/:id
  const systemDetailMatch = pathname.match(/^\/api\/systems\/([^/]+)$/);
  if (systemDetailMatch) {
    const system = db.getSystem(systemDetailMatch[1]);
    if (!system) return json(res, { error: 'System not found' }, 404), true;

    const observations = db.listObservations({ status: 'active', limit: 50 })
      .filter(o => (o.entities ?? []).some(e => e.type === 'system' && e.id === system.id));
    const memories = db.listMemories({ archived: false })
      .filter(m => (m.entities ?? []).some(e => e.type === 'system' && e.id === system.id));

    // Find projects that include this system
    const projects = db.listProjects({ status: 'active' })
      .filter(p => p.systemIds.includes(system.id));

    return json(res, {
      ...system,
      observations: observations.slice(0, 10).map(o => ({ id: o.id, kind: o.kind, severity: o.severity, title: o.title, createdAt: o.createdAt })),
      memories: memories.slice(0, 10).map(m => ({ id: m.id, kind: m.kind, title: m.title, createdAt: m.createdAt })),
      projects: projects.map(p => ({ id: p.id, name: p.name, kind: p.kind })),
      counts: {
        observations: observations.length,
        memories: memories.length,
        projects: projects.length,
      },
    }), true;
  }

  if (pathname === '/api/entity-graph') {
    const relations = db.listRelations();
    return json(res, relations), true;
  }

  return false;
}
