import { nodeRunner } from './node';
import { trackPorts } from './ports';
import { pythonRunner } from './python';
import { createRouter } from './router';
import { Runner } from './runner';

// The local runner the terminal uses. It notes the ports programs listen on.
export const localRunner: Runner = trackPorts(createRouter({ node: nodeRunner, python: pythonRunner }));
