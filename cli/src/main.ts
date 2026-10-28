import { parseArgs, type ParseArgsConfig } from 'node:util';
import { VERBS, type Verb, type VerbName } from '@tobos/deck/verbs';
import { VERSION } from './api.ts';
import * as commands from './commands.ts';
import { CliError, createOutput, EXIT, update, type Output } from './out.ts';
import { refresh } from './skill.ts';

/** A command and what it does, in two columns, what it does wrapped to the help's width. */
function row(usage: string, does: string): string {
  const lines: string[] = [];
  for (const word of does.split(' ')) {
    const last = lines.at(-1);
    if (last !== undefined && last.length + word.length < 50) lines[lines.length - 1] += ` ${word}`;
    else lines.push(word);
  }
  const first = `  ${usage}`;
  const pad = ' '.repeat(46);
  return [first.length < 45 ? first.padEnd(46) + lines[0] : `${first}\n${pad}${lines[0]}`]
    .concat(lines.slice(1).map((line) => pad + line))
    .join('\n');
}

/** The five verbs (ADR 0005), as verbs.ts says them for every door. */
const VERB_ROWS = Object.values(VERBS as Record<VerbName, Verb>)
  .flatMap((verb) => verb.cli.map((c) => row(c.usage, c.does)))
  .join('\n');

const HELP = `tobos ${VERSION}: the command line of Tobos, the office suite your coding agent works in.

Account
${row('tobos login [--server URL]', 'connect this machine: prints an address for the person to open and approve (logging in, or signing up, there); run it again once they did')}
${row('tobos logout', "forget this machine's token")}
${row('tobos whoami', 'who you are, on which server')}

The five verbs (a deck by its id, or its title to mv it; a folder by its path; in a working copy,
with no git: the server keeps the versions)
${VERB_ROWS}

Looking at it (from the working copy, render and open push what changed first; with --deck <id>,
from anywhere)
  tobos render scene/beat | scene | --all     PNGs of beats, for you to look at
         [--film] [--frames 6] [--out dir]    --film: frames through the animation
         [--scale 2] [-m "what changed"]      --scale: pixels per stage pixel; -m: for the push
  tobos open [scene/beat] [--presenter]       the deck's page in a browser (--presenter: a
         [--print]                            presenter's link, which opens once); --print: print
                                              the URL only, open nothing
  tobos open                                  outside a deck: the person's decks, in Tobos

The skill (what your harness reads to know Tobos without this help)
  tobos skill install                         put it where Claude Code, Codex, OpenCode and others
                                              read skills; later CLIs keep it up to date

Every command takes --json and then prints one JSON object.
Exit codes: 0 ok, 1 error, 2 the deck has problems, 3 not logged in (or not yet approved),
4 a conflict: someone changed the same lines (pull, resolve, push again), 5 a plan's limit or an
archived deck: the person decides what to do, so show them the message and wait.
`;

const COMMON: ParseArgsConfig['options'] = {
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
};

type Handler = (out: Output, args: commands.Args) => Promise<void>;

const TABLE: Record<string, { run: Handler; options?: ParseArgsConfig['options'] }> = {
  login: {
    run: commands.login,
    options: { server: { type: 'string' } },
  },
  logout: { run: commands.logout },
  whoami: { run: commands.whoami },
  ls: { run: commands.ls },
  new: {
    run: commands.create,
    options: {
      dir: { type: 'string' },
      'no-pull': { type: 'boolean' },
      from: { type: 'string' },
      template: { type: 'boolean' },
    },
  },
  mv: { run: commands.mv },
  pull: { run: commands.pull },
  check: { run: commands.check, options: { types: { type: 'boolean' } } },
  push: { run: commands.push, options: { message: { type: 'string', short: 'm' } } },
  open: {
    run: commands.open,
    options: {
      presenter: { type: 'boolean' },
      deck: { type: 'string' },
      print: { type: 'boolean' },
    },
  },
  skill: { run: commands.skill },
  render: {
    run: commands.render,
    options: {
      all: { type: 'boolean' },
      film: { type: 'boolean' },
      frames: { type: 'string' },
      out: { type: 'string' },
      scale: { type: 'string' },
      deck: { type: 'string' },
      message: { type: 'string', short: 'm' },
    },
  },
};

async function main(argv: string[]) {
  const [name, ...rest] = argv;
  if (!name || name === 'help' || name === '--help' || name === '-h') {
    process.stdout.write(HELP);
    return;
  }
  if (name === '--version' || name === '-v' || name === 'version') {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  const command = TABLE[name];
  const json = rest.includes('--json');
  const out = createOutput(json);
  try {
    if (!command) throw new CliError(`Unknown command "${name}". \`tobos help\` lists them.`);
    let parsed;
    try {
      parsed = parseArgs({
        args: rest,
        options: { ...COMMON, ...command.options },
        allowPositionals: true,
      });
    } catch (error) {
      throw new CliError(`${(error as Error).message}. \`tobos help\` shows the options.`);
    }
    if (parsed.values.help) {
      process.stdout.write(HELP);
      return;
    }
    if (name !== 'skill')
      for (const { dir, reason } of refresh())
        out.note(
          `Couldn't update the skill in ${dir} (${reason}); \`tobos skill install\`, run where it may write there, does.`,
        );
    await command.run(out, {
      positionals: parsed.positionals,
      values: parsed.values as commands.Args['values'],
    });
  } catch (error) {
    const known = error instanceof CliError;
    const message = known ? error.message : `${(error as Error).stack ?? error}`;
    if (json)
      process.stdout.write(
        `${JSON.stringify({ ok: false, error: message, ...(known ? error.extra : {}), ...(update ? { update } : {}) })}\n`,
      );
    else process.stderr.write(`tobos: ${message}\n`);
    process.exitCode = known ? error.exit : EXIT.error;
  }
  if (update && !json) process.stderr.write(`${update}\n`);
}

await main(process.argv.slice(2));
