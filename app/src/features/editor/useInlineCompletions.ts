// AI inline completions for EditorPane: tells the editor whether they are on,
// and answers its 'requestCompletion' messages with the provider's suggestion.
import { useCallback, useEffect, useRef } from 'react';
import { useStore } from 'zustand';

import { aiReady, complete } from '../ai/client';
import { aiSettings } from '../ai/settings';
import { FromEditor, languageFor, ToEditor } from './bridge';

type CompletionRequest = Extract<FromEditor, { type: 'requestCompletion' }>;

// The completions switch in AI settings; missing (older settings) means on.
const completionsOn = (s: object) => (s as { completions?: boolean }).completions ?? true;

// The model completions use, for the editor's hint: a per-job model when
// the settings have one, else the single model.
export function completionModel(s: object): string | undefined {
  const x = s as { models?: Record<string, unknown>; model?: unknown };
  const job = x.models?.complete;
  if (typeof job === 'string') return job;
  if (job && typeof job === 'object' && typeof (job as { model?: unknown }).model === 'string') return (job as { model: string }).model;
  return typeof x.model === 'string' ? x.model : undefined;
}

function ready() {
  try {
    return aiReady('complete');
  } catch {
    return false;
  }
}

// `active`: a normal file is open (not a large or refused one).
export function useInlineCompletions(send: (msg: ToEditor) => void, active: boolean) {
  // The whole state, so a new key or model re-checks aiReady.
  const settings = useStore(aiSettings);
  const enabled = active && completionsOn(settings) && ready();
  const model = completionModel(settings);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const inFlight = useRef<AbortController | null>(null);

  const sendCompletions = useCallback(
    () => send({ type: 'setCompletions', enabled, ...(model ? { model } : {}) }),
    [send, enabled, model],
  );
  useEffect(sendCompletions, [sendCompletions]);
  useEffect(() => {
    if (!enabled) inFlight.current?.abort();
  }, [enabled]);
  useEffect(() => () => inFlight.current?.abort(), []);

  const requestCompletion = useCallback(
    (msg: CompletionRequest) => {
      // Each request replaces the last: only the newest answer can still apply.
      inFlight.current?.abort();
      inFlight.current = null;
      if (!enabledRef.current) return;
      const controller = new AbortController();
      inFlight.current = controller;
      // No alerts: no key, the spend limit or a failed request just shows nothing.
      Promise.resolve()
        .then(() => complete({ path: msg.path, language: languageFor(msg.path), prefix: msg.prefix, suffix: msg.suffix, signal: controller.signal }))
        .catch(() => '')
        .then((text) => {
          if (controller.signal.aborted) return;
          inFlight.current = null;
          send({ type: 'completion', requestId: msg.requestId, text: typeof text === 'string' ? text : '' });
        });
    },
    [send],
  );

  return { sendCompletions, requestCompletion };
}
