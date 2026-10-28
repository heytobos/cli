import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CliError } from './out.ts';

const DEFAULT_SERVER = 'https://app.tobos.ai';

interface Stored {
  server?: string;
  token?: string;
  email?: string;
  /**
   * The code this machine connects with, until the person approves it (RFC 8628): what the next
   * `tobos login` waits on, rather than asking for another.
   */
  device?: {
    server: string;
    /** What the CLI polls with, which only it knows. */
    deviceCode: string;
    /** What the person checks on the page, ABCD-EFGH. */
    userCode: string;
    url: string;
    interval: number;
    expires: string;
  };
}

const dir = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'tobos');
const file = join(dir, 'config.json');

/**
 * What's stored: nothing before the first login; said, when the file isn't a JSON object; refused,
 * when it can't be read at all (a folder, another user's file).
 */
function read(): Stored {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code === 'ENOENT') return {};
    throw new CliError(`Can't read ${file} (${code}): fix or remove it, then log in again.`);
  }
  let stored: unknown;
  try {
    stored = JSON.parse(text);
  } catch {
    // below
  }
  if (typeof stored === 'object' && stored !== null && !Array.isArray(stored)) return stored;
  process.stderr.write(`${file} isn't a JSON object: \`tobos login\` writes it afresh.\n`);
  return {};
}

/**
 * Written whole or not at all, readable only by this user from the start: to a file of its own,
 * which then takes the old one's place. A reader never sees half of it, or a token another user
 * could read.
 */
function write(stored: Stored) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const next = `${file}.${process.pid}`;
  writeFileSync(next, JSON.stringify(stored, null, 2) + '\n', { mode: 0o600 });
  renameSync(next, file);
}

/**
 * What's stored, with `update`. Another server forgets what logs in to this one: its token and
 * address go, and a code pending for it, unless the update brings its own.
 */
export function save(update: Stored) {
  const stored = read();
  const elsewhere = update.server !== undefined && update.server !== stored.server;
  const kept = elsewhere ? { server: stored.server } : stored;
  write({ ...kept, ...update });
}

export function forget() {
  write({ server: read().server });
}

/** TOBOS_SERVER and TOBOS_TOKEN win, so cloud sandboxes and CI need no config file. */
export function settings(): {
  server: string;
  token?: string;
  email?: string;
  device?: Stored['device'];
} {
  // With both in the environment, the file isn't needed, and one that can't be read doesn't matter.
  let stored: Stored = {};
  try {
    stored = read();
  } catch (error) {
    if (!process.env.TOBOS_SERVER || !process.env.TOBOS_TOKEN) throw error;
  }
  const server = (process.env.TOBOS_SERVER || stored.server || DEFAULT_SERVER).replace(/\/$/, '');
  // The file's token is the server's it was made by: TOBOS_SERVER naming another doesn't get it.
  const own = (stored.server || DEFAULT_SERVER).replace(/\/$/, '') === server;
  return {
    server,
    token: process.env.TOBOS_TOKEN || (own ? stored.token : undefined),
    email: own ? stored.email : undefined,
    device: stored.device,
  };
}
