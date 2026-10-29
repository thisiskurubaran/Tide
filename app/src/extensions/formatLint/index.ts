import { Alert } from 'react-native';

import { joinPath } from '../../features/files/fs';
import { PROJECTS_DIR } from '../../features/files/workspace';
import { localRunner } from '../../runtime';
import { pythonRuntime } from '../../runtime/python';
import { buffersStore } from '../../state';
import { diagnosticsStore } from '../diagnostics';
import { problemsCommand, problemsPanel } from '../ProblemsPanel';
import { createPythonTools } from '../pythonTools';
import { createService } from '../services';
import { extensionsStore } from '../state';
import type { ProjectContext, TideExtension } from '../types';
import { LintMessage, toDiagnostics } from './lintMessages';

const service = createService(localRunner, { entry: 'tide:format' });
const python = createPythonTools((code) => pythonRuntime.snippet(code));

const FORMATTABLE = /\.(m?jsx?|cjs|m?tsx?|cts|json|css|scss|less|html?|vue|md|markdown|ya?ml|py)$/i;
const LINTABLE = /\.(m?jsx?|cjs|py)$/i;
const isPython = (path: string) => /\.py$/i.test(path);
const sourceFor = (path: string) => (isPython(path) ? 'pyflakes' : 'eslint');

const documentsPath = (project: string, path: string) => joinPath(PROJECTS_DIR, project, path);

export async function formatText(project: string, path: string, content: string): Promise<string> {
  if (isPython(path)) return python.request<string>('format', { path, content });
  return service.request<string>('format', { path: documentsPath(project, path), content });
}

async function lint(project: string, path: string, content: string) {
  const messages = isPython(path)
    ? await python.request<LintMessage[]>('lint', { path, content })
    : await service.request<LintMessage[]>('lint', { path: documentsPath(project, path), content });
  diagnosticsStore.getState().set(project, path, sourceFor(path), toDiagnostics(content, messages, sourceFor(path)));
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
  diagnosticsStore.getState().clearSource('pyflakes');
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
    problemsCommand(ctx),
  ],
  panels: [problemsPanel],
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
