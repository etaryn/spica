/**
 * Structured logging. Log ids and error names only, never message text: what users write is
 * sensitive personal data.
 */

type Meta = Record<string, unknown>;

export interface Logger {
  info(msg: string, meta?: Meta): void;
  error(msg: string, meta?: Meta): void;
}

export const consoleLogger: Logger = {
  info: (msg, meta) => console.log(JSON.stringify({ level: "info", msg, ...meta })),
  error: (msg, meta) => console.error(JSON.stringify({ level: "error", msg, ...meta })),
};

export const silentLogger: Logger = {
  info: () => {},
  error: () => {},
};
