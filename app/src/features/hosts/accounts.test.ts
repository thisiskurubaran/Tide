import { accountsStore, gitCredentials } from './accounts';

describe('git credentials for signed-in hosts', () => {
  it('gives GitLab and Bitbucket remotes their own token and username', () => {
    accountsStore.setState({
      accounts: [
        { id: 'g', kind: 'gitlab', baseUrl: 'https://gitlab.example.com', username: 'ada', name: 'Ada' },
        { id: 'b', kind: 'bitbucket', baseUrl: 'https://bitbucket.org', email: 'ada@example.com', username: 'ada', name: 'Ada' },
        { id: 'x', kind: 'gitlab', baseUrl: 'https://gitlab.com', username: 'gone', name: 'No token' },
      ],
      tokens: { g: 'glpat-1', b: 'ATATT-1', x: '' },
    });
    expect(gitCredentials()).toEqual({
      'gitlab.example.com': { username: 'oauth2', password: 'glpat-1' },
      'bitbucket.org': { username: 'x-bitbucket-api-token-auth', password: 'ATATT-1' },
    });
  });
});
