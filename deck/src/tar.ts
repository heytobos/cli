/**
 * A deck's files as one `.tar.gz` (ADR 0005): the export a person downloads, and what `tobos pull`
 * reads. Plain ustar, with a PAX header for a path too long for ustar's fields, so every desktop
 * opens it; written and read here alone, so the server and the CLI agree.
 */
import { promisify } from 'node:util';
import { gunzipSync, gzip } from 'node:zlib';

const gzipped = promisify(gzip);

const BLOCK = 512;

/**
 * Files, by path, as one gzipped tar, in the order given, each readable by everyone: compressed
 * off the event loop, as a deck's files may be 100 MB.
 */
export async function packTar(
  files: Iterable<[string, Uint8Array]>,
  mtime = new Date(),
): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  const seconds = Math.floor(mtime.getTime() / 1000);
  for (const [path, bytes] of files) {
    const name = Buffer.from(path, 'utf8');
    if (name.length > 100) {
      // A PAX record of the whole path, "<length> path=<path>\n", its length counting itself.
      const body = Buffer.byteLength(`path=${path}\n`);
      let length = body + 2;
      while (String(length).length + 1 + body !== length) length = String(length).length + 1 + body;
      const record = Buffer.from(`${length} path=${path}\n`, 'utf8');
      parts.push(header('PaxHeader', record.length, seconds, 'x'), padded(record));
    }
    // A path too long for its field has the PAX record before it, which readers take instead.
    const short = name.length > 100 ? `long-${parts.length}` : path;
    parts.push(header(short, bytes.length, seconds, '0'), padded(bytes));
  }
  parts.push(new Uint8Array(BLOCK * 2));
  return gzipped(Buffer.concat(parts));
}

/** A gzipped tar's files, by path: regular files only, as packTar writes them. */
export function unpackTar(gzipped: Uint8Array): Map<string, Uint8Array> {
  const tar = gunzipSync(gzipped);
  const files = new Map<string, Uint8Array>();
  let longPath: string | undefined;
  for (let at = 0; at + BLOCK <= tar.length;) {
    const block = tar.subarray(at, at + BLOCK);
    if (block.every((b) => b === 0)) break;
    const field = (from: number, length: number) =>
      block
        .subarray(from, from + length)
        .toString('utf8')
        .replace(/\0.*$/s, '');
    const size = Number.parseInt(field(124, 12).trim() || '0', 8);
    const type = field(156, 1) || '0';
    const prefix = field(345, 155);
    const name = prefix ? `${prefix}/${field(0, 100)}` : field(0, 100);
    const body = tar.subarray(at + BLOCK, at + BLOCK + size);
    at += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
    if (type === 'x') {
      longPath = paxPath(body);
      continue;
    }
    if (type === '0' || type === '\0') files.set(longPath ?? name, new Uint8Array(body));
    longPath = undefined;
  }
  return files;
}

/**
 * The path a PAX header gives: its records read one by one by their lengths, which count bytes,
 * as a path may hold a newline.
 */
function paxPath(body: Uint8Array): string | undefined {
  const bytes = Buffer.from(body);
  let path: string | undefined;
  for (let at = 0; at < bytes.length;) {
    const space = bytes.indexOf(0x20, at);
    const length = Number(bytes.subarray(at, space).toString('ascii'));
    if (space < 0 || !Number.isInteger(length) || length <= space - at + 1) break;
    // `<length> key=value\n`: the value up to the record's last byte, its newline.
    const record = bytes.subarray(space + 1, at + length - 1).toString('utf8');
    if (record.startsWith('path=')) path = record.slice('path='.length);
    at += length;
  }
  return path;
}

/** A ustar header: the name, the size and the time, a file readable by everyone. */
function header(name: string, size: number, seconds: number, type: string): Uint8Array {
  const block = Buffer.alloc(BLOCK);
  block.write(name, 0, 100, 'utf8');
  block.write('0000644\0', 100, 'ascii');
  block.write('0000000\0', 108, 'ascii');
  block.write('0000000\0', 116, 'ascii');
  block.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 'ascii');
  block.write(`${seconds.toString(8).padStart(11, '0')}\0`, 136, 'ascii');
  block.write('        ', 148, 'ascii');
  block.write(type, 156, 'ascii');
  block.write('ustar\0', 257, 'ascii');
  block.write('00', 263, 'ascii');
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii');
  return block;
}

/** Bytes, padded with zeros to a whole number of blocks. */
function padded(bytes: Uint8Array): Uint8Array {
  const rest = bytes.length % BLOCK;
  return rest ? Buffer.concat([bytes, new Uint8Array(BLOCK - rest)]) : bytes;
}
