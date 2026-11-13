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
  writeBase,
  writeCopy,
  type Base,
  type Copy,
} from './copy.ts';
import { sizeNote } from './media.ts';
import { openUrl } from './open-url.ts';
import { ASK_THE_PERSON, CliError, EXIT, type Output } from './out.ts';
import { writeFormatGuide } from './format.ts';
import { install, SKILL_NAME } from './skill.ts';

export interface Args {
  positionals: string[];
  values: Record<string, string | boolean | string[] | undefined>;
}

interface DeckInfo {
  id: string;
  title: string;
  /** What you may do with it: you own it, or it was shared with you to edit, present or view. */
  role?: 'owner' | 'editor' | 'presenter' | 'viewer';
  /** Whose it is; for one shared with you, on their plan. */
  owner?: string;
  /** View only, under the name servers from before give it. */
  archived?: boolean;
  /** Beyond the decks its owner's plan keeps editable: no pushes, until its owner chooses it. */
  viewOnly?: boolean;
  /** Made by `new` where the plan kept no more editable: the deck that is View only now. */
  madeViewOnly?: { id: string; title: string; note: string };
  /** The folder it is in, by its path from the root: of the person's own decks only. */
  folder?: string;
  rev: string | null;
  url: string;
  scenes: { id: string; beats: string[] }[];
  /** Its outline, which Tobos holds apart from its files (ADR 0006). */
  outline?: Outline;
}

/** A scene of the outline: its id, which is its file's name, its title, and whether it shows. */
type OutlineScene = { id: string; title: string; hidden?: true };

/**
 * A deck's outline, as the server gives it: `tobos outline` prints and changes it. A deck has no
 * chapters, its `scenes` then in order, or every scene in one of its `chapters`.
 */
interface Outline {
  version: number;
  title: string;
  chapters?: { id: string; title: string; scenes: OutlineScene[] }[];
  scenes?: OutlineScene[];
  /** The scene files it doesn't place. */
  unplaced: string[];
}

// ─── Account ────────────────────────────────────────────────────────────────

/** How long one `tobos login` waits for the person's answer, before it says to run it again. */
const LOGIN_WAIT_MS = 90_000;

/** What the server gives a device to connect with (RFC 8628). */
interface DeviceStart {
  device_code: string;
  user_code: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

/**
 * Connect this machine to the person's account (TOB-402, D1): they approve it in a browser, at the
 * address this prints, where they log in at /login with their address and the code mailed to it
 * (a first code signs them up). The first `tobos login` prints the address, and opens it where
 * this machine has a browser; then it, or the next `tobos login`, waits a while for their answer,
 * on the same code, so an agent whose commands time out keeps one address to give the person.
 * `--ref`: the visit to tobos.ai that brought them, from the line they copied there
 * (product/start.md), which the server joins to the account the login makes, if it makes one.
 */
export async function login(out: Output, args: Args) {
  const server = ((args.values.server as string) || settings().server).replace(/\/$/, '');
  const kept = settings().device;
  const ref = typeof args.values.ref === 'string' && args.values.ref ? args.values.ref : undefined;
  let device =
    kept && kept.server === server && Date.parse(kept.expires) > Date.now() ? kept : undefined;
  // A ref given only to the login that waits goes with its polls too.
  if (device && ref && device.ref !== ref) save({ device: (device = { ...device, ref }) });
  let opened = false;
  if (!device) {
    const started = await api<DeviceStart>('/oauth/device', {
      anonymous: true,
      server,
      body: { label: `the tobos CLI on ${hostname()}` },
    });
    device = {
      server,
      deviceCode: started.device_code,
      userCode: started.user_code,
      url: started.verification_uri_complete,
      interval: started.interval,
      expires: new Date(Date.now() + started.expires_in * 1000).toISOString(),
      ...(ref ? { ref } : {}),
    };
    save({ server, device });
    opened = await openUrl(device.url);
    if (!opened) {
      out.result(
        { waiting: true, url: device.url, code: device.userCode, next: 'tobos login' },
        () =>
          `Give the person this address, to open where they like, a phone too: they log in there and approve this machine (a first login signs them up, and accepts https://tobos.ai/terms).\n\n  ${device!.url}\n\nThe page shows the code ${device!.userCode}. Once they approved it, run \`tobos login\` again.`,
      );
      process.exitCode = EXIT.auth;
      return;
    }
    out.note(`Opened ${device.url} in the browser: approve the code ${device.userCode} there.`);
  }
  const token = await waitForApproval(device, (m) => out.note(m));
  if (!token) {
    out.result({ waiting: true, url: device.url, code: device.userCode, next: 'tobos login' }, () =>
      [
        `Not approved yet. The person approves this machine at\n\n  ${device!.url}`,
        `where the page shows the code ${device!.userCode}. Then run \`tobos login\` again.`,
      ].join('\n\n'),
    );
    process.exitCode = EXIT.auth;
    return;
  }
  save({ server, token, device: undefined });
  const me = await api<{ email: string }>('/api/me', { server });
  save({ email: me.email });
  out.result({ email: me.email, server }, () => `Logged in as ${me.email}.`);
}

/**
 * The grant for `device`, once the person approved it, asking as often as the server allows, for
 * LOGIN_WAIT_MS at most: undefined if they haven't answered by then. A CliError if they said no,
 * or the code expired, which starts over.
 */
async function waitForApproval(
  device: NonNullable<ReturnType<typeof settings>['device']>,
  note: (m: string) => void,
): Promise<string | undefined> {
  const until = Date.now() + LOGIN_WAIT_MS;
  let interval = device.interval * 1000;
  note(`waiting for the person to approve ${device.userCode}…`);
  while (Date.now() < until) {
    const response = await request('/oauth/token', {
      anonymous: true,
      server: device.server,
      body: {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: device.deviceCode,
        ...(device.ref ? { ref: device.ref } : {}),
      },
    });
    const answer = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      error?: string;
    };
    if (answer.access_token) return answer.access_token;
    if (answer.error === 'slow_down') interval += 5000;
    else if (answer.error === 'access_denied') {
      save({ device: undefined });
      throw new CliError('The person chose not to connect this machine.', EXIT.auth);
    } else if (answer.error === 'expired_token' || answer.error === 'invalid_grant') {
      save({ device: undefined });
      throw new CliError(
        'The code expired before the person approved it. Run `tobos login` again for a new one.',
        EXIT.auth,
      );
    } else if (answer.error !== 'authorization_pending')
      // Not the server's answer, a proxy's during a release say: the code may still be approved.
      throw new CliError(
        `${device.server} answered ${response.status} rather than whether the person approved. Run \`tobos login\` again: it waits on the same code.`,
      );
    await new Promise((done) => setTimeout(done, interval));
  }
  return undefined;
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

/** What `tobos ls` says of one besides its title: someone else's, View only. */
function aboutDeck(d: DeckInfo): string {
  const can = { editor: 'you edit', presenter: 'you present', viewer: 'you view' } as const;
  const notes = [
    d.role && d.role !== 'owner' && `${d.owner ?? 'someone else'}’s, ${can[d.role]}`,
    (d.viewOnly ?? d.archived) && 'view only: no pushes',
  ].filter(Boolean);
  return notes.length ? `  (${notes.join('; ')})` : '';
}

// ─── Folders ────────────────────────────────────────────────────────────────

/** A folder's path as a prefix of what is in it: none for the root. */
const inFolder = (path: string) => (path === '/' ? '' : `${path}/`);

/** What a folder holds: a folder, a deck, or a shortcut to a deck shared with the person. */
type Entry =
  | { kind: 'folder'; name: string; path: string }
  | { kind: 'deck'; id: string; title: string; shortcut?: true; owner?: string };

/**
 * The decks the person can work on, each in its folder, and those shared with
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
            .map((e) =>
              e.kind === 'folder'
                ? `${e.name}/`
                : `${e.id}  ${e.title}${e.shortcut ? `  (a shortcut: ${e.owner}'s deck)` : ''}`,
            )
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
 * deck by its id or its title, a folder by its path, which starts with `/`. With --name, the one
 * folder named is renamed where it is.
 */
export async function mv(out: Output, args: Args) {
  const name = args.values.name;
  if (typeof name === 'string') {
    const [folder, ...more] = args.positionals;
    if (!folder?.startsWith('/') || more.length)
      throw new CliError(
        '--name renames one folder where it is: `tobos mv </folder> --name <name>`, the folder by its path.',
      );
    const renamed = await api<{ to: string }>('/api/drive/move', {
      body: { folders: [folder], name },
    });
    out.result(renamed, () => `Renamed ${folder} to ${renamed.to}.`);
    return;
  }
  const named = args.positionals.slice(0, -1);
  const to = args.positionals.at(-1);
  if (!to || named.length === 0)
    throw new CliError(
      'What goes where? `tobos mv <deck or /folder>… <folder>`: decks by id or title, folders by path. `tobos mkdir </path>` makes an empty folder.',
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

/** An empty folder made, with the folders on its path that aren't there: `move` with nothing to move. */
export async function mkdir(out: Output, args: Args) {
  const [path, ...more] = args.positionals;
  if (!path || more.length)
    throw new CliError('Which folder? `tobos mkdir </path>`, such as /Courses/AI 101.');
  const made = await api<{ to: string }>('/api/drive/move', { body: { to: path } });
  out.result(made, () => `Made ${made.to}.`);
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
  const page = await pageChanges(out, found.root, base, pulled.rev);
  out.result({ id: base.deck, ...pulled, page }, () =>
    [
      `In step with the server (${pulled.rev?.slice(0, 7) ?? 'no version yet'}): ${plural(pulled.changed.length, 'file')} changed.`,
      saidPage(page),
      pulled.conflicts.length
        ? `${plural(pulled.conflicts.length, 'conflict')}, between <<<<<<< and >>>>>>> in each: resolve them, then push.\n${pulled.conflicts.join('\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );
  if (pulled.conflicts.length) process.exitCode = EXIT.conflict;
}

/**
 * What changed that the copy didn't make: a change to the outline, on the deck's page or by
 * another agent, or a version by the deck's page or by Tobos itself. Its message, and who made it.
 */
interface PageChange {
  message: string;
  author: string | null;
}

/**
 * What changed after the copy's base that it didn't make, up to `until` (the version the copy
 * took), oldest first: the versions made on the deck's page or by Tobos, and the changes to the
 * outline through other doors than this one's, since the outline's version the copy last heard
 * of, so the agent knows what moved, was hidden or renamed. That version is the copy's now. If the
 * server can't say now, a warning that names the version to ask about later, and none: the files
 * are what count.
 */
async function pageChanges(
  out: Output,
  root: string,
  base: Pick<Base, 'deck' | 'server' | 'rev' | 'outline'>,
  until: string | null = null,
): Promise<PageChange[]> {
  const { deck, server, rev: since } = base;
  if (!since) return [];
  const range = new URLSearchParams({
    since,
    ...(until ? { until } : {}),
    ...(base.outline === undefined ? {} : { outline: String(base.outline) }),
  });
  try {
    const answer = await api<
      DeckInfo & {
        pushes: { message: string | null; author: string | null; door: string | null }[];
        /** Missing from a server from before ADR 0006. */
        outlineChanges?: { message: string; author: string | null; door: string | null }[];
      }
    >(`/api/decks/${deck}?${range}`, { server });
    // The outline's version the copy has heard of now.
    if (answer.outline) keepOutlineVersion(root, answer.outline.version);
    return [
      ...answer.pushes
        .filter((p) => p.door === 'browser' || p.door === 'tobos')
        .map((p) => ({ message: p.message ?? 'Changed', author: p.author ?? p.door })),
      ...(answer.outlineChanges ?? []).map((c) => ({
        message: c.message,
        author: c.author ?? c.door,
      })),
    ];
  } catch (error) {
    out.note(
      `Couldn't ask what changed on the deck's page since ${since.slice(0, 7)}: its versions say. (${(error as Error).message})`,
      true,
    );
    return [];
  }
}

/** The outline's version a copy last heard of, into its base: what a later pull asks since. */
function keepOutlineVersion(root: string, version: number) {
  const found = findCopy(root);
  if (found?.base && found.root === root) writeBase(root, { ...found.base, outline: version });
}

/** Those changes, said: a scene renamed there keeps its slide's heading, the agent's to change. */
const saidPage = (changes: PageChange[]) =>
  changes.length
    ? [
        'Changed meanwhile, on the deck’s page or by Tobos (`tobos outline` shows the outline):',
        ...changes.map((c) => `  ${c.message}${c.author ? ` (${c.author})` : ''}`),
        // As the history says it (arrangedMessage): “Renamed “…” to …”, or after a “; ”.
        changes.some((c) => /(^|; )renamed “/i.test(c.message))
          ? "A scene renamed there keeps its slide's own heading: change that to match."
          : '',
      ]
        .filter(Boolean)
        .join('\n')
    : '';

/** A new working copy of a deck in `dir`, with the format guide. */
async function pullCopy(out: Output, info: DeckInfo, dir: string) {
  const { server } = settings();
  out.note(`pulling ${info.title} into ${dir}`);
  await pullInto(dir, info.id, server, undefined, { note: (m) => out.note(m) });
  if (info.outline) keepOutlineVersion(dir, info.outline.version);
  await writeFormatGuide(dir, server);
}

/**
 * A new deck, its design copied from another deck (Tobos standard unless `--from` names one): its
 * master, the master's media and the packages it imports. Then pulled into a folder of its own,
 * unless `--no-pull`.
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
    body: { title, from: args.values.from },
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
      // Made where the plan kept no more editable: which deck is View only now, for the person.
      info.madeViewOnly ? info.madeViewOnly.note : '',
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
  if (changes.length === 0)
    return { pushed: false as const, rev: copy.base.rev, uploaded: [], page: [] as PageChange[] };
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
    // What changed that the copy didn't make, on the page or by Tobos, since its version.
    page: await pageChanges(out, copy.root, copy.base, written.rev),
  };
}

export async function push(out: Output, args: Args) {
  const copy = requireCopy();
  const pushed = await pushCopy(out, copy, args.values.message as string | undefined);
  // Nothing to push, the page may still have changed since the copy's version: pull takes it.
  const result = pushed.pushed
    ? pushed
    : { ...pushed, page: await pageChanges(out, copy.root, copy.base) };
  const url = `${copy.base.server}/${copy.base.deck}`;
  out.result({ ...result, url }, () =>
    [
      result.pushed
        ? `✓ Pushed ${result.rev?.slice(0, 7)}${result.uploaded.length ? ` with ${plural(result.uploaded.length, 'media file')}` : ''}. Live at ${url}`
        : result.page.length
          ? `Nothing to push, but the deck changed since this copy's version: run \`tobos pull\`. Live at ${url}`
          : `Nothing to push: the copy has no changes of its own. Live at ${url}`,
      saidPage(result.page),
    ]
      .filter(Boolean)
      .join('\n'),
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

// ─── The outline ────────────────────────────────────────────────────────────

/** An operation on the outline, as `write` takes it (ADR 0006). */
type Op = Record<string, unknown> & { op: string };

/**
 * The outline as the person would read it: chapters, numbered scenes, and those not placed; a deck
 * with no chapters, its scenes alone.
 */
function saidOutline(outline: Outline): string {
  let n = 0;
  const all = outline.scenes ?? (outline.chapters ?? []).flatMap((c) => c.scenes);
  const width = Math.max(0, ...all.map((s) => s.id.length));
  const scene = (s: OutlineScene, indent: string) =>
    `${indent}${String(++n).padStart(3)}  ${s.id.padEnd(width)}  ${s.title}${s.hidden ? '  (hidden)' : ''}`;
  return [
    `${outline.title}  (outline version ${outline.version})`,
    ...(outline.scenes
      ? ['  No chapters', ...outline.scenes.map((s) => scene(s, '  '))]
      : (outline.chapters ?? []).flatMap((c) => [
          `  ${c.title}  [${c.id}]`,
          ...(c.scenes.length ? [] : ['    (no scenes)']),
          ...c.scenes.map((s) => scene(s, '    ')),
        ])),
    outline.unplaced.length
      ? `Not placed, so not shown (\`tobos outline place <scene>\`): ${outline.unplaced.join(', ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Where `--after`, `--before`, `--chapter` (with `--start`) say scenes go, if they say; `--start`
 * alone, a deck's start, in one with no chapters.
 */
function placeFrom(args: Args): Record<string, unknown> | undefined {
  const { after, before, chapter, start } = args.values;
  const given = [after, before, chapter].filter((v) => typeof v === 'string');
  if (given.length > 1)
    throw new CliError('Say where with one of --after <scene>, --before <scene>, --chapter <id>.');
  if (typeof after === 'string') return { after };
  if (typeof before === 'string') return { before };
  if (typeof chapter === 'string') return { chapter, at: start ? 'start' : 'end' };
  if (start) return { at: 'start' };
  return undefined;
}

/**
 * The operations `tobos outline <op> …` stands for. A scene placed or moved with nowhere said goes
 * at the end of the last chapter, as the outline is now, or of a deck with none; and a deck's first
 * chapter takes every scene (outline, below).
 */
function opsFrom(args: Args): Op[] {
  const [what, ...rest] = args.positionals;
  const need = (count: number, usage: string) => {
    if (rest.length < count) throw new CliError(`\`tobos outline ${usage}\`.`);
  };
  const title = typeof args.values.title === 'string' ? args.values.title : undefined;
  switch (what) {
    case 'place':
      need(
        1,
        'place <scene> [--after s | --before s | --chapter c [--start]] [--title "T"] [--hidden]',
      );
      // Several, each after the one before, from where the first goes.
      return rest.map((scene, i) => ({
        op: 'place',
        scene,
        ...(title && rest.length === 1 ? { title } : {}),
        ...(args.values.hidden ? { hidden: true } : {}),
        to: i === 0 ? placeFrom(args) : { after: rest[i - 1] },
      }));
    case 'move':
      need(1, 'move <scene>… (--after s | --before s | --chapter c [--start])');
      return [{ op: 'move', scenes: rest, to: placeFrom(args) }];
    case 'hide':
    case 'show':
      need(1, `${what} <scene>…`);
      return [{ op: 'hide', scenes: rest, hidden: what === 'hide' }];
    case 'rename':
      need(2, 'rename <scene> "Title"');
      return [{ op: 'rename', scene: rest[0], title: rest.slice(1).join(' ') }];
    case 'remove':
      need(1, 'remove <scene>…');
      return [{ op: 'remove', scenes: rest }];
    case 'title':
      need(1, 'title "The deck\'s title"');
      return [{ op: 'title', title: rest.join(' ') }];
    case 'chapter': {
      const [verb, id, ...words] = rest;
      const before = typeof args.values.before === 'string' ? args.values.before : null;
      if (verb === 'add' && id && words.length)
        return [{ op: 'addChapter', chapter: id, title: words.join(' '), before }];
      if (verb === 'rename' && id && words.length)
        return [{ op: 'renameChapter', chapter: id, title: words.join(' ') }];
      if (verb === 'move' && id) return [{ op: 'moveChapter', chapter: id, before }];
      if (verb === 'remove' && args.values.all && !id) return [{ op: 'removeChapters' }];
      if (verb === 'remove' && id) return [{ op: 'removeChapter', chapter: id }];
      throw new CliError(
        '`tobos outline chapter add <id> "Title" [--before c]`, `chapter rename <id> "Title"`, `chapter move <id> [--before c]` (last without), `chapter remove <id>` (an empty one), or `chapter remove --all` (every chapter, the scenes staying in order).',
      );
    }
    default:
      throw new CliError(
        `No \`tobos outline ${what}\`: place, move, hide, show, rename, remove, title or chapter. \`tobos help\` shows each.`,
      );
  }
}

/**
 * `tobos outline`: the deck's outline, which Tobos holds, not a file of the copy (ADR 0006): its
 * chapters and scenes in order, and the scene files it doesn't place. With an operation, it is
 * changed first, at once, with no build: `write` with `outline`, as every door changes it.
 */
export async function outline(out: Output, args: Args) {
  const id = await deckId(args);
  const server = findCopy()?.base?.server ?? settings().server;
  let read: Outline | undefined;
  const now = async () => (read ??= await api<Outline>(`/api/decks/${id}/outline`, { server }));
  if (args.positionals.length === 0) {
    const shown = await now();
    out.result({ ...shown }, () => saidOutline(shown));
    return;
  }
  const ops = opsFrom(args);
  for (const op of ops) {
    // A deck with no chapters takes its first only with every scene in it.
    if (op.op === 'addChapter' && !(await now()).chapters?.length) {
      if (op.before)
        throw new CliError('This deck has no chapters: its first goes without --before.');
      op.scenes = 'all';
    }
    if (!('to' in op) || op.to !== undefined) continue;
    const last = (await now()).chapters?.at(-1);
    op.to = last ? { chapter: last.id, at: 'end' } : { at: 'end' };
  }
  const written = await api<{ outline: Omit<Outline, 'unplaced'> }>(`/api/decks/${id}/files`, {
    server,
    body: { outline: ops },
  }).catch((error: unknown) => {
    // What it names is gone, the outline having changed meanwhile: a conflict, to read again.
    if (error instanceof CliError && error.extra.status === 409)
      throw new CliError(error.message, EXIT.conflict, error.extra);
    throw error;
  });
  const after = await api<Outline>(`/api/decks/${id}/outline`, { server });
  // Its own change isn't news to the copy's next pull: the version it made is heard of, if it
  // followed the one the copy had heard of last, so no other change comes between unsaid.
  const copy = findCopy();
  if (copy?.base?.deck === id && copy.base.outline === written.outline.version - 1)
    keepOutlineVersion(copy.root, written.outline.version);
  out.result({ ...after }, () => saidOutline(after));
}

// ─── Viewing ────────────────────────────────────────────────────────────────

/**
 * What `tobos render` draws from: a renderer's link to the deck's latest push, the only link the
 * API makes (TOB-404), its revision and its scenes.
 */
async function renderView(id: string) {
  return api<{
    url: string;
    rev: string | null;
    scenes: DeckInfo['scenes'];
  }>(`/api/decks/${id}/view`, { body: { view: 'render' } });
}

/** The deck a command is about: `--deck <id>`, or the working copy's. */
async function deckId(args: Args): Promise<string> {
  if (typeof args.values.deck === 'string') return parseId(args.values.deck);
  return requireCopy().base.deck;
}

/**
 * `tobos open`: the deck's page, at a scene and beat if given, what changed pushed first: where
 * the person presents it. Outside a deck, their decks.
 */
export async function open(out: Output, args: Args) {
  const position = args.positionals[0];
  if (!position && typeof args.values.deck !== 'string' && !findCopy()?.base) return openApp(out);
  const id = await deckId(args);
  const { pushed } = await pushIfChanged(out, id);
  const url = `${settings().server}/${id}`;
  const full = position ? `${url}#${position}` : url;
  const opened = !args.values.print && (await openUrl(full));
  out.result({ url: full, opened, pushed }, () => full);
}

/** Outside a deck: the person's decks, in Tobos, where they log in at /login if they aren't. */
async function openApp(out: Output) {
  const url = `${settings().server}/`;
  const opened = await openUrl(url);
  out.result({ url, opened }, () => url);
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
  const view = await renderView(id);
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
    if (!scene)
      throw new CliError(
        `No scene "${sceneId}" in the outline: \`tobos outline\` shows it, and places a scene.`,
      );
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
  const next = 'New conversations in the harness load the skill.';
  out.result({ skill: SKILL_NAME, version: VERSION, targets, next }, () =>
    [
      `The ${SKILL_NAME} skill (${VERSION}):`,
      ...targets.map((t) => `  ${t.dir}  (${t.harnesses.join(', ')})`),
      next,
    ].join('\n'),
  );
}
