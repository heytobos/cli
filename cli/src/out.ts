/**
 * Every command prints human text by default, and exactly one JSON object on stdout with
 * --json (login prints one per step, as JSON lines). Progress goes to stderr either way.
 */
export const EXIT = { ok: 0, error: 1, problems: 2, auth: 3, conflict: 4 } as const;

export class CliError extends Error {
  readonly exit: number;
  readonly extra: Record<string, unknown>;

  constructor(message: string, exit: number = EXIT.error, extra: Record<string, unknown> = {}) {
    super(message);
    this.exit = exit;
    this.extra = extra;
  }
}

/** Set once a server names a newer CLI than this one (api.ts). */
export let update: string | undefined;
export function offerUpdate(line: string) {
  update = line;
}

export interface Output {
  json: boolean;
  /** Progress, to stderr. Quiet in --json mode unless `always`. */
  note(message: string, always?: boolean): void;
  /** The command's result. */
  result(value: Record<string, unknown>, human: () => string | void): void;
}

export function createOutput(json: boolean): Output {
  return {
    json,
    note(message, always = false) {
      if (!json || always) process.stderr.write(`${message}\n`);
    },
    result(value, human) {
      // An agent reads only stdout in --json mode, so a newer CLI is news in the result itself.
      if (json) process.stdout.write(`${JSON.stringify(update ? { ...value, update } : value)}\n`);
      else {
        const text = human();
        if (text) process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
      }
    },
  };
}
