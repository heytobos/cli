import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { copyFiles } from '../src/copy.ts';

describe('what a working copy holds', () => {
  it('is its files and media, not .tobos, .git, node_modules, nor any link', () => {
    const root = mkdtempSync(join(tmpdir(), 'tobos-copy-'));
    for (const dir of ['media', '.tobos', '.git', 'node_modules/x', 'scenes'])
      mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, 'deck.json'), '{}');
    writeFileSync(join(root, 'scenes/a.svelte'), '<p>a</p>');
    writeFileSync(join(root, 'media/a.png'), 'a picture');
    for (const dir of ['.tobos', '.git', 'node_modules/x'])
      writeFileSync(join(root, dir, 'f'), 'x');
    const secret = join(mkdtempSync(join(tmpdir(), 'tobos-secret-')), 'secret.txt');
    writeFileSync(secret, 'not for the server');
    symlinkSync(secret, join(root, 'media/linked.png'));
    symlinkSync(join(root, 'scenes'), join(root, 'linked-scenes'));
    expect([...copyFiles(root).keys()].sort()).toEqual([
      'deck.json',
      'media/a.png',
      'scenes/a.svelte',
    ]);
  });
});

describe('what push says about a large file', () => {
  it('gives lossless sound over 1 MB the line that makes it AAC, however large', async () => {
    const { sizeNote } = await import('../src/media.ts');
    expect(sizeNote('talk.wav', 900_000)).toBeUndefined();
    expect(sizeNote('talk.wav', 30_000_000)).toBe(
      'note: media/talk.wav is lossless sound, 30 MB. As AAC it takes a fraction of that, and sounds the same in a room: ffmpeg -i media/talk.wav -c:a aac -b:a 128k media/talk.m4a',
    );
    expect(sizeNote('clip.mp4', 30_000_000)).toBe(
      'note: media/clip.mp4 is 30 MB. Every viewer downloads it; size it for the stage.',
    );
    expect(sizeNote('song.m4a', 3_000_000)).toBeUndefined();
  });

  it('quotes a path the shell would split or read', async () => {
    const { sizeNote } = await import('../src/media.ts');
    expect(sizeNote("Bob's take 2.FLAC", 5_000_000)).toContain(
      "ffmpeg -i 'media/Bob'\\''s take 2.FLAC' -c:a aac -b:a 128k 'media/Bob'\\''s take 2.m4a'",
    );
  });
});
