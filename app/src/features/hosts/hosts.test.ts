import { HostError, splitDiff } from './api';
import { createBitbucket } from './bitbucket';
import { createGitLab } from './gitlab';

type Route = (url: string, init: RequestInit) => { status?: number; body?: unknown; text?: string } | undefined;

function fakeFetch(route: Route) {
  const calls: { url: string; method: string; headers: Record<string, string>; body: unknown }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: (init.headers ?? {}) as Record<string, string>, body: typeof init.body === 'string' && init.body ? JSON.parse(init.body) : undefined });
    const r = route(url, init);
    if (!r) return new Response('{"message":"404 Not found"}', { status: 404 });
    return new Response(r.text ?? JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const PATCH = '@@ -1,2 +1,2 @@\n line\n-old\n+new';

describe('GitLab', () => {
  const { fetchImpl, calls } = fakeFetch((url, init) => {
    const u = url.replace('https://git.example.com/api/v4', '');
    if (u === '/user') return { body: { username: 'ada', name: 'Ada' } };
    if (u.startsWith('/projects?membership=true')) {
      return { body: [{ id: 7, path_with_namespace: 'team/app', description: null, visibility: 'private', default_branch: 'main', http_url_to_repo: 'https://git.example.com/team/app.git', web_url: 'https://git.example.com/team/app', last_activity_at: '2026-10-01T00:00:00Z' }] };
    }
    if (u === '/projects/7/merge_requests?state=opened&per_page=50') {
      return { body: [{ iid: 3, title: 'Add login', description: 'Adds it', author: { username: 'grace' }, state: 'opened', draft: false, source_branch: 'login', target_branch: 'main', created_at: '2026-10-02T00:00:00Z', web_url: 'w' }] };
    }
    if (u === '/projects/7/merge_requests/3/diffs?per_page=100') return { body: [{ old_path: 'a.js', new_path: 'a.js', diff: `${PATCH}\n` }, { old_path: 'b.png', new_path: 'b.png', new_file: true, diff: '' }] };
    if (u.startsWith('/projects/7/merge_requests/3/notes?')) {
      return { body: [{ id: 1, body: 'changed the description', system: true, author: { username: 'grace' }, created_at: 'x' }, { id: 2, body: 'Looks good', system: false, author: { username: 'ada' }, created_at: '2026-10-03T00:00:00Z' }] };
    }
    if (u === '/projects/7/merge_requests/3/notes' && init.method === 'POST') return { body: {} };
    if (u === '/projects/7/merge_requests/3/merge' && init.method === 'PUT') return { body: {} };
    if (u === '/projects/7/issues?state=opened&per_page=50') return { body: [{ iid: 9, title: 'Bug', description: 'It breaks', author: { username: 'linus' }, state: 'opened', created_at: 'c', web_url: 'w', user_notes_count: 2 }] };
    if (u === '/projects/8/issues?state=opened&per_page=50') return { status: 403, body: { message: '403 Forbidden' } };
    if (u === '/projects/7/issues/9' && init.method === 'PUT') return { body: {} };
    return undefined;
  });
  const gl = createGitLab('https://git.example.com/', 'glpat-1', fetchImpl);

  it('signs in with the token and lists projects', async () => {
    expect(await gl.user()).toEqual({ username: 'ada', name: 'Ada' });
    expect(calls[0].headers['PRIVATE-TOKEN']).toBe('glpat-1');
    expect(await gl.repos()).toEqual([
      { id: '7', fullName: 'team/app', description: '', private: true, defaultBranch: 'main', cloneUrl: 'https://git.example.com/team/app.git', webUrl: 'https://git.example.com/team/app', updatedAt: '2026-10-01T00:00:00Z' },
    ]);
  });

  it('reads merge requests, their diffs and notes, and merges', async () => {
    expect(await gl.changes('7', 'open')).toEqual([
      { number: 3, title: 'Add login', body: 'Adds it', author: 'grace', state: 'open', draft: false, source: 'login', target: 'main', createdAt: '2026-10-02T00:00:00Z', webUrl: 'w' },
    ]);
    expect(await gl.changeFiles('7', 3)).toEqual([
      { filename: 'a.js', status: 'modified', additions: 1, deletions: 1, patch: PATCH },
      { filename: 'b.png', status: 'added', additions: 0, deletions: 0, patch: undefined },
    ]);
    // System notes ("changed the description") are left out.
    expect(await gl.changeComments('7', 3)).toEqual([{ id: 2, user: { login: 'ada' }, body: 'Looks good', created_at: '2026-10-03T00:00:00Z' }]);
    await gl.commentOnChange('7', 3, 'Thanks');
    expect(calls.at(-1)).toMatchObject({ method: 'POST', body: { body: 'Thanks' } });
    await gl.merge('7', 3);
    expect(calls.at(-1)!.method).toBe('PUT');
  });

  it('reads issues, closes them, and says when issues are off', async () => {
    expect((await gl.issues('7', true))![0]).toMatchObject({ number: 9, open: true, comments: 2 });
    expect(await gl.issues('8', true)).toBeNull();
    await gl.setIssueOpen('7', 9, false);
    expect(calls.at(-1)!.body).toEqual({ state_event: 'close' });
  });

  it('explains a bad token', async () => {
    const { fetchImpl: f } = fakeFetch(() => ({ status: 401, body: { message: '401 Unauthorized' } }));
    await expect(createGitLab('https://gitlab.com', 'x', f).user()).rejects.toThrow("didn't accept the token");
  });
});

describe('Bitbucket', () => {
  const diff = `diff --git a/src/a.js b/src/a.js
index 1..2 100644
--- a/src/a.js
+++ b/src/a.js
${PATCH}
diff --git a/new.txt b/new.txt
new file mode 100644
--- /dev/null
+++ b/new.txt
@@ -0,0 +1 @@
+hello
`;
  const { fetchImpl, calls } = fakeFetch((url, init) => {
    const u = url.replace('https://api.bitbucket.org/2.0', '');
    if (u === '/user') return { body: { username: 'ada', display_name: 'Ada L' } };
    if (u === '/user/workspaces?pagelen=100') return { body: { values: [{ workspace: { slug: 'team' } }], next: undefined } };
    if (u === '/repositories/team?pagelen=50&sort=-updated_on') {
      return {
        body: {
          values: [{ full_name: 'team/site', description: '', is_private: true, mainbranch: { name: 'main' }, links: { clone: [{ name: 'https', href: 'https://ada@bitbucket.org/team/site.git' }], html: { href: 'https://bitbucket.org/team/site' } }, updated_on: '2026-10-01' }],
          next: 'https://api.bitbucket.org/2.0/repositories/team?page=2',
        },
      };
    }
    if (u === '/repositories/team?page=2') return { body: { values: [{ full_name: 'team/old', is_private: false, links: {}, updated_on: '2025-01-01' }] } };
    if (u === '/repositories/team/site/pullrequests?state=OPEN&pagelen=50') {
      return { body: { values: [{ id: 5, title: 'Fix', description: '', author: { nickname: 'grace' }, state: 'OPEN', source: { branch: { name: 'fix' } }, destination: { branch: { name: 'main' } }, created_on: 'c', links: { html: { href: 'w' } } }] } };
    }
    if (u === '/repositories/team/site/pullrequests/5/diff') return { text: diff };
    if (u === '/repositories/team/site/pullrequests/5/comments?pagelen=100') return { body: { values: [{ id: 1, content: { raw: 'Nice' }, user: { nickname: 'ada' }, created_on: 'd' }, { id: 2, deleted: true, content: { raw: '' } }] } };
    if (u === '/repositories/team/site/pullrequests/5/merge') return { body: {} };
    if (u.startsWith('/repositories/team/site/issues?q=')) return { status: 404, body: { error: { message: 'Repository has no issue tracker.' } } };
    return undefined;
  });
  const bb = createBitbucket('ada@example.com', 'ATATT-1', fetchImpl);

  it('signs in with email and token, and lists repositories across pages', async () => {
    expect(await bb.user()).toEqual({ username: 'ada', name: 'Ada L' });
    expect(calls[0].headers.Authorization).toBe(`Basic ${Buffer.from('ada@example.com:ATATT-1').toString('base64')}`);
    const repos = await bb.repos();
    expect(repos.map((r) => r.fullName)).toEqual(['team/site', 'team/old']);
    // The clone URL loses the username Bitbucket puts in it.
    expect(repos[0].cloneUrl).toBe('https://bitbucket.org/team/site.git');
    expect(repos[1].cloneUrl).toBe('https://bitbucket.org/team/old.git');
  });

  it('reads pull requests, splits the diff into files, and merges', async () => {
    expect((await bb.changes('team/site', 'open'))[0]).toMatchObject({ number: 5, source: 'fix', target: 'main', state: 'open', author: 'grace' });
    expect(await bb.changeFiles('team/site', 5)).toEqual([
      { filename: 'src/a.js', status: 'modified', additions: 1, deletions: 1, patch: PATCH },
      { filename: 'new.txt', status: 'added', additions: 1, deletions: 0, patch: '@@ -0,0 +1 @@\n+hello' },
    ]);
    expect(await bb.changeComments('team/site', 5)).toEqual([{ id: 1, user: { login: 'ada' }, body: 'Nice', created_at: 'd' }]);
    await bb.merge('team/site', 5);
    expect(calls.at(-1)!.method).toBe('POST');
  });

  it('says when the issue tracker is off', async () => {
    expect(await bb.issues('team/site', true)).toBeNull();
  });
});

describe('splitDiff', () => {
  it('handles deletions and renames', () => {
    const files = splitDiff(`diff --git a/gone.txt b/gone.txt
deleted file mode 100644
--- a/gone.txt
+++ /dev/null
@@ -1 +0,0 @@
-bye
diff --git a/old.md b/new.md
similarity index 90%
rename from old.md
rename to new.md
--- a/old.md
+++ b/new.md
@@ -1 +1 @@
-a
+b
diff --git a/img.png b/img.png
Binary files a/img.png and b/img.png differ
`);
    expect(files.map((f) => [f.filename, f.status, f.patch === undefined])).toEqual([
      ['gone.txt', 'removed', false],
      ['new.md', 'renamed', false],
      ['img.png', 'modified', true],
    ]);
  });

  it('keeps HostError status for callers', () => {
    expect(new HostError('x', 404).status).toBe(404);
  });
});
