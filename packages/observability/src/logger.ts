import pino from "pino";

export type Logger = pino.Logger;

/**
 * Paths censored in every log line. Agent contacts and credentials must never reach logs;
 * log hashes and token counts instead (docs/CONVENTIONS.md).
 */
export const REDACT_PATHS: readonly string[] = [
  "*.phone",
  "*.email",
  "*.agent.phone",
  "*.agent.email",
  "agent.phone",
  "agent.email",
  "phone",
  "email",
  "req.headers.authorization",
  "*.authorization",
  "authorization",
  "*.api_key",
  "*.apiKey",
  "*.secret",
  "*.password",
  "*.token",
  "*.RUNPOD_API_KEY",
  "*.GEMINI_API_KEY",
  "api_key",
  "apiKey",
  "secret",
  "password",
  "token",
  "RUNPOD_API_KEY",
  "GEMINI_API_KEY",
];

export const REDACT_CENSOR = "[redacted]";

export interface LoggerOptions {
  level?: pino.LevelWithSilent | string;
  /** Human-readable output through pino-pretty. Never in tests or production JSON pipelines. */
  pretty?: boolean;
  name?: string;
  /** Static fields added to every line (service, env, ...). */
  base?: Record<string, unknown>;
  /** Where lines go; defaults to stdout. Tests pass a capturing stream. */
  destination?: pino.DestinationStream;
}

export function createLogger(opts: LoggerOptions = {}): Logger {
  const options: pino.LoggerOptions = {
    level: opts.level ?? process.env.LOG_LEVEL ?? "info",
    base: opts.base ?? {},
    redact: { paths: [...REDACT_PATHS], censor: REDACT_CENSOR },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
  };
  if (opts.name) options.name = opts.name;
  if (opts.pretty) {
    options.transport = {
      target: "pino-pretty",
      options: { colorize: true, translateTime: "SYS:standard", ignore: "pid,hostname" },
    };
    return pino(options);
  }
  return opts.destination ? pino(options, opts.destination) : pino(options);
}

/** A logger that discards everything; for tests and disabled components. */
export function silentLogger(): Logger {
  return pino({ level: "silent" });
}
