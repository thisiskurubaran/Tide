import { projectsStore, workspace } from '../../state';
import { toBase64 } from '../backup/zip';
import { DatabaseView } from './DatabaseView';
import { openProjectDb } from './open';
import { sqliteSource } from './source';

// A .db / .sqlite file in the project. Exports are saved next to it.
export function DatabasePane({ project, path }: { project: string; path: string }) {
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
  return (
    <DatabaseView
      openKey={`${project}/${path}`}
      open={async () => sqliteSource(await openProjectDb(project, path))}
      saveCsv={async (name, csv) => {
        await workspace.writeBase64(project, `${dir}${name}`, toBase64(new TextEncoder().encode(csv)));
        await projectsStore.getState().loadTree(project);
        return `saved to ${dir}${name}`;
      }}
    />
  );
}
