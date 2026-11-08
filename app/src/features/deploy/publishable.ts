// Which files of a project folder go up when it is deployed. Deploys are
// public, and deploying the project root is common (index.html at the top),
// so anything that may hold a secret stays behind: every dotfile and dot
// folder except the few hosts need, and well-known key and credential files.

// Tooling and caches, whatever they are called.
const TOOLING = new Set(['node_modules', '__pycache__']);
// Dotfiles a static host needs: .well-known (domain verification, security.txt)
// and .nojekyll (GitHub Pages serves _folders with it).
const PUBLIC_DOTFILES = new Set(['.well-known', '.nojekyll']);
// Secrets without a leading dot: keys and certificates (Apple's AuthKey_*.p8
// too), Terraform state and variables, VPN profiles, PGP files, password
// databases, .http requests and their environments (they carry tokens),
// SQLite databases, and env files named without the dot (prod.env).
const SECRET_FILE = new RegExp(
  '^(' +
    [
      'id_(rsa|dsa|ecdsa|ed25519)(\\.pub)?',
      '.*\\.private\\.env\\.json',
      'http-client\\.env\\.json',
      '.*\\.(pem|key|p8|p12|pfx|jks|keystore|ppk|kdbx|ovpn|asc|gpg)',
      '.*\\.(tfstate|tfstate\\.backup|tfvars)',
      '.*\\.http',
      '.*\\.(db|sqlite|sqlite3)',
      '.*\\.env',
      'credentials\\.json',
      'client_secret.*\\.json',
      'service[-_]?account.*\\.json',
      '.*firebase-adminsdk.*\\.json',
      'secrets?\\.(json|ya?ml|toml)',
    ].join('|') +
    ')$',
  'i',
);

// `path` is relative to the folder being deployed.
export function isPublishable(path: string): boolean {
  return path.split('/').every((part) => {
    if (TOOLING.has(part)) return false;
    if (part.startsWith('.')) return PUBLIC_DOTFILES.has(part);
    return !SECRET_FILE.test(part);
  });
}
