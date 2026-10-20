import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

Object.assign(process.env, {
  XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), 'tobos-exit-')),
  TOBOS_SERVER: 'http://127.0.0.1:9',
  TOBOS_TOKEN: 'tobos_secret',
});
const { pushFailure } = await import('../src/commands.ts');
const { typeProblems } = await import('../src/types.ts');
const { EXIT } = await import('../src/out.ts');

describe('a push that failed', () => {
  it('says 2, problems in the deck, only when the server refused the deck', () => {
    expect(
      pushFailure('! [remote rejected] HEAD -> main (pre-receive hook declined)', [
        'tobos: rejected: 1 problem (run `tobos check` locally)',
        'scenes/title.svelte:3:1 error svelte/compile …',
      ]).exit,
    ).toBe(EXIT.problems);
  });

  it('says 5, for the person to decide, when the deck is archived', () => {
    const failure = pushFailure('! [remote rejected] HEAD -> main (pre-receive hook declined)', [
      'tobos: This deck is archived: it can still be viewed and cloned, but takes no changes.',
    ]);
    expect(failure).toMatchObject({ exit: EXIT.limit, archived: true });
    expect(failure.message).toMatch(/^This deck is archived/);
    expect(failure.message).toContain('This is for the person you work for to decide');
  });

  it('says 3 for a login the server would not take', () => {
    for (const output of [
      "fatal: Authentication failed for 'https://app.tobos.ai/git/x.git/'",
      "fatal: unable to access 'https://app.tobos.ai/git/x.git/': The requested URL returned error: 401",
    ]) {
      const failure = pushFailure(output, []);
      expect(failure.exit, output).toBe(EXIT.auth);
      expect(failure.message).toContain('tobos login');
    }
  });

  it('says 1, an error, for being behind, a server out of reach, or a refusal that is not the deck', () => {
    expect(pushFailure(' ! [rejected] HEAD -> main (fetch first)', []).message).toContain(
      'tobos pull',
    );
    const unreachable = pushFailure(
      "fatal: unable to access 'https://app.tobos.ai/git/x.git/': Could not resolve host: app.tobos.ai",
      [],
    );
    expect(unreachable.message).toContain("Couldn't reach the server");
    // Cut off once it had reached the server: perhaps pushed, perhaps not.
    const cutOff = pushFailure(
      'error: RPC failed; curl 28 Operation timed out after 300000 milliseconds\nfatal: the remote end hung up unexpectedly',
      [],
    );
    expect(cutOff.exit).toBe(EXIT.error);
    expect(cutOff.message).toContain('may have gone through');
    expect(cutOff.message).not.toContain('nothing was pushed');
    // A certificate the CLI won't trust: never sent.
    expect(
      pushFailure(
        "fatal: unable to access 'https://app.tobos.ai/git/x.git/': SSL certificate OpenSSL verify result: certificate has expired (10)",
        [],
      ).message,
    ).toContain('nothing was pushed');
    expect(pushFailure('error: 403', []).exit).toBe(EXIT.error);
    expect(pushFailure('The requested URL returned error: 403', []).message).toContain(
      'may not push',
    );
    expect(
      pushFailure('! [remote rejected] HEAD -> main (pre-receive hook declined)', [
        "tobos: main can't be rewritten, only added to: pull what's on the server, merge it, and push again.",
      ]).exit,
    ).toBe(EXIT.error);
    for (const failure of [
      unreachable,
      pushFailure(' ! [rejected] HEAD -> main (non-fast-forward)', []),
    ])
      expect(failure.exit).toBe(EXIT.error);
  });
});

describe('the type check', () => {
  const finished = '1792000000000 COMPLETED 12 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS';

  it('passes when svelte-check finished and found nothing', () => {
    expect(
      typeProblems({ code: 0, out: `1792000000000 START "/deck"\n${finished}` }, '/deck'),
    ).toEqual([]);
  });

  it("fails when svelte-check didn't finish, or failed without a problem to show for it", () => {
    for (const result of [
      { code: 1, out: 'Error: Cannot find module typescript' },
      { code: 0, out: '' },
      { code: 2, out: finished },
    ]) {
      const problems = typeProblems(result, '/deck');
      expect(problems, result.out).toMatchObject([
        { rule: 'types', severity: 'error', message: expect.stringContaining("didn't finish") },
      ]);
    }
  });
});
