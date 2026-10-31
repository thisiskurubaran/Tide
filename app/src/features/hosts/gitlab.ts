// GitLab (gitlab.com or your own instance) through its REST API v4, with a
// personal access token (scopes: api, or read_api to only look).
import type { PullFile } from '../github/api';
import { ChangeState, comment, GitHost, HostChange, HostIssue, HostRepo, readJson } from './api';

const MR_STATE: Record<ChangeState, string> = { open: 'opened', merged: 'merged', closed: 'closed' };

export function createGitLab(baseUrl: string, token: string, fetchImpl: typeof fetch = (...a) => fetch(...a)): GitHost {
  const api = `${baseUrl.replace(/\/+$/, '')}/api/v4`;
  const call = async (path: string, init: RequestInit = {}) =>
    readJson(await fetchImpl(`${api}${path}`, { ...init, headers: { 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json', ...init.headers } }), 'GitLab');
  const project = (id: string) => `/projects/${encodeURIComponent(id)}`;

  const toChange = (m: any): HostChange => ({
    number: m.iid,
    title: m.title,
    body: m.description ?? '',
    author: m.author?.username ?? '',
    state: m.state === 'merged' ? 'merged' : m.state === 'opened' ? 'open' : 'closed',
    draft: !!(m.draft ?? m.work_in_progress),
    source: m.source_branch,
    target: m.target_branch,
    createdAt: m.created_at,
    webUrl: m.web_url,
  });
  const toIssue = (i: any): HostIssue => ({
    number: i.iid,
    title: i.title,
    body: i.description ?? '',
    author: i.author?.username ?? '',
    open: i.state === 'opened',
    createdAt: i.created_at,
    webUrl: i.web_url,
    comments: i.user_notes_count ?? null,
  });
  // People's notes, without the system ones ("changed the description").
  const notes = async (path: string) =>
    ((await call(`${path}/notes?sort=asc&order_by=created_at&per_page=100`)) as any[])
      .filter((n) => !n.system)
      .map((n) => comment(n.id, n.author?.username ?? '', n.body, n.created_at));

  return {
    kind: 'gitlab',
    async user() {
      const u = await call('/user');
      return { username: u.username, name: u.name ?? u.username };
    },
    async repos(): Promise<HostRepo[]> {
      const list: any[] = await call('/projects?membership=true&order_by=last_activity_at&per_page=50');
      return list.map((p) => ({
        id: String(p.id),
        fullName: p.path_with_namespace,
        description: p.description ?? '',
        private: p.visibility !== 'public',
        defaultBranch: p.default_branch ?? null,
        cloneUrl: p.http_url_to_repo,
        webUrl: p.web_url,
        updatedAt: p.last_activity_at,
      }));
    },
    async changes(repo, state) {
      return ((await call(`${project(repo)}/merge_requests?state=${MR_STATE[state]}&per_page=50`)) as any[]).map(toChange);
    },
    async change(repo, n) {
      return toChange(await call(`${project(repo)}/merge_requests/${n}`));
    },
    async changeFiles(repo, n): Promise<PullFile[]> {
      const diffs: any[] = await call(`${project(repo)}/merge_requests/${n}/diffs?per_page=100`);
      return diffs.map((d) => {
        const patch: string = d.diff ?? '';
        const body = patch.split('\n');
        return {
          filename: d.new_path ?? d.old_path,
          status: d.new_file ? 'added' : d.deleted_file ? 'removed' : d.renamed_file ? 'renamed' : 'modified',
          additions: body.filter((l) => l.startsWith('+')).length,
          deletions: body.filter((l) => l.startsWith('-')).length,
          patch: patch ? patch.replace(/\n$/, '') : undefined,
        };
      });
    },
    changeComments: (repo, n) => notes(`${project(repo)}/merge_requests/${n}`),
    async commentOnChange(repo, n, body) {
      await call(`${project(repo)}/merge_requests/${n}/notes`, { method: 'POST', body: JSON.stringify({ body }) });
    },
    async approve(repo, n) {
      await call(`${project(repo)}/merge_requests/${n}/approve`, { method: 'POST', body: '{}' });
    },
    async merge(repo, n) {
      await call(`${project(repo)}/merge_requests/${n}/merge`, { method: 'PUT', body: '{}' });
    },
    async issues(repo, open) {
      try {
        return ((await call(`${project(repo)}/issues?state=${open ? 'opened' : 'closed'}&per_page=50`)) as any[]).map(toIssue);
      } catch (e: any) {
        if (e?.status === 404 || e?.status === 403) return null;
        throw e;
      }
    },
    async issue(repo, n) {
      return toIssue(await call(`${project(repo)}/issues/${n}`));
    },
    issueComments: (repo, n) => notes(`${project(repo)}/issues/${n}`),
    async commentOnIssue(repo, n, body) {
      await call(`${project(repo)}/issues/${n}/notes`, { method: 'POST', body: JSON.stringify({ body }) });
    },
    async createIssue(repo, title, body) {
      return toIssue(await call(`${project(repo)}/issues`, { method: 'POST', body: JSON.stringify({ title, description: body }) }));
    },
    async setIssueOpen(repo, n, open) {
      await call(`${project(repo)}/issues/${n}`, { method: 'PUT', body: JSON.stringify({ state_event: open ? 'reopen' : 'close' }) });
    },
  };
}
