// A project's environment: the .env file, plus secrets kept only in the
// Keychain (never written to the project, so they can't be committed or
// exported). Secrets win over .env values with the same name.
import * as SecureStore from 'expo-secure-store';

import { buffersStore, projectsStore, workspace } from '../../state';
import { bufferKey } from '../../state/buffers';
import { folderIdentity } from '../agent/projectIdentity';
import { parseDotenv, removeDotenv, setDotenv } from './dotenv';
import { createProjectKeychain, hexName } from './secretKeys';

export const ENV_FILE = '.env';

// One Keychain entry per project (see secretKeys.ts). The old key mangled
// the name and could be shared by two projects.
export const secretsKeys = {
  key: (project: string) => `tide.secrets.env.${hexName(project)}`,
  legacy: (project: string) => `tide.env.${encodeURIComponent(project).replace(/[^A-Za-z0-9.-]/g, '_')}`,
  index: 'tide.secrets.env.index',
};
// The project list once it has loaded (null before: old keys wait for it).
export const loadedProjects = () => {
  const s = projectsStore.getState();
  return s.loaded ? s.projects : null;
};
// Follows project renames and deletes, and is checked against the project
// folders at start-up (registered in ../deploy/index.ts, which loads then).
// Tied to the folder's identity where that's reliable (iOS).
export const projectSecrets = createProjectKeychain(SecureStore, secretsKeys, loadedProjects, { identify: folderIdentity });

export async function readSecrets(project: string): Promise<Record<string, string>> {
  try {
    const v = await projectSecrets.read(project);
    return v ? (JSON.parse(v) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export async function writeSecrets(project: string, secrets: Record<string, string>): Promise<void> {
  await projectSecrets.write(project, Object.keys(secrets).length ? JSON.stringify(secrets) : null);
}

// What a run sees.
export async function projectEnv(project: string): Promise<Record<string, string>> {
  const [file, secrets] = await Promise.all([currentText(project, ENV_FILE), readSecrets(project)]);
  return { ...Object.fromEntries(parseDotenv(file).map((l) => [l.key, l.value])), ...secrets };
}

// Edits go through the buffers so an open .env tab shows them.
async function writeProjectFile(project: string, path: string, content: string) {
  if ((await workspace.stat(project, path)) === 'file') await buffersStore.getState().replace(project, path, content);
  else await workspace.createFile(project, '', path, content);
  await projectsStore.getState().loadTree(project);
}

async function currentText(project: string, path: string) {
  return buffersStore.getState().buffers[bufferKey(project, path)]?.content ?? (await workspace.readFile(project, path).catch(() => ''));
}

export interface EnvVariable {
  key: string;
  value: string;
  secret: boolean;
}

export async function listVariables(project: string): Promise<EnvVariable[]> {
  const [file, secrets] = await Promise.all([currentText(project, ENV_FILE), readSecrets(project)]);
  const plain = parseDotenv(file).filter((l) => !(l.key in secrets));
  return [...plain.map((l) => ({ ...l, secret: false })), ...Object.entries(secrets).map(([key, value]) => ({ key, value, secret: true }))].sort((a, b) =>
    a.key.localeCompare(b.key),
  );
}

// Saves a variable in .env or the Keychain, and takes it out of the other.
export async function setVariable(project: string, v: EnvVariable, previousKey?: string) {
  const secrets = await readSecrets(project);
  const file = await currentText(project, ENV_FILE);
  let text = file;
  for (const k of new Set([v.key, previousKey].filter(Boolean) as string[])) {
    delete secrets[k];
    text = removeDotenv(text, k);
  }
  if (v.secret) secrets[v.key] = v.value;
  else text = setDotenv(text, v.key, v.value);
  await writeSecrets(project, secrets);
  if (text !== file) await writeProjectFile(project, ENV_FILE, text);
}

export async function removeVariable(project: string, key: string) {
  const secrets = await readSecrets(project);
  if (key in secrets) {
    delete secrets[key];
    await writeSecrets(project, secrets);
  }
  const file = await currentText(project, ENV_FILE);
  const text = removeDotenv(file, key);
  if (text !== file) await writeProjectFile(project, ENV_FILE, text);
}

// Whether .env would be committed: the project uses git and .gitignore
// doesn't list it.
export async function envNotIgnored(project: string): Promise<boolean> {
  const git = await workspace.readFile(project, '.git/HEAD').then(
    () => true,
    () => false,
  );
  if (!git) return false;
  const ignore = await currentText(project, '.gitignore');
  return !ignore.split(/\r?\n/).some((l) => /^\/?\.env(\*|\.\*)?$/.test(l.trim()));
}

export async function ignoreEnv(project: string) {
  const ignore = await currentText(project, '.gitignore');
  const body = ignore.replace(/\n*$/, '');
  await writeProjectFile(project, '.gitignore', `${body}${body ? '\n' : ''}.env\n`);
}
