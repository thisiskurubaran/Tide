// The Local shell's command history, kept per project in
// .tide/terminal-history/<project>.json so ↑ and `history` still have it
// after a restart. Every Local terminal of a project shares it. Remote
// terminals don't use it: their bash keeps its own.
//
// Like bash with HISTCONTROL=ignoreboth, a line isn't kept when it repeats
// the previous one or starts with a space. Lines that look like they carry a
// credential (export GITHUB_TOKEN=..., --password=..., a pasted API key)
// aren't kept at all, not even for this session.
import { FsAdapter, joinPath } from '../../files/fs';
import { isSecretName } from '../../http/history';
import { STATE_DIR } from '../../../state/storage';
import { HISTORY_LIMIT, LineHistory } from './lineEditor';

export const HISTORY_DIR = joinPath(STATE_DIR, 'terminal-history');

// Values that are credentials whatever they're called.
const SECRET_VALUES = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}/, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bglpat-[A-Za-z0-9_-]{16,}/, // GitLab
  /\bsk-(?:ant-|proj-|live_|test_)?[A-Za-z0-9_-]{16,}/, // Anthropic, OpenAI, Stripe
  /\b[rp]k_(?:live|test)_[A-Za-z0-9]{16,}/, // Stripe
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/, // Slack
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /\bAIza[0-9A-Za-z_-]{30,}/, // Google API key
  /\bnpm_[A-Za-z0-9]{30,}/,
  /\bhf_[A-Za-z0-9]{30,}/, // Hugging Face
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{12,}/i, // Authorization header values
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i, // https://user:password@host
];

// NAME=value (export, env, or before a command) where NAME is secret-like.
const ASSIGNMENT = /(?:^|[\s;&|(])([A-Za-z_][A-Za-z0-9_]*)=/g;
// --name=value, or --name value: --password, --token, --api-key, --client-secret.
const LONG_FLAG = /(?:^|\s)--([A-Za-z][A-Za-z0-9_-]*)(=|\s+(?!-)\S)/g;
// Header arguments: -H "Authorization: ...", -H 'X-Api-Key: ...'.
const HEADER = /(?:^|\s)(?:-H|--header)\s*=?\s*["']?([A-Za-z0-9_-]+)\s*:/g;

// Whether a command line looks like it holds a secret.
export function looksSecret(line: string): boolean {
  if (SECRET_VALUES.some((re) => re.test(line))) return true;
  for (const re of [ASSIGNMENT, LONG_FLAG, HEADER]) {
    re.lastIndex = 0;
    for (let m = re.exec(line); m; m = re.exec(line)) {
      if (isSecretName(m[1]) || /^(cookie|set-cookie)$/i.test(m[1])) return true;
    }
  }
  // sshpass -p, mysql -pSECRET: short flags that take a password.
  if (/\bsshpass\s+-p\s*\S/.test(line) || /\bmysql(?:dump|admin)?\b.*\s-p\S/.test(line)) return true;
  // curl -u user:password
  if (/\bcurl\b.*\s(?:-u|--user)\s*=?\s*\S+:\S+/.test(line)) return true;
  return false;
}

// Whether `line` goes into a history whose newest entry is `previous`.
export function shouldRecord(line: string, previous: string | undefined): boolean {
  if (!line.trim()) return false;
  if (line.startsWith(' ')) return false;
  if (line === previous) return false;
  return !looksSecret(line);
}

export interface ProjectHistory extends LineHistory {
  // Reads the saved history (once; later calls return the same promise).
  // Lines typed before it finishes stay, after the saved ones.
  load(): Promise<void>;
  // Empties it, on disk too (history -c).
  clear(): Promise<void>;
}

export interface TerminalHistory {
  forProject(project: string): ProjectHistory;
  renameProject(from: string, to: string): Promise<void>;
  removeProject(project: string): Promise<void>;
}

const fileName = (project: string) => `${encodeURIComponent(project)}.json`;
const filePath = (project: string) => joinPath(HISTORY_DIR, fileName(project));

function parse(text: string): string[] {
  try {
    const data = JSON.parse(text);
    const list = Array.isArray(data) ? data : data?.entries;
    return Array.isArray(list) ? list.filter((e): e is string => typeof e === 'string' && !!e.trim()) : [];
  } catch {
    return [];
  }
}

export function createTerminalHistory(fs: FsAdapter, { limit = HISTORY_LIMIT } = {}): TerminalHistory {
  const projects = new Map<string, ReturnType<typeof create>>();

  function create(project: string) {
    let entries: string[] = [];
    let loading: Promise<void> | null = null;
    // False after a read failed (not a missing file): saving would replace what's there.
    let canSave = true;
    let queue: Promise<void> = Promise.resolve();
    let path = filePath(project);

    const trim = () => {
      if (entries.length > limit) entries = entries.slice(entries.length - limit);
    };

    const load = () => {
      loading ??= (async () => {
        try {
          if ((await fs.stat(path)) !== 'file') return;
          const saved = parse(await fs.readFile(path)).filter((e) => !looksSecret(e));
          // Lines typed while it loaded go after the saved ones.
          const typed = entries.filter((e, i) => i > 0 || e !== saved[saved.length - 1]);
          entries = [...saved, ...typed];
          trim();
        } catch (e) {
          canSave = false;
          console.warn('Could not read the terminal history; not saving it this session', e);
        }
      })();
      return loading;
    };

    const save = () => {
      queue = queue
        .then(load)
        .then(async () => {
          if (!canSave) return;
          await fs.writeFile(path, JSON.stringify({ version: 1, entries }));
        })
        .catch((e) => console.warn('Could not save the terminal history', e));
      return queue;
    };

    const history = {
      get entries() {
        return entries;
      },
      add(line: string) {
        if (!shouldRecord(line, entries[entries.length - 1])) return;
        entries.push(line);
        trim();
        void save();
      },
      load,
      clear() {
        entries = [];
        return save();
      },
      flushed: () => queue,
      setPath(project: string) {
        path = filePath(project);
      },
    };
    return history;
  }

  return {
    forProject(project) {
      let h = projects.get(project);
      if (!h) {
        h = create(project);
        projects.set(project, h);
      }
      return h;
    },
    async renameProject(from, to) {
      const h = projects.get(from);
      await h?.flushed();
      if ((await fs.stat(filePath(from))) === 'file') {
        if (await fs.stat(filePath(to))) await fs.remove(filePath(to));
        await fs.rename(filePath(from), fileName(to));
      }
      projects.delete(from);
      if (h) {
        h.setPath(to);
        projects.set(to, h);
      }
    },
    async removeProject(project) {
      const h = projects.get(project);
      projects.delete(project);
      await h?.flushed();
      if (await fs.stat(filePath(project))) await fs.remove(filePath(project));
    },
  };
}
