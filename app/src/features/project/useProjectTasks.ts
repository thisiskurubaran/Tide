import { useEffect, useState } from 'react';

import { useBuffers, useProjects, useRunner, workspace } from '../../state';
import { bufferKey } from '../../state/buffers';
import { RUN_CONFIG_FILE } from '../files/templates';
import { parseTasks, ProjectTasks } from './tasks';

const EMPTY: ProjectTasks = { configs: [], tasks: [], error: null };

// The project's run configurations and tasks, reread whenever tide.json or
// package.json is saved or the file tree changes.
export function useProjectTasks(project: string): ProjectTasks {
  const mode = useRunner((s) => s.mode);
  const tree = useProjects((s) => s.trees[project]);
  const tideSaved = useBuffers((s) => s.buffers[bufferKey(project, RUN_CONFIG_FILE)]?.saved);
  const pkgSaved = useBuffers((s) => s.buffers[bufferKey(project, 'package.json')]?.saved);
  const [tasks, setTasks] = useState<ProjectTasks>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    const read = (path: string) => workspace.readFile(project, path).catch(() => null);
    Promise.all([read(RUN_CONFIG_FILE), read('package.json')]).then(([tide, pkg]) => {
      if (!cancelled) setTasks(parseTasks(tide, pkg, mode));
    });
    return () => {
      cancelled = true;
    };
  }, [project, mode, tree, tideSaved, pkgSaved]);

  return tasks;
}
