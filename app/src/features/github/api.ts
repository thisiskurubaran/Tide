// The GitHub REST API calls Tide uses, with the signed-in user's token.
const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface User {
  login: string;
  id: number;
  name: string | null;
  avatar_url: string;
  html_url: string;
}

export interface Repo {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  private: boolean;
  fork: boolean;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  open_issues_count: number;
  default_branch: string;
  clone_url: string;
  html_url: string;
  updated_at: string;
  has_pages?: boolean;
}

export interface Label {
  name: string;
  color: string;
}

export interface Issue {
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  user: { login: string };
  labels: Label[];
  comments: number;
  created_at: string;
  updated_at: string;
  html_url: string;
  pull_request?: unknown;
  repository_url?: string;
}

export interface Pull {
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  draft: boolean;
  merged?: boolean;
  merged_at: string | null;
  mergeable?: boolean | null;
  mergeable_state?: string;
  user: { login: string };
  head: { ref: string; sha: string; repo: { full_name: string } | null };
  base: { ref: string };
  created_at: string;
  updated_at: string;
  html_url: string;
  additions?: number;
  deletions?: number;
  changed_files?: number;
  comments?: number;
  review_comments?: number;
}

export interface PullFile {
  filename: string;
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';
  additions: number;
  deletions: number;
  patch?: string;
}

export interface Comment {
  id: number;
  user: { login: string };
  body: string;
  created_at: string;
}

export interface Review {
  id: number;
  user: { login: string };
  body: string | null;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
  submitted_at: string | null;
}

export interface CheckRun {
  id: number;
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: string | null;
  html_url: string;
}

export interface WorkflowRun {
  id: number;
  name: string | null;
  display_title: string;
  status: string | null;
  conclusion: string | null;
  head_branch: string | null;
  event: string;
  run_number: number;
  created_at: string;
  html_url: string;
}

export interface Branch {
  name: string;
}

export type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
export type MergeMethod = 'merge' | 'squash' | 'rebase';

export function createGitHub(token: string, fetchImpl: typeof fetch = (...a) => fetch(...a)) {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetchImpl(path.startsWith('http') ? path : `${API}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      const detail = data?.errors?.[0]?.message ?? data?.message ?? res.statusText;
      throw new GitHubError(res.status === 401 ? 'GitHub sign-in has expired. Sign in again in Settings → GitHub.' : detail, res.status);
    }
    return data as T;
  }

  const get = <T>(path: string) => request<T>('GET', path);
  const enc = encodeURIComponent;
  const repoPath = (owner: string, repo: string) => `/repos/${enc(owner)}/${enc(repo)}`;

  return {
    user: () => get<User>('/user'),
    emails: () => get<{ email: string; primary: boolean; verified: boolean; visibility: string | null }[]>('/user/emails'),
    repos: (page = 1) => get<Repo[]>(`/user/repos?sort=updated&per_page=50&page=${page}&affiliation=owner,collaborator,organization_member`),
    searchRepos: (q: string) => get<{ items: Repo[] }>(`/search/repositories?q=${enc(q)}&per_page=30`).then((r) => r.items),
    repo: (owner: string, repo: string) => get<Repo>(repoPath(owner, repo)),
    branches: (owner: string, repo: string) => get<Branch[]>(`${repoPath(owner, repo)}/branches?per_page=100`),

    pulls: (owner: string, repo: string, state: 'open' | 'closed' = 'open') => get<Pull[]>(`${repoPath(owner, repo)}/pulls?state=${state}&per_page=50`),
    pull: (owner: string, repo: string, n: number) => get<Pull>(`${repoPath(owner, repo)}/pulls/${n}`),
    pullFiles: (owner: string, repo: string, n: number) => get<PullFile[]>(`${repoPath(owner, repo)}/pulls/${n}/files?per_page=100`),
    reviews: (owner: string, repo: string, n: number) => get<Review[]>(`${repoPath(owner, repo)}/pulls/${n}/reviews?per_page=100`),
    review: (owner: string, repo: string, n: number, event: ReviewEvent, body: string) =>
      request<Review>('POST', `${repoPath(owner, repo)}/pulls/${n}/reviews`, { event, body: body || undefined }),
    merge: (owner: string, repo: string, n: number, method: MergeMethod) =>
      request<{ merged: boolean; message: string }>('PUT', `${repoPath(owner, repo)}/pulls/${n}/merge`, { merge_method: method }),
    createPull: (owner: string, repo: string, p: { title: string; body: string; head: string; base: string; draft?: boolean }) =>
      request<Pull>('POST', `${repoPath(owner, repo)}/pulls`, p),
    checks: (owner: string, repo: string, sha: string) => get<{ check_runs: CheckRun[] }>(`${repoPath(owner, repo)}/commits/${sha}/check-runs?per_page=100`).then((r) => r.check_runs),

    issues: (owner: string, repo: string, state: 'open' | 'closed' = 'open') =>
      get<Issue[]>(`${repoPath(owner, repo)}/issues?state=${state}&per_page=50`).then((list) => list.filter((i) => !i.pull_request)),
    issue: (owner: string, repo: string, n: number) => get<Issue>(`${repoPath(owner, repo)}/issues/${n}`),
    comments: (owner: string, repo: string, n: number) => get<Comment[]>(`${repoPath(owner, repo)}/issues/${n}/comments?per_page=100`),
    comment: (owner: string, repo: string, n: number, body: string) => request<Comment>('POST', `${repoPath(owner, repo)}/issues/${n}/comments`, { body }),
    createIssue: (owner: string, repo: string, title: string, body: string) => request<Issue>('POST', `${repoPath(owner, repo)}/issues`, { title, body }),
    setIssueState: (owner: string, repo: string, n: number, state: 'open' | 'closed') => request<Issue>('PATCH', `${repoPath(owner, repo)}/issues/${n}`, { state }),
    // Open issues and pull requests across GitHub that involve the user.
    involved: (login: string, kind: 'issue' | 'pr') =>
      get<{ items: Issue[] }>(`/search/issues?q=${enc(`is:open is:${kind} involves:${login} archived:false`)}&sort=updated&per_page=50`).then((r) => r.items),

    runs: (owner: string, repo: string) => get<{ workflow_runs: WorkflowRun[] }>(`${repoPath(owner, repo)}/actions/runs?per_page=30`).then((r) => r.workflow_runs),
    rerun: (owner: string, repo: string, id: number) => request<void>('POST', `${repoPath(owner, repo)}/actions/runs/${id}/rerun`),

    request,
  };
}

export type GitHub = ReturnType<typeof createGitHub>;

// owner/repo from a git remote URL (https or ssh), or null when it isn't GitHub.
export function parseRemote(url: string): { owner: string; repo: string } | null {
  const m = /github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(url.trim());
  return m ? { owner: m[1], repo: m[2] } : null;
}

// owner/repo out of an issue's repository_url (search results don't name the repo otherwise).
export function repoOf(issue: Issue): { owner: string; repo: string } | null {
  const m = /\/repos\/([^/]+)\/([^/]+)$/.exec(issue.repository_url ?? '');
  return m ? { owner: m[1], repo: m[2] } : null;
}

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const units: [number, string][] = [
    [60, 'minute'],
    [3600, 'hour'],
    [86400, 'day'],
    [2592000, 'month'],
    [31536000, 'year'],
  ];
  let i = 0;
  while (i + 1 < units.length && s >= units[i + 1][0]) i++;
  const n = Math.floor(s / units[i][0]);
  return `${n} ${units[i][1]}${n === 1 ? '' : 's'} ago`;
}
