import { describe, expect, it } from 'vitest';
import { analyzeScript, analyzeSvelte } from '../src/analyze.ts';

/** analyze.ts on its own: what it reads from one file, without a deck, a master or a build. */
const scene = (module: string, markup = '<p>hi</p>') =>
  analyzeSvelte('scenes/a.svelte', `<script module lang="ts">\n${module}\n</script>\n${markup}\n`, {
    scene: true,
  });
const messages = (analysis: { problems: { message: string }[] }) =>
  analysis.problems.map((p) => p.message);

describe('beats', () => {
  it('are read from a literal list, in order', () => {
    const { beats, problems } = scene("export const beats = [{ id: 'ask' }, { id: 'answer' }];");
    expect(problems).toEqual([]);
    expect(beats?.map((b) => b.id)).toEqual(['ask', 'answer']);
  });

  it('are refused when they would need running to read', () => {
    expect(
      messages(scene("const ids = ['a'];\nexport const beats = ids.map((id) => ({ id }));")),
    ).toEqual([
      '`beats` must be an array literal, so Tobos can read it without running the scene.',
    ]);
    expect(messages(scene("const a = 'a';\nexport const beats = [{ id: a }];"))).toEqual([
      "A beat's `id` must be a string literal.",
    ]);
    expect(messages(scene("export let beats = [{ id: 'a' }];"))).toEqual([
      '`beats` must be declared with const.',
    ]);
  });

  it('refuse IDs a position could mistake, and the same ID twice', () => {
    expect(
      messages(
        scene("export const beats = [{ id: 'Ask' }, { id: '2' }, { id: 'b' }, { id: 'b' }];"),
      ),
    ).toEqual([
      'Beat ID "Ask" must be lowercase letters, digits and dashes.',
      'Beat ID "2" can\'t be only digits: #scene/2 already means the third beat.',
      'Beat "b" is declared twice in this scene.',
    ]);
  });

  it('are asked of scenes only', () => {
    const lib = analyzeSvelte('lib/Pill.svelte', '<p>pill</p>', { scene: false });
    expect(lib.problems).toEqual([]);
    expect(lib.beats).toBeUndefined();
  });
});

describe('media()', () => {
  it('is read with its position, a template literal as a pattern', () => {
    const { media, problems } = analyzeScript(
      'lib/a.js',
      "import { media } from '@tobos/present';\nexport const cow = media('cow.jpg');\nexport const part = (p) => media(`cow/${p}.png`);",
    );
    expect(problems).toEqual([]);
    expect(media).toEqual([
      { name: 'cow.jpg', line: 2, column: 26 },
      { name: 'cow/*.png', pattern: true, line: 3, column: 34 },
    ]);
  });
});

describe('a file that is not JavaScript', () => {
  it('yields nothing to read rather than throwing', () => {
    expect(analyzeScript('lib/a.js', 'export const x = ;')).toMatchObject({ media: [] });
    expect(
      analyzeSvelte('scenes/a.svelte', '<script>let x = </script>', { scene: true }),
    ).toMatchObject({
      media: [],
    });
  });
});

describe('imports and exports', () => {
  it('are read by name, types left out', () => {
    const { takes, exports } = analyzeScript(
      'lib/a.ts',
      "import x, { a as b, 'c-d' as e } from './m.ts';\nimport * as all from './n.ts';\nexport { f } from './f.ts';\nexport * from './g.ts';\nexport const { h, i: [j] } = {};\nexport default 1;",
    );
    expect(takes?.map((t) => [t.specifier, t.names, t.line])).toEqual([
      ['./m.ts', ['default', 'a', 'c-d'], 1],
      ['./f.ts', ['f'], 3],
    ]);
    expect(exports).toEqual({
      names: ['f', 'h', 'j', 'default'],
      from: [['f', './f.ts', 'f']],
      all: ['./g.ts'],
    });
  });
});
