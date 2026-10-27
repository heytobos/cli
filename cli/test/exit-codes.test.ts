import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

Object.assign(process.env, {
  XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), 'tobos-exit-')),
  TOBOS_SERVER: 'http://127.0.0.1:9',
  TOBOS_TOKEN: 'tobos_secret',
});
const { typeProblems } = await import('../src/types.ts');
const { EXIT } = await import('../src/out.ts');

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
