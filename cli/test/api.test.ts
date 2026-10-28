import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/** A server that keeps the Authorization header of every request it gets. */
const seen: (string | undefined)[] = [];
const server = createServer((req, res) => {
  seen.push(req.headers.authorization);
  res.setHeader('content-type', 'application/json');
  res.end('{}');
});
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
const port = (server.address() as AddressInfo).port;
const ours = `http://127.0.0.1:${port}`;

Object.assign(process.env, {
  XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), 'tobos-api-')),
  TOBOS_SERVER: ours,
  TOBOS_TOKEN: 'tobos_secret',
});
const { request } = await import('../src/api.ts');

afterAll(() => server.close());

describe("the CLI's token", () => {
  it('goes to the server it is logged in to', async () => {
    await request('/api/me', { server: ours });
    expect(seen.at(-1)).toBe('Bearer tobos_secret');
  });

  it("goes to no other, whatever a working copy's git remote names", async () => {
    const before = seen.length;
    // The same machine under another name is another origin all the same.
    await expect(
      request('/api/media/missing', { server: `http://localhost:${port}` }),
    ).rejects.toThrow('you are logged in to');
    expect(seen).toHaveLength(before);
  });

  it('is not needed for what goes without one, to any server', async () => {
    await request('/oauth/device', { server: `http://localhost:${port}`, anonymous: true });
    expect(seen.at(-1)).toBeUndefined();
  });
});
