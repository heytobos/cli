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
  tobos decks                                 your decks and templates, by id, and those shared
                                              with you; an archived one is read-only

Working on a deck
  tobos new "Title" [--dir dir] [--no-clone]  create a deck and clone it here, into ./<id>
                                              (or into dir; --no-clone: only create it)
  tobos clone <id> [dir]                      clone a deck, with the agent pack
  tobos pull                                  get the latest pushes and the format guide
  tobos check [--types]                       compile and check the deck, offline (~1 s);
                                              --types: TypeScript too (installs a checker once)
  tobos push [-m "what changed"]              upload media, commit, push; the server checks it

Looking at it (from the working copy, render and open push what changed first; with --deck <id>,
from anywhere)
  tobos render scene/beat | scene | --all     PNGs of beats, for you to look at
         [--film] [--frames 6] [--out dir]    --film: frames through the animation
         [--scale 2] [-m "what changed"]      --scale: pixels per stage pixel; -m: for the push
  tobos open [scene/beat] [--presenter]       the deck in a browser (prints the URL, which opens once)
         [--print]                            --print: print the URL only, open nothing
  tobos open                                  outside a deck: a link, or its code for /login,
                                              that logs a browser in once; show the person both
  tobos export pdf [--out file]               the deck's PDF, as its page and its link give it:
                                              a page per scene at its last beat, no polls

The story (what the speaker says, held by the server; a scene mentioned: [Title](scene:<id>),
a beat: [Title](scene:<id>/<beat>))
  tobos story                                 the text, by ¶ id
  tobos story edit <¶> "old" "new"            change it, anchored on the exact text
  tobos story add [--after <¶>] "…"           a new paragraph (at the end, or after ¶)
  tobos story delete <¶>                      a paragraph goes
                                              TOBOS_AGENT=<name> says which agent you are: the
                                              deck's page marks what you wrote

People on a deck or template (from its working copy, or --deck <id>)
  tobos people                                who is on it, what each may do, and when a
                                              waiting invite lapses
  tobos invite <email> --can edit|present|view
                                              its owner puts them on it, mailed the way in;
                                              someone on it already gets the new level. On a
                                              template, --can edit|use
  tobos uninvite <email>                      take them off, and their access ends at once;
                                              with your own address, leave it

The skill (what your harness reads to know Tobos without this help)
  tobos skill install                         put it where Claude Code, Codex, OpenCode and others
                                              read skills; later CLIs keep it up to date

Templates (decks people start from: a new deck copies a template's master/)
  tobos new "Title" --from <id>                start a deck from that template (default: Tobos
                                              simple; \`tobos decks\` lists the person's own)
  tobos new "Our brand" --template            a new template: a copy of Tobos simple (or of --from)

Every command takes --json and then prints one JSON object.
Exit codes: 0 ok, 1 error, 2 the deck has problems, 3 not logged in, 4 the story changed
meanwhile (the reply has the paragraph as it is now: anchor on that and try again), 5 a plan's
limit or an archived deck: the person decides what to do, so show them the message and wait.
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
    },
  },
  people: { run: commands.people, options: { deck: { type: 'string' } } },
  invite: {
    run: commands.invite,
    options: { can: { type: 'string' }, deck: { type: 'string' } },
  },
  uninvite: { run: commands.uninvite, options: { deck: { type: 'string' } } },
  skill: { run: commands.skill },
  story: {
    run: commands.story,
    options: { deck: { type: 'string' }, after: { type: 'string' } },
  },
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
