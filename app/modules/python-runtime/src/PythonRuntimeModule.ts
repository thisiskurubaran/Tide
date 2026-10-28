import { NativeModule, requireNativeModule } from 'expo';

export type PythonOutputEvent = { id: string; kind: 'stdout' | 'stderr'; data: string };
export type PythonExitEvent = { id: string; code: number; killed: boolean };

type Events = {
  onOutput(event: PythonOutputEvent): void;
  onExit(event: PythonExitEvent): void;
};

declare class PythonRuntimeModule extends NativeModule<Events> {
  version(): Promise<string>;
  snippet(code: string): Promise<string>;
  // Paths are absolute. Modules loaded from under `purgeRoot` are dropped after the run.
  run(id: string, entry: string, cwd: string, args: string[], extraPaths: string[], purgeRoot: string): Promise<void>;
  write(id: string, data: string): Promise<void>;
  eof(id: string): Promise<void>;
  kill(id: string): Promise<void>;
}

export default requireNativeModule<PythonRuntimeModule>('PythonRuntime');
