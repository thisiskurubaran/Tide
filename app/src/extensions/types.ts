import type { ComponentType } from 'react';

import type { EditorHandle } from '../features/editor/EditorPane';
import type { CompletionResult, EditorFeatures, HoverResult } from '../features/editor/bridge';
import type { Command } from '../features/search/CommandPalette';
import type { ExtensionId } from './manifests';

// What an extension can reach in the open project. Built by the project screen.
export interface ProjectContext {
  project: string;
  activePath(): string | null;
  // The cursor in the active file, as an offset, if the editor has reported one.
  cursor(): number | null;
  // Opens a file and moves to a 1-based line and column.
  openFile(path: string, line?: number, column?: number): void;
  editor(): EditorHandle | null;
  openPanel(id: string): void;
  // Saves through the extensions' save hooks (format on save), like Cmd-S.
  save(path: string): Promise<void>;
}

export interface PanelProps {
  ctx: ProjectContext;
  visible: boolean;
  onClose(): void;
}

export interface Panel {
  id: string;
  component: ComponentType<PanelProps>;
}

export interface Location {
  path: string;
  // 1-based.
  line: number;
  column: number;
  // The line's text, for lists of references.
  preview?: string;
}

export interface DocumentRequest {
  project: string;
  path: string;
  content: string;
  offset: number;
}

// Language features for files an extension understands.
export interface LanguageProvider {
  supports(path: string): boolean;
  completion?(req: DocumentRequest & { explicit: boolean }): Promise<CompletionResult | null>;
  hover?(req: DocumentRequest): Promise<HoverResult | null>;
  definition?(req: DocumentRequest): Promise<Location[]>;
}

export interface TideExtension {
  id: ExtensionId;
  // Shown in the command palette while a project is open.
  commands?(ctx: ProjectContext): Command[];
  // Sheets a command can open with ctx.openPanel(id).
  panels?: Panel[];
  // A strip under the tabs, e.g. the debug toolbar. It renders nothing when it has nothing to show.
  bar?: ComponentType<{ ctx: ProjectContext }>;
  editor?: Partial<EditorFeatures>;
  language?: LanguageProvider;
  // Runs on an explicit save (Cmd-S, Save file), not autosave. Returns the
  // text to save instead, or null to leave it alone.
  beforeSave?(ctx: ProjectContext, path: string, content: string): Promise<string | null>;
  // An open file's text changed, or a file was opened. Debounced by the host.
  documentChanged?(ctx: ProjectContext, path: string, content: string): void;
  // The project screen opened; the returned function runs when it closes.
  activate?(ctx: ProjectContext): (() => void) | void;
  // The extension was switched off or its project closed: drop diagnostics and the like.
  deactivate?(): void;
}
