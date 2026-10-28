import { createUnavailableRunner, Runner } from './runner';

// The local runner the terminal uses. The Node and Python runners replace this.
export const localRunner: Runner = createUnavailableRunner();
