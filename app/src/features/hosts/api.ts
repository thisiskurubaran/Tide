// GitLab and Bitbucket behind one interface. Shapes that the
// GitHub screens' diff list and conversation view already take are reused.
import type { Comment, PullFile } from '../github/api';

export type HostKind = 'gitlab' | 'bitbucket';

export class HostError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface HostRepo {
  // GitLab's numeric id, or Bitbucket's "workspace/repo".
  id: string;
  fullName: string;
  description: string;
  private: boolean;
  defaultBranch: string | null;
  cloneUrl: string;
  webUrl: string;
  updatedAt: string;
}

export type ChangeState = 'open' | 'merged' | 'closed';

// A GitLab merge request or Bitbucket pull request.
export interface HostChange {
  number: number;
  title: string;
  body: string;
  author: string;
  state: ChangeState;
  draft: boolean;
  source: string;
  target: string;
  createdAt: string;
  webUrl: string;
}

export interface HostIssue {
  number: number;
  title: string;
  body: string;
  author: string;
  open: boolean;
  createdAt: string;
  webUrl: string;
  comments: number | null;
}

export interface GitHost {
  kind: HostKind;
  user(): Promise<{ username: string; name: string }>;
  repos(): Promise<HostRepo[]>;
  changes(repo: string, state: ChangeState): Promise<HostChange[]>;
  change(repo: string, n: number): Promise<HostChange>;
  changeFiles(repo: string, n: number): Promise<PullFile[]>;
  changeComments(repo: string, n: number): Promise<Comment[]>;
  commentOnChange(repo: string, n: number, body: string): Promise<void>;
  approve(repo: string, n: number): Promise<void>;
  merge(repo: string, n: number): Promise<void>;
  // null when the repository has no issue tracker.
  issues(repo: string, open: boolean): Promise<HostIssue[] | null>;
  issue(repo: string, n: number): Promise<HostIssue>;
  issueComments(repo: string, n: number): Promise<Comment[]>;
  commentOnIssue(repo: string, n: number, body: string): Promise<void>;
  createIssue(repo: string, title: string, body: string): Promise<HostIssue>;
  setIssueOpen(repo: string, n: number, open: boolean): Promise<void>;
}

// Reads a JSON answer, turning API errors into readable ones.
export async function readJson(res: Response, service: string): Promise<any> {
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON.
  }
  if (!res.ok) {
    const message =
      res.status === 401
        ? `${service} didn't accept the token. Check it hasn't expired and has the right scopes.`
        : res.status === 403
          ? `${service}: the token doesn't have permission for this.`
          : data?.message
            ? typeof data.message === 'string'
              ? data.message
              : JSON.stringify(data.message)
            : data?.error?.message ?? data?.error ?? `HTTP ${res.status}`;
    throw new HostError(`${message}`, res.status);
  }
  return data;
}

// A whole pull request diff split into files, each patch from its first @@.
export function splitDiff(diff: string): PullFile[] {
  const files: PullFile[] = [];
  for (const section of diff.split(/^diff --git /m).slice(1)) {
    const lines = section.split('\n');
    const header = lines[0];
    const plus = lines.find((l) => l.startsWith('+++ '));
    const minus = lines.find((l) => l.startsWith('--- '));
    const strip = (p: string | undefined) => (p && p !== '/dev/null' ? p.replace(/^[ab]\//, '') : null);
    const after = strip(plus?.slice(4).trim());
    const before = strip(minus?.slice(4).trim());
    const fallback = /^a\/(.+?) b\/(.+)$/.exec(header);
    const filename = after ?? before ?? fallback?.[2] ?? header;
    const start = lines.findIndex((l) => l.startsWith('@@'));
    const patch = start >= 0 ? lines.slice(start).join('\n').replace(/\n$/, '') : undefined;
    const body = patch?.split('\n') ?? [];
    files.push({
      filename,
      status: !before && after ? 'added' : before && !after ? 'removed' : before && after && before !== after ? 'renamed' : 'modified',
      additions: body.filter((l) => l.startsWith('+')).length,
      deletions: body.filter((l) => l.startsWith('-')).length,
      patch,
    });
  }
  return files;
}

export const comment = (id: number, login: string, body: string, created_at: string): Comment => ({ id, user: { login }, body, created_at });
