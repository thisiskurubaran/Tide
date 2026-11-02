import type { EditorDiagnostic } from '../../../src/features/editor/bridge';
import type { HoverText, RGBA, ServiceCompletion } from './adapters';

export interface ColorAt {
  from: number;
  to: number;
  color: RGBA;
}

// What every language module offers, in editor offsets.
export interface LanguageService {
  complete(path: string, text: string, offset: number): Promise<ServiceCompletion[] | null>;
  hover(path: string, text: string, offset: number): Promise<HoverText | null>;
  validate(path: string, text: string): Promise<EditorDiagnostic[]>;
  colors(path: string, text: string): ColorAt[];
  // Ways to write `color` in place of from..to, e.g. #ff0000 or rgb(255, 0, 0).
  presentations(path: string, text: string, color: RGBA, from: number, to: number): string[];
}
