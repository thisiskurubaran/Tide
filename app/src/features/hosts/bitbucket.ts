// Bitbucket Cloud through its REST API 2.0, with an Atlassian API token and
// the account's email (Basic auth). Git uses the same token.
import { toBase64 } from '../backup/zip';
import { ChangeState, comment, GitHost, HostChange, HostError, HostIssue, HostRepo, readJson, splitDiff } from './api';

const PR_STATE: Record<ChangeState, string> = { open: 'OPEN', merged: 'MERGED', closed: 'DECLINED' };
const OPEN_ISSUE = ['new', 'open', 'on hold'];
// Pages of results followed at most, so a huge account can't hang the screen.
const MAX_PAGES = 4;

export function createBitbucket(email: string, token: string, fetchImpl: typeof fetch = (...a) => fetch(...a)): GitHost {
  const api = 'https://api.bitbucket.org/2.0';
  const auth = `Basic ${toBase64(new TextEncoder().encode(`${email}:${token}`))}`;
  const call = async (path: string, init: RequestInit = {}) =>
    readJson(await fetchImpl(path.startsWith('http') ? path : `${api}${path}`, { ...init, headers: { Authorization: auth, 'Content-Type': 'application/json', ...init.headers } }), 'Bitbucket');
  const all = async (path: string) => {
    const out: any[] = [];
    let next: string | undefined = path;
    for (let i = 0; next && i < MAX_PAGES; i++) {
      const page: any = await call(next);
      out.push(...(page.values ?? []));
      next = page.next;
    }
    return out;
  };
  const repoPath = (repo: string) => `/repositories/${repo.split('/').map(encodeURIComponent).join('/')}`;

  const toChange = (p: any): HostChange => ({
    number: p.id,
    title: p.title,
    body: p.description ?? '',
    author: p.author?.nickname ?? p.author?.display_name ?? '',
    state: p.state === 'MERGED' ? 'merged' : p.state === 'OPEN' ? 'open' : 'closed',
    draft: !!p.draft,
    source: p.source?.branch?.name ?? '',
    target: p.destination?.branch?.name ?? '',
    createdAt: p.created_on,
    webUrl: p.links?.html?.href ?? '',
  });
  const toIssue = (i: any): HostIssue => ({
    number: i.id,
    title: i.title,
    body: i.content?.raw ?? '',
    author: i.reporter?.nickname ?? i.reporter?.display_name ?? '',
    open: OPEN_ISSUE.includes(i.state),
    createdAt: i.created_on,
    webUrl: i.links?.html?.href ?? '',
    comments: null,
  });
  const comments = async (path: string) =>
    (await all(`${path}/comments?pagelen=100`))
      .filter((c) => !c.deleted && c.content?.raw)
      .map((c) => comment(c.id, c.user?.nickname ?? c.user?.display_name ?? '', c.content.raw, c.created_on));

  return {
    kind: 'bitbucket',
    async user() {
      const u = await call('/user');
      return { username: u.username ?? u.nickname, name: u.display_name ?? u.username };
    },
    async repos(): Promise<HostRepo[]> {
      // The workspaces you're in, then their repositories.
      let workspaces: string[];
      try {
        workspaces = (await all('/user/workspaces?pagelen=100')).map((w) => w.workspace?.slug).filter(Boolean);
      } catch (e) {
        if (!(e instanceof HostError) || e.status !== 404) throw e;
        workspaces = (await all('/workspaces?role=member&pagelen=100')).map((w) => w.slug);
      }
      const lists = await Promise.all(workspaces.slice(0, 10).map((w) => all(`/repositories/${encodeURIComponent(w)}?pagelen=50&sort=-updated_on`)));
      return lists
        .flat()
        .map((r) => ({
          id: r.full_name,
          fullName: r.full_name,
          description: r.description ?? '',
          private: !!r.is_private,
          defaultBranch: r.mainbranch?.name ?? null,
          cloneUrl: (r.links?.clone ?? []).find((c: any) => c.name === 'https')?.href?.replace(/\/\/[^@/]+@/, '//') ?? `https://bitbucket.org/${r.full_name}.git`,
          webUrl: r.links?.html?.href ?? `https://bitbucket.org/${r.full_name}`,
          updatedAt: r.updated_on,
        }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async changes(repo, state) {
      return (await all(`${repoPath(repo)}/pullrequests?state=${PR_STATE[state]}&pagelen=50`)).map(toChange);
    },
    async change(repo, n) {
      return toChange(await call(`${repoPath(repo)}/pullrequests/${n}`));
    },
    async changeFiles(repo, n) {
      const res = await fetchImpl(`${api}${repoPath(repo)}/pullrequests/${n}/diff`, { headers: { Authorization: auth } });
      if (!res.ok) await readJson(res, 'Bitbucket');
      return splitDiff(await res.text());
    },
    changeComments: (repo, n) => comments(`${repoPath(repo)}/pullrequests/${n}`),
    async commentOnChange(repo, n, body) {
      await call(`${repoPath(repo)}/pullrequests/${n}/comments`, { method: 'POST', body: JSON.stringify({ content: { raw: body } }) });
    },
    async approve(repo, n) {
      await call(`${repoPath(repo)}/pullrequests/${n}/approve`, { method: 'POST' });
    },
    async merge(repo, n) {
      await call(`${repoPath(repo)}/pullrequests/${n}/merge`, { method: 'POST', body: '{}' });
    },
    async issues(repo, open) {
      const q = encodeURIComponent((open ? OPEN_ISSUE : ['resolved', 'closed', 'invalid', 'duplicate', 'wontfix']).map((s) => `state="${s}"`).join(' OR '));
      try {
        return (await all(`${repoPath(repo)}/issues?q=${q}&sort=-created_on&pagelen=50`)).map(toIssue);
      } catch (e) {
        // Repositories without the issue tracker turned on.
        if (e instanceof HostError && e.status === 404) return null;
        throw e;
      }
    },
    async issue(repo, n) {
      return toIssue(await call(`${repoPath(repo)}/issues/${n}`));
    },
    issueComments: (repo, n) => comments(`${repoPath(repo)}/issues/${n}`),
    async commentOnIssue(repo, n, body) {
      await call(`${repoPath(repo)}/issues/${n}/comments`, { method: 'POST', body: JSON.stringify({ content: { raw: body } }) });
    },
    async createIssue(repo, title, body) {
      return toIssue(await call(`${repoPath(repo)}/issues`, { method: 'POST', body: JSON.stringify({ title, content: { raw: body } }) }));
    },
    async setIssueOpen(repo, n, open) {
      await call(`${repoPath(repo)}/issues/${n}`, { method: 'PUT', body: JSON.stringify({ state: open ? 'open' : 'resolved' }) });
    },
  };
}
