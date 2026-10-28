import { execFile, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { parseId } from '../src/copy.ts';

const main = join(import.meta.dirname, '../src/main.ts');
const config = mkdtempSync(join(tmpdir(), 'tobos-cli-'));

function run(args: string[], input?: string) {
  return spawnSync('node', [main, ...args], {
    encoding: 'utf8',
    input,
    env: {
      ...process.env,
      XDG_CONFIG_HOME: config,
      TOBOS_SERVER: 'http://127.0.0.1:9',
      TOBOS_TOKEN: '',
    },
  });
}

describe('tobos', () => {
  it("reads a deck's id", () => {
    const id = '4388700c-ca09-4818-880b-3d9c2d3de8af';
    expect(parseId(id)).toBe(id);
    expect(() => parseId('ada/first-deck')).toThrow('`tobos ls` lists them');
  });

  it('prints one JSON object for an error, with a stable exit code', () => {
    const result = run(['whoami', '--json']);
    expect(result.status).toBe(3);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: expect.stringContaining('tobos login'),
    });
  });

  it('rejects unknown commands and options', () => {
    expect(run(['frobnicate']).status).toBe(1);
    const bad = run(['push', '--frobnicate', '--json']);
    expect(bad.status).toBe(1);
    expect(JSON.parse(bad.stdout).error).toContain('tobos help');
  });

  it('says when the server names a newer CLI: once on stderr, or in the --json result', async () => {
    const server = createServer((_, response) => {
      response.writeHead(200, { 'content-type': 'application/json', 'tobos-latest-cli': '0.2.0' });
      response.end(JSON.stringify({ email: 'ada@example.com' }));
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    // A released CLI has its version built in; from source it is "dev", unless set like this.
    const whoami = (version: string | null, ...args: string[]) =>
      promisify(execFile)(
        'node',
        [
          ...(version
            ? ['--import', `data:text/javascript,globalThis.TOBOS_VERSION="${version}"`]
            : []),
          main,
          'whoami',
          ...args,
        ],
        {
          env: {
            ...process.env,
            // The skill refresh runs too: keep it away from this machine's harnesses.
            HOME: config,
            CLAUDE_CONFIG_DIR: '',
            XDG_CONFIG_HOME: config,
            TOBOS_SERVER: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
            TOBOS_TOKEN: 'tobos_test',
          },
        },
      );
    try {
      const [human, json, current, dev] = await Promise.all([
        whoami('0.1.0'),
        whoami('0.1.0', '--json'),
        whoami('0.2.0'),
        whoami(null),
      ]);
      const line = 'tobos 0.2.0 is out (you have 0.1.0): npm i -g @tobos/cli';
      expect(human.stderr).toBe(`${line}\n`);
      expect(json.stderr).toBe('');
      expect(JSON.parse(json.stdout)).toMatchObject({ email: 'ada@example.com', update: line });
      expect(current.stderr).toBe('');
      expect(dev.stderr).toBe('');
    } finally {
      server.close();
    }
  });

  it('logs in by a code the person approves: the address first, then, run again, the token, through a proxy’s error; another server forgets it', async () => {
    /** What the server is asked, and its answers to the agent's polls, in turn. */
    const asked: string[] = [];
    const polls = [
      [400, { error: 'authorization_pending' }],
      [502, 'Bad gateway'],
      [200, { access_token: 'tobos_granted', token_type: 'Bearer' }],
    ] as const;
    const server = createServer((request, response) => {
      asked.push(`${request.method} ${request.url} ${request.headers.authorization ?? ''}`.trim());
      response.setHeader('content-type', 'application/json');
      if (request.url === '/oauth/device')
        return response.end(
          JSON.stringify({
            device_code: 'tobos_device_x',
            user_code: 'BCDF-GHJK',
            verification_uri: `${origin}/connect`,
            verification_uri_complete: `${origin}/connect?code=BCDF-GHJK`,
            expires_in: 600,
            interval: 0,
          }),
        );
      if (request.url === '/oauth/token') {
        const [status, body] = polls[asked.filter((a) => a.includes('/oauth/token')).length - 1]!;
        response.statusCode = status;
        return response.end(typeof body === 'string' ? body : JSON.stringify(body));
      }
      response.end(JSON.stringify({ email: 'ada@example.com' }));
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const home = mkdtempSync(join(tmpdir(), 'tobos-cli-'));
    const login = (...args: string[]) =>
      new Promise<{ status: number; json: Record<string, unknown> }>((done) =>
        execFile(
          'node',
          [main, 'login', ...args, '--json'],
          {
            env: {
              ...process.env,
              XDG_CONFIG_HOME: home,
              TOBOS_SERVER: args.length ? '' : origin,
              TOBOS_TOKEN: '',
              TOBOS_NO_BROWSER: '1',
            },
          },
          (error, stdout) =>
            done({ status: error ? Number(error.code) : 0, json: JSON.parse(stdout) }),
        ),
      );
    const stored = () => JSON.parse(readFileSync(join(home, 'tobos/config.json'), 'utf8'));
    try {
      // No browser here: it prints the address for the person, and keeps the code.
      expect(await login()).toEqual({
        status: 3,
        json: {
          waiting: true,
          url: `${origin}/connect?code=BCDF-GHJK`,
          code: 'BCDF-GHJK',
          next: 'tobos login',
        },
      });
      expect(stored().device).toMatchObject({
        deviceCode: 'tobos_device_x',
        userCode: 'BCDF-GHJK',
      });
      // Run again, it waits on the same code. A proxy's error is no answer: the code stays.
      expect(await login()).toMatchObject({ status: 1, json: { ok: false } });
      expect(stored().device).toMatchObject({ deviceCode: 'tobos_device_x' });
      // And again: it saves the token once approved.
      expect(await login()).toEqual({
        status: 0,
        json: { email: 'ada@example.com', server: origin },
      });
      expect(asked.filter((a) => a.startsWith('POST /oauth/device'))).toHaveLength(1);
      expect(asked.at(-1)).toBe('GET /api/me Bearer tobos_granted');
      expect(stored()).toMatchObject({ token: 'tobos_granted', email: 'ada@example.com' });
      expect(stored()).not.toHaveProperty('device');
      // Logging in to another server forgets this one's token, so it can't go there.
      const other = origin.replace('127.0.0.1', 'localhost');
      expect((await login('--server', other)).status).toBe(3);
      expect(stored()).toMatchObject({ server: other });
      expect(stored()).not.toHaveProperty('token');
      expect(stored()).not.toHaveProperty('email');
    } finally {
      server.close();
    }
  });

  it("does without a config file it can't read when the environment names the server and token", () => {
    const broken = mkdtempSync(join(tmpdir(), 'tobos-cli-'));
    mkdirSync(join(broken, 'tobos', 'config.json'), { recursive: true });
    const env = { ...process.env, XDG_CONFIG_HOME: broken, TOBOS_SERVER: 'http://tobos.test' };
    // Without a token there, the file is needed: said in a line, not a stack.
    const whoami = spawnSync('node', [main, 'whoami', '--json'], {
      encoding: 'utf8',
      env: { ...env, TOBOS_TOKEN: '' },
    });
    expect(whoami.status).toBe(1);
    expect(JSON.parse(whoami.stdout).error).toMatch(/^Can't read .*config\.json \(EISDIR\)/);
  });

  it('reads a config.json that is JSON but no object as empty, and says so', () => {
    for (const text of ['null', '[]', '42']) {
      const odd = mkdtempSync(join(tmpdir(), 'tobos-cli-'));
      mkdirSync(join(odd, 'tobos'));
      writeFileSync(join(odd, 'tobos', 'config.json'), text);
      const whoami = spawnSync('node', [main, 'whoami', '--json'], {
        encoding: 'utf8',
        env: {
          ...process.env,
          XDG_CONFIG_HOME: odd,
          TOBOS_SERVER: 'http://127.0.0.1:9',
          TOBOS_TOKEN: '',
        },
      });
      expect(whoami.status, text).toBe(3);
      expect(whoami.stderr, text).toContain("isn't a JSON object");
    }
  });
});
