/**
 * Every command prints human text by default, and exactly one JSON object on stdout with
 * --json. Progress goes to stderr either way.
 */
export const EXIT = { ok: 0, error: 1, problems: 2, auth: 3, conflict: 4, limit: 5 } as const;

/**
 * Said after a plan's limit or an archived deck (exit 5): what to do is the person's to decide,
 * whether to make room, buy Pro or open a deck again, so the agent asks rather than works around it.
 */
export const ASK_THE_PERSON =
  'This is for the person you work for to decide: show them the above, and wait for their answer. Don’t work around it, for instance by building the deck outside Tobos.';

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
