import { existsSync, statSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import type { Problem } from '@tobos/deck';
import { formatProblems } from '@tobos/deck/format-problems';
import { api, failure, request, VERSION } from './api.ts';
import { forget, save, settings } from './config.ts';
import {
  baseOfClone,
  changesOf,
  copyFiles,
  findCopy,
  parseId,
  pullInto,
  requireCopy,
  writeCopy,
  type Copy,
} from './copy.ts';
import { sizeNote } from './media.ts';
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
  /** The folder it is in, by its path from the root: of the person's own decks only. */
  folder?: string;
  rev: string | null;
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

/** What `tobos ls` says of one besides its title: a template, someone else's, archived. */
function aboutDeck(d: DeckInfo): string {
  const can = { editor: 'you edit', presenter: 'you present', viewer: 'you view' } as const;
  const notes = [
    d.kind === 'template' && 'template',
    d.role && d.role !== 'owner' && `${d.owner ?? 'someone else'}’s, ${can[d.role]}`,
    d.archived && 'archived: read-only',
  ].filter(Boolean);
  return notes.length ? `  (${notes.join('; ')})` : '';
}

// ─── Folders ────────────────────────────────────────────────────────────────

/** A folder's path as a prefix of what is in it: none for the root. */
const inFolder = (path: string) => (path === '/' ? '' : `${path}/`);

type Entry =
  { kind: 'folder'; name: string; path: string } | { kind: 'deck'; id: string; title: string };

/**
 * The decks and templates the person can work on, each in its folder, and those shared with
 * them; with a path, what that folder of their drive holds instead: its folders, then its decks.
 */
export async function ls(out: Output, args: Args) {
  const path = args.positionals[0];
  if (path !== undefined) {
    const listed = await api<{ path: string; entries: Entry[] }>(
      `/api/decks?${new URLSearchParams({ path })}`,
    );
    out.result(listed, () =>
      listed.entries.length === 0
        ? `${listed.path} is empty.`
        : listed.entries
            .map((e) => (e.kind === 'folder' ? `${e.name}/` : `${e.id}  ${e.title}`))
            .join('\n'),
    );
    return;
  }
  const { decks } = await api<{ decks: DeckInfo[] }>('/api/decks');
  out.result({ decks }, () =>
    decks.length === 0
      ? 'No decks yet. `tobos new "Title"` starts one.'
      : decks
          .map((d) => `${d.id}  ${inFolder(d.folder ?? '/')}${d.title}${aboutDeck(d)}`)
          .join('\n'),
  );
}

/**
 * Decks and folders moved into a folder, the last argument, which is made if there is none: a
 * deck by its id or its title, a folder by its path, which starts with `/`.
 */
export async function mv(out: Output, args: Args) {
  const named = args.positionals.slice(0, -1);
  const to = args.positionals.at(-1);
  if (!to || named.length === 0)
    throw new CliError(
      'What goes where? `tobos mv <deck or /folder>… <folder>`: decks by id or title, folders by path.',
    );
  const moved = await api<{ to: string }>('/api/drive/move', {
    body: {
      decks: named.filter((name) => !name.startsWith('/')),
      folders: named.filter((name) => name.startsWith('/')),
      to,
    },
  });
  out.result(moved, () => `Moved ${plural(named.length, 'item')} into ${moved.to}.`);
}

// ─── Working copies ─────────────────────────────────────────────────────────

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * `tobos pull`: the working copy into step with the deck's latest version, merging what both
 * changed (copy.ts). With an id, a new copy of that deck, in `dir` or a folder named after its id;
 * in a clone from before, made with git, once, which makes it a working copy.
 */
export async function pull(out: Output, args: Args) {
  const given = args.positionals[0];
  const note = (m: string) => out.note(m);
  if (given) {
    const id = parseId(given);
    const info = await api<DeckInfo>(`/api/decks/${id}`);
    const dir = resolve(args.positionals[1] ?? id);
    if (existsSync(dir)) throw new CliError(`${dir} already exists.`);
    await pullCopy(out, info, dir);
    out.result(
      { ...info, dir },
      () =>
        `Pulled ${info.title} into ${relative(process.cwd(), dir) || '.'}.\nRead AGENTS.md there first. Preview: ${info.url}`,
    );
    return;
  }
  const found = findCopy();
  if (!found) throw new CliError('Not in a deck. `tobos pull <id>` makes a copy of one.');
  const base = found.base ?? (await baseOfClone(found.root));
  const pulled = await pullInto(found.root, base.deck, base.server, base, {
    note,
    clone: !found.base,
  });
  await writeFormatGuide(found.root, base.server);
  out.result({ id: base.deck, ...pulled }, () =>
    [
      `In step with the server (${pulled.rev?.slice(0, 7) ?? 'no version yet'}): ${plural(pulled.changed.length, 'file')} changed.`,
      pulled.conflicts.length
        ? `${plural(pulled.conflicts.length, 'conflict')}, between <<<<<<< and >>>>>>> in each: resolve them, then push.\n${pulled.conflicts.join('\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );
  if (pulled.conflicts.length) process.exitCode = EXIT.conflict;
}

/** A new working copy of a deck in `dir`, with the format guide. */
async function pullCopy(out: Output, info: DeckInfo, dir: string) {
  const { server } = settings();
  out.note(`pulling ${info.title} into ${dir}`);
  await pullInto(dir, info.id, server, undefined, { note: (m) => out.note(m) });
  await writeFormatGuide(dir, server);
}

/**
 * A new deck, its master copied from a template (the account's default unless `--from` names one),
 * or with `--template` a new template: a copy of all of the one it starts from. Then pulled into
 * a folder of its own, unless `--no-pull`.
 */
export async function create(out: Output, args: Args) {
  const title = args.positionals.join(' ').trim();
  if (!title) throw new CliError('What is it called? `tobos new "My talk"`.');
  // A folder given is checked first: a deck made and then refused here would be made again.
  if (
    !args.values['no-pull'] &&
    typeof args.values.dir === 'string' &&
    existsSync(resolve(args.values.dir))
  )
    throw new CliError(`${resolve(args.values.dir)} already exists.`);
  const info = await api<DeckInfo>('/api/decks', {
    body: {
      title,
      from: args.values.from,
      template: Boolean(args.values.template),
    },
  });
  let dir: string | undefined;
  if (!args.values['no-pull']) {
    dir = resolve((args.values.dir as string) ?? info.id);
    if (existsSync(dir)) throw new CliError(`${dir} already exists.`);
    await pullCopy(out, info, dir);
  }
  out.result({ ...info, dir: dir ?? null }, () =>
    [
      `Created ${info.title}: ${info.url}`,
      dir ? `Pulled into ${relative(process.cwd(), dir) || '.'}. Read AGENTS.md there first.` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );
}

// ─── Check and push ─────────────────────────────────────────────────────────

function problemSummary(problems: Problem[]) {
  const errors = problems.filter((p) => p.severity === 'error').length;
  return { errors, warnings: problems.length - errors };
}

/** The deck's media files that every viewer would download more of than they need, noted. */
function noteSizes(out: Output, root: string, paths: string[]) {
  for (const path of paths.filter((p) => p.startsWith('media/'))) {
    const file = join(root, ...path.split('/'));
    if (!existsSync(file)) continue;
    const note = sizeNote(path.slice('media/'.length), statSync(file).size);
    if (note) out.note(note, true);
  }
}

/**
 * `tobos check`: what the server's check says of the working copy's changes, written dry (ADR
 * 0005): nothing lands. With `--types`, TypeScript's too, here.
 */
export async function check(out: Output, args: Args) {
  const copy = requireCopy(args.positionals[0]);
  const started = performance.now();
  // Nothing changed: the version pulled passed the check when it landed, so there is nothing to ask.
  const unchanged = changesOf(copy).length === 0;
  const written = unchanged
    ? { problems: [] }
    : await writeCopy(copy, 'Checked', { dry: true, note: (m) => out.note(m) }).catch(
        (error: unknown) => {
          // The check's errors are its answer, not a failure of the command.
          if (error instanceof CliError && error.exit === EXIT.problems)
            return { problems: (error.extra.problems ?? []) as Problem[], refused: true };
          throw error;
        },
      );
  const problems = [...(written.problems as Problem[])];
  if (args.values.types) {
    const { checkTypes } = await import('./types.ts');
    problems.push(...(await checkTypes(copy.root, (m) => out.note(m))));
  }
  const { errors, warnings } = problemSummary(problems);
  const ms = Math.round(performance.now() - started);
  out.result({ ok: errors === 0, changed: !unchanged, errors, warnings, problems, ms }, () =>
    [
      unchanged
        ? 'Nothing changed in the copy: the version it is of passed the check when it landed.'
        : '',
      formatProblems(problems),
      errors === 0
        ? unchanged
          ? ''
          : `✓ The check takes it${warnings ? `, with ${plural(warnings, 'warning')}` : ''} (${ms} ms)`
        : `✗ ${plural(errors, 'error')}${warnings ? `, ${plural(warnings, 'warning')}` : ''}`,
    ]
      .filter(Boolean)
      .join('\n'),
  );
  if (errors > 0) process.exitCode = EXIT.problems;
}

/**
 * The working copy's changes written as one version, which the server checks and every open
 * preview follows; then the copy takes that version, with whatever else it merged in.
 */
async function pushCopy(out: Output, copy: Copy, message?: string) {
  const changes = changesOf(copy);
  if (changes.length === 0) return { pushed: false as const, rev: copy.base.rev, uploaded: [] };
  noteSizes(
    out,
    copy.root,
    changes.filter((c) => c.hash).map((c) => c.path),
  );
  for (const { path, hash } of changes) out.note(`  ${hash ? '' : 'deleted '}${path}`);
  out.note('pushing…');
  const written = await writeCopy(copy, message || 'Update the deck', { note: (m) => out.note(m) });
  // The version it made, others' merged changes in it: on what was just sent as the base, so the
  // files it sent are the server's now, and nothing is merged twice.
  try {
    await pullInto(
      copy.root,
      copy.base.deck,
      copy.base.server,
      { ...copy.base, files: Object.fromEntries(copyFiles(copy.root)) },
      { note: (m) => out.note(m) },
    );
  } catch (error) {
    out.note(
      `Pushed, but the copy couldn't take the version it made: run \`tobos pull\`. (${(error as Error).message})`,
      true,
    );
  }
  return {
    pushed: true as const,
    rev: written.rev,
    uploaded: written.uploaded,
    problems: written.problems,
  };
}

export async function push(out: Output, args: Args) {
  const copy = requireCopy();
  const result = await pushCopy(out, copy, args.values.message as string | undefined);
  const url = `${copy.base.server}/${copy.base.deck}`;
  out.result({ ...result, url }, () =>
    result.pushed
      ? `✓ Pushed ${result.rev?.slice(0, 7)}${result.uploaded.length ? ` with ${plural(result.uploaded.length, 'media file')}` : ''}. Live at ${url}`
      : `Nothing to push: the copy is as the server has it. Live at ${url}`,
  );
}

/**
 * Before showing a deck from its own working copy, push what changed: what you render or open
 * is always what's pushed, and what everyone with the deck open sees.
 */
async function pushIfChanged(out: Output, id: string, message?: string) {
  const found = findCopy();
  if (!found?.base || found.base.deck !== id) return { pushed: false, uploaded: [] as string[] };
  const { pushed, uploaded } = await pushCopy(out, found as Copy, message);
  return { pushed, uploaded };
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
  return requireCopy().base.deck;
}

/**
 * `tobos open`: the deck's page, at a scene and beat if given, what changed pushed first. With
 * `--presenter`, a presenter's link. Outside a deck, a login for a browser.
 */
export async function open(out: Output, args: Args) {
  const position = args.positionals[0];
  if (!position && typeof args.values.deck !== 'string' && !findCopy()?.base) return openApp(out);
  const id = await deckId(args);
  const { pushed } = await pushIfChanged(out, id);
  const url = args.values.presenter
    ? (await viewUrl(id, 'presenter', 12)).url
    : `${settings().server}/${id}`;
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

// ─── Exports and rendering ──────────────────────────────────────────────────

/**
 * Render what's pushed. From the deck's own working copy, what changed is pushed first, so
 * that is the working copy too.
 */
export async function render(out: Output, args: Args) {
  const { renderBeats } = await import('./render.ts');
  // With --deck, from anywhere: a working copy is needed only to say which deck.
  const copy = findCopy();
  const deck = copy?.base ? { id: copy.base.deck, root: copy.root } : undefined;
  const id = typeof args.values.deck === 'string' ? parseId(args.values.deck) : deck?.id;
  if (!id) throw new CliError('Run this inside a deck you pulled, or pass --deck <id>.');
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
