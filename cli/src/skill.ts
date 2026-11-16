/**
 * The Tobos skills in the person's harnesses: `tobos-present` for decks, `tobos-mail` for
 * `tobos mail` (TOB-500). Between them, two user-level folders reach every harness that reads
 * SKILL.md: Claude Code reads only its own, Codex only the shared one. Copies, not symlinks, so
 * Windows needs no special rights.
 *
 * A skill's folder is the CLI's once it wrote it: each holds the skill and a VERSION file, and a
 * newer CLI replaces the whole folder, so a change to a skill reaches everyone who updates the CLI.
 * A folder of the same name that the CLI didn't write is someone's own skill, and stays as it is.
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

declare const TOBOS_SKILLS: Skills;

export const SKILL_NAMES = ['tobos-present', 'tobos-mail'];

export type Files = Record<string, string>;
/** Each skill's files, by its name. */
export type Skills = Record<string, Files>;

export interface Target {
  skill: string;
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

/** The agent pack's skills, from `root`, the agent pack's `skills/` folder. */
export function readSkills(root: string): Skills {
  return Object.fromEntries(SKILL_NAMES.map((name) => [name, readTree(join(root, name))]));
}

/** The skills this CLI carries: built in, or read from the agent pack when run from source. */
export function bundled(): Skills {
  if (typeof TOBOS_SKILLS !== 'undefined') return TOBOS_SKILLS;
  return readSkills(new URL('../../agent-pack/skills/', import.meta.url).pathname);
}

/** Where harnesses read skills, each folder with the harnesses that read it. */
function roots(): { dir: string; harnesses: string[] }[] {
  const home = homedir();
  return [
    {
      dir: join(process.env.CLAUDE_CONFIG_DIR || join(home, '.claude'), 'skills'),
      harnesses: ['Claude Code', 'OpenCode', 'Cursor', 'GitHub Copilot', 'Goose'],
    },
    {
      dir: join(home, '.agents', 'skills'),
      harnesses: ['Codex', 'OpenCode', 'Cursor', 'Gemini CLI', 'GitHub Copilot', 'Amp'],
    },
  ];
}

type Root = ReturnType<typeof roots>[number];

/** The folders of `skills` in `root`. */
const folders = (root: Root, skills: string[]): Target[] =>
  skills.map((skill) => ({ skill, dir: join(root.dir, skill), harnesses: root.harnesses }));

/**
 * Each skill's folder in each harness folder. Read per call, so HOME and CLAUDE_CONFIG_DIR are
 * honoured as they are now.
 */
const targets = (skills: string[] = SKILL_NAMES): Target[] =>
  roots().flatMap((root) => folders(root, skills));

/** A skill is in the folder. */
const present = (dir: string) => existsSync(join(dir, 'SKILL.md'));

/**
 * The CLI wrote the folder: every copy it ever wrote has VERSION beside it, or, before VERSION
 * files, the stamp .tobos.json.
 */
const ours = (dir: string) =>
  existsSync(join(dir, 'VERSION')) || existsSync(join(dir, '.tobos.json'));

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
  /** `kept`: a folder of the same name the CLI didn't write is there, and stays. */
  action: 'installed' | 'refused' | 'kept';
  /** Why a write failed, when it was refused. */
  reason?: string;
}

/** A sandbox that refuses the write (Codex's is read-only outside the working folder) is reported. */
function place(target: Target, files: Files, version: string): Report {
  if (existsSync(target.dir) && !ours(target.dir)) return { ...target, action: 'kept' };
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

export function install(options: { skills?: Skills; version?: string } = {}): Report[] {
  const skills = options.skills ?? bundled();
  return targets(Object.keys(skills)).map((t) =>
    place(t, skills[t.skill]!, options.version ?? VERSION),
  );
}

/**
 * Run before every command: in a harness folder where the person installed the skills, a copy
 * older than this CLI is replaced, and a skill this CLI carries and the folder lacks is added, so
 * the skills follow the CLI without anyone running install again. It never installs into a folder
 * that holds none of the CLI's skills, nor replaces a skill the CLI didn't write. A copy without
 * a VERSION file comes from a CLI that stamped it instead (.tobos.json), and counts as older. A
 * CLI that isn't a release (`dev`, run from source) adds nothing, as it replaces nothing. Returns
 * the folders it couldn't write to.
 */
export function refresh(options: { skills?: Skills; version?: string } = {}): Report[] {
  const version = options.version ?? VERSION;
  const names = options.skills ? Object.keys(options.skills) : SKILL_NAMES;
  const release = newer(version, '0.0.0');
  const due = (t: Target) =>
    present(t.dir) ? ours(t.dir) && newer(version, installed(t.dir)) : release;
  const stale = roots()
    .map((root) => folders(root, names))
    .filter((here) => here.some((t) => present(t.dir) && ours(t.dir)))
    .flat()
    .filter(due);
  if (stale.length === 0) return [];
  const skills = options.skills ?? bundled();
  return stale
    .map((t) => place(t, skills[t.skill]!, version))
    .filter((r) => r.action === 'refused');
}

function installed(dir: string): string {
  try {
    return readFileSync(join(dir, 'VERSION'), 'utf8').trim();
  } catch {
    return '0.0.0';
  }
}
