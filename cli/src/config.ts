import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_SERVER = 'https://app.tobos.ai';

interface Stored {
  server?: string;
  token?: string;
  email?: string;
  /** The address a login code went to, until `tobos login --code` uses it. */
  pending?: string;
}

const dir = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'tobos');
const file = join(dir, 'config.json');

function read(): Stored {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Stored;
  } catch {
    return {};
  }
}

export function save(update: Stored) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify({ ...read(), ...update }, null, 2) + '\n', { mode: 0o600 });
  chmodSync(file, 0o600);
}

export function forget() {
  const { server } = read();
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify({ server }, null, 2) + '\n', { mode: 0o600 });
}

/** TOBOS_SERVER and TOBOS_TOKEN win, so cloud sandboxes and CI need no config file. */
export function settings(): {
  server: string;
  token?: string;
  email?: string;
  pending?: string;
  configFile: string;
} {
  const stored = read();
  return {
    server: (process.env.TOBOS_SERVER || stored.server || DEFAULT_SERVER).replace(/\/$/, ''),
    token: process.env.TOBOS_TOKEN || stored.token,
    email: stored.email,
    pending: stored.pending,
    configFile: file,
  };
}
