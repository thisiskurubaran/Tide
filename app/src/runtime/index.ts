import { nodeRunner } from './node';
import { createRouter } from './router';
import { createUnavailableRunner, Runner } from './runner';

// Local runner used by the terminal. Python joins with the Python runner.
export const localRunner: Runner = createRouter({ node: nodeRunner, python: createUnavailableRunner() });
