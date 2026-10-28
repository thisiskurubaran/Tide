export interface Config {
  token: string;
  host: string;
  port: number;
  image: string;
  idleMs: number;
  memoryBytes: number;
  cpus: number;
  pids: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const token = env.TIDE_TOKEN ?? '';
  if (token.length < 16) throw new Error('Set TIDE_TOKEN to a secret of at least 16 characters');
  return {
    token,
    host: env.HOST ?? '0.0.0.0',
    port: Number(env.PORT ?? 8787),
    image: env.TIDE_IMAGE ?? 'tide-session:dev',
    idleMs: Number(env.TIDE_IDLE_MINUTES ?? 15) * 60_000,
    memoryBytes: Number(env.TIDE_MEMORY_MB ?? 1024) * 1024 * 1024,
    cpus: Number(env.TIDE_CPUS ?? 1),
    pids: Number(env.TIDE_PIDS ?? 512),
  };
}
