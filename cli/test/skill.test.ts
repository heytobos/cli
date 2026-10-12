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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newer } from '../src/api.ts';
import { install, refresh } from '../src/skill.ts';

const main = join(import.meta.dirname, '../src/main.ts');
const v1 = { 'SKILL.md': '---\nname: tobos-present\n---\none\n', 'old.md': 'gone in v2\n' };
const v2 = { 'SKILL.md': '---\nname: tobos-present\n---\ntwo\n', 'ref/format.md': 'new\n' };

let home: string;
let claude: string;
let agents: string;
const saved = { HOME: process.env.HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR };

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'tobos-skill-'));
  process.env.HOME = home;
  delete process.env.CLAUDE_CONFIG_DIR;
  claude = join(home, '.claude/skills/tobos-present');
  agents = join(home, '.agents/skills/tobos-present');
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved))
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
});

const read = (dir: string, file = 'SKILL.md') => readFileSync(join(dir, file), 'utf8');

describe('tobos skill', () => {
  it('installs into both folders, with the version it came from', () => {
    const run = spawnSync('node', [main, 'skill', 'install', '--json'], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config') },
    });
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({
      skill: 'tobos-present',
      targets: [
        { dir: claude, action: 'installed', harnesses: expect.arrayContaining(['Claude Code']) },
        { dir: agents, action: 'installed', harnesses: expect.arrayContaining(['Codex']) },
      ],
    });
    const source = join(import.meta.dirname, '../../agent-pack/skills/tobos-present/SKILL.md');
    for (const dir of [claude, agents]) {
      expect(read(dir)).toBe(readFileSync(source, 'utf8'));
      expect(read(dir, 'VERSION')).toBe('dev\n');
    }
  });

  it('follows CLAUDE_CONFIG_DIR', () => {
    process.env.CLAUDE_CONFIG_DIR = join(home, 'elsewhere');
    install({ files: v1, version: '0.1.0' });
    expect(read(join(home, 'elsewhere/skills/tobos-present'))).toBe(v1['SKILL.md']);
    expect(existsSync(claude)).toBe(false);
  });

  it('rewrites an older copy on refresh, files the new version dropped included', () => {
    expect(refresh({ files: v2, version: '0.2.0' })).toEqual([]);
    expect(existsSync(claude)).toBe(false);

    install({ files: v1, version: '0.1.0' });
    writeFileSync(join(claude, 'SKILL.md'), 'changed by hand\n');
    expect(refresh({ files: v2, version: '0.2.0' })).toEqual([]);
    for (const dir of [claude, agents]) {
      expect(read(dir)).toBe(v2['SKILL.md']);
      expect(read(dir, 'ref/format.md')).toBe('new\n');
      expect(read(dir, 'VERSION')).toBe('0.2.0\n');
      expect(existsSync(join(dir, 'old.md'))).toBe(false);
    }

    // An older CLI doesn't take a newer copy back.
    refresh({ files: v1, version: '0.1.0' });
    expect(read(claude)).toBe(v2['SKILL.md']);
  });

  it('rewrites a copy from before VERSION files, stamp and all', () => {
    mkdirSync(claude, { recursive: true });
    writeFileSync(join(claude, 'SKILL.md'), 'old\n');
    writeFileSync(join(claude, '.tobos.json'), '{"version":"0.1.0"}');
    refresh({ files: v2, version: '0.1.0' });
    expect(read(claude)).toBe(v2['SKILL.md']);
    expect(existsSync(join(claude, '.tobos.json'))).toBe(false);
  });

  it('reports a folder it may not write to, and writes the other', () => {
    mkdirSync(join(home, '.claude/skills'), { recursive: true });
    chmodSync(join(home, '.claude/skills'), 0o500);
    try {
      const [refused, written] = install({ files: v1, version: '0.1.0' });
      expect(refused).toMatchObject({ dir: claude, action: 'refused', reason: /EACCES/ });
      expect(written).toMatchObject({ dir: agents, action: 'installed' });
    } finally {
      chmodSync(join(home, '.claude/skills'), 0o700);
    }
  });

  it('compares plain versions only, so a dev CLI never counts as newer or older', () => {
    expect(newer('0.10.0', '0.9.1')).toBe(true);
    expect(newer('0.1.0', '0.1.0')).toBe(false);
    expect(newer('1.0.0', 'dev')).toBe(false);
    expect(newer('dev', '0.1.0')).toBe(false);
  });
});
