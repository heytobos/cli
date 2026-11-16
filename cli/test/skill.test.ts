import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newer } from '../src/api.ts';
import { install, refresh } from '../src/skill.ts';

const main = join(import.meta.dirname, '../src/main.ts');
const pack = join(import.meta.dirname, '../../agent-pack/skills');
const v1 = {
  'tobos-present': { 'SKILL.md': '---\nname: tobos-present\n---\none\n', 'old.md': 'gone in v2\n' },
};
const v2 = {
  'tobos-present': { 'SKILL.md': '---\nname: tobos-present\n---\ntwo\n', 'ref/format.md': 'new\n' },
  'tobos-mail': { 'SKILL.md': '---\nname: tobos-mail\n---\ntwo\n' },
};
/** A skill of the person's own, which no CLI wrote. */
const theirs = '---\nname: tobos-mail\n---\ninvoices\n';

let home: string;
let claude: string;
let agents: string;
const saved = { HOME: process.env.HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR };

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'tobos-skill-'));
  process.env.HOME = home;
  delete process.env.CLAUDE_CONFIG_DIR;
  claude = join(home, '.claude/skills');
  agents = join(home, '.agents/skills');
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved))
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
});

const read = (dir: string, file = 'SKILL.md') => readFileSync(join(dir, file), 'utf8');

const installCli = () => {
  const run = spawnSync('node', [main, 'skill', 'install', '--json'], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config') },
  });
  expect(run.status).toBe(0);
  return JSON.parse(run.stdout);
};

describe('tobos skill', () => {
  it('installs both skills into both folders, with the version they came from', () => {
    expect(installCli()).toMatchObject({
      skills: ['tobos-present', 'tobos-mail'],
      targets: [
        { skill: 'tobos-present', dir: join(claude, 'tobos-present'), action: 'installed' },
        { skill: 'tobos-mail', dir: join(claude, 'tobos-mail'), action: 'installed' },
        { skill: 'tobos-present', dir: join(agents, 'tobos-present'), action: 'installed' },
        { skill: 'tobos-mail', dir: join(agents, 'tobos-mail'), action: 'installed' },
      ],
    });
    for (const skill of ['tobos-present', 'tobos-mail'])
      for (const dir of [join(claude, skill), join(agents, skill)]) {
        expect(read(dir)).toBe(readFileSync(join(pack, skill, 'SKILL.md'), 'utf8'));
        expect(read(dir, 'VERSION')).toBe('dev\n');
      }
  });

  it("leaves a skill of the person's own by the same name as it is, and says so", () => {
    mkdirSync(join(claude, 'tobos-mail'), { recursive: true });
    writeFileSync(join(claude, 'tobos-mail/SKILL.md'), theirs);
    const answer = installCli();
    expect(answer.targets).toContainEqual(
      expect.objectContaining({ dir: join(claude, 'tobos-mail'), action: 'kept' }),
    );
    expect(answer.next).toContain(join(claude, 'tobos-mail'));
    expect(read(join(claude, 'tobos-mail'))).toBe(theirs);
    expect(existsSync(join(claude, 'tobos-mail/VERSION'))).toBe(false);
    expect(existsSync(join(agents, 'tobos-mail/VERSION'))).toBe(true);

    // Nor does a newer CLI take it, while it updates the CLI's own beside it.
    install({ skills: v1, version: '0.1.0' });
    expect(refresh({ skills: v2, version: '0.2.0' })).toEqual([]);
    expect(read(join(claude, 'tobos-mail'))).toBe(theirs);
    expect(read(join(claude, 'tobos-present'))).toBe(v2['tobos-present']['SKILL.md']);
  });

  it("leaves a folder of the same name the CLI didn't write, with no skill in it, as it is", () => {
    mkdirSync(join(claude, 'tobos-mail'), { recursive: true });
    writeFileSync(join(claude, 'tobos-mail/notes.md'), 'mine\n');
    install({ skills: v2, version: '0.2.0' });
    expect(read(join(claude, 'tobos-mail'), 'notes.md')).toBe('mine\n');
    expect(existsSync(join(claude, 'tobos-mail/SKILL.md'))).toBe(false);
  });

  it('follows CLAUDE_CONFIG_DIR', () => {
    process.env.CLAUDE_CONFIG_DIR = join(home, 'elsewhere');
    install({ skills: v1, version: '0.1.0' });
    expect(read(join(home, 'elsewhere/skills/tobos-present'))).toBe(
      v1['tobos-present']['SKILL.md'],
    );
    expect(existsSync(claude)).toBe(false);
  });

  it('rewrites an older copy on refresh, files the new version dropped included, and adds a new skill', () => {
    expect(refresh({ skills: v2, version: '0.2.0' })).toEqual([]);
    expect(existsSync(claude)).toBe(false);

    install({ skills: v1, version: '0.1.0' });
    writeFileSync(join(claude, 'tobos-present/SKILL.md'), 'changed by hand\n');
    expect(refresh({ skills: v2, version: '0.2.0' })).toEqual([]);
    for (const root of [claude, agents]) {
      const dir = join(root, 'tobos-present');
      expect(read(dir)).toBe(v2['tobos-present']['SKILL.md']);
      expect(read(dir, 'ref/format.md')).toBe('new\n');
      expect(read(dir, 'VERSION')).toBe('0.2.0\n');
      expect(existsSync(join(dir, 'old.md'))).toBe(false);
      expect(read(join(root, 'tobos-mail'))).toBe(v2['tobos-mail']['SKILL.md']);
      expect(read(join(root, 'tobos-mail'), 'VERSION')).toBe('0.2.0\n');
    }

    // An older CLI doesn't take a newer copy back.
    refresh({ skills: v1, version: '0.1.0' });
    expect(read(join(claude, 'tobos-present'))).toBe(v2['tobos-present']['SKILL.md']);
  });

  it('adds a new skill only from a release, as it replaces only from one', () => {
    install({ skills: v1, version: '0.1.0' });
    refresh({ skills: v2, version: 'dev' });
    expect(existsSync(join(claude, 'tobos-mail'))).toBe(false);
    expect(read(join(claude, 'tobos-present'))).toBe(v1['tobos-present']['SKILL.md']);
  });

  it('rewrites a copy from before VERSION files, stamp and all', () => {
    const dir = join(claude, 'tobos-present');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), 'old\n');
    writeFileSync(join(dir, '.tobos.json'), '{"version":"0.1.0"}');
    refresh({ skills: v2, version: '0.1.0' });
    expect(read(dir)).toBe(v2['tobos-present']['SKILL.md']);
    expect(existsSync(join(dir, '.tobos.json'))).toBe(false);
  });

  it('reports a folder it may not write to, and writes the other', () => {
    mkdirSync(claude, { recursive: true });
    chmodSync(claude, 0o500);
    try {
      const [refused, written] = install({ skills: v1, version: '0.1.0' });
      expect(refused).toMatchObject({
        dir: join(claude, 'tobos-present'),
        action: 'refused',
        reason: /EACCES/,
      });
      expect(written).toMatchObject({ dir: join(agents, 'tobos-present'), action: 'installed' });
    } finally {
      chmodSync(claude, 0o700);
    }
  });

  it('compares plain versions only, so a dev CLI never counts as newer or older', () => {
    expect(newer('0.10.0', '0.9.1')).toBe(true);
    expect(newer('0.1.0', '0.1.0')).toBe(false);
    expect(newer('1.0.0', 'dev')).toBe(false);
    expect(newer('dev', '0.1.0')).toBe(false);
  });
});

describe('the skills', () => {
  /** `tobos --help`, run once: each run starts Node. */
  let help: string;
  beforeAll(() => {
    help = spawnSync('node', [main, '--help'], { encoding: 'utf8' }).stdout;
  });

  it('leave the commands to `tobos --help`, which names every one the CLI takes', () => {
    const cli = readFileSync(main, 'utf8');
    const table = cli.slice(
      cli.indexOf('const TABLE'),
      cli.indexOf('\n};', cli.indexOf('const TABLE')),
    );
    const commands = [...table.matchAll(/^  (\w+): \{/gm)].map((m) => m[1]!);
    expect(commands.length).toBeGreaterThan(10);
    expect(commands.filter((command) => !help.includes(`tobos ${command}`))).toEqual([]);
    expect(read(join(pack, 'tobos-present'))).toContain('`tobos --help` lists every command');
    expect(read(join(pack, 'tobos-mail'))).toContain('`tobos --help` lists its commands');
  });

  it('name only `tobos mail` commands the CLI has, as /start does', () => {
    // heytobos/cli, the public copy the CLI is published from, has no product/: there, and only
    // there, the skill alone is checked.
    const startFile = join(import.meta.dirname, '../../../product/start.md');
    const start = existsSync(startFile) ? readFileSync(startFile, 'utf8') : '';
    const named = [read(join(pack, 'tobos-mail')), start].flatMap((text) =>
      [...text.matchAll(/tobos mail (\w+)/g)].map((m) => m[1]!),
    );
    expect(named.length).toBeGreaterThan(1);
    expect(named.filter((command) => !help.includes(`tobos mail ${command}`))).toEqual([]);
  });

  it('have frontmatter a YAML parser reads: no ": " inside a value', () => {
    for (const skill of ['tobos-present', 'tobos-mail']) {
      const front = read(join(pack, skill)).split('---\n')[1]!;
      for (const line of front.trim().split('\n')) expect(line.split(': ')).toHaveLength(2);
    }
  });

  it('keep Mail out of tobos-present, and decks out of tobos-mail', () => {
    expect(read(join(pack, 'tobos-present'))).not.toMatch(/\bmail\b/i);
    expect(read(join(pack, 'tobos-mail'))).not.toMatch(/\bdeck/i);
  });
});
