import { nodeRunner } from './node';
import { pythonRunner } from './python';
import { createRouter } from './router';
import { Runner } from './runner';

// The local runner the terminal uses.
export const localRunner: Runner = createRouter({ node: nodeRunner, python: pythonRunner });
