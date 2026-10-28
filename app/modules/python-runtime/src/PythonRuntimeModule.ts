import { NativeModule, requireNativeModule } from 'expo';

declare class PythonRuntimeModule extends NativeModule {
  version(): Promise<string>;
  run(code: string): Promise<string>;
}

export default requireNativeModule<PythonRuntimeModule>('PythonRuntime');
