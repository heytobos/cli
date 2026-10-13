import { execFile, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { parseId } from '../src/deck-dir.ts';

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
    expect(() => parseId('ada/first-deck')).toThrow('`tobos decks` lists them');
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

  it('answers git only for its own server', () => {
    const env = {
      ...process.env,
      XDG_CONFIG_HOME: config,
      TOBOS_SERVER: 'http://tobos.test',
      TOBOS_TOKEN: 'tobos_secret',
    };
    const ours = spawnSync('node', [main, 'credential', 'get'], {
      encoding: 'utf8',
      env,
      input: 'protocol=http\nhost=tobos.test\n\n',
    });
    expect(ours.stdout).toBe('username=tobos\npassword=tobos_secret\n');
    const theirs = spawnSync('node', [main, 'credential', 'get'], {
      encoding: 'utf8',
      env,
      input: 'protocol=https\nhost=github.com\n\n',
    });
    expect(theirs.stdout).toBe('');
  });

  it('checks a deck offline and reports problems with exit code 2', () => {
    // The sample deck, with Tobos standard's master copied in as `tobos new` would.
    const fixture = join(config, 'sample');
    const standard = join(import.meta.dirname, '../../templates/tobos');
    cpSync(join(import.meta.dirname, '../../deck/fixtures/sample'), fixture, { recursive: true });
    cpSync(join(standard, 'master'), join(fixture, 'master'), { recursive: true });
    const media = {
      ...JSON.parse(readFileSync(join(standard, 'media.json'), 'utf8')),
      ...JSON.parse(readFileSync(join(fixture, 'media.json'), 'utf8')),
    };
    writeFileSync(join(fixture, 'media.json'), JSON.stringify(media));
    const ok = spawnSync('node', [main, 'check', fixture, '--json'], {
      encoding: 'utf8',
      env: { ...process.env, XDG_CONFIG_HOME: config },
    });
    expect(ok.status).toBe(0);
    expect(JSON.parse(ok.stdout)).toMatchObject({ ok: true, scenes: 4, beats: 8 });
  });
});
