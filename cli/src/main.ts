import { parseArgs, type ParseArgsConfig } from 'node:util';
import { VERSION } from './api.ts';
import * as commands from './commands.ts';
import { CliError, createOutput, EXIT, update, type Output } from './out.ts';
import { refresh } from './skill.ts';

const HELP = `tobos ${VERSION}: the command line of Tobos, the office suite your coding agent works in.

Account
  tobos login <email> [--server URL]          e-mail a login code to the person (signs them up if new)
  tobos login --code <code>                   finish: the code they read from the mail
  tobos logout                                forget this machine's token
  tobos whoami                                who you are, on which server
  tobos decks                                 your decks

Working on a deck
  tobos new "Title" [--slug S]                create a deck and clone it here
  tobos clone account/deck [dir]              clone a deck, with the agent pack
  tobos pull                                  get the latest pushes and the format guide
  tobos check [--types]                       compile and check the deck, offline (~1 s);
                                              --types: TypeScript too (installs a checker once)
  tobos push [-m "what changed"]              upload media, commit, push; the server checks it

Looking at it (from the working copy, render and open push what changed first)
  tobos render scene/beat | scene | --all     PNGs of beats, for you to look at
         [--film] [--frames 6] [--out dir]    --film: frames through the animation
  tobos open [scene/beat] [--presenter]       the deck in a browser (prints the URL)
  tobos export pdf [--out file]               a PDF of every beat

The skill (what your harness reads to know Tobos without this help)
  tobos skill install                         put it where Claude Code, Codex, OpenCode and others
                                              read skills; later CLIs keep it up to date

Templates (decks people start from: a new deck copies a template's master/)
  tobos new "Title" --from account/template   start a deck from that template (default: your own,
                                              account/my-template)
  tobos new "Our brand" --template            a new template: a copy of your default (or of --from)

Every command takes --json and then prints one JSON object.
Exit codes: 0 ok, 1 error, 2 the deck has problems, 3 not logged in.
`;

const COMMON: ParseArgsConfig['options'] = {
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
};

type Handler = (out: Output, args: commands.Args) => Promise<void>;

const TABLE: Record<string, { run: Handler; options?: ParseArgsConfig['options'] }> = {
  login: {
    run: commands.login,
    options: { server: { type: 'string' }, code: { type: 'string' } },
  },
  logout: { run: commands.logout },
  whoami: { run: commands.whoami },
  decks: { run: commands.decks },
  new: {
    run: commands.create,
    options: {
      slug: { type: 'string' },
      dir: { type: 'string' },
      'no-clone': { type: 'boolean' },
      from: { type: 'string' },
      template: { type: 'boolean' },
    },
  },
  clone: { run: commands.clone },
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
  export: {
    run: commands.exportDeck,
    options: {
      out: { type: 'string' },
      deck: { type: 'string' },
      handout: { type: 'boolean' },
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
  if (name === 'credential') {
    await commands.credential({ positionals: rest, values: {} });
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
