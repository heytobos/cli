/**
 * A working copy of a deck (ADR 0005): every file in its folder but `.tobos/`, `.git/`,
 * `node_modules/`, `sources/` (the originals scripts read) and any `.DS_Store`, with the bytes of each file its media.json names in media/. `.tobos/base.json`
 * says which deck and server it is of, the version it is in step with, and each file's SHA-256
 * there. `pull` brings it into step with the deck's latest version, merging what both changed;
 * `push` writes what changed since its base as one change, then takes the version it made. No
 * git: the server keeps the versions.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  statSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { isUtf8 } from 'node:buffer';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { parseMediaJson } from '@tobos/deck/deck-json';
import { mediaTypeOf } from '@tobos/deck/media-type';
import type { MediaJson } from '@tobos/deck/types';
import { mergeText } from '@tobos/deck/merge';
import { unpackTar } from '@tobos/deck/tar';
import { api, request, failure } from './api.ts';
import { CliError, EXIT } from './out.ts';

/** What `.tobos/base.json` holds. */
export interface Base {
  deck: string;
  server: string;
  /** The version the copy is in step with: null for a deck with none yet. */
  rev: string | null;
  /** Each file's SHA-256 at that version, media's included, by path. */
  files: Record<string, string>;
}

/** A working copy: its folder, and its base. */
export interface Copy {
  root: string;
  base: Base;
}

const BASE = join('.tobos', 'base.json');
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** What is no file of the deck, at the copy's top. */
const NOT_THE_DECK = new Set(['.tobos', '.git', 'node_modules', 'sources']);

/** A deck's id, as the command line gives it. */
export function parseId(id: string): string {
  if (!ID.test(id)) throw new CliError(`"${id}" is not a deck's id; \`tobos ls\` lists them.`);
  return id;
}

/** The working copy this folder is in: the nearest folder with a base, or a clone from before. */
export function findCopy(start = process.cwd()): { root: string; base?: Base } | undefined {
  for (let dir = resolve(start); ; dir = dirname(dir)) {
    if (existsSync(join(dir, BASE)))
      return { root: dir, base: JSON.parse(readFileSync(join(dir, BASE), 'utf8')) as Base };
    if (existsSync(join(dir, '.git')) && existsSync(join(dir, 'deck.json'))) return { root: dir };
    if (dirname(dir) === dir) return undefined;
  }
}

/** The working copy this folder is in, which must be one. */
export function requireCopy(start?: string): Copy {
  const found = findCopy(start);
  if (!found)
    throw new CliError(
      'Not in a deck: no .tobos/base.json here or above. `tobos pull <id>` makes one.',
    );
  if (!found.base)
    throw new CliError(
      `${found.root} is a clone from before: run \`tobos pull\` there once, which makes it a working copy.`,
    );
  return found as Copy;
}

function writeBase(root: string, base: Base) {
  mkdirSync(join(root, '.tobos'), { recursive: true });
  writeFileSync(join(root, BASE), `${JSON.stringify(base, null, 2)}\n`);
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/**
 * Whether `path`, from the server, is one the copy holds: a path that stays inside its folder,
 * and none it leaves out (NOT_THE_DECK, `.DS_Store`). One that isn't, the copy neither writes nor
 * keeps in its base, so a push never deletes it on the server.
 */
function held(path: string): boolean {
  const parts = path.split('/');
  return (
    parts.every((part) => part !== '' && part !== '.' && part !== '..' && !part.includes('\\')) &&
    // Any case: a disk that ignores it would write `.TOBOS/` over the copy's own `.tobos/`.
    !NOT_THE_DECK.has(parts[0]!.toLowerCase()) &&
    !parts.includes('.DS_Store')
  );
}

/** Whether a link stands anywhere on the way to `path` in the copy: nothing is written there. */
function throughLink(root: string, path: string): boolean {
  let at = root;
  for (const part of path.split('/')) {
    at = join(at, part);
    try {
      if (lstatSync(at).isSymbolicLink()) return true;
    } catch {
      return false;
    }
  }
  return false;
}

/** Every file of the copy, by path with `/`, and its SHA-256. Links are none. */
export function copyFiles(root: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      const name = relative(root, path).split(sep).join('/');
      if ((dir === root && NOT_THE_DECK.has(entry.name)) || entry.name === '.DS_Store') continue;
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.set(name, sha256(readFileSync(path)));
    }
  };
  walk(root);
  return files;
}

/** A deck's files at its latest version, by path: the export's, and its media by hash. */
async function latest(deck: string, server: string) {
  const response = await request(`/api/decks/${deck}/export`, { server });
  if (!response.ok) throw failure(response, await response.json().catch(() => ({})));
  const rev = response.headers.get('tobos-rev');
  const files = unpackTar(new Uint8Array(await response.arrayBuffer()));
  const media = parseMediaJson(textOf(files.get('media.json'))).media;
  const hashes = new Map<string, string>([...files].map(([path, bytes]) => [path, sha256(bytes)]));
  for (const [name, entry] of Object.entries(media)) hashes.set(`media/${name}`, entry.hash);
  return { rev, files, media, hashes };
}

const textOf = (bytes: Uint8Array | undefined) =>
  bytes ? Buffer.from(bytes).toString('utf8') : '{}';

/** A media file's bytes, by its hash. */
async function mediaBytes(deck: string, server: string, hash: string): Promise<Uint8Array> {
  const response = await request(`/api/media/${hash}?deck=${deck}`, { server });
  if (!response.ok) throw failure(response, await response.json().catch(() => ({})));
  return new Uint8Array(await response.arrayBuffer());
}

/** What a pull did: the version, the files it changed, and those it left with conflicts. */
export interface Pulled {
  rev: string | null;
  changed: string[];
  conflicts: string[];
}

/**
 * Bring the copy at `root` into step with the deck's latest version: a file the copy didn't
 * change since its base is the server's; one both changed is merged, three ways, line by line,
 * and a conflict is left in it between git's markers; one only the copy changed stays. Where
 * there is nothing to mark, a file deleted here but changed there, or bytes both changed, the
 * server's is taken, and the copy's own kept in `.tobos/conflicts/`. Then the copy's base is that
 * version. A copy made now has no base: every file is the server's. A `clone` from before never
 * had its media, which are fetched. A file the server can't give now keeps the base it had, so a
 * push doesn't take it for the copy's own change, and a later pull tries again. Nothing is written
 * outside the copy, through a link in it, or where the copy leaves files out (held).
 */
export async function pullInto(
  root: string,
  deck: string,
  server: string,
  base: Base | undefined,
  { note, clone = false }: { note: (m: string) => void; clone?: boolean },
): Promise<Pulled> {
  const now = await latest(deck, server);
  const local = existsSync(root) ? copyFiles(root) : new Map<string, string>();
  // Maps, not objects: a file may be called __proto__, which an object would answer for.
  const was = new Map(Object.entries(base?.files ?? {}));
  const next = new Map([...now.hashes].filter(([path]) => held(path)));
  const changed: string[] = [];
  const conflicts: string[] = [];
  /** The bytes of a media file, once each hash; null if the server can't give it now. */
  const fetched = new Map<string, Uint8Array | null>();
  const bytesOf = async (path: string, hash: string) => {
    const file = now.files.get(path);
    if (file) return file;
    if (!fetched.has(hash))
      fetched.set(hash, await mediaBytes(deck, server, hash).catch(() => null));
    return fetched.get(hash)!;
  };
  const paths = new Set([...was.keys(), ...next.keys(), ...local.keys()]);
  for (const path of paths) {
    if (!held(path)) continue;
    const [b, s] = [was.get(path), next.get(path)];
    const l = local.get(path);
    if (s === l) continue;
    const file = join(root, ...path.split('/'));
    if (throughLink(root, path)) {
      note(`left ${path} as it is: a link in this copy leads to it`);
      if (b === undefined) next.delete(path);
      else next.set(path, b);
      continue;
    }
    // A clone from before never had its media: missing here, they come now.
    const fresh = !base || l === b || (clone && path.startsWith('media/') && l === undefined);
    // The copy's own change, on what the server still has: it stays, to push.
    if (!fresh && s === b) continue;
    if (fresh) {
      if (s === undefined) rmSync(file, { force: true });
      else {
        const bytes = await bytesOf(path, s);
        if (!bytes) {
          note(`couldn't fetch ${path}: the server may have lost it; a later pull tries again`);
          if (l === undefined || b === undefined) next.delete(path);
          else next.set(path, b);
          continue;
        }
        write(file, bytes);
      }
      changed.push(path);
      continue;
    }
    // Both changed it: text is merged; anything else takes the server's, the copy's kept aside.
    const ours = l === undefined ? undefined : readFileSync(file);
    const theirs = s === undefined ? undefined : await bytesOf(path, s);
    const older = b === undefined ? new Uint8Array() : await fileAt(deck, server, base!.rev, path);
    const texts = [older, ours, theirs].every((bytes) => bytes && isUtf8(bytes));
    const merged = texts ? mergeText(textOf(older), textOf(ours), textOf(theirs)) : undefined;
    if (merged !== undefined) write(file, Buffer.from(merged));
    else if (texts) {
      write(file, Buffer.from(marked(textOf(ours), textOf(theirs))));
      note(`conflict: ${path}, between <<<<<<< and >>>>>>>`);
      conflicts.push(path);
    } else {
      if (ours) write(join(root, '.tobos', 'conflicts', ...path.split('/')), ours);
      if (theirs) write(file, theirs);
      else if (s === undefined) rmSync(file, { force: true });
      else {
        // The server's can't be fetched now: the copy's stays, on the base it had.
        if (b === undefined) next.delete(path);
        else next.set(path, b);
        continue;
      }
      note(
        `conflict: ${path} changed on both sides; the server's is here now${ours ? `, yours in .tobos/conflicts/${path}` : ''}`,
      );
      conflicts.push(path);
    }
    changed.push(path);
  }
  writeBase(root, { deck, server, rev: now.rev, files: Object.fromEntries(next) });
  return { rev: now.rev, changed, conflicts };
}

/** A conflict as git leaves one: the copy's text, then the server's, between markers. */
function marked(ours: string, theirs: string): string {
  const end = (text: string) => (text.endsWith('\n') || text === '' ? text : `${text}\n`);
  return `<<<<<<< yours\n${end(ours)}=======\n${end(theirs)}>>>>>>> tobos\n`;
}

/** A file of the deck at a version, as it was. */
async function fileAt(deck: string, server: string, rev: string | null, path: string) {
  const response = await request(
    `/api/decks/${deck}/files/${path.split('/').map(encodeURIComponent).join('/')}${rev ? `?rev=${rev}` : ''}`,
    { server },
  );
  return response.ok ? new Uint8Array(await response.arrayBuffer()) : new Uint8Array();
}

function write(file: string, bytes: Uint8Array) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, bytes);
}

/**
 * A clone from before, made with git, as a working copy: its deck from its remote, and as its base
 * the last version both it and Tobos had, the merge-base of HEAD and origin/main, so what it
 * changed since, pushed or not, is its own. Its media, which git never had, are taken as
 * unchanged, and come with the pull.
 */
export async function baseOfClone(root: string): Promise<Base> {
  const run = (args: string[]) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  let remote: string;
  let rev: string;
  try {
    remote = run(['remote', 'get-url', 'origin']);
    rev = run(['merge-base', 'HEAD', 'origin/main']);
  } catch {
    throw new CliError(
      `${root} is a clone from before, and git can't say what it was cloned from. Pull the deck afresh: \`tobos pull <id> <folder>\`.`,
    );
  }
  const match = /^(https?:\/\/[^/]+)\/git\/([0-9a-f-]{36})\.git$/.exec(remote);
  if (!match) throw new CliError(`${root} is a clone of no Tobos deck (its remote is ${remote}).`);
  const [, server, deck] = match as unknown as [string, string, string];
  const { files } = await api<{ files: { path: string; hash: string }[] }>(
    `/api/decks/${deck}/files?rev=${rev}`,
    { server },
  );
  const hashes: Record<string, string> = Object.fromEntries(files.map((f) => [f.path, f.hash]));
  const json = files.some((f) => f.path === 'media.json')
    ? await fileAt(deck, server, rev, 'media.json')
    : undefined;
  const media: MediaJson = parseMediaJson(textOf(json)).media;
  for (const [name, entry] of Object.entries(media)) hashes[`media/${name}`] = entry.hash;
  return { deck, server, rev, files: hashes };
}

/** What a push sends: each file the copy changed since its base, and each it deleted. */
export function changesOf(copy: Copy): { path: string; hash: string | null }[] {
  const local = copyFiles(copy.root);
  const changes: { path: string; hash: string | null }[] = [];
  for (const [path, hash] of local)
    if (path !== 'media.json' && copy.base.files[path] !== hash) changes.push({ path, hash });
  for (const path of Object.keys(copy.base.files))
    if (path !== 'media.json' && !local.has(path)) changes.push({ path, hash: null });
  return changes;
}

/** A write's answer. */
export interface Written {
  rev: string;
  changed: boolean;
  problems: { severity: string; file?: string; message: string }[];
}

/**
 * The copy's changes written to the deck, as one version on its base (`dry`: checked, and a
 * version recorded that doesn't land). Media by their hash, each uploaded first if the server
 * asks for it. A CliError for what the server refuses, with its exit code.
 */
export async function writeCopy(
  copy: Copy,
  message: string,
  { dry = false, note }: { dry?: boolean; note: (m: string) => void },
): Promise<Written & { sent: string[]; uploaded: string[] }> {
  const { root, base } = copy;
  const changes = changesOf(copy);
  // No prototype: a file called __proto__ is a key here, not one.
  const files: Record<string, unknown> = Object.create(null);
  for (const { path, hash } of changes) {
    if (hash === null) files[path] = null;
    else if (path.startsWith('media/')) files[path] = { hash };
    else {
      const bytes = readFileSync(join(root, ...path.split('/')));
      files[path] = isUtf8(bytes)
        ? Buffer.from(bytes).toString('utf8')
        : { base64: Buffer.from(bytes).toString('base64') };
    }
  }
  const body = { base: base.rev, message, dry, files };
  const uploaded: string[] = [];
  for (let tries = 1; ; tries++) {
    const response = await request(`/api/decks/${base.deck}/files`, {
      method: 'POST',
      body,
      server: base.server,
    });
    const data = (await response.json().catch(() => ({}))) as Written & {
      error?: string;
      hashes?: string[];
      elsewhere?: number;
    };
    if (response.ok) return { ...data, sent: changes.map((c) => c.path), uploaded };
    // Media to upload first: those it sends, and on another round those the server lost.
    if (data.error === 'media' && tries <= 3) {
      // Each by the file of the copy that has it: one this push sends, or one the server lost.
      const media = [...copyFiles(root)].filter(([path]) => path.startsWith('media/'));
      // What the version shows at most, each file once, but what the account's other decks
      // show already.
      const sizes = new Map(
        media.map(([path, hash]) => [hash, statSync(join(root, ...path.split('/'))).size]),
      );
      const total = [...sizes.values()].reduce((sum, size) => sum + size, 0);
      const shows = Math.max(0, total - (data.elsewhere ?? 0));
      for (const hash of data.hashes ?? []) {
        const path = media.find(([, h]) => h === hash)?.[0];
        if (!path)
          throw new CliError(
            `The server lacks a file of media/ (${hash}) that this copy doesn't have either: drop it on the deck's page again, or put it in media/ and push.`,
          );
        note(`uploading ${path}`);
        // So a file swapped for a larger one fits in one push.
        const put = await request(`/api/media/${hash}?deck=${base.deck}&shows=${shows}`, {
          method: 'PUT',
          body: readFileSync(join(root, ...path.split('/'))),
          // The type its name gives it, which the server keeps and serves it as.
          contentType: mediaTypeOf(path.slice('media/'.length)),
          server: base.server,
        });
        if (!put.ok)
          throw failure(put, await put.json().catch(() => ({})), `Uploading ${path} failed: `);
        uploaded.push(path);
      }
      continue;
    }
    if (data.error === 'conflict')
      throw new CliError(
        `${(data as { message?: string }).message ?? 'The deck changed meanwhile.'}\nRun \`tobos pull\`, which merges what changed, then push again.`,
        EXIT.conflict,
        { ...data, status: response.status },
      );
    if (data.error === 'problems')
      throw new CliError(
        (data as { message?: string }).message ?? 'The check refused it.',
        EXIT.problems,
        {
          problems: data.problems,
          status: response.status,
        },
      );
    throw failure(response, data);
  }
}
