import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { packTar, unpackTar } from '../src/tar.ts';

describe('a deck as a .tar.gz', () => {
  const long = `scenes/${'a-very-long-folder-name/'.repeat(6)}scene.svelte`;
  const files = new Map<string, Uint8Array>([
    ['deck.json', Buffer.from('{"title":"Hi"}\n')],
    ['media/größe.png', new Uint8Array([0, 255, 1, 2])],
    ['empty.txt', new Uint8Array()],
    [long, Buffer.from('<p>deep</p>\n')],
  ]);

  it('comes back as it went, a long path and bytes too', async () => {
    const plain = (map: Map<string, Uint8Array>) => [...map].map(([path, b]) => [path, [...b]]);
    expect(plain(unpackTar(await packTar(files)))).toEqual(plain(files));
  });

  it('opens with tar, as a person opens it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tobos-tar-'));
    writeFileSync(join(dir, 'deck.tar.gz'), await packTar(files));
    execFileSync('tar', ['-xzf', 'deck.tar.gz'], { cwd: dir });
    expect(readFileSync(join(dir, long), 'utf8')).toBe('<p>deep</p>\n');
    expect([...readFileSync(join(dir, 'media/größe.png'))]).toEqual([0, 255, 1, 2]);
  });

  it('keeps a long path with a newline in it, read by its PAX record’s length', async () => {
    const odd = `scenes/${'x'.repeat(100)}\nnew-line.svelte`;
    const back = unpackTar(await packTar([[odd, Buffer.from('odd\n')]]));
    expect([...back.keys()]).toEqual([odd]);
  });
});
