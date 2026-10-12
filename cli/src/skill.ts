/**
 * The Tobos skill in the person's harnesses. Between them, two user-level folders reach every
 * harness that reads SKILL.md: Claude Code reads only its own, Codex only the shared one.
 * Copies, not symlinks, so Windows needs no special rights.
 *
 * The folders are the CLI's: each holds the skill and a VERSION file, and a newer CLI replaces
 * the whole folder, so a change to the skill reaches everyone who updates the CLI.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { newer, VERSION } from './api.ts';

declare const TOBOS_SKILL: Record<string, string>;

export const SKILL_NAME = 'tobos-present';

export type Files = Record<string, string>;

export interface Target {
  dir: string;
  harnesses: string[];
}

/** A folder's files, path → text, with / as separator. */
export function readTree(root: string): Files {
  const files: Files = {};
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true }))
    if (entry.isFile()) {
      const path = join(entry.parentPath, entry.name);
      files[
        path
          .slice(root.length)
          .replace(/^[\\/]/, '')
          .split('\\')
          .join('/')
      ] = readFileSync(path, 'utf8');
    }
  return files;
}

/** The skill this CLI carries: built in, or read from the agent pack when run from source. */
export function bundled(): Files {
  if (typeof TOBOS_SKILL !== 'undefined') return TOBOS_SKILL;
  return readTree(new URL(`../../agent-pack/skills/${SKILL_NAME}/`, import.meta.url).pathname);
}

/** Read per call, so HOME and CLAUDE_CONFIG_DIR are honoured as they are now. */
export function targets(): Target[] {
  const home = homedir();
  return [
    {
      dir: join(process.env.CLAUDE_CONFIG_DIR || join(home, '.claude'), 'skills', SKILL_NAME),
      harnesses: ['Claude Code', 'OpenCode', 'Cursor', 'GitHub Copilot', 'Goose'],
    },
    {
      dir: join(home, '.agents', 'skills', SKILL_NAME),
      harnesses: ['Codex', 'OpenCode', 'Cursor', 'Gemini CLI', 'GitHub Copilot', 'Amp'],
    },
  ];
}

/**
 * Replaces whatever is in the folder, so files an older version had and this one hasn't go too.
 * The new copy is written beside it first, so a write that fails halfway leaves the old one, and
 * under its own name, since two agents' CLIs may update the same skill at once: whichever swaps
 * in second finds the folder already replaced and drops its copy.
 */
function write(dir: string, files: Files, version: string) {
  const next = `${dir}.next-${process.pid}`;
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(next, path)), { recursive: true });
    writeFileSync(join(next, path), text);
  }
  writeFileSync(join(next, 'VERSION'), `${version}\n`);
  rmSync(dir, { recursive: true, force: true });
  try {
    renameSync(next, dir);
  } catch (error) {
    rmSync(next, { recursive: true, force: true });
    // Only another CLI's finished copy excuses a failed swap.
    if (!existsSync(join(dir, 'VERSION'))) throw error;
  }
}

const refusedCodes = new Set(['EACCES', 'EPERM', 'EROFS']);

export interface Report extends Target {
  action: 'installed' | 'refused';
  /** Why a write failed, when it was refused. */
  reason?: string;
}

/** A sandbox that refuses the write (Codex's is read-only outside the working folder) is reported. */
function place(target: Target, files: Files, version: string): Report {
  try {
    write(target.dir, files, version);
    return { ...target, action: 'installed' };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code && refusedCodes.has(code))
      return { ...target, action: 'refused', reason: (error as Error).message };
    throw error;
  }
}

export function install(options: { files?: Files; version?: string } = {}): Report[] {
  const files = options.files ?? bundled();
  return targets().map((t) => place(t, files, options.version ?? VERSION));
}

/**
 * Run before every command: an installed copy older than this CLI is replaced, so the skill
 * follows the CLI without anyone running install again. It never installs where there is no copy.
 * A copy without a VERSION file comes from a CLI that stamped it instead (.tobos.json), and counts
 * as older. Returns the folders it couldn't write to.
 */
export function refresh(options: { files?: Files; version?: string } = {}): Report[] {
  const version = options.version ?? VERSION;
  return targets()
    .filter((t) => existsSync(join(t.dir, 'SKILL.md')) && newer(version, installed(t.dir)))
    .map((t) => place(t, options.files ?? bundled(), version))
    .filter((r) => r.action === 'refused');
}

function installed(dir: string): string {
  try {
    return readFileSync(join(dir, 'VERSION'), 'utf8').trim();
  } catch {
    return '0.0.0';
  }
}
