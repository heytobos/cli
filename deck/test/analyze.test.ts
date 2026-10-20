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

  it("is read through the engine's namespace too", () => {
    const { media, problems } = analyzeScript(
      'lib/a.js',
      "import * as present from '@tobos/present';\nexport const cow = present.media('cow.jpg');\nexport const ear = present['media']('ear.jpg');",
    );
    expect(problems).toEqual([]);
    expect(media.map((m) => m.name)).toEqual(['cow.jpg', 'ear.jpg']);
  });

  it('is refused under another name, or passed on, where the check could not read its calls', () => {
    const refused = (source: string) =>
      analyzeScript('lib/a.js', source).problems.map((p) => [p.rule, p.line]);
    const imported = "import { media } from '@tobos/present';\n";
    expect(refused("import { media as m } from '@tobos/present';\nm('cow.jpg');")).toEqual([
      ['media', 1],
    ]);
    expect(refused(`${imported}const m = media;`)).toEqual([['media', 2]]);
    expect(refused(`${imported}export const all = ['a.jpg'].map(media);`)).toEqual([['media', 2]]);
    expect(refused(`${imported}export const api = { media };`)).toEqual([['media', 2]]);
    expect(refused(`${imported}export default media;`)).toEqual([['media', 2]]);
    expect(refused(`${imported}export { media as m };`)).toEqual([['media', 2]]);
    expect(refused("export { media as m } from '@tobos/present';")).toEqual([['media', 1]]);
    // The engine's namespace, or import(), is media() under another name too.
    const namespace = "import * as present from '@tobos/present';\n";
    expect(refused(`${namespace}export const m = present.media;`)).toEqual([['media', 2]]);
    expect(refused(`${namespace}const { media: m } = present;\nm('cow.jpg');`)).toEqual([
      ['media', 2],
    ]);
    expect(refused(`${namespace}const p = present;\np.media('cow.jpg');`)).toEqual([['media', 2]]);
    expect(refused(`${namespace}export { present };`)).toEqual([['media', 2]]);
    expect(refused("const { media: m } = await import('@tobos/present');")).toEqual([['media', 1]]);
    expect(refused("export * as present from '@tobos/present';")).toEqual([['media', 1]]);
    // A package's `media` is its own.
    expect(refused("import { media as mq } from 'queries';\nexport const a = mq;")).toEqual([]);
    expect(refused("import { media } from 'queries';\nexport const a = media.phone;")).toEqual([]);
    expect(refused("export { media as mq } from 'queries';")).toEqual([]);
    expect(analyzeScript('lib/a.js', `${imported}const m = media;`).problems[0]!.message).toContain(
      "as `media('cow.jpg')`",
    );
  });

  it('is read wherever it is called by name, and its name is free to use otherwise', () => {
    const { media, problems } = analyzeScript(
      'lib/a.js',
      "import { media } from '@tobos/present';\nexport { media };\nexport const cow = { media: media('cow.jpg') };\nexport const query = (window) => window.media;",
    );
    expect(problems).toEqual([]);
    expect(media.map((m) => m.name)).toEqual(['cow.jpg']);
    // A file that doesn't import it may have a media of its own.
    expect(
      analyzeScript('lib/b.js', 'const media = 1;\nexport const two = media + 1;').problems,
    ).toEqual([]);
    // So may a function or a block of one that does: that `media` is theirs.
    const own = analyzeScript(
      'lib/c.js',
      "import { media } from '@tobos/present';\nexport const f = (media) => media.x;\nexport function g() { const media = {}; return [media]; }\nexport function h() { if (f) { var media = 1; } return media; }\ntry { f(); } catch (media) { g(media); }\nexport const cow = media('cow.jpg');",
    );
    expect(own.problems).toEqual([]);
    expect(own.media.map((m) => m.name)).toEqual(['cow.jpg']);
  });

  it("through one of the deck's files, holds only if that file passes the engine's on", () => {
    // The build knows whether it does (build.test.ts); here, a `media` of the deck's own is
    // as likely.
    const { media, problems, through } = analyzeScript(
      'lib/a.js',
      "import { media as m } from './index.ts';\nimport * as lib from './index.ts';\nexport const cow = lib.media('cow.jpg');\nexport const all = lib;\nexport const later = () => import('./later.ts');",
    );
    expect(media).toEqual([]);
    expect(problems).toEqual([]);
    expect(
      through?.map((found) => [
        found.specifier,
        found.media.map((m) => m.name),
        found.problems.map((p) => p.line),
      ]),
    ).toEqual([
      ['./index.ts', ['cow.jpg'], [1, 4]],
      ['./later.ts', [], [5]],
    ]);
  });

  it('is refused under another name in a component, its types aside', () => {
    const { media, problems } = analyzeSvelte(
      'lib/A.svelte',
      "<script lang=\"ts\">\n  import { media, type Beat } from '@tobos/present';\n  import Frame from './Frame.svelte';\n  type Media = typeof media;\n</script>\n<img src={media('cow.jpg')} alt=\"\" />\n<Frame {media} />\n",
      { scene: false },
    );
    expect(media.map((m) => m.name)).toEqual(['cow.jpg']);
    expect(problems.map((p) => [p.rule, p.line])).toEqual([['media', 7]]);
  });

  it('leaves alone a `media` the markup declares, and refuses a directive that names it', () => {
    const { media, problems } = analyzeSvelte(
      'lib/A.svelte',
      '<script lang="ts">\n  import { media } from \'@tobos/present\';\n  let { items }: { items: { src: string }[] } = $props();\n</script>\n{#each items as media}<img src={media.src} alt="" />{/each}\n{#snippet frame(media: string)}<img src={media} alt="" />{/snippet}\n<img src={media(\'cow.jpg\')} alt="" />\n<p use:media></p>\n',
      { scene: false },
    );
    expect(media.map((m) => m.name)).toEqual(['cow.jpg']);
    expect(problems.map((p) => [p.rule, p.line])).toEqual([['media', 8]]);
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
