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
const SHARE_PREFIX = 'shared-app:';
const SHARE_INDEX_PREFIX = 'shared-app-index:';
const MAX_PROJECT_BYTES = 5 * 1024 * 1024;
const PATH_PATTERN = /^[a-z0-9][a-z0-9/_-]{0,159}$/;
const SHARE_TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
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

function publicationProblem(graph: JsonObject, inputs: JsonObject, sidecar: JsonObject): string | null {
  if (!isRecord(graph.outputs) || !Object.keys(graph.outputs).length) return 'Expose at least one graph output before publishing';
  if (containsCredentialValue({ graph, inputs, sidecar })) return 'App contains credential values';
  const hasAssets = Object.values(graph.inputs ?? {}).some((definition) => isRecord(definition)
    && typeof definition.type === 'string' && definition.type.startsWith('asset'));
  return hasAssets ? 'Hosted apps with asset inputs are not supported yet' : null;
}

function publicAppSidecar(sidecar: JsonObject): JsonObject {
  return { schema_version: 1, kind: 'mere.run/workflow-editor', viewport: { x: 0, y: 0, zoom: 1 },
    nodes: {}, ...(isRecord(sidecar.app) ? { app: sidecar.app } : {}) };
}

function projectTitle(graph: JsonObject, path: string, sidecar: JsonObject): string {
  const app = isRecord(sidecar.app) ? sidecar.app : {};
  if (typeof app.title === 'string' && app.title.trim()) return app.title.trim();
  return typeof graph.name === 'string' ? graph.name : path;
}

export class StudioAccount extends DurableObject<Env> {
  private async publishApp(request: Request): Promise<Response> {
    let body: JsonObject;
    try { body = recordValue(await request.json(), 'App publication'); }
    catch { return Response.json({ error: 'Invalid app publication' }, { status: 400 }); }
    const path = body.path;
    if (typeof path !== 'string' || !PATH_PATTERN.test(path) || path.includes('//')) return Response.json({ error: 'Invalid project path' }, { status: 400 });
    const [graph, inputs, sidecar] = await Promise.all([
      this.ctx.storage.get<JsonObject>(projectKey(path, 'graph')),
      this.ctx.storage.get<JsonObject>(projectKey(path, 'inputs')),
      this.ctx.storage.get<JsonObject>(projectKey(path, 'sidecar')),
    ]);
    if (!graph || !inputs || !sidecar) return Response.json({ error: 'Save the project before publishing an app' }, { status: 404 });
    const problem = publicationProblem(graph, inputs, sidecar);
    if (problem) return Response.json({ error: problem }, { status: 400 });
    const token = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const version = { token, path, title: projectTitle(graph, path, sidecar),
      created_at: createdAt };
    const snapshot = { contract_version: 'mere.run/graph-studio-shared-app.v1', ...version,
      graph, inputs, sidecar: publicAppSidecar(sidecar) };
    await this.ctx.storage.put({ [`${SHARE_PREFIX}${token}`]: snapshot,
      [`${SHARE_INDEX_PREFIX}${path}:${token}`]: version });
    return Response.json(version, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  }

  private async listAppVersions(url: URL): Promise<Response> {
    const path = url.searchParams.get('path') ?? '';
    if (!PATH_PATTERN.test(path)) return Response.json({ error: 'Invalid project path' }, { status: 400 });
    const values = await this.ctx.storage.list<JsonObject>({ prefix: `${SHARE_INDEX_PREFIX}${path}:` });
    const versions = [...values.values()].sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)));
    return Response.json({ versions }, { headers: { 'Cache-Control': 'no-store' } });
  }

  private async sharedApp(url: URL): Promise<Response> {
    const token = url.searchParams.get('token') ?? '';
    if (!SHARE_TOKEN_PATTERN.test(token)) return Response.json({ error: 'Invalid share token' }, { status: 400 });
    const snapshot = await this.ctx.storage.get(`${SHARE_PREFIX}${token}`);
    return snapshot
      ? Response.json(snapshot, { headers: { 'Cache-Control': 'no-store' } })
      : Response.json({ error: 'Shared app not found' }, { status: 404 });
  }

  private async revokeAppVersion(url: URL): Promise<Response> {
    const token = url.searchParams.get('token') ?? '';
    if (!SHARE_TOKEN_PATTERN.test(token)) return Response.json({ error: 'Invalid share token' }, { status: 400 });
    const snapshot = await this.ctx.storage.get<JsonObject>(`${SHARE_PREFIX}${token}`);
    if (!snapshot || typeof snapshot.path !== 'string') return Response.json({ error: 'Shared app not found' }, { status: 404 });
    await this.ctx.storage.delete([`${SHARE_PREFIX}${token}`, `${SHARE_INDEX_PREFIX}${snapshot.path}:${token}`]);
    return new Response(null, { status: 204 });
  }

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
    switch (`${request.method} ${url.pathname}`) {
      case 'POST /app-version': return this.publishApp(request);
      case 'DELETE /app-version': return this.revokeAppVersion(url);
      case 'GET /app-versions': return this.listAppVersions(url);
      case 'GET /shared-app': return this.sharedApp(url);
      case 'GET /projects': return this.listProjects();
      case 'GET /project': return this.loadProject(url);
      case 'PUT /project': return this.saveProject(request);
      case 'DELETE /project': return this.deleteProject(url);
      default: return new Response('Not Found', { status: 404 });
    }
  }
}
