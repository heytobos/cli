import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/** A server that says it lacks every file, and keeps what is uploaded to it. */
const uploads: string[] = [];
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/media/missing')
      return res.end(JSON.stringify({ missing: JSON.parse(body).hashes }));
    uploads.push(req.url!);
    res.end('{}');
  });
});
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
Object.assign(process.env, {
  XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), 'tobos-media-')),
  TOBOS_SERVER: origin,
  TOBOS_TOKEN: 'tobos_secret',
});
const { syncMediaJson, uploadMedia } = await import('../src/media.ts');
afterAll(() => server.close());

/** A media.json entry for a file the server has. */
const entry = { hash: 'f'.repeat(64), size: 18, type: 'image/png' };

/** A deck folder with media/a.png, and a secret file outside it. */
function deck() {
  const root = mkdtempSync(join(tmpdir(), 'tobos-media-deck-'));
  mkdirSync(join(root, 'media'));
  writeFileSync(join(root, 'media/a.png'), 'a picture');
  writeFileSync(join(root, 'secret.txt'), 'not for the server');
  return root;
}

describe("a deck's media", () => {
  it('leaves a link in media/ out of media.json: only files go', async () => {
    const root = deck();
    symlinkSync(join(root, 'secret.txt'), join(root, 'media/b.png'));
    const { media } = await syncMediaJson(root);
    expect(Object.keys(media)).toEqual(['a.png']);
  });

  it('refuses a name in media.json whose file has become a link since', async () => {
    const root = deck();
    await syncMediaJson(root);
    rmSync(join(root, 'media/a.png'));
    symlinkSync(join(root, 'secret.txt'), join(root, 'media/a.png'));
    await expect(syncMediaJson(root)).rejects.toThrow(
      'media/a.png is a link or a folder, not a file: media/ holds files only.',
    );
  });

  it('keeps a name in media.json whose folder is a file now, as one whose file is not here', async () => {
    const root = deck();
    writeFileSync(join(root, 'media.json'), JSON.stringify({ 'a.png/b.png': entry }));
    expect(Object.keys((await syncMediaJson(root)).media)).toEqual(['a.png', 'a.png/b.png']);
  });

  it('refuses a name in media.json that goes through a loop of links, or holds a NUL', async () => {
    const root = deck();
    symlinkSync(join(root, 'media/loop'), join(root, 'media/loop'));
    for (const [name, message] of [
      ['loop/x.png', 'media/loop/x.png is a link or a folder'],
      ['x\0.png', "which isn't a file in media/"],
    ] as const) {
      writeFileSync(join(root, 'media.json'), JSON.stringify({ [name]: entry }));
      await expect(syncMediaJson(root), name).rejects.toThrow(message);
    }
  });

  it('refuses a name in media.json whose file is a link to nothing', async () => {
    const root = deck();
    await syncMediaJson(root);
    rmSync(join(root, 'media/a.png'));
    symlinkSync(join(root, 'not-there.png'), join(root, 'media/a.png'));
    await expect(syncMediaJson(root)).rejects.toThrow('media/a.png is a link or a folder');
  });

  it.runIf(process.platform !== 'win32')(
    'keeps a backslash in a file name as it is, rather than as a folder',
    async () => {
      const root = deck();
      writeFileSync(join(root, 'media', '\\cover.png'), 'a picture');
      const { media } = await syncMediaJson(root);
      expect(Object.keys(media)).toEqual(['\\cover.png', 'a.png']);
      // Synced again, it is the same file, not a name that leaves media/.
      expect(Object.keys((await syncMediaJson(root)).media)).toEqual(['\\cover.png', 'a.png']);
    },
  );

  it('leaves out a media/ that is itself a link', async () => {
    const root = deck();
    const elsewhere = mkdtempSync(join(tmpdir(), 'tobos-media-elsewhere-'));
    writeFileSync(join(elsewhere, 'c.png'), 'not in the deck');
    rmSync(join(root, 'media'), { recursive: true });
    symlinkSync(elsewhere, join(root, 'media'));
    const { media } = await syncMediaJson(root);
    expect(media).toEqual({});
  });

  it('uploads no file that a media.json name puts outside media/, or that is a link', async () => {
    for (const [name, link] of [
      ['../secret.txt', 'none'],
      ['b.png', 'file'],
      ['sub/secret.txt', 'folder'],
      ['secret.txt', 'media'],
    ] as const) {
      const root = deck();
      if (link === 'file') symlinkSync(join(root, 'secret.txt'), join(root, 'media/b.png'));
      // A link on the way: a folder in media/, or media/ itself, that is the deck's own folder.
      if (link === 'folder') symlinkSync(root, join(root, 'media/sub'));
      if (link === 'media') {
        rmSync(join(root, 'media'), { recursive: true });
        symlinkSync(root, join(root, 'media'));
      }
      const media = { [name]: { hash: 'f'.repeat(64), size: 18, type: 'image/png' } };
      await expect(
        uploadMedia(root, media, origin, 'deck', () => {}),
        name,
      ).rejects.toThrow(/isn't a file in media\/|not a file/);
    }
    expect(uploads).toEqual([]);
  });

  it('uploads a file in media/ of a deck reached through a link', async () => {
    const root = deck();
    const via = join(mkdtempSync(join(tmpdir(), 'tobos-media-via-')), 'deck');
    symlinkSync(root, via);
    const { media } = await syncMediaJson(via);
    await uploadMedia(via, media, origin, 'deck', () => {});
    expect(uploads).toHaveLength(1);
    uploads.length = 0;
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
