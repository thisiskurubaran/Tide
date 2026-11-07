// "✦ Fix" in the editor's error lens: tells the editor whether to show it
// (AI is set up and the host handles it), and passes taps on to the host.
import { useCallback, useEffect } from 'react';
import { useStore } from 'zustand';

import { aiReady } from '../ai/client';
import { aiSettings } from '../ai/settings';
import type { ToEditor } from './bridge';

function ready() {
  try {
    return aiReady('chat');
  } catch {
    return false;
  }
}

// `active`: the host handles 'fixProblem' and a normal file is open.
export function useAiFix(send: (msg: ToEditor) => void, active: boolean) {
  // Subscribed so a new key or model re-checks aiReady.
  useStore(aiSettings);
  const enabled = active && ready();
  const sendAiFix = useCallback(() => send({ type: 'setAiFix', enabled }), [send, enabled]);
  useEffect(sendAiFix, [sendAiFix]);
  return { sendAiFix };
}
