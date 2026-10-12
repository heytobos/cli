import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { findDeck } from '../src/deck-dir.ts';

const root = mkdtempSync(join(tmpdir(), 'tobos-cli-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('findDeck', () => {
  it('finds the deck a folder is in', async () => {
    const deck = join(root, 'talk');
    mkdirSync(join(deck, 'scenes'), { recursive: true });
    writeFileSync(join(deck, 'deck.json'), '{}');
    expect(await findDeck(join(deck, 'scenes'))).toEqual({ root: deck });
  });

  it('says so outside one', async () => {
    await expect(findDeck(tmpdir())).rejects.toThrow('Not in a deck');
  });
});
