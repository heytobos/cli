import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildDeck,
  createCache,
  masterOf,
  memoryTree,
  type DeckTree,
  type Problem,
} from '../src/index.ts';
import { mediaMatches } from '../src/analyze.ts';
import { directoryTree } from '../src/node.ts';

const sampleDir = directoryTree(fileURLToPath(new URL('../fixtures/sample', import.meta.url)));
const standard = directoryTree(fileURLToPath(new URL('../../templates/tobos', import.meta.url)));
const text = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes);
const checkDeck = async (tree: DeckTree) => (await buildDeck(tree)).problems;

/** The standard master's rules; the tests below check without them unless they set them. */
const RULES = JSON.stringify({ rules: { minFontSize: 28, layoutRoot: true } });

/**
 * The sample deck with the standard master copied in, as `tobos new` gives every deck: its
 * master/ files and the media under media/master/. Without the master's rules.
 */
const sample: DeckTree = await (async () => {
  const { files, media } = await masterOf(standard);
  const all: Record<string, Uint8Array> = { ...files };
  for (const path of sampleDir.files()) all[path] = sampleDir.read(path)!;
  const own = JSON.parse(text(sampleDir.read('media.json')));
  all['media.json'] = new TextEncoder().encode(JSON.stringify({ ...media, ...own }));
  all['master/master.json'] = new TextEncoder().encode('{}');
  return memoryTree(all);
})();

/** The sample deck with some files replaced, added (string) or removed (null). */
function variant(changes: Record<string, string | null>): DeckTree {
  const files: Record<string, Uint8Array> = {};
  for (const path of sample.files()) files[path] = sample.read(path)!;
  for (const [path, content] of Object.entries(changes)) {
    if (content === null) delete files[path];
    else files[path] = new TextEncoder().encode(content);
  }
  return memoryTree(files);
}

const errors = (problems: Problem[]) => problems.filter((p) => p.severity === 'error');

function scene(module: string, body = '<p>hi</p>', instance = '') {
  return `<script module lang="ts">\n${module}\n</script>\n${instance ? `<script lang="ts">\n${instance}\n</script>\n` : ''}${body}\n`;
}

describe('the sample deck', () => {
  it('checks clean', async () => {
    expect(await checkDeck(variant({ 'master/master.json': RULES }))).toEqual([]);
  });

  it('builds a manifest with every scene and its beats', async () => {
    const { manifest } = await buildDeck(sample);
    expect(manifest!.chapters.map((c) => c.scenes.map((s) => [s.id, s.beats]))).toEqual([
      [
        ['title', ['title']],
        ['question', ['scan', 'ask']],
      ],
      [['tokens', ['text', 'ids']]],
      [['clip', ['start', 'half', 'rest']]],
    ]);
    expect(Object.keys(manifest!.imports).filter((k) => !k.startsWith('@deck/master/'))).toEqual([
      '@deck/data/tokens.json',
      '@deck/lib/format.ts',
      '@deck/lib/Pill.svelte',
      '@deck/scenes/clip.svelte',
      '@deck/scenes/question.svelte',
      '@deck/scenes/title.svelte',
      '@deck/scenes/tokens.svelte',
    ]);
  });

  it('rewrites deck imports to import-map specifiers and strips types', async () => {
    const { manifest, modules } = await buildDeck(sample);
    const tokens = modules.get(manifest!.imports['@deck/scenes/tokens.svelte']!)!;
    expect(tokens).toContain("from '@deck/data/tokens.json'");
    expect(tokens).toContain("from '@deck/lib/Pill.svelte'");
    expect(tokens).not.toContain('../lib');
    const format = modules.get(manifest!.imports['@deck/lib/format.ts']!)!;
    expect(format).not.toContain(': string');
  });

  it('is deterministic: the same tree gives the same modules', async () => {
    const a = await buildDeck(sample);
    const b = await buildDeck(sample, { cache: createCache() });
    expect(b.manifest).toEqual(a.manifest);
    expect([...b.modules.keys()]).toEqual([...a.modules.keys()]);
  });

  it('changes only the hash of the file that changed', async () => {
    const a = (await buildDeck(sample)).manifest!;
    const changed = sample.read('scenes/title.svelte')!;
    const text = new TextDecoder().decode(changed).replace('Lecture 1', 'Lecture 2');
    const b = (await buildDeck(variant({ 'scenes/title.svelte': text }))).manifest!;
    const differing = Object.keys(a.imports).filter((k) => a.imports[k] !== b.imports[k]);
    expect(differing).toEqual(['@deck/scenes/title.svelte']);
  });
});

describe('deck.json', () => {
  it('must exist', async () => {
    expect(await checkDeck(variant({ 'deck.json': null }))).toMatchObject([{ rule: 'deck-json' }]);
  });

  it('must be valid JSON', async () => {
    expect(await checkDeck(variant({ 'deck.json': '{' }))).toMatchObject([{ rule: 'deck-json' }]);
  });

  it('rejects a scene listed twice and bad IDs', async () => {
    const deck = {
      title: 'x',
      chapters: [
        {
          id: 'A',
          title: 'A',
          scenes: [
            { id: 'title', title: 'T' },
            { id: 'title', title: 'T' },
          ],
        },
      ],
    };
    const messages = (await checkDeck(variant({ 'deck.json': JSON.stringify(deck) }))).map(
      (p) => p.message,
    );
    expect(messages).toEqual([
      'chapters[0].id must be lowercase letters, digits and dashes.',
      'Scene "title" is listed twice.',
    ]);
  });

  it('needs exact versions for dependencies', async () => {
    const deck = JSON.parse(new TextDecoder().decode(sample.read('deck.json')));
    deck.dependencies = { d3: '^7.9.0' };
    const problems = await checkDeck(variant({ 'deck.json': JSON.stringify(deck) }));
    expect(problems).toMatchObject([
      { rule: 'deck-json', message: '"d3" needs an exact version, like "7.9.0".' },
    ]);
  });

  it("doesn't let a deck list the packages the runtime provides", async () => {
    const deck = JSON.parse(new TextDecoder().decode(sample.read('deck.json')));
    deck.dependencies = { svelte: '5.0.0', gsap: '3.12.5' };
    const problems = await checkDeck(variant({ 'deck.json': JSON.stringify(deck) }));
    expect(problems.map((p) => p.message)).toEqual([
      '"svelte" comes with Tobos: import it without listing it in "dependencies".',
      '"gsap" comes with Tobos: import it without listing it in "dependencies".',
    ]);
  });

  it('lists at most 500 scenes, and stops there, before compiling any', async () => {
    const listing = (count: number) => ({
      title: 'x',
      chapters: [0, 1].map((c) => ({
        id: `c${c}`,
        title: 'C',
        scenes: Array.from({ length: c ? count - 250 : 250 }, (_, s) => ({
          id: `s${c}-${s}`,
          title: 'S',
        })),
      })),
    });
    expect(await checkDeck(variant({ 'deck.json': JSON.stringify(listing(501)) }))).toEqual([
      {
        file: 'deck.json',
        rule: 'scenes',
        message: 'deck.json lists 501 scenes; a deck may have 500. Split it into several decks.',
        severity: 'error',
      },
    ]);
    const atLimit = await checkDeck(variant({ 'deck.json': JSON.stringify(listing(500)) }));
    expect(atLimit.filter((p) => p.message.includes('may have'))).toEqual([]);
  });

  it('reports a scene without a file', async () => {
    expect(await checkDeck(variant({ 'scenes/title.svelte': null }))).toMatchObject([
      {
        file: 'deck.json',
        rule: 'scenes',
        message: expect.stringContaining('scenes/title.svelte is missing'),
      },
    ]);
  });
});

describe('beats', () => {
  it('must be exported from the module script', async () => {
    const problems = await checkDeck(variant({ 'scenes/title.svelte': '<h1>Hi</h1>' }));
    expect(problems).toMatchObject([{ file: 'scenes/title.svelte', rule: 'beats' }]);
  });

  it('must be an array literal', async () => {
    const problems = await checkDeck(
      variant({
        'scenes/title.svelte': scene("const list = [{ id: 'a' }];\nexport const beats = list;"),
      }),
    );
    expect(problems).toMatchObject([
      { rule: 'beats', line: 3, message: expect.stringContaining('array literal') },
    ]);
  });

  it('need literal IDs', async () => {
    const problems = await checkDeck(
      variant({
        'scenes/title.svelte': scene("const x = 'a';\nexport const beats = [{ id: x }];"),
      }),
    );
    expect(problems).toMatchObject([
      { rule: 'beats', message: "A beat's `id` must be a string literal." },
    ]);
  });

  it('need unique IDs', async () => {
    const problems = await checkDeck(
      variant({ 'scenes/title.svelte': scene("export const beats = [{ id: 'a' }, { id: 'a' }];") }),
    );
    expect(problems).toMatchObject([
      { rule: 'beats', line: 2, message: 'Beat "a" is declared twice in this scene.' },
    ]);
  });

  it("can't be only digits", async () => {
    const problems = await checkDeck(
      variant({ 'scenes/title.svelte': scene("export const beats = [{ id: '2' }];") }),
    );
    expect(problems).toMatchObject([
      { rule: 'beats', message: expect.stringContaining('only digits') },
    ]);
  });

  it('need at least one', async () => {
    const problems = await checkDeck(
      variant({ 'scenes/title.svelte': scene('export const beats = [];') }),
    );
    expect(problems).toMatchObject([
      { rule: 'beats', message: 'A scene needs at least one beat.' },
    ]);
  });
  it('number at most 100 in a scene', async () => {
    const beats = (count: number) =>
      scene(
        `export const beats = [${Array.from({ length: count }, (_, b) => `{ id: 'b${b}' }`).join(', ')}];`,
      );
    expect(await checkDeck(variant({ 'scenes/title.svelte': beats(101) }))).toMatchObject([
      {
        file: 'scenes/title.svelte',
        rule: 'beats',
        line: 2,
        message: 'The scene has 101 beats; it may have 100. Split it into several scenes.',
      },
    ]);
    expect(await checkDeck(variant({ 'scenes/title.svelte': beats(100) }))).toEqual([]);
  });
});

describe('compiling', () => {
  it('reports Svelte errors with their position', async () => {
    const problems = await checkDeck(
      variant({
        'scenes/title.svelte': scene("export const beats = [{ id: 'a' }];", '<p>{#if}</p>'),
      }),
    );
    expect(errors(problems)).toMatchObject([
      { file: 'scenes/title.svelte', line: 4, rule: expect.stringMatching(/^svelte\//) },
    ]);
  });

  it('reports Svelte warnings without failing', async () => {
    const problems = await checkDeck(
      variant({
        'scenes/title.svelte': scene("export const beats = [{ id: 'a' }];", '<img src="x.png" />'),
      }),
    );
    expect(problems).toMatchObject([
      { rule: 'svelte/a11y_missing_attribute', severity: 'warning' },
    ]);
  });

  it('reports invalid JSON data', async () => {
    const problems = await checkDeck(variant({ 'data/tokens.json': '[1,' }));
    expect(problems).toMatchObject([{ file: 'data/tokens.json', rule: 'compile' }]);
  });

  it('warns about a scene file that deck.json does not list', async () => {
    const problems = await checkDeck(
      variant({ 'scenes/extra.svelte': scene("export const beats = [{ id: 'a' }];") }),
    );
    expect(problems).toMatchObject([
      { file: 'scenes/extra.svelte', rule: 'scenes', severity: 'warning' },
    ]);
  });
});

describe('imports', () => {
  const importing = (line: string) =>
    variant({
      'scenes/title.svelte': scene("export const beats = [{ id: 'a' }];", '<p>hi</p>', line),
    });

  it('allow the runtime packages', async () => {
    const problems = await checkDeck(
      importing(
        "import gsap from 'gsap';\nimport { Flip } from 'gsap/Flip';\nimport { tick } from 'svelte';\nimport { Title } from '../master/index.ts';",
      ),
    );
    expect(problems).toEqual([]);
  });

  it('reject an undeclared package', async () => {
    const problems = await checkDeck(importing("import * as d3 from 'd3';"));
    expect(problems).toMatchObject([
      { rule: 'imports', line: 5, message: expect.stringContaining('"d3" is not a dependency') },
    ]);
  });

  it('allow a declared package and its subpaths', async () => {
    const deck = JSON.parse(new TextDecoder().decode(sample.read('deck.json')));
    deck.dependencies = { d3: '7.9.0' };
    const tree = variant({
      'deck.json': JSON.stringify(deck),
      'scenes/title.svelte': scene(
        "export const beats = [{ id: 'a' }];",
        '<p>hi</p>',
        "import * as d3 from 'd3';\nimport 'd3/dist/d3.js';",
      ),
    });
    expect(await checkDeck(tree)).toEqual([]);
  });

  it('reject paths that leave a package', async () => {
    const deck = JSON.parse(new TextDecoder().decode(sample.read('deck.json')));
    deck.dependencies = { d3: '7.9.0' };
    const tree = variant({
      'deck.json': JSON.stringify(deck),
      'scenes/title.svelte': scene(
        "export const beats = [{ id: 'a' }];",
        '<p>hi</p>',
        "import a from 'd3/../../etc/x.js';\nimport b from 'd3/';\nimport c from 'd3//x.js';",
      ),
    });
    expect((await checkDeck(tree)).map((p) => p.message)).toEqual([
      '"d3/../../etc/x.js" is not a path inside a package.',
      '"d3/" is not a path inside a package.',
      '"d3//x.js" is not a path inside a package.',
    ]);
  });

  it('reject URLs and Node APIs', async () => {
    const problems = await checkDeck(
      importing("import fs from 'node:fs';\nimport x from 'https://esm.sh/x';"),
    );
    expect(problems.map((p) => p.rule)).toEqual(['imports', 'imports']);
  });

  it('reject files outside the deck, missing files and media', async () => {
    const problems = await checkDeck(
      importing(
        "import a from '../../x.js';\nimport b from '../lib/nope.ts';\nimport c from '../media/cow.jpg';",
      ),
    );
    expect(problems.map((p) => p.message)).toEqual([
      '"../../x.js" points outside the deck.',
      '"../lib/nope.ts" doesn\'t exist (looked for lib/nope.ts).',
      '"../media/cow.jpg" can\'t be imported: only .svelte, .ts, .js and .json files can. Use media() for media.',
    ]);
  });

  it('reject a computed dynamic import', async () => {
    const problems = await checkDeck(importing("const name = 'x';\nimport('../lib/' + name);"));
    expect(problems).toMatchObject([
      { rule: 'imports', message: expect.stringContaining('string literal') },
    ]);
  });

  it('rewrite a literal dynamic import', async () => {
    const tree = importing("const load = () => import('../lib/format.ts');");
    const { manifest, modules } = await buildDeck(tree);
    const code = modules.get(manifest!.imports['@deck/scenes/title.svelte']!)!;
    expect(code).toContain('import("@deck/lib/format.ts")');
  });
});

describe('media', () => {
  it('must be in media.json', async () => {
    const problems = (await checkDeck(variant({ 'media.json': '{}' }))).filter((p) =>
      p.file.startsWith('scenes/'),
    );
    expect(problems).toMatchObject([
      { file: 'scenes/clip.svelte', rule: 'media', message: expect.stringContaining('clip.webm') },
      {
        file: 'scenes/question.svelte',
        rule: 'media',
        message: expect.stringContaining('scan.png'),
      },
    ]);
  });

  it('needs a literal name', async () => {
    const problems = await checkDeck(
      variant({
        'scenes/title.svelte': scene(
          "export const beats = [{ id: 'a' }];",
          '<img alt="" src={media(name)} />',
          "import { media } from '@tobos/present';\nconst name = 'scan.png';",
        ),
      }),
    );
    expect(problems).toMatchObject([
      { rule: 'media', message: expect.stringContaining('string literal') },
    ]);
  });

  it('is checked in plain modules too', async () => {
    const problems = await checkDeck(
      variant({
        'lib/format.ts':
          "import { media } from '@tobos/present';\nexport const cow = media('cow.jpg');",
      }),
    );
    expect(problems).toMatchObject([{ file: 'lib/format.ts', line: 2, rule: 'media' }]);
  });

  it('rejects a malformed media.json', async () => {
    const problems = await checkDeck(variant({ 'media.json': '{"a.jpg": {"hash": "x"}}' }));
    expect(problems).toMatchObject([{ file: 'media.json', rule: 'media-json' }]);
  });
});

describe("the master's rules", () => {
  it('enforce the smallest font size', async () => {
    const problems = await checkDeck(
      variant({
        'scenes/title.svelte': scene(
          "export const beats = [{ id: 'a' }];",
          '<p style="font-size: 18px">small</p>\n<style>p { font-size: 20px; }</style>',
        ),
        'master/master.json': JSON.stringify({ rules: { minFontSize: 28 } }),
      }),
    );
    expect(problems.map((p) => [p.rule, p.line])).toEqual([
      ['master/min-font-size', 4],
      ['master/min-font-size', 5],
    ]);
  });
});

describe('a directory tree', () => {
  it('reads only the files it listed', () => {
    expect(sampleDir.read('deck.json')).toBeDefined();
    expect(sampleDir.read('../package.json')).toBeUndefined();
    expect(sampleDir.read('media/scan.png')).toBeUndefined();
  });
});

describe('packages', () => {
  const withDependencies = (
    dependencies: Record<string, string>,
    files: Record<string, string>,
  ) => {
    const deck = JSON.parse(new TextDecoder().decode(sample.read('deck.json')));
    deck.dependencies = dependencies;
    return variant({ 'deck.json': JSON.stringify(deck), ...files });
  };

  it('are recorded in the manifest: every specifier the deck imports, by dependency', async () => {
    const tree = withDependencies(
      { three: '0.170.0', d3: '7.9.0', 'd3-scale': '4.0.2' },
      {
        'scenes/title.svelte': scene(
          "export const beats = [{ id: 'a' }];",
          '<p>hi</p>',
          "import * as THREE from 'three';\nimport { OrbitControls } from 'three/addons/controls/OrbitControls.js';\nimport gsap from 'gsap';\nimport { line } from '../lib/chart.ts';",
        ),
        'lib/chart.ts': "export { line } from 'd3';\nexport const load = () => import('three');\n",
      },
    );
    const { manifest, problems } = await buildDeck(tree);
    expect(problems).toEqual([]);
    expect(manifest!.packages).toEqual({
      d3: ['d3'],
      three: ['three', 'three/addons/controls/OrbitControls.js'],
    });
    expect(manifest!.dependencies).toEqual({ three: '0.170.0', d3: '7.9.0', 'd3-scale': '4.0.2' });
  });

  it('are empty for a deck without dependencies', async () => {
    const { manifest } = await buildDeck(sample);
    expect(manifest!.packages).toEqual({});
  });

  it("may import a package's CSS, but not the deck's own", async () => {
    const importing = (line: string) =>
      withDependencies(
        { katex: '0.16.11' },
        {
          'scenes/title.svelte': scene("export const beats = [{ id: 'a' }];", '<p>hi</p>', line),
          'lib/look.css': 'p { color: red }',
        },
      );
    const css = await buildDeck(importing("import 'katex/dist/katex.min.css';"));
    expect(css.problems).toEqual([]);
    expect(css.manifest!.packages).toEqual({ katex: ['katex/dist/katex.min.css'] });
    expect((await buildDeck(importing("import '../lib/look.css';"))).problems).toMatchObject([
      {
        rule: 'imports',
        message: expect.stringContaining('own CSS goes in a <style> block of a .svelte file'),
      },
    ]);
  });
});

describe('the master', () => {
  it('compiles with the deck, its tokens.css linked, with its fonts from media', async () => {
    const { manifest, modules } = await buildDeck(sample);
    expect(Object.keys(manifest!.imports)).toContain('@deck/master/index.ts');
    const [sheet] = manifest!.styles!;
    expect(sheet).toMatch(/^m\/[0-9a-f]{20}\.css$/);
    const css = modules.get(sheet!)!;
    const fonts = JSON.parse(text(standard.read('media.json')));
    expect(css).toContain(`url(../media/${fonts['master/fonts/hanken-grotesk-latin.woff2'].hash})`);
    expect(css).not.toContain('master/fonts');
  });

  it('has no stylesheet without tokens.css', async () => {
    const { manifest } = await buildDeck(variant({ 'master/tokens.css': null }));
    expect(manifest!.styles).toBeUndefined();
  });

  it('names only media files in tokens.css; data: URLs pass', async () => {
    const build = await buildDeck(
      variant({
        'master/tokens.css':
          ':root { --dot: url(data:image/png;base64,AA==); }\n@font-face { src: url(fonts/a.woff2); }\n.a { background: url("https://x.example/a.png"); }\n',
      }),
    );
    expect(errors(build.problems).map((p) => [p.file, p.rule, p.line])).toEqual([
      ['master/tokens.css', 'media', 2],
      ['master/tokens.css', 'media', 3],
    ]);
  });

  it('takes its rules from master.json, which must make sense', async () => {
    const build = await buildDeck(
      variant({ 'master/master.json': JSON.stringify({ rules: { minFontSize: 'big' } }) }),
    );
    expect(errors(build.problems).map((p) => [p.file, p.rule])).toEqual([
      ['master/master.json', 'master'],
    ]);
  });

  it('is copied with the dependencies its files import, not those only scenes import', async () => {
    const deck = JSON.parse(text(sample.read('deck.json')));
    deck.dependencies = { katex: '0.16.11', shiki: '1.22.0', d3: '7.9.0' };
    const tree = variant({
      'deck.json': JSON.stringify(deck),
      'master/components/Formula.svelte':
        "<script lang=\"ts\">\n  import katex from 'katex';\n  import 'katex/dist/katex.min.css';\n</script>\n<p>{katex.renderToString('x')}</p>\n",
      'master/highlight.ts': "export const load = () => import('shiki/bundle/web');\n",
      'scenes/title.svelte': scene("export const beats = [{ id: 'a' }];", '', "import 'd3';"),
    });
    const master = await masterOf(tree);
    expect(master.dependencies).toEqual({ katex: '0.16.11', shiki: '1.22.0' });
    expect(Object.keys(master.files)).toContain('master/components/Formula.svelte');
    expect((await masterOf(sample)).dependencies).toEqual({});
  });

  it('builds a deck.json that still gives a scene a note, and leaves the note out', async () => {
    const deck = JSON.parse(text(sample.read('deck.json')));
    deck.chapters[0].scenes[0].note = 'The opening.';
    const { manifest } = await buildDeck(variant({ 'deck.json': JSON.stringify(deck) }));
    expect(manifest!.chapters[0]!.scenes[0]).toMatchObject({ id: 'title' });
    expect(manifest!.chapters[0]!.scenes[0]).not.toHaveProperty('note');
  });
});

describe('the rules a master and the stage set', () => {
  const check = (body: string, instance = "import { Content } from '../master/index.ts';") =>
    checkDeck(
      variant({
        'scenes/title.svelte': scene("export const beats = [{ id: 'a' }];", body, instance),
        'master/master.json': RULES,
      }),
    );
  const rulesOf = async (body: string, instance?: string) =>
    (await check(body, instance)).map((p) => [p.rule, p.severity]);

  it('find small type in every form CSS and GSAP write it', async () => {
    const sizes = [
      '<Content><p style="font: 600 18px/1.2 sans-serif">a</p></Content>',
      '<Content><p style:font-size="14px">a</p></Content>',
      '<Content><p style="font-size: 1rem">a</p></Content>',
      '<Content><p>a</p></Content>\n<style>p { font: italic 20px serif; }</style>',
    ];
    for (const body of sizes)
      expect(await rulesOf(body), body).toEqual([['master/min-font-size', 'error']]);
    expect(
      await rulesOf(
        '<Content><p>a</p></Content>',
        "import { Content } from '../master/index.ts';\nconst grow = { fontSize: 12 };",
      ),
    ).toEqual([['master/min-font-size', 'error']]);
    expect(await rulesOf('<Content><p style="font-size: 2rem">a</p></Content>')).toEqual([]);
    // em and % depend on context: neither is read as its leading digits in px.
    for (const size of ["'1.5em'", "'10%'"])
      expect(
        await rulesOf(
          '<Content><p>a</p></Content>',
          `import { Content } from '../master/index.ts';\nconst grow = { fontSize: ${size} };`,
        ),
        size,
      ).toEqual([]);
  });

  it('want one layout as the root', async () => {
    expect(await rulesOf('<p>a</p>')).toEqual([['master/layout-root', 'warning']]);
    expect(await rulesOf('<Content>a</Content>\n<p>b</p>')).toEqual([
      ['master/layout-root', 'warning'],
    ]);
    expect(await rulesOf('<Content>a</Content>\n<svelte:window />')).toEqual([]);
    expect(await rulesOf('<Card>a</Card>', "import Card from 'some-package';")).toContainEqual([
      'master/layout-root',
      'warning',
    ]);
  });

  it('keep motion in beats', async () => {
    expect(
      await rulesOf(
        '<Content>a</Content>',
        "import { Content } from '../master/index.ts';\nsetTimeout(() => {}, 100);",
      ),
    ).toEqual([['motion/timer', 'warning']]);
    expect(
      await rulesOf(
        '<Content>a</Content>',
        "import { onMount } from 'svelte';\nimport gsap from 'gsap';\nimport { Content } from '../master/index.ts';\nonMount(() => { gsap.to('p', { x: 10 }); });",
      ),
    ).toEqual([['motion/on-mount', 'warning']]);
    expect(
      await rulesOf(
        '<Content>a</Content>',
        "import { Content } from '../master/index.ts';\nconst spin = { rotation: 360, repeat: -1 };",
      ),
    ).toEqual([['motion/loop', 'warning']]);
    expect(
      await rulesOf(
        '<Content><p>a</p></Content>\n<style>p { animation: pulse 1s infinite; }</style>',
      ),
    ).toEqual([['motion/loop', 'warning']]);
  });

  it('reject the network, which the viewer blocks', async () => {
    expect(
      await rulesOf(
        '<Content>a</Content>',
        "import { Content } from '../master/index.ts';\nfetch('https://example.com/data.json');",
      ),
    ).toEqual([['network', 'error']]);
    expect(
      await rulesOf('<Content><img alt="" src="https://example.com/cow.jpg" /></Content>'),
    ).toEqual([['network', 'error']]);
    expect(
      await rulesOf(
        '<Content><p>a</p></Content>\n<style>p { background: url(https://example.com/x.png); }</style>',
      ),
    ).toEqual([['network', 'error']]);
    expect(await rulesOf('<Content><a href="https://example.com">a link</a></Content>')).toEqual(
      [],
    );
  });
});

describe('media patterns', () => {
  const body = '<img alt="" src={media(`sc${"an"}.png`)} />';
  it('pass when a file matches', async () => {
    const problems = await checkDeck(
      variant({
        'scenes/title.svelte': scene(
          "export const beats = [{ id: 'a' }];",
          body,
          "import { media } from '@tobos/present';",
        ),
      }),
    );
    expect(problems).toEqual([]);
  });
  it('fail when none does', async () => {
    const problems = await checkDeck(
      variant({
        'scenes/title.svelte': scene(
          "export const beats = [{ id: 'a' }];",
          '<img alt="" src={media(`cow/${part}.png`)} />',
          "import { media } from '@tobos/present';\nconst part = 'ear';",
        ),
      }),
    );
    expect(problems).toMatchObject([
      { rule: 'media', message: expect.stringContaining('cow/${…}.png') },
    ]);
  });
  it('match * as anything and the rest literally, without backtracking', () => {
    expect(mediaMatches('cow/*.png', 'cow/ear.png')).toBe(true);
    expect(mediaMatches('cow/*.png', 'cow/.png')).toBe(true);
    expect(mediaMatches('cow/*.png', 'cow/ear.jpg')).toBe(false);
    expect(mediaMatches('*a*b*', 'xaxb')).toBe(true);
    expect(mediaMatches('*a*b*', 'xxbxa')).toBe(false);
    expect(mediaMatches('a*a', 'a')).toBe(false);
    expect(mediaMatches('c.w', 'cow')).toBe(false);
    // The deck writes both sides: a regex would backtrack here for minutes.
    expect(mediaMatches('*a'.repeat(20) + 'b.png', 'a'.repeat(10_000) + '.png')).toBe(false);
  });
});

describe('activities', () => {
  const POLL = `export const beats = [{ id: 'ask' }, { id: 'result' }];
export const activity = {
  id: 'used-llm-api',
  kind: 'choice',
  prompt: 'Have you called an LLM API yourself?',
  options: ['Never', 'Once or twice', 'Regularly'],
  reveals: 'result',
};`;
  const FORM = `export const beats = [{ id: 'ask' }];
export const activity = {
  id: 'course-wishes',
  kind: 'text',
  prompt: 'Help us make this course great',
  fields: [
    { id: 'amazing', label: 'What would make this course amazing?', multiline: true },
    { id: 'worry', label: 'What worries you about it?', multiline: true, max: 1000 },
  ],
};`;
  /** The title scene with this module script; its activity's problems. */
  const check = async (module: string) =>
    (await checkDeck(variant({ 'scenes/title.svelte': scene(module) }))).filter(
      (p) => p.rule === 'activity',
    );
  const messages = async (module: string) => (await check(module)).map((p) => p.message);
  /** A poll whose fields are these, written as an object literal's body. */
  const poll = (body: string) =>
    `export const beats = [{ id: 'ask' }, { id: 'result' }];\nexport const activity = {\n${body}\n};`;

  it('go into the manifest with their scene, a form with each field’s limit', async () => {
    const { manifest, problems } = await buildDeck(
      variant({ 'scenes/title.svelte': scene(POLL), 'scenes/question.svelte': scene(FORM) }),
    );
    expect(errors(problems)).toEqual([]);
    const [title, question] = manifest!.chapters[0]!.scenes;
    expect(title!.activity).toEqual({
      id: 'used-llm-api',
      kind: 'choice',
      prompt: 'Have you called an LLM API yourself?',
      options: ['Never', 'Once or twice', 'Regularly'],
      reveals: 'result',
    });
    expect(question!.activity).toEqual({
      id: 'course-wishes',
      kind: 'text',
      prompt: 'Help us make this course great',
      fields: [
        { id: 'amazing', label: 'What would make this course amazing?', multiline: true, max: 500 },
        { id: 'worry', label: 'What worries you about it?', multiline: true, max: 1000 },
      ],
    });
    expect(manifest!.chapters[1]!.scenes[0]).not.toHaveProperty('activity');
  });

  it('may be typed, as beats are', async () => {
    const typed = POLL.replace('export const activity = {', 'export const activity: Activity = {')
      .replace('};', '} satisfies Activity;')
      .concat("\nimport type { Activity } from '@tobos/present';");
    expect(await check(typed)).toEqual([]);
  });

  it('are read without running the scene: literals only', async () => {
    expect(await messages(POLL.replace('export const activity', 'export let activity'))).toEqual([
      '`activity` must be declared with const.',
    ]);
    expect(
      await check("export const beats = [{ id: 'a' }];\nconst a = {};\nexport const activity = a;"),
    ).toMatchObject([
      { rule: 'activity', line: 4, message: expect.stringContaining('object literal') },
    ]);
    expect(
      await messages(
        poll("id: 'x', kind: 'choice', prompt: 'Q?', options: ['a', 'b'].map((o) => o),"),
      ),
    ).toEqual([expect.stringContaining('only string, number and boolean literals')]);
    expect(
      await messages(poll("id: 'x', kind: 'choice', prompt: `Q ${1}?`, options: ['a', 'b'],")),
    ).toEqual([expect.stringContaining('only string, number and boolean literals')]);
    expect(
      await messages(poll("['id']: 'x', kind: 'choice', prompt: 'Q?', options: ['a', 'b'],")),
    ).toEqual([expect.stringContaining('only string, number and boolean literals')]);
    // A template literal without holes is a string literal.
    expect(
      await messages(poll("id: 'x', kind: 'choice', prompt: `Q?`, options: ['a', 'b'],")),
    ).toEqual([]);
  });

  it('need an id of lowercase letters, digits and dashes, and a kind', async () => {
    expect(await messages(poll("kind: 'choice', prompt: 'Q?', options: ['a', 'b'],"))).toEqual([
      'An activity needs an `id`: lowercase letters, digits and dashes.',
    ]);
    expect(
      await messages(poll("id: 'Used API', kind: 'choice', prompt: 'Q?', options: ['a', 'b'],")),
    ).toEqual(['Activity ID "Used API" must be lowercase letters, digits and dashes.']);
    expect(await messages(poll("id: 'x', kind: 'quiz', prompt: 'Q?'"))).toEqual([
      'An activity\'s `kind` is "choice" (a poll) or "text" (a form).',
    ]);
    expect(
      await messages(
        poll("id: 'x', kind: 'choice', prompt: 'Q?', options: ['a', 'b'], reveal: 'result',"),
      ),
    ).toEqual(['A poll has no `reveal`: it takes id, kind, prompt, options and reveals.']);
  });

  it('as a poll need a prompt and two to eight different options, each short', async () => {
    expect(await messages(poll("id: 'x', kind: 'choice', options: ['a', 'b'],"))).toEqual([
      'A poll needs a `prompt`.',
    ]);
    expect(
      await messages(poll("id: 'x', kind: 'choice', prompt: ' ', options: ['a', 'b'],")),
    ).toEqual(['A poll needs a `prompt`.']);
    expect(
      await messages(
        poll(`id: 'x', kind: 'choice', prompt: '${'q'.repeat(201)}', options: ['a', 'b'],`),
      ),
    ).toEqual(['The `prompt` is 201 characters; it may have 200.']);
    expect(await messages(poll("id: 'x', kind: 'choice', prompt: 'Q?', options: ['a'],"))).toEqual([
      'A poll needs 2 to 8 `options`; this one has 1.',
    ]);
    expect(
      await messages(
        poll(
          "id: 'x', kind: 'choice', prompt: 'Q?', options: ['1','2','3','4','5','6','7','8','9'],",
        ),
      ),
    ).toEqual(['A poll needs 2 to 8 `options`; this one has 9.']);
    expect(
      await messages(poll("id: 'x', kind: 'choice', prompt: 'Q?', options: ['a', 'a'],")),
    ).toEqual(['Option "a" is listed twice.']);
    expect(
      await messages(poll("id: 'x', kind: 'choice', prompt: 'Q?', options: ['a', ' '],")),
    ).toEqual(['An option needs some text.']);
    expect(
      await messages(poll("id: 'x', kind: 'choice', prompt: 'Q?', options: ['a', 2],")),
    ).toEqual(['Each option is a string.']);
    expect(
      await messages(
        poll(`id: 'x', kind: 'choice', prompt: 'Q?', options: ['a', '${'o'.repeat(81)}'],`),
      ),
    ).toEqual(['An option is 81 characters; it may have 80.']);
  });

  it("reveal a poll's result on a later beat of its own scene", async () => {
    const reveals = (beat: string) =>
      messages(
        poll(`id: 'x', kind: 'choice', prompt: 'Q?', options: ['a', 'b'], reveals: '${beat}',`),
      );
    expect(await reveals('result')).toEqual([]);
    expect(await reveals('ask')).toEqual([
      '`reveals` names "ask", the scene\'s first beat: the poll would never be open. Name a later beat.',
    ]);
    expect(await reveals('nope')).toEqual([
      '`reveals` names "nope", which is not a beat of this scene (ask, result).',
    ]);
  });

  it('as a form need one to five fields, each with a unique id and a label', async () => {
    const form = (fields: string, extra = '') =>
      messages(poll(`id: 'x', kind: 'text', ${extra}fields: [${fields}],`));
    expect(await form("{ id: 'a', label: 'A?' }")).toEqual([]);
    expect(await form('')).toEqual(['A form needs 1 to 5 `fields`; this one has 0.']);
    expect(
      await form(Array.from({ length: 6 }, (_, i) => `{ id: 'f${i}', label: 'L' }`).join()),
    ).toEqual(['A form needs 1 to 5 `fields`; this one has 6.']);
    expect(await form("{ id: 'a', label: 'A?' }, { id: 'a', label: 'B?' }")).toEqual([
      'Field "a" is declared twice in this form.',
    ]);
    expect(await form("{ id: 'a' }")).toEqual(['A field needs a `label`.']);
    expect(await form("{ label: 'A?' }")).toEqual([
      'A field needs an `id`: lowercase letters, digits and dashes.',
    ]);
    expect(await form("'a'")).toEqual(['Each field is an object: `{ id: "…", label: "…" }`.']);
    expect(await form(`{ id: 'a', label: '${'l'.repeat(201)}' }`)).toEqual([
      'The `label` is 201 characters; it may have 200.',
    ]);
    expect(await form("{ id: 'a', label: 'A?', multiline: 'yes' }")).toEqual([
      '`multiline` is true or false.',
    ]);
    expect(await form("{ id: 'a', label: 'A?', max: 2001 }")).toEqual([
      '`max` is a whole number of characters from 1 to 2000.',
    ]);
    expect(await form("{ id: 'a', label: 'A?', size: 3 }")).toEqual([
      'A field has no `size`: it takes id, label, multiline and max.',
    ]);
    expect(await form("{ id: 'a', label: 'A?' }", `prompt: '${'q'.repeat(201)}', `)).toEqual([
      'The `prompt` is 201 characters; it may have 200.',
    ]);
  });

  it("can't reveal a form, whose answers are only stored", async () => {
    expect(
      await messages(
        poll("id: 'x', kind: 'text', fields: [{ id: 'a', label: 'A?' }], reveals: 'result',"),
      ),
    ).toEqual(["A form can't `reveal`: a form's answers are only stored."]);
  });

  it('have IDs unique across the deck', async () => {
    const problems = await checkDeck(
      variant({ 'scenes/title.svelte': scene(POLL), 'scenes/question.svelte': scene(POLL) }),
    );
    expect(problems.filter((p) => p.rule === 'activity')).toMatchObject([
      {
        file: 'scenes/question.svelte',
        line: 4,
        message:
          'Activity "used-llm-api" is declared in scenes/title.svelte too: activity IDs are unique across the deck.',
      },
    ]);
  });
});
