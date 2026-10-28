import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Docker from 'dockerode';

// Docker Desktop on macOS keeps its socket in the home folder; Linux uses /var/run.
export function connectDocker(): Docker {
  if (process.env.DOCKER_HOST) return new Docker();
  const desktop = path.join(os.homedir(), '.docker', 'run', 'docker.sock');
  return new Docker({ socketPath: fs.existsSync(desktop) ? desktop : '/var/run/docker.sock' });
}
