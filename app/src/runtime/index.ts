import { nodeRunner } from './node';
import { trackPorts } from './ports';
import { pythonRunner } from './python';
import { createLuaRunner } from './lua';
import { createRouter } from './router';
import { wasmRunner } from './wasm';
import { Runner } from './runner';

// The local runner the terminal uses. It notes the ports programs listen on.
export const localRunner: Runner = trackPorts(
  createRouter({ node: nodeRunner, python: pythonRunner, lua: createLuaRunner(nodeRunner), ruby: wasmRunner, php: wasmRunner }),
);
