// In-memory project files for the agent's tests.
import { ChangeIo, createChangesStore } from './changes';
import type { AgentFiles, CommandResult, CommandRunner, ToolEnv } from './tools';

export function memoryProject(initial: Record<string, string> = {}) {
  const disk = new Map(Object.entries(initial));
  const writes: [string, string | null][] = [];
  const history: [string, string, string | null][] = [];
  const io: ChangeIo = {
    read: async (_p, path) => disk.get(path) ?? null,
    write: async (_p, path, content) => {
      writes.push([path, content]);
      if (content === null) disk.delete(path);
      else disk.set(path, content);
    },
    recordHistory: (_p, path, content, before) => {
      history.push([path, content, before]);
    },
  };
  const files: AgentFiles = {
    listFiles: async () => [...disk.keys()].sort(),
    read: async (path) => disk.get(path) ?? null,
  };
  return { disk, writes, history, io, files, changes: createChangesStore(io) };
}

export function fakeCommands(run: (command: string) => CommandResult | Promise<CommandResult>): CommandRunner & { commands: string[] } {
  const commands: string[] = [];
  return {
    commands,
    run: async (command) => {
      commands.push(command);
      return run(command);
    },
  };
}

export function testEnv(initial: Record<string, string> = {}, run: (command: string) => CommandResult | Promise<CommandResult> = () => ({ output: '', code: 0, timedOut: false })) {
  const project = memoryProject(initial);
  const commands = fakeCommands(run);
  const env: ToolEnv = { project: 'demo', files: project.files, changes: project.changes, commands };
  return { ...project, env, commands };
}
