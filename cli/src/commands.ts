import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { buildDeck, formatProblems, type Problem } from '@tobos/deck';
import { directoryTree } from '@tobos/deck/node';
import { api, VERSION } from './api.ts';
import { forget, save, settings } from './config.ts';
import { findDeck, parseId, requireRemote, type DeckDir } from './deck-dir.ts';
import { authEnv, configureCredentials, credentialConfig, git, gitOk } from './git.ts';
import { sizeNote, syncMediaJson, uploadMedia } from './media.ts';
import { openUrl } from './open-url.ts';
import { ASK_THE_PERSON, CliError, EXIT, type Output } from './out.ts';
import { writeFormatGuide } from './format.ts';
import { install, SKILL_NAME } from './skill.ts';

export interface Args {
  positionals: string[];
  values: Record<string, string | boolean | undefined>;
}

interface DeckInfo {
  id: string;
  kind: 'deck' | 'template';
  title: string;
  /** What you may do with it: you own it, or it was shared with you to edit, present or view. */
  role?: 'owner' | 'editor' | 'presenter' | 'viewer';
  /** Whose it is; for one shared with you, on their plan. */
  owner?: string;
  /** Read-only until its owner opens it again: no pushes, no presenting. */
  archived?: boolean;
  rev: string | null;
  git: string;
  url: string;
  scenes: { id: string; beats: string[] }[];
}

// ─── Account ────────────────────────────────────────────────────────────────

/**
 * What the person accepts with their first code: said here too, not only in the login mail,
 * since an agent may read the mail for them. The same words for every address, so the answer
 * doesn't tell whether an account exists.
 */
const TERMS_NOTICE = 'If the address is new, using the code accepts https://tobos.ai/terms.';

/**
 * Log in, or sign up, by e-mailed code, in two steps an agent can take in a conversation:
 * `tobos login <email>` sends the code; the person reads it from the mail; `tobos login --code
 * <code>` finishes. Both at once work too: `tobos login <email> --code <code>`.
 */
export async function login(out: Output, args: Args) {
  const server = ((args.values.server as string) || settings().server).replace(/\/$/, '');
  const client = `the tobos CLI on ${hostname()}`;
  const email = args.positionals[0]?.trim().toLowerCase();
  const code = args.values.code as string | undefined;

  if (!code) {
    if (!email)
      throw new CliError(
        'Log in with the e-mail address of the person you work for: `tobos login <email>`.',
      );
    await api('/api/login', { anonymous: true, server, body: { email, client } });
    save({ server, pending: email });
    out.result(
      { sent: email, next: 'tobos login --code <code>', terms: TERMS_NOTICE },
      () =>
        `Sent a 6-digit code to ${email}; it works for 10 minutes. Ask the person for it in one line: check the inbox, or spam, and paste the code here. ${TERMS_NOTICE} Then run:\n\n  tobos login --code <code>`,
    );
    return;
  }

  const address = email ?? settings().pending;
  if (!address)
    throw new CliError('Which address got the code? `tobos login <email> --code <code>`.');
  const { token } = await api<{ token: string; email: string }>('/api/login/verify', {
    anonymous: true,
    server,
    body: { email: address, code, client },
  });
  save({ server, token, pending: undefined });
  const me = await api<{ email: string }>('/api/me', { server });
  save({ email: me.email });
  out.result({ email: me.email, server }, () => `Logged in as ${me.email}.`);
}

/** Revoke this machine's token on the server, then forget it here. */
export async function logout(out: Output) {
  let revoked = false;
  if (settings().token)
    try {
      await api('/api/logout', { method: 'POST', body: {} });
      revoked = true;
    } catch (error) {
      out.note(`(couldn't revoke the token on the server: ${(error as Error).message})`, true);
    }
  forget();
  out.result({ loggedOut: true, revoked }, () =>
    revoked
      ? 'Logged out. The token no longer works anywhere.'
      : 'Logged out on this machine; the server still knows the token.',
  );
}

export async function whoami(out: Output) {
  const me = await api<{ email: string }>('/api/me');
  out.result({ ...me, server: settings().server }, () => `${me.email} on ${settings().server}`);
}

/** What `tobos decks` says of one besides its title: a template, someone else's, archived. */
function aboutDeck(d: DeckInfo): string {
  const can = { editor: 'you edit', presenter: 'you present', viewer: 'you view' } as const;
  const notes = [
    d.kind === 'template' && 'template',
    d.role && d.role !== 'owner' && `${d.owner ?? 'someone else'}’s, ${can[d.role]}`,
    d.archived && 'archived: read-only',
  ].filter(Boolean);
  return notes.length ? `  (${notes.join('; ')})` : '';
}

export async function decks(out: Output) {
  const { decks } = await api<{ decks: DeckInfo[] }>('/api/decks');
  out.result({ decks }, () =>
    decks.length === 0
      ? 'No decks yet. `tobos new "Title"` starts one.'
      : decks.map((d) => `${d.id}  ${d.title}${aboutDeck(d)}`).join('\n'),
  );
}

// ─── Working copies ─────────────────────────────────────────────────────────

async function cloneInto(out: Output, info: DeckInfo, dir: string) {
  const { server } = settings();
  if (existsSync(dir)) throw new CliError(`${dir} already exists.`);
  out.note(`cloning ${info.title} into ${dir}`);
  await gitOk([...credentialConfig(server), 'clone', '--quiet', info.git, dir], {
    env: authEnv(server),
  });
  await configureCredentials(dir, server);
  return writeFormatGuide(dir, server);
}

export async function clone(out: Output, args: Args) {
  const given = args.positionals[0];
  if (!given) throw new CliError('Which deck? `tobos clone <id>` (`tobos decks` lists them).');
  const id = parseId(given);
  const info = await api<DeckInfo>(`/api/decks/${id}`);
  const dir = resolve(args.positionals[1] ?? id);
  await cloneInto(out, info, dir);
  out.result(
    { ...info, dir },
    () =>
      `Cloned ${info.title} into ${relative(process.cwd(), dir) || '.'}.\nRead AGENTS.md there first. Preview: ${info.url}`,
  );
}

/**
 * A new deck, its master copied from a template (the account's default unless `--from` names one), or
 * with `--template` a new template: a copy of all of the one it starts from.
 */
export async function create(out: Output, args: Args) {
  const title = args.positionals.join(' ').trim();
  if (!title) throw new CliError('What is it called? `tobos new "My talk"`.');
  const info = await api<DeckInfo>('/api/decks', {
    body: {
      title,
      from: args.values.from,
      template: Boolean(args.values.template),
    },
  });
  let dir: string | undefined;
  if (!args.values['no-clone']) {
    dir = resolve((args.values.dir as string) ?? info.id);
    await cloneInto(out, info, dir);
  }
  out.result({ ...info, dir: dir ?? null }, () =>
    [
      `Created ${info.title}: ${info.url}`,
      dir ? `Cloned into ${relative(process.cwd(), dir) || '.'}. Read AGENTS.md there first.` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );
}

export async function pull(out: Output) {
  const deck = await requireRemote();
  const result = await git(
    [...credentialConfig(deck.server), 'pull', '--ff-only', '--quiet', 'origin', 'main'],
    { cwd: deck.root, env: authEnv(deck.server) },
  );
  if (result.code !== 0)
    throw new CliError(
      `Couldn't fast-forward to the server's main:\n${result.stderr.trim()}\nCommit or stash your changes, then merge with \`git pull\`.`,
    );
  await writeFormatGuide(deck.root, deck.server);
  const rev = (await gitOk(['rev-parse', 'HEAD'], { cwd: deck.root })).trim();
  out.result({ id: deck.id, rev }, () => `Up to date with the server (${rev.slice(0, 7)}).`);
}

// ─── Check and push ─────────────────────────────────────────────────────────

/**
 * The files `tobos push` sends: every file git doesn't ignore, when the deck is a repository of
 * its own, as push needs it to be. Otherwise undefined, for every file: without git, or in a
 * folder of another repository, whose ignores aren't the deck's.
 */
async function pushedFiles(root: string): Promise<string[] | undefined> {
  try {
    const prefix = await git(['rev-parse', '--show-prefix'], { cwd: root });
    if (prefix.code !== 0 || prefix.stdout.trim() !== '') return undefined;
    const listed = await git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: root,
    });
    return listed.code === 0 ? listed.stdout.split('\0').filter(Boolean) : undefined;
  } catch {
    return undefined; // no git
  }
}

async function runCheck(dir: DeckDir) {
  const started = performance.now();
  const files = await pushedFiles(dir.root);
  const result = await buildDeck(directoryTree(dir.root, files));
  return { ...result, files, ms: Math.round(performance.now() - started) };
}

/** The server's messages, which git prints as "remote: …". */
const remoteLines = (stderr: string) =>
  stderr
    .split('\n')
    .filter((l) => l.startsWith('remote: '))
    .map((l) => l.slice(8));

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * How the server's hook refuses a push that would take the deck's account past the media its plan
 * keeps: the app's LimitError (checkMediaRoom), which tells an editor first whose plan it is. The
 * app's server suite pushes past it with this CLI and expects 5, which holds the two together.
 */
const MEDIA_LIMIT = /^tobos: (This deck belongs to .+, whose )?Tobos \w+ keeps .+ of media/;

/**
 * Why a push failed, as the exit code says it (2 only for problems in the deck, which an agent
 * then sets out to fix; 5 for an archived deck, which only the person opens again, or for media
 * past the plan, which only they make room for), and what to do about it. `output` is git's,
 * `remote` the server's lines.
 */
export function pushFailure(
  output: string,
  remote: string[],
): { message: string; exit: number; archived?: true; limit?: 'media' } {
  const forThePerson = `${remote.map((line) => line.replace(/^tobos: /, '')).join('\n')}\n${ASK_THE_PERSON}`;
  // The deck is archived (the server's hook says so): its owner's choice, not the agent's.
  if (remote.some((line) => /^tobos: This (deck|template) is archived/.test(line)))
    return { message: forThePerson, exit: EXIT.limit, archived: true };
  // Past the media its plan keeps, as an upload's 402 is: theirs to make room, not the agent's.
  if (remote.some((line) => MEDIA_LIMIT.test(line)))
    return { message: forThePerson, exit: EXIT.limit, limit: 'media' };
  if (/non-fast-forward|fetch first/.test(output))
    return {
      message:
        "The server has changes you don't have. Run `tobos pull` (or `git pull`), then push again.",
      exit: EXIT.error,
    };
  if (remote.some((line) => line.startsWith('tobos: rejected:')))
    return { message: `The server rejected the deck.\n${remote.join('\n')}`, exit: EXIT.problems };
  if (/Authentication failed|returned error: 401|could not read Username/i.test(output))
    return {
      message: "The server didn't take your login. Run `tobos login` again, then push.",
      exit: EXIT.auth,
    };
  if (/returned error: 403/.test(output))
    return {
      message: 'You may not push to this deck: ask its owner to make you an editor.',
      exit: EXIT.error,
    };
  if (remote.length > 0)
    return { message: `The server refused the push.\n${remote.join('\n')}`, exit: EXIT.error };
  // Never reached, or not trusted (TLS): nothing went.
  if (/Could not resolve host|Failed to connect|Connection refused|SSL|certificate/i.test(output))
    return {
      message: `Couldn't reach the server: nothing was pushed. Try again.\n${output.trim()}`,
      exit: EXIT.error,
    };
  // Reached, then cut off: the server may have taken it all the same.
  if (/timed out|Connection reset|unexpected disconnect|RPC failed/i.test(output))
    return {
      message: `The connection broke off, and the push may have gone through. Run \`tobos pull\` to see where the server is, then push again if it still lacks your change.\n${output.trim()}`,
      exit: EXIT.error,
    };
  return { message: `The push failed.\n${output.trim()}`, exit: EXIT.error };
}

function problemSummary(problems: Problem[]) {
  const errors = problems.filter((p) => p.severity === 'error').length;
  return { errors, warnings: problems.length - errors };
}

export async function check(out: Output, args: Args) {
  const deck = await findDeck(args.positionals[0]);
  // Hashing media/ into media.json needs no network; uploading waits for push.
  await syncMediaJson(deck.root);
  const result = await runCheck(deck);
  if (args.values.types) {
    const { checkTypes } = await import('./types.ts');
    // Only in what a push sends, as the check above.
    const sent = result.files && new Set(result.files);
    result.problems.push(
      ...(await checkTypes(deck.root, (m) => out.note(m))).filter((p) => sent?.has(p.file) ?? true),
    );
  }
  const { errors, warnings } = problemSummary(result.problems);
  const scenes = result.manifest?.chapters.reduce((n, c) => n + c.scenes.length, 0) ?? 0;
  const beats =
    result.manifest?.chapters.reduce(
      (n, c) => n + c.scenes.reduce((m, s) => m + s.beats.length, 0),
      0,
    ) ?? 0;
  out.result(
    { ok: errors === 0, errors, warnings, problems: result.problems, scenes, beats, ms: result.ms },
    () =>
      [
        formatProblems(result.problems),
        errors === 0
          ? `✓ ${plural(scenes, 'scene')}, ${plural(beats, 'beat')}${warnings ? `, ${plural(warnings, 'warning')}` : ''} (${result.ms} ms)`
          : `✗ ${plural(errors, 'error')}${warnings ? `, ${plural(warnings, 'warning')}` : ''}`,
      ]
        .filter(Boolean)
        .join('\n'),
  );
  if (errors > 0) process.exitCode = EXIT.problems;
}

/**
 * Check the working copy, upload its new media, commit everything and push it to main. The
 * server checks it again; every open preview follows. Returns the problems instead when the
 * check finds errors.
 */
async function pushWorkingCopy(out: Output, deck: Required<DeckDir>, message?: string) {
  const { root, server } = deck;
  const { media } = await syncMediaJson(root);
  const result = await runCheck(deck);
  const { errors, warnings } = problemSummary(result.problems);
  if (errors > 0) return { ok: false as const, errors, warnings, problems: result.problems };

  for (const [name, entry] of Object.entries(media)) {
    const note = sizeNote(name, entry.size);
    if (note) out.note(note, true);
  }
  const uploaded = await uploadMedia(root, media, server, deck.id, (m) => out.note(m));

  await gitOk(['add', '-A'], { cwd: root });
  const committed = (await gitOk(['diff', '--cached', '--name-only'], { cwd: root }))
    .split('\n')
    .filter(Boolean);
  for (const file of committed) out.note(`  ${file}`);
  if (committed.length > 0)
    await gitOk(['commit', '--quiet', '-m', message || 'Update the deck'], {
      cwd: root,
      env: await identity(root),
    });

  out.note('pushing…');
  const pushed = await git(
    [...credentialConfig(server), 'push', '--porcelain', 'origin', 'HEAD:main'],
    { cwd: root, echo: !out.json, env: authEnv(server) },
  );
  const remote = remoteLines(pushed.stderr);
  if (pushed.code !== 0) {
    const { message, exit, ...extra } = pushFailure(pushed.stdout + pushed.stderr, remote);
    throw new CliError(message, exit, { remote, ...extra });
  }
  const rev = (await gitOk(['rev-parse', 'HEAD'], { cwd: root })).trim();
  return { ok: true as const, rev, committed, uploaded, warnings, remote };
}

export async function push(out: Output, args: Args) {
  const deck = await requireRemote();
  const result = await pushWorkingCopy(out, deck, args.values.message as string | undefined);
  if (!result.ok) {
    out.result(
      { ...result, pushed: false },
      () =>
        `${formatProblems(result.problems)}\n✗ Not pushed: ${plural(result.errors, 'error')}. Fix them and push again.`,
    );
    process.exitCode = EXIT.problems;
    return;
  }
  const url = `${deck.server}/${deck.id}`;
  out.result(
    { ...result, pushed: true, url },
    () =>
      `✓ Pushed ${result.rev.slice(0, 7)}${result.uploaded.length ? ` with ${plural(result.uploaded.length, 'media file')}` : ''}. Live at ${url}`,
  );
}

/**
 * Before showing a deck from its own working copy, push what changed: what you render or open
 * is always what's pushed, and what everyone with the deck open sees.
 */
async function pushIfChanged(out: Output, id: string, message?: string) {
  const found = await findDeck().catch(() => undefined);
  if (!found?.server || found.id !== id) return { pushed: false, uploaded: [] as string[] };
  const deck = found as Required<DeckDir>;
  const dirty = (await gitOk(['status', '--porcelain'], { cwd: deck.root })).trim() !== '';
  const head = await git(['rev-parse', '--verify', '--quiet', 'HEAD'], { cwd: deck.root });
  const remote = await git(['rev-parse', '--verify', '--quiet', 'origin/main'], { cwd: deck.root });
  if (!dirty && head.stdout.trim() === remote.stdout.trim())
    return { pushed: false, uploaded: [] as string[] };
  const result = await pushWorkingCopy(out, deck, message);
  if (!result.ok)
    throw new CliError(
      `${formatProblems(result.problems)}\n✗ ${plural(result.errors, 'error')} in your working copy. Fix them and try again.`,
      EXIT.problems,
      { problems: result.problems },
    );
  return { pushed: true, uploaded: result.uploaded };
}

async function identity(root: string): Promise<Record<string, string>> {
  if ((await git(['config', 'user.email'], { cwd: root })).code === 0) return {};
  const who = settings().email;
  return {
    GIT_AUTHOR_NAME: who ?? 'tobos',
    GIT_AUTHOR_EMAIL: who ?? 'tobos@localhost',
    GIT_COMMITTER_NAME: who ?? 'tobos',
    GIT_COMMITTER_EMAIL: who ?? 'tobos@localhost',
  };
}

// ─── Viewing ────────────────────────────────────────────────────────────────

async function viewUrl(id: string, view?: string, hours?: number) {
  return api<{
    url: string;
    rev: string | null;
    scenes: DeckInfo['scenes'];
  }>(`/api/decks/${id}/view`, { body: { view, hours } });
}

/** The deck a command is about: `--deck <id>`, or the working copy's. */
async function deckId(args: Args): Promise<string> {
  if (typeof args.values.deck === 'string') return parseId(args.values.deck);
  return (await requireRemote()).id;
}

export async function open(out: Output, args: Args) {
  const position = args.positionals[0];
  if (!position && typeof args.values.deck !== 'string' && !(await findDeck().catch(() => null)))
    return openApp(out);
  const view = args.values.presenter ? 'presenter' : undefined;
  const id = await deckId(args);
  const { pushed } = await pushIfChanged(out, id);
  const { url } = await viewUrl(id, view, 12);
  const full = position ? `${url}#${position}` : url;
  const opened = !args.values.print && (await openUrl(full));
  out.result({ url: full, opened, pushed }, () => full);
}

/**
 * Outside a deck: a login for a browser as this CLI's user, at their decks and templates. Shown,
 * never opened: the person takes the last step, by opening the link or by typing its code in at
 * /login on another device, a phone or a lecture hall's PC. Either spends both.
 */
async function openApp(out: Output) {
  const { url, code } = await api<{ url: string; code?: string }>('/api/login/browser', {
    method: 'POST',
  });
  const page = `${new URL(url).origin}/login`;
  out.result({ url, code, page }, () =>
    code
      ? `Open this link, or enter ${code} at ${page}. It works once, within 10 minutes.\n${url}`
      : `Open this link. It works once, within 10 minutes.\n${url}`,
  );
}

// ─── The story ──────────────────────────────────────────────────────────────

interface StoryParagraph {
  id: string;
  text: string;
  version: number;
  /** Who wrote what in it, and when: n characters (a mention counts as one). */
  marks: { n: number; name: string; agent: string | null; at: string }[];
}

interface Story {
  id: string;
  title: string;
  seq: number;
  paragraphs: StoryParagraph[];
}

/**
 * Change the story with one request. The server applies it, or refuses it with the paragraph as
 * it is now (exit code 4): read it again, and anchor on its text as it is.
 */
async function storyTx(id: string, ops: unknown[]) {
  try {
    return await api<{ seq: number; ids: Record<string, string> }>(`/api/decks/${id}/story/tx`, {
      body: { ops, agent: process.env.TOBOS_AGENT || undefined },
    });
  } catch (error) {
    // The story changed meanwhile (409, exit 4), or the anchor is too short (422): either way the
    // paragraph as it is now, to anchor on.
    if (error instanceof CliError && (error.extra.status === 409 || error.extra.status === 422)) {
      const now = error.extra.paragraph as StoryParagraph | undefined;
      throw new CliError(
        now ? `${error.message}\nIt is now:\n¶ ${now.id}  ${now.text}` : error.message,
        error.extra.status === 409 ? EXIT.conflict : EXIT.error,
        error.extra,
      );
    }
    throw error;
  }
}

/**
 * `tobos story`: the deck's story, one living text the server holds, with ¶ ids. `edit`, `add`
 * and `delete` change it, as a person on the deck's page does; the page marks what an agent wrote.
 */
export async function story(out: Output, args: Args) {
  const [action, ...rest] = args.positionals;
  const id = await deckId(args);
  if (!action) {
    const story = await api<Story>(`/api/decks/${id}/story`);
    out.result({ ...story }, () =>
      story.paragraphs.length
        ? story.paragraphs.map((p) => `¶ ${p.id.padEnd(4)} ${p.text}`).join('\n\n')
        : 'No story yet. `tobos story add "…"` writes its first paragraph.',
    );
    return;
  }
  if (action === 'edit') {
    const [paragraph, find, replace] = rest;
    if (!paragraph || find === undefined || replace === undefined)
      throw new CliError(
        '`tobos story edit <¶ id> "the exact text" "what replaces it"` (`tobos story` shows the ids).',
      );
    const result = await storyTx(id, [{ op: 'set', id: paragraph, find, replace }]);
    out.result({ ...result, paragraph }, () => `Changed ${paragraph}.`);
    return;
  }
  if (action === 'add') {
    const text = rest.join(' ').trim();
    if (!text) throw new CliError('`tobos story add [--after <¶ id>] "the paragraph"`.');
    const after = (args.values.after as string | undefined) ?? 'end';
    const result = await storyTx(id, [
      { op: 'insert', after: after === 'start' ? null : after, text, key: 'new:1' },
    ]);
    const paragraph = result.ids['new:1'] ?? null;
    out.result({ ...result, paragraph }, () => `Added ${paragraph}.`);
    return;
  }
  if (action === 'delete') {
    const paragraph = rest[0];
    if (!paragraph) throw new CliError('`tobos story delete <¶ id>`.');
    const result = await storyTx(id, [{ op: 'delete', id: paragraph }]);
    out.result({ ...result, paragraph }, () => `Deleted ${paragraph}.`);
    return;
  }
  throw new CliError(`No \`tobos story ${action}\`: edit, add or delete.`);
}

// ─── People ─────────────────────────────────────────────────────────────────

interface Person {
  email: string;
  role: 'owner' | 'editor' | 'presenter' | 'viewer';
  joined: boolean;
  /** An editor beyond what the owner's plan allows, who views the deck meanwhile. */
  paused: boolean;
  /** When an invite nobody has logged in with lapses, as the server says it. */
  lapsesAt?: string;
}

/** An invite nobody has logged in with yet, and when it lapses: 5 Nov. */
const waiting = (p: Person) =>
  p.joined
    ? ''
    : ` (invited, not logged in yet${p.lapsesAt ? `; lapses ${new Date(p.lapsesAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''})`;

/**
 * `--can`'s words, as the Share menu says them (Can edit, Can present, Can view), and the level.
 * A template's are Can edit and Can use, which is the viewer's level there.
 */
const CAN: Record<string, Exclude<Person['role'], 'owner'>> = {
  edit: 'editor',
  present: 'presenter',
  view: 'viewer',
  use: 'viewer',
};
const CAN_WORDS: Record<Person['role'], string> = {
  owner: 'owner',
  editor: 'can edit',
  presenter: 'can present',
  viewer: 'can view',
};

/** Whether the server answered for a deck or a template: one that doesn't say means a deck. */
type Kind = 'deck' | 'template';

/** A level's words on a deck or a template, where viewing it is using it. */
const canWords = (role: Person['role'], kind: Kind = 'deck') =>
  kind === 'template' && role === 'viewer' ? 'can use' : CAN_WORDS[role];

/** Who is on the deck, the owner first, and what each may do. */
export async function people(out: Output, args: Args) {
  const id = await deckId(args);
  const { people, kind } = await api<{ people: Person[]; kind?: Kind }>(`/api/decks/${id}/people`);
  out.result({ ...(kind ? { kind } : {}), people }, () =>
    people
      .map(
        (p) =>
          `${p.email.padEnd(32)} ${canWords(p.role, kind)}${p.paused ? ', paused: views until the plan allows more editors' : ''}${waiting(p)}`,
      )
      .join('\n'),
  );
}

/**
 * Put someone on the deck at a level: they get a mail with the way in, and their access starts
 * at their first login from that address. Someone on it already is given the new level instead;
 * someone who had its invite in the last day gets no second one, and the link is for you to send.
 */
export async function invite(out: Output, args: Args) {
  const email = args.positionals[0];
  const level = CAN[String(args.values.can)];
  if (!email || !level)
    throw new CliError(
      'Invite whom, to do what? `tobos invite <email> --can edit`, `--can present` or `--can view`; to a template, `--can edit` or `--can use`.',
    );
  const id = await deckId(args);
  const done = await api<{
    email: string;
    level: Person['role'];
    kind?: Kind;
    mailed: boolean;
    /** The mail couldn't be sent; they are on the deck all the same. */
    mailFailed?: boolean;
    link?: string;
  }>(`/api/decks/${id}/people`, { body: { email, level } });
  const now = `${done.email} ${canWords(done.level, done.kind)} now`;
  out.result(done, () =>
    done.mailed
      ? `${now}; they got a mail with the way in.`
      : done.mailFailed
        ? `${now}, but the invite mail couldn't be sent: send them ${done.link}`
        : done.link
          ? `${now}. They had an invite to it in the last day, so no second mail: send them ${done.link}`
          : `${now}.`,
  );
}

/** Take someone off the deck, or, with your own address, leave it. Their access ends at once. */
export async function uninvite(out: Output, args: Args) {
  const email = args.positionals[0];
  if (!email) throw new CliError('Take whom off? `tobos uninvite <email>`.');
  const id = await deckId(args);
  const done = await api<{ removed: string; kind?: Kind }>(`/api/decks/${id}/people`, {
    method: 'DELETE',
    body: { email },
  });
  out.result(
    done,
    () => `${done.removed} is off the ${done.kind ?? 'deck'}; their access has ended.`,
  );
}

// ─── Exports and rendering ──────────────────────────────────────────────────

/** Where exports go by default: .tobos/exports/ inside a deck (ignored by git), else here. */
async function exportTarget(args: Args, file: string): Promise<string> {
  if (args.values.out) return resolve(args.values.out as string);
  const deck = await findDeck().catch(() => undefined);
  if (!deck) return resolve(file);
  mkdirSync(join(deck.root, '.tobos', 'exports'), { recursive: true });
  return join(deck.root, '.tobos', 'exports', file);
}

export async function exportDeck(out: Output, args: Args) {
  const kind = args.positionals[0];
  if (kind !== 'pdf') throw new CliError('Export what? `tobos export pdf`.');
  const id = await deckId(args);
  const { exportPdf } = await import('./render.ts');
  const { url, rev } = await viewUrl(id, 'print');
  const target = await exportTarget(args, `${id}.pdf`);
  const print = new URL(url);
  if (args.values.handout) print.searchParams.set('beats', 'last');
  const pages = await exportPdf(print.href, target, (m) => out.note(m));
  out.result(
    { file: target, pages, rev },
    () => `Wrote ${relative(process.cwd(), target)} (${pages} pages).`,
  );
}

/**
 * Render what's pushed. From the deck's own working copy, what changed is pushed first, so
 * that is the working copy too.
 */
export async function render(out: Output, args: Args) {
  const { renderBeats } = await import('./render.ts');
  // With --deck, from anywhere: a working copy is needed only to say which deck.
  const deck = await findDeck().catch(() => undefined);
  const id = typeof args.values.deck === 'string' ? parseId(args.values.deck) : deck?.id;
  if (!id) throw new CliError('Run this inside a cloned deck, or pass --deck <id>.');
  const { pushed, uploaded } = await pushIfChanged(out, id, args.values.message as string);
  const view = await viewUrl(id, 'render');
  const { url } = view;
  const rev = view.rev ?? undefined;

  // What to render: a beat, a whole scene, or everything.
  const targets: string[] = [];
  const { scenes } = view;
  const wanted = args.values.all ? scenes.map((s) => s.id) : args.positionals;
  if (wanted.length === 0)
    throw new CliError('Render what? `tobos render scene/beat`, `tobos render scene`, or `--all`.');
  for (const ref of wanted) {
    const [sceneId, beat] = ref.split('/');
    const scene = scenes.find((s) => s.id === sceneId);
    if (!scene) throw new CliError(`No scene "${sceneId}" in deck.json.`);
    if (beat) {
      const id = /^\d+$/.test(beat) ? scene.beats[Number(beat)] : beat;
      if (!id || !scene.beats.includes(id))
        throw new CliError(`No beat "${beat}" in scene "${sceneId}".`);
      targets.push(`${scene.id}/${id}`);
    } else targets.push(...scene.beats.map((b) => `${scene.id}/${b}`));
  }
  // Beside the deck's own working copy; any other deck's, here.
  const root = deck?.id === id ? deck.root : '.';
  const dir = resolve((args.values.out as string) ?? join(root, '.tobos', 'render'));
  const { files, errors } = await renderBeats(url, targets, {
    dir,
    film: Boolean(args.values.film),
    frames: Number(args.values.frames ?? 6),
    scale: Number(args.values.scale ?? 1),
    note: (m) => out.note(m),
  });
  out.result({ rev, pushed, uploaded, files, errors }, () =>
    files
      .map(
        (f) =>
          `${f.position.padEnd(28)} ${relative(process.cwd(), f.path)}${f.late ? '  (not fully drawn)' : ''}`,
      )
      .join('\n'),
  );
}

// ─── The skill ──────────────────────────────────────────────────────────────

/** `tobos skill install` puts the Tobos skill where the person's harnesses read skills. */
export async function skill(out: Output, args: Args) {
  if (args.positionals[0] !== 'install')
    throw new CliError(
      '`tobos skill install` installs the skill; there is no other skill command.',
    );
  const targets = install();
  const refused = targets.filter((t) => t.action === 'refused');
  if (refused.length)
    throw new CliError(
      `Couldn't write the skill to ${refused.map((t) => t.dir).join(' or ')}: ${refused[0]!.reason}. ` +
        "A harness's sandbox can stop writes outside the working folder: ask the person to approve " +
        'the command, or to run `tobos skill install` themselves.',
      EXIT.error,
      { targets },
    );
  const next = 'New sessions of the harness load the skill.';
  out.result({ skill: SKILL_NAME, version: VERSION, targets, next }, () =>
    [
      `The ${SKILL_NAME} skill (${VERSION}):`,
      ...targets.map((t) => `  ${t.dir}  (${t.harnesses.join(', ')})`),
      next,
    ].join('\n'),
  );
}

// ─── Git credential helper ──────────────────────────────────────────────────

/** git calls `tobos credential get` and reads the token from stdout. */
export async function credential(args: Args) {
  if (args.positionals[0] !== 'get') return; // store and erase: nothing to do
  const input = readFileSync(0, 'utf8');
  const fields = Object.fromEntries(
    input
      .split('\n')
      .filter((l) => l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );
  let stored;
  try {
    stored = settings();
  } catch (error) {
    // Git asks quietly: a helper that can't answer gives it nothing, and git says what it lacks.
    process.stderr.write(`tobos: ${(error as Error).message}\n`);
    return;
  }
  const { server, token } = stored;
  const target = new URL(server);
  if (!token || fields.host !== target.host || `${fields.protocol}:` !== target.protocol) return;
  process.stdout.write(`username=tobos\npassword=${token}\n`);
}
