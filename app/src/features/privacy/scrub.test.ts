import { scrubEvent, scrubPaths } from './scrub';

const DOCS = '/var/mobile/Containers/Data/Application/ABC/Documents';

describe('crash report scrubbing', () => {
  it('replaces whole paths under Documents in plain and file URL forms', () => {
    const out = scrubPaths(
      {
        message: `ENOENT: ${DOCS}/projects/secret-app/index.js`,
        frames: [{ filename: `file://${DOCS}/projects/a/b.js` }, { filename: 'app:///main.jsbundle' }],
        count: 3,
      },
      DOCS,
    );
    expect(out).toEqual({
      message: 'ENOENT: <documents>',
      frames: [{ filename: '<documents>' }, { filename: 'app:///main.jsbundle' }],
      count: 3,
    });
  });

  it('handles a Documents path with spaces written as a file URL', () => {
    const docs = '/Users/me/Library/Mobile Documents';
    expect(scrubPaths(`open 'file:///Users/me/Library/Mobile%20Documents/x y' failed`, docs)).toBe("open '<documents>' failed");
    expect(scrubPaths(`at (${docs}/my app/a.js:3)\nnext`, docs)).toBe('at (<documents>)\nnext');
  });

  it('drops breadcrumbs, request, user and extra data', () => {
    const out = scrubEvent(
      {
        message: 'boom',
        breadcrumbs: [{ message: 'typed: rm -rf' }],
        request: { url: 'http://server' },
        user: { ip_address: '1.2.3.4' },
        extra: { code: 'console.log(1)' },
        server_name: 'phone',
      },
      DOCS,
    );
    expect(out).toEqual({ message: 'boom' });
  });
});
