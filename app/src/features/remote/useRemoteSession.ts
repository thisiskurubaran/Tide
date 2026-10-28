import type { SessionInfo } from '@shared/protocol';
import { useCallback, useEffect, useState } from 'react';

import { buffersStore, projectsStore, workspace } from '../../state';
import { splitKey } from '../../state/buffers';
import { connectSocket, nativeSocket, openSession, RemoteError } from './api';
import { RemoteSettings, useRemoteSettings } from './settings';
import { RemoteSync } from './sync';

export type RemoteStatus =
  | { state: 'off' }
  | { state: 'unconfigured' }
  | { state: 'connecting' }
  | { state: 'ready'; settings: RemoteSettings; session: SessionInfo }
  | { state: 'error'; message: string };

const TREE_RELOAD_MS = 250;

// Opens the project's container and keeps its files in sync while `enabled`.
// The terminal only connects once the first sync is done, so the shell
// starts with the phone's files already in /workspace.
export function useRemoteSession(project: string, enabled: boolean) {
  const settings = useRemoteSettings((s) => s.settings);
  const [status, setStatus] = useState<RemoteStatus>({ state: 'off' });
  const [ports, setPorts] = useState<number[]>([]);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setPorts([]);
    if (!enabled) {
      setStatus({ state: 'off' });
      return;
    }
    if (!settings) {
      setStatus({ state: 'unconfigured' });
      return;
    }
    setStatus({ state: 'connecting' });
    let cancelled = false;
    let sync: RemoteSync | null = null;
    let treeTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe: (() => void)[] = [];

    openSession(settings, project).then(
      (session) => {
        if (cancelled) return;
        const socket = connectSocket(nativeSocket, settings, session, 'sync');
        sync = new RemoteSync(socket, project, workspace, {
          onReady: () => !cancelled && setStatus({ state: 'ready', settings, session }),
          onPorts: (p) => !cancelled && setPorts(p),
          onFileChanged: (path) => void buffersStore.getState().reload(project, path),
          onTreeChanged: () => {
            if (treeTimer !== null) clearTimeout(treeTimer);
            treeTimer = setTimeout(() => void projectsStore.getState().loadTree(project), TREE_RELOAD_MS);
          },
        });
        socket.onclose = (e) => {
          if (!cancelled) setStatus({ state: 'error', message: e.reason || 'Lost the connection to the server' });
        };

        // Saves from the editor.
        unsubscribe.push(
          buffersStore.subscribe((next, prev) => {
            const saved: string[] = [];
            for (const [key, b] of Object.entries(next.buffers)) {
              const [p, path] = splitKey(key);
              if (p === project && prev.buffers[key]?.saved !== b.saved) saved.push(path);
            }
            if (saved.length) sync?.changed(saved);
          }),
        );
        // Creates, renames and deletes from the file tree.
        unsubscribe.push(
          projectsStore.subscribe((next, prev) => {
            if (next.trees[project] !== prev.trees[project]) sync?.changed([]);
          }),
        );
      },
      (err: unknown) => {
        if (!cancelled) setStatus({ state: 'error', message: err instanceof RemoteError ? err.message : String(err) });
      },
    );

    return () => {
      cancelled = true;
      if (treeTimer !== null) clearTimeout(treeTimer);
      unsubscribe.forEach((u) => u());
      sync?.close();
    };
  }, [project, enabled, settings, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { status, ports, retry };
}
