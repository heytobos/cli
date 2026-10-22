import { execFile, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
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

  it("does without a config file it can't read when the environment names the server and token", () => {
    const broken = mkdtempSync(join(tmpdir(), 'tobos-cli-'));
    mkdirSync(join(broken, 'tobos', 'config.json'), { recursive: true });
    const env = { ...process.env, XDG_CONFIG_HOME: broken, TOBOS_SERVER: 'http://tobos.test' };
    const helper = (token: string) =>
      spawnSync('node', [main, 'credential', 'get'], {
        encoding: 'utf8',
        env: { ...env, TOBOS_TOKEN: token },
        input: 'protocol=http\nhost=tobos.test\n\n',
      });
    expect(helper('tobos_secret').stdout).toBe('username=tobos\npassword=tobos_secret\n');
    // Without a token there, the file is needed: said in a line, not a stack.
    const refused = helper('');
    expect([refused.status, refused.stdout]).toEqual([0, '']);
    expect(refused.stderr).toMatch(/^tobos: Can't read .*config\.json \(EISDIR\)/);
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
    expect(JSON.parse(ok.stdout)).toMatchObject({ ok: true, scenes: 5, beats: 14 });

    // In git, it checks what a push would send: a broken file git ignores isn't, one it doesn't is.
    spawnSync('git', ['init', '-q'], { cwd: fixture });
    writeFileSync(join(fixture, 'lib/draft.ts'), "import x from './nope.ts';\nexport default x;\n");
    writeFileSync(join(fixture, '.gitignore'), 'lib/draft.ts\n');
    const check = () =>
      spawnSync('node', [main, 'check', fixture, '--json'], {
        encoding: 'utf8',
        env: { ...process.env, XDG_CONFIG_HOME: config },
      });
    expect(check().status).toBe(0);
    writeFileSync(join(fixture, '.gitignore'), '');
    const broken = check();
    expect(broken.status).toBe(2);
    expect(broken.stdout).toContain('lib/draft.ts');

    // A deck in a folder of another repository is no repository of its own: that one's ignores
    // aren't the deck's, so every file counts, as without git at all.
    const outer = join(config, 'outer');
    cpSync(fixture, join(outer, 'talks/q3'), {
      recursive: true,
      filter: (f) => !f.endsWith('.git'),
    });
    spawnSync('git', ['init', '-q'], { cwd: outer });
    writeFileSync(join(outer, '.gitignore'), 'talks/\nlib/\n');
    const nested = spawnSync('node', [main, 'check', join(outer, 'talks/q3'), '--json'], {
      encoding: 'utf8',
      env: { ...process.env, XDG_CONFIG_HOME: config },
    });
    expect(nested.status, nested.stdout).toBe(2);
    expect(nested.stdout).toContain('lib/draft.ts');
    expect(nested.stdout).not.toContain('deck.json is missing');

    // Without git, every file too: the draft git ignores is checked, rather than nothing at all.
    writeFileSync(join(fixture, '.gitignore'), 'lib/draft.ts\n');
    const bin = mkdtempSync(join(tmpdir(), 'tobos-no-git-'));
    symlinkSync(process.execPath, join(bin, 'node'));
    const noGit = spawnSync(join(bin, 'node'), [main, 'check', fixture, '--json'], {
      encoding: 'utf8',
      env: { PATH: bin, HOME: process.env.HOME, XDG_CONFIG_HOME: config },
    });
    expect(noGit.status, noGit.stdout).toBe(2);
    expect(noGit.stdout).toContain('lib/draft.ts');
  }, 30_000);
});
