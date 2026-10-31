// Messages between the app and the Ruby/PHP runtime page (web/runtimes),
// which runs the interpreters as WebAssembly in a hidden web view.
export type WasmRuntime = 'ruby' | 'php';

// Files are base64, keyed by path relative to the project root.
export type FileMap = Record<string, string>;

export type ToRuntime =
  | { type: 'init'; ruby: string; php: string }
  | { type: 'run'; id: string; runtime: WasmRuntime; entry: string; cwd: string; args: string[]; env: Record<string, string>; files: FileMap; stdin: string }
  | { type: 'kill'; id: string };

export type FromRuntime =
  | { type: 'ready' }
  | { type: 'status'; id: string; text: string }
  | { type: 'stdout' | 'stderr'; id: string; data: string }
  // Files the run created or changed, and the ones it deleted.
  | { type: 'exit'; id: string; code: number; changed: FileMap; removed: string[] };
