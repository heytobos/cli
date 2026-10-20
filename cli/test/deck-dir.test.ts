import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { findDeck } from '../src/deck-dir.ts';
import { credentialHelper } from '../src/git.ts';

const root = mkdtempSync(join(tmpdir(), 'tobos-cli-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('findDeck', () => {
  it('finds the deck a folder is in', async () => {
    const deck = join(root, 'talk');
    mkdirSync(join(deck, 'scenes'), { recursive: true });
    writeFileSync(join(deck, 'deck.json'), '{}');
    expect(await findDeck(join(deck, 'scenes'))).toEqual({ root: deck });
  });

  it("points the deck's credential helper at this CLI as it runs now, once Node has moved", async () => {
    const server = 'http://127.0.0.1:9';
    const key = `credential.${server}.helper`;
    const linked = (name: string) => {
      const deck = join(root, name);
      mkdirSync(deck, { recursive: true });
      writeFileSync(join(deck, 'deck.json'), '{}');
      const run = (...args: string[]) => execFileSync('git', args, { cwd: deck, encoding: 'utf8' });
      run('init', '-q');
      run('remote', 'add', 'origin', `${server}/git/06b48295-7c5c-4e1f-90f5-a082d60941de.git`);
      return { deck, run };
    };
    // Cloned under a Node that's gone since.
    const moved = linked('moved');
    moved.run('config', '--add', key, '');
    moved.run('config', '--add', key, "!'/old/node' '/old/tobos.js' credential");
    expect(await findDeck(moved.deck)).toMatchObject({ server });
    expect(moved.run('config', '--get-all', key)).toBe(`\n${credentialHelper()}\n`);
    // A deck cloned with git alone gets none it didn't ask for, a helper set for everything or not.
    const plain = linked('plain');
    const home = mkdtempSync(join(tmpdir(), 'tobos-home-'));
    const global = join(home, '.gitconfig');
    writeFileSync(global, `[credential "${server}"]\n\thelper = store\n`);
    process.env.GIT_CONFIG_GLOBAL = global;
    try {
      await findDeck(plain.deck);
    } finally {
      delete process.env.GIT_CONFIG_GLOBAL;
    }
    expect(() => plain.run('config', '--local', '--get-all', key)).toThrow();
  });

  it('says so outside one', async () => {
    await expect(findDeck(tmpdir())).rejects.toThrow('Not in a deck');
  });
});
