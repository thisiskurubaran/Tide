import type { LogEntry } from './logs';

export interface DeviceInfo {
  appVersion: string;
  build: string | null;
  platform: string;
  osVersion: string;
  device: string | null;
  runtime: string;
}

// The text attached to a bug report. Paths into the app's sandbox are cut
// down to "~", so the report shows where a file was without the device's
// container ids.
export function buildReport(info: DeviceInfo, logs: readonly LogEntry[], documents: string | null): string {
  const scrub = (s: string) => (documents ? s.split(documents).join('~') : s);
  const lines = [
    `Tide ${info.appVersion}${info.build ? ` (${info.build})` : ''}`,
    `${info.platform} ${info.osVersion}${info.device ? `, ${info.device}` : ''}`,
    `Terminal: ${info.runtime}`,
    '',
    logs.length ? `Recent warnings and errors (${logs.length}):` : 'No warnings or errors logged this session.',
    ...logs.map((l) => `${new Date(l.time).toISOString()} ${l.level.toUpperCase()} ${scrub(l.message)}`),
  ];
  return lines.join('\n');
}

export function mailBody(kind: 'bug' | 'feature', info: DeviceInfo): string {
  const intro =
    kind === 'bug'
      ? 'What happened, and what did you expect?\n\n\nSteps to reproduce:\n1.\n2.\n3.\n'
      : 'What would you like Tide to do?\n\n\nHow would it help you?\n';
  return `${intro}\n--\nTide ${info.appVersion} on ${info.platform} ${info.osVersion}`;
}
