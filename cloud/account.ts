import { DurableObject } from 'cloudflare:workers';

import type { Env } from './types';
import { isRecord, recordValue } from './decode';

type JsonObject = Record<string, unknown>;

interface ValidatedProject {
  path: string;
  graph: JsonObject;
  inputs: JsonObject;
  sidecar: JsonObject;
  program?: unknown;
}

interface ProjectSummary {
  path: string;
  name: string;
  modified_at: string;
}

const PROJECT_PREFIX = 'project:';
const MAX_PROJECT_BYTES = 5 * 1024 * 1024;
const PATH_PATTERN = /^[a-z0-9][a-z0-9/_-]{0,159}$/;
const CREDENTIAL_KEY_PATTERN = /^(access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|password|secret[_-]?value)$/i;

function projectKey(path: string, document: string): string {
  return `${PROJECT_PREFIX}${path}:${document}`;
}

function containsCredentialValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsCredentialValue);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, item]) => (
    (CREDENTIAL_KEY_PATTERN.test(key) && typeof item === 'string' && item.length > 0)
    || containsCredentialValue(item)
  ));
}

function validateProject(value: unknown): ValidatedProject {
  const project = recordValue(value, 'Project');
  if (typeof project.path !== 'string' || !PATH_PATTERN.test(project.path) || project.path.includes('//')) {
    throw new Error('Project path must use lowercase letters, numbers, dashes, underscores, and folders');
  }
  const graph = recordValue(project.graph, 'Workflow graph');
  const sidecar = recordValue(project.sidecar, 'Editor sidecar');
  const inputs = recordValue(project.inputs, 'Workflow inputs');
  if (graph.schema_version !== 1 || graph.kind !== 'mere.run/workflow-graph') throw new Error('Invalid workflow graph');
  if (sidecar.schema_version !== 1 || sidecar.kind !== 'mere.run/workflow-editor') throw new Error('Invalid editor sidecar');
  if (containsCredentialValue(project)) throw new Error('Project documents may reference secret names but may not store credential values');
  if (new TextEncoder().encode(JSON.stringify(project)).byteLength > MAX_PROJECT_BYTES) throw new Error('Project exceeds 5 MB');
  return { path: project.path, graph, inputs, sidecar, program: project.program };
}

export class StudioAccount extends DurableObject<Env> {
  private async listProjects(): Promise<Response> {
    const values = await this.ctx.storage.list<ProjectSummary>({ prefix: PROJECT_PREFIX });
    const projects = [...values.entries()]
      .filter(([key]) => key.endsWith(':summary'))
      .map(([, value]) => value)
      .sort((left, right) => right.modified_at.localeCompare(left.modified_at));
    return Response.json({ projects }, { headers: { 'Cache-Control': 'no-store' } });
  }

  private async loadProject(url: URL): Promise<Response> {
    const path = url.searchParams.get('path') ?? '';
    if (!PATH_PATTERN.test(path)) return Response.json({ error: 'Invalid project path' }, { status: 400 });
    const [graph, inputs, sidecar, program] = await Promise.all([
      this.ctx.storage.get(projectKey(path, 'graph')),
      this.ctx.storage.get(projectKey(path, 'inputs')),
      this.ctx.storage.get(projectKey(path, 'sidecar')),
      this.ctx.storage.get(projectKey(path, 'program')),
    ]);
    if (!graph || !inputs || !sidecar) return Response.json({ error: 'Project not found' }, { status: 404 });
    return Response.json({ path, graph, inputs, sidecar, ...(program ? { program } : {}) });
  }

  private async saveProject(request: Request): Promise<Response> {
    try {
      const value: unknown = await request.json();
      const project = validateProject(value);
      const modifiedAt = new Date().toISOString();
      const summary: ProjectSummary = {
        path: project.path,
        name: typeof project.graph.name === 'string' ? project.graph.name : project.path.split('/').at(-1) ?? project.path,
        modified_at: modifiedAt,
      };
      const entries: Record<string, unknown> = {
        [projectKey(project.path, 'graph')]: project.graph,
        [projectKey(project.path, 'inputs')]: project.inputs,
        [projectKey(project.path, 'sidecar')]: project.sidecar,
        [projectKey(project.path, 'summary')]: summary,
      };
      if (project.program) entries[projectKey(project.path, 'program')] = project.program;
      await this.ctx.storage.put(entries);
      if (!project.program) await this.ctx.storage.delete(projectKey(project.path, 'program'));
      return Response.json({ status: 'saved', path: project.path, modified_at: modifiedAt });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : 'Invalid project' }, { status: 400 });
    }
  }

  private async deleteProject(url: URL): Promise<Response> {
    const path = url.searchParams.get('path') ?? '';
    if (!PATH_PATTERN.test(path)) return Response.json({ error: 'Invalid project path' }, { status: 400 });
    await this.ctx.storage.delete([
      projectKey(path, 'graph'),
      projectKey(path, 'inputs'),
      projectKey(path, 'sidecar'),
      projectKey(path, 'program'),
      projectKey(path, 'summary'),
    ]);
    return new Response(null, { status: 204 });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/projects' && request.method === 'GET') return this.listProjects();
    if (url.pathname === '/project' && request.method === 'GET') return this.loadProject(url);
    if (url.pathname === '/project' && request.method === 'PUT') return this.saveProject(request);
    if (url.pathname === '/project' && request.method === 'DELETE') return this.deleteProject(url);
    return new Response('Not Found', { status: 404 });
  }
}
