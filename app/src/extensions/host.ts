import { useEffect, useMemo, useRef } from 'react';

import type { CompletionResult, EditorFeatures, EditorRequest, HoverResult } from '../features/editor/bridge';
import { NO_FEATURES } from '../features/editor/bridge';
import { buffersStore } from '../state';
import { bufferKey } from '../state/buffers';
import { isActive } from './store';
import { allExtensions } from './registry';
import { useExtensions } from './state';
import type { Location, ProjectContext, TideExtension } from './types';

const DOCUMENT_DEBOUNCE_MS = 500;

// The extensions that are bought and switched on, in registry order.
export function useActiveExtensions(): TideExtension[] {
  const key = useExtensions((s) => allExtensions.filter((e) => isActive(s, e.id)).map((e) => e.id).join(','));
  return useMemo(() => allExtensions.filter((e) => key.split(',').includes(e.id)), [key]);
}

export function editorFeatures(active: TideExtension[]): EditorFeatures {
  const out = { ...NO_FEATURES };
  for (const ext of active) {
    for (const [k, v] of Object.entries(ext.editor ?? {})) if (v) out[k as keyof EditorFeatures] = true;
  }
  return out;
}

const content = (project: string, path: string) => buffersStore.getState().buffers[bufferKey(project, path)]?.content;

// An explicit save: each extension's beforeSave may rewrite the text (format on save) first.
export async function saveWithHooks(active: TideExtension[], ctx: ProjectContext, path: string) {
  const store = buffersStore.getState();
  const original = content(ctx.project, path);
  if (original !== undefined) {
    let text = original;
    for (const ext of active) {
      if (!ext.beforeSave) continue;
      try {
        text = (await ext.beforeSave(ctx, path, text)) ?? text;
      } catch (e) {
        // A file that doesn't parse can't be formatted; it still gets saved.
        console.warn(`${ext.id}: before save failed`, e);
      }
    }
    // Skip it if the user typed while the hooks ran.
    if (text !== original && content(ctx.project, path) === original) store.edit(ctx.project, path, text);
  }
  await store.save(ctx.project, path);
}

// Answers a completion or hover request from the editor with the first extension that knows the file.
export async function answerRequest(
  active: TideExtension[],
  project: string,
  req: EditorRequest,
): Promise<CompletionResult | HoverResult | null> {
  const text = content(project, req.path);
  if (text === undefined) return null;
  for (const ext of active) {
    const lang = ext.language;
    if (!lang?.supports(req.path)) continue;
    const doc = { project, path: req.path, content: text, offset: req.offset };
    if (req.method === 'completion' && lang.completion) return lang.completion({ ...doc, explicit: req.explicit });
    if (req.method === 'hover' && lang.hover) return lang.hover(doc);
  }
  return null;
}

export async function findDefinition(active: TideExtension[], project: string, path: string, offset: number): Promise<Location[]> {
  const text = content(project, path);
  if (text === undefined) return [];
  for (const ext of active) {
    if (ext.language?.supports(path) && ext.language.definition) {
      return ext.language.definition({ project, path, content: text, offset });
    }
  }
  return [];
}

// Runs each extension's activate() while the project is open and feeds
// documentChanged() with the text of open files as it changes.
export function useExtensionHost(active: TideExtension[], ctx: ProjectContext, openPaths: string[]) {
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const { project } = ctx;

  useEffect(() => {
    const cleanups = active.map((ext) => ext.activate?.(ctxRef.current));
    return () => {
      for (const cleanup of cleanups) cleanup?.();
      for (const ext of active) ext.deactivate?.();
    };
  }, [active, project]);

  const openKey = openPaths.join('\n');
  useEffect(() => {
    const listeners = active.filter((e) => e.documentChanged);
    if (!listeners.length) return;
    const open = new Set(openKey ? openKey.split('\n') : []);
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const seen = new Map<string, string>();

    const notify = (path: string, text: string) => {
      if (seen.get(path) === text) return;
      seen.set(path, text);
      for (const ext of listeners) ext.documentChanged!(ctxRef.current, path, text);
    };
    const check = (immediate: boolean) => {
      for (const path of open) {
        const text = content(project, path);
        if (text === undefined || seen.get(path) === text) continue;
        clearTimeout(timers.get(path));
        if (immediate) notify(path, text);
        else timers.set(path, setTimeout(() => notify(path, content(project, path) ?? text), DOCUMENT_DEBOUNCE_MS));
      }
    };
    check(true);
    const unsubscribe = buffersStore.subscribe(() => check(false));
    return () => {
      unsubscribe();
      for (const t of timers.values()) clearTimeout(t);
    };
  }, [active, project, openKey]);
}
