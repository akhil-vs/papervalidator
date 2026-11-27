import type { Logger } from '../../application/ports.js';

export function createLogger(): Logger {
  return {
    info(event, fields) {
      write('info', event, fields);
    },
    error(event, fields) {
      write('error', event, fields);
    },
  };
}

function write(level: 'info' | 'error', event: string, fields: Record<string, unknown>): void {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    event,
    ...sanitize(fields),
  });
  if (level === 'error') console.error(line);
  else console.log(line);
}

function sanitize(fields: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (/authorization|token|secret|password/i.test(key)) continue;
    copy[key] = value;
  }
  return copy;
}
