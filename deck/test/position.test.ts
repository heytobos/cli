import { describe, expect, it } from 'vitest';
import { formatProblems, type Problem } from '../src/index.ts';
import { position } from '../src/tree.ts';

/** Line and column by counting, character by character: what position() must agree with. */
function counted(text: string, offset: number) {
  let line = 1;
  let last = -1;
  for (let i = 0; i < offset && i < text.length; i++)
    if (text[i] === '\n') {
      line++;
      last = i;
    }
  return { line, column: offset - last };
}

describe('position', () => {
  it('agrees with counting lines, at every offset and past the end', () => {
    for (const text of [
      '',
      'one line',
      'a\nb\n\nc',
      '\nstarts with a newline\n',
      'crlf\r\nline\r\n',
    ])
      for (let offset = 0; offset <= text.length + 2; offset++)
        expect(position(text, offset), `${JSON.stringify(text)} at ${offset}`).toEqual(
          counted(text, offset),
        );
  });

  it('answers for one text, then another, then the first again', () => {
    expect(position('a\nb', 2)).toEqual({ line: 2, column: 1 });
    expect(position('xyz', 2)).toEqual({ line: 1, column: 3 });
    expect(position('a\nb', 2)).toEqual({ line: 2, column: 1 });
  });

  it('places a problem on every line of a long file without reading it again for each', () => {
    const text = 'url(//a)\n'.repeat(200_000);
    const started = performance.now();
    for (let offset = 0; offset < text.length; offset += 9) position(text, offset);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(position(text, text.length - 9)).toEqual({ line: 200_000, column: 1 });
  });
});

describe('formatProblems', () => {
  const problems: Problem[] = Array.from({ length: 5 }, (_, i) => ({
    file: 'lib/a.js',
    line: i + 1,
    column: 1,
    rule: 'network',
    message: 'From another site.',
    severity: 'error',
  }));

  it('lists every problem, one to a line', () => {
    expect(formatProblems(problems).split('\n')).toHaveLength(5);
    expect(formatProblems(problems)).toContain('lib/a.js:5:1 error network: From another site.');
  });

  it('lists the first few and says how many more there are', () => {
    expect(formatProblems(problems, 2).split('\n')).toEqual([
      'lib/a.js:1:1 error network: From another site.',
      'lib/a.js:2:1 error network: From another site.',
      '… and 3 more: `tobos check` lists them all.',
    ]);
    expect(formatProblems(problems, 5)).not.toContain('more');
  });
});
