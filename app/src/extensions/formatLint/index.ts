import { Alert } from 'react-native';

import { joinPath } from '../../features/files/fs';
import { PROJECTS_DIR } from '../../features/files/workspace';
import { localRunner } from '../../runtime';
import { buffersStore, workspace } from '../../state';
import { diagnosticsStore } from '../diagnostics';
import { createService } from '../services';
import { extensionsStore } from '../state';
import type { ProjectContext, TideExtension } from '../types';
import { LintMessage, toDiagnostics } from './lintMessages';
import { findRuffSettings, RUFF_SOURCE, ruffDiagnostics } from './ruff';
import { ruff } from './ruffClient';

// Prettier and ESLint run in the Node service; Python goes to Ruff, which is
// WebAssembly and so runs in a hidden web view (RuffHost).
const service = createService(localRunner, { entry: 'tide:format' });

const FORMATTABLE = /\.(m?jsx?|cjs|m?tsx?|cts|json|css|scss|less|html?|vue|md|markdown|ya?ml|pyi?)$/i;
const LINTABLE = /\.(m?jsx?|cjs|pyi?)$/i;
const isPython = (path: string) => /\.pyi?$/i.test(path);

const documentsPath = (project: string, path: string) => joinPath(PROJECTS_DIR, project, path);

// The project's ruff.toml or pyproject.toml [tool.ruff], read fresh each time
// so edits to it apply on the next keystroke.
const ruffSettings = (project: string, path: string) => findRuffSettings(path, (p) => workspace.readFile(project, p).catch(() => null));

export async function formatText(project: string, path: string, content: string): Promise<string> {
  if (isPython(path)) return ruff.format(content, await ruffSettings(project, path));
  return service.request<string>('format', { path: documentsPath(project, path), content });
}

async function lint(project: string, path: string, content: string) {
  if (isPython(path)) {
    const items = await ruff.check(content, await ruffSettings(project, path));
    diagnosticsStore.getState().set(project, path, RUFF_SOURCE, ruffDiagnostics(content, items));
    return;
  }
  const messages = await service.request<LintMessage[]>('lint', { path: documentsPath(project, path), content });
  diagnosticsStore.getState().set(project, path, 'eslint', toDiagnostics(content, messages, 'eslint'));
}

async function formatActive(ctx: ProjectContext) {
  const path = ctx.activePath();
  if (!path) return;
  if (!FORMATTABLE.test(path)) {
    Alert.alert('Format document', `There is no formatter for ${path.split('/').pop()}.`);
    return;
  }
  const { content } = await buffersStore.getState().load(ctx.project, path);
  try {
    const formatted = await formatText(ctx.project, path, content);
    // Skip it if the user typed while it was formatting.
    if (formatted !== content && buffersStore.getState().buffers[`${ctx.project}\u0000${path}`]?.content === content) {
      buffersStore.getState().edit(ctx.project, path, formatted);
    }
  } catch (e) {
    Alert.alert("Couldn't format", e instanceof Error ? e.message : String(e));
  }
}

const clear = () => {
  diagnosticsStore.getState().clearSource('eslint');
  diagnosticsStore.getState().clearSource(RUFF_SOURCE);
};

export const formatLintExtension: TideExtension = {
  id: 'format-lint',
  commands: (ctx) => [
    { id: 'format', title: 'Format document', icon: 'align-left', hint: '⇧⌥F', run: () => formatActive(ctx) },
    {
      id: 'format.toggle-on-save',
      title: extensionsStore.getState().prefs.formatOnSave ? 'Format on save: turn off' : 'Format on save: turn on',
      icon: 'save',
      run: () => extensionsStore.getState().setPref('formatOnSave', !extensionsStore.getState().prefs.formatOnSave),
    },
  ],
  async beforeSave(ctx, path, content) {
    if (!extensionsStore.getState().prefs.formatOnSave || !FORMATTABLE.test(path)) return null;
    return formatText(ctx.project, path, content);
  },
  documentChanged(ctx, path, content) {
    if (!extensionsStore.getState().prefs.lintAsYouType || !LINTABLE.test(path)) return;
    lint(ctx.project, path, content).catch((e) => console.warn('Lint failed', e));
  },
  activate() {
    // Turning lint off clears what it reported.
    return extensionsStore.subscribe((s, prev) => {
      if (prev.prefs.lintAsYouType && !s.prefs.lintAsYouType) clear();
    });
  },
  deactivate() {
    clear();
    service.stop();
  },
};
