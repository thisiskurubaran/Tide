// @ts-check
// Which credential, if any, git sends when a remote answers 401. The token from
// Settings is a GitHub token, so it goes to github.com only; any other host
// needs its own signed-in account (TIDE_GIT_HOSTS). Nothing is ever sent over
// plain http, where anyone on the network could read it.
'use strict';

// Hosts the Settings token is for. Matched against the URL's parsed hostname,
// so github.com.evil.com, evil.com/github.com and github.com@evil.com don't.
const TOKEN_HOSTS = new Set(['github.com', 'www.github.com']);

/**
 * @param {string} url
 * @returns {{ protocol: string, hostname: string, host: string, port: string } | null}
 */
function parseRemote(url) {
  try {
    const u = new URL(url);
    return { protocol: u.protocol, hostname: u.hostname.toLowerCase(), host: u.host.toLowerCase(), port: u.port };
  } catch {
    return null;
  }
}

/** @param {string} url */
function hostOf(url) {
  return parseRemote(url)?.host ?? '';
}

/**
 * @param {{ env: Record<string, string | undefined>, GitError: new (message: string) => Error }} deps
 */
function createAuth({ env, GitError }) {
  // Signed-in GitLab and Bitbucket accounts, as JSON {host: {username, password}}.
  /** @type {Map<string, { username: string, password: string }>} */
  const hostCredentials = new Map();
  try {
    const parsed = JSON.parse(env.TIDE_GIT_HOSTS || '{}');
    if (parsed && typeof parsed === 'object') {
      for (const [host, account] of Object.entries(parsed)) if (account) hostCredentials.set(host.toLowerCase(), account);
    }
  } catch {
    // No accounts.
  }

  const canAuth = () => !!env.TIDE_GIT_TOKEN || hostCredentials.size > 0;

  // Called by isomorphic-git when the remote asks for credentials: the account
  // saved for exactly this host, else the Settings token if this is GitHub.
  /** @param {string} url */
  function onAuth(url) {
    const remote = parseRemote(url);
    if (!remote) throw new GitError(`can't send credentials to ${url}: not a valid URL`);
    if (remote.protocol !== 'https:') {
      throw new GitError(`${remote.host || url} asked for credentials over ${remote.protocol.replace(/:$/, '')}://, which isn't encrypted: use an https:// URL for this remote`);
    }
    const account = hostCredentials.get(remote.host);
    if (account) return { username: account.username, password: account.password };
    if (TOKEN_HOSTS.has(remote.hostname) && remote.port === '') {
      if (!env.TIDE_GIT_TOKEN) throw new GitError('this remote needs a token: add one in Settings, Git');
      return { username: 'x-access-token', password: env.TIDE_GIT_TOKEN };
    }
    throw new GitError(`${remote.host} needs you to sign in: add an account for ${remote.host} in Settings (the GitHub token is only sent to github.com)`);
  }

  return { canAuth, onAuth };
}

module.exports = { createAuth, hostOf, parseRemote, TOKEN_HOSTS };
