// Messages between the app and the Ruff page (web/ruff), which runs Ruff's
// WebAssembly build in a hidden web view.
import type { RuffSettings } from './ruff';

export type RuffMethod = 'check' | 'format';

export type ToRuff =
  // The URL of ruff.wasm, next to the page.
  | { type: 'init'; wasm: string }
  | { type: 'request'; id: number; method: RuffMethod; content: string; settings: RuffSettings };

export type FromRuff =
  | { type: 'ready' }
  | { type: 'reply'; id: number; result?: unknown; error?: string };
