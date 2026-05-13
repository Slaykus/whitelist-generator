import type { LogLevel } from '@types';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

const currentLevel: LogLevel =
  (process.env.LOG_LEVEL?.toUpperCase() as LogLevel) ?? 'INFO';

/** Serialize extra attributes to key=value pairs, quoting values that contain spaces */
function serializeAttrs(attrs?: Record<string, unknown>): string {
  if (!attrs) return '';
  return Object.entries(attrs)
    .map(([k, v]) => {
      const str = String(v);
      return str.includes(' ') ? `${k}="${str}"` : `${k}=${str}`;
    })
    .join(' ');
}

/** Emit a single log line in slog key=value format */
function emit(
  level: LogLevel,
  msg: string,
  attrs?: Record<string, unknown>
): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[currentLevel]) return;

  const time = new Date().toISOString();
  const msgPart = msg.includes(' ') ? `msg="${msg}"` : `msg=${msg}`;
  const attrsPart = attrs ? ` ${serializeAttrs(attrs)}` : '';

  const line = `time=${time} level=${level} ${msgPart}${attrsPart}`;

  if (level === 'ERROR' || level === 'WARN') {
    process.stderr.write(`${line}\n`);
  } else {
    process.stdout.write(`${line}\n`);
  }
}

export const logger = {
  debug: (msg: string, attrs?: Record<string, unknown>) =>
    emit('DEBUG', msg, attrs),
  info: (msg: string, attrs?: Record<string, unknown>) =>
    emit('INFO', msg, attrs),
  warn: (msg: string, attrs?: Record<string, unknown>) =>
    emit('WARN', msg, attrs),
  error: (msg: string, attrs?: Record<string, unknown>) =>
    emit('ERROR', msg, attrs),
};
