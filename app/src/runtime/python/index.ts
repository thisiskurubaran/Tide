import PythonRuntime from '../../../modules/python-runtime/src/PythonRuntimeModule';
import { documentsPath } from '../paths';
import { createPythonRunner } from './pythonRunner';

export { default as pythonRuntime } from '../../../modules/python-runtime/src/PythonRuntimeModule';

export const pythonRunner = createPythonRunner(PythonRuntime, documentsPath);
