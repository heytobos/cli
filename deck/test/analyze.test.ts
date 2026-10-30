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

describe('media', () => {
  it('is read from $media imports and globs, with where each is written', () => {
    const { media, problems } = analyzeScript(
      'lib/a.js',
      "import cow from '$media/cow.jpg';\nexport const parts = import.meta.glob(['$media/cow/*.png', '$media/ox/**/*.png']);\nexport { cow };",
    );
    expect(problems).toEqual([]);
    expect(media).toEqual([
      { name: 'cow.jpg', line: 1, column: 17 },
      { name: 'cow/*.png', pattern: true, line: 2, column: 40 },
      { name: 'ox/**/*.png', pattern: true, line: 2, column: 60 },
    ]);
  });

  it('is read in either script of a component, and its markup', () => {
    const { media, problems } = analyzeSvelte(
      'lib/A.svelte',
      "<script module>\n  import later from '$media/later.png';\n</script>\n<script lang=\"ts\">\n  import type Url from '$media/type.png';\n  import cow from '$media/cow.jpg';\n</script>\n{#each Object.values(import.meta.glob('$media/ear/*.png')) as ear}<img src={ear} alt=\"\" />{/each}\n<img src={cow} alt=\"\" />\n",
      { scene: false },
    );
    expect(problems).toEqual([]);
    expect(media.map((m) => [m.name, m.line])).toEqual([
      ['cow.jpg', 6],
      ['later.png', 2],
      ['ear/*.png', 8],
    ]);
  });

  it("refuses format 1's media(), each call with the line that replaces it", () => {
    const fixes = (file: string, source: string) =>
      (file.endsWith('.svelte')
        ? analyzeSvelte(file, source, { scene: false })
        : analyzeScript(file, source)
      ).problems.map((p) => [p.rule, p.line, p.message]);
    expect(
      fixes(
        'lib/A.svelte',
        '<script lang="ts">\n  import { media } from \'@tobos/present\';\n  let { part }: { part: string } = $props();\n</script>\n<img src={media(\'cow-close-up.jpg\')} alt="" />\n<img src={media(`frames/${part}.png`)} alt="" />\n<img src={media(part)} alt="" />\n',
      ),
    ).toEqual([
      [
        'media',
        5,
        "media('cow-close-up.jpg') is gone: import cowCloseUp from '$media/cow-close-up.jpg' at the top of the script, and write {cowCloseUp}.",
      ],
      [
        'media',
        6,
        "media(`frames/${part}.png`) is gone: const frames = import.meta.glob('$media/frames/*.png') at the top of the script gives each file's URL, so write {frames[`$media/frames/${part}.png`]}.",
      ],
      [
        'media',
        7,
        "media(part) is gone: import each file it shows at the top of the script, as `import cow from '$media/cow.jpg'`, or those a pattern matches, as `const frames = import.meta.glob('$media/frames/*.png')`.",
      ],
    ]);
    expect(
      fixes(
        'lib/a.ts',
        "import * as present from '@tobos/present';\nexport const cow = present.media('2024/cow.jpg');",
      ),
    ).toEqual([
      [
        'media',
        2,
        "present.media('2024/cow.jpg') is gone: import cow from '$media/2024/cow.jpg' at the top of the file, and write cow in its place.",
      ],
    ]);
    // Imported and never called: said at the import.
    expect(
      fixes(
        'lib/a.ts',
        "import { media } from '@tobos/present';\nexport const all = ['a'].map(media);",
      ),
    ).toEqual([
      [
        'media',
        1,
        "media() is gone: import each file it shows at the top of the file, `import cow from '$media/cow.jpg'`, and use cow where media('cow.jpg') was.",
      ],
    ]);
  });

  it("leaves alone a `media` of the deck's own, or a package's", () => {
    expect(
      analyzeScript(
        'lib/a.js',
        "import { media } from './queries.ts';\nimport * as q from 'queries';\nexport const a = media('phone') + q.media('x');",
      ).problems,
    ).toEqual([]);
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
