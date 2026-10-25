import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildDeck,
  createCache,
  masterOf,
  memoryTree,
  sharedManifest,
  type DeckTree,
  type Manifest,
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
      [
        ['clip', ['start', 'half', 'rest']],
        ['sound', ['quiet', 'listen', 'more', 'bed', 'over', 'after']],
      ],
    ]);
    expect(Object.keys(manifest!.imports).filter((k) => !k.startsWith('@deck/master/'))).toEqual([
      '@deck/data/tokens.json',
      '@deck/lib/format.ts',
      '@deck/lib/Pill.svelte',
      '@deck/scenes/clip.svelte',
      '@deck/scenes/question.svelte',
      '@deck/scenes/sound.svelte',
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

describe('the build cache', () => {
  it('keeps what a build that passed compiled, and nothing of one that failed', async () => {
    const cache = createCache();
    const broken = variant({
      'scenes/title.svelte': scene("export const beats = [{ id: 'a' }];", '<p>{#if}</p>'),
    });
    expect((await buildDeck(broken, { cache })).manifest).toBeUndefined();
    expect(cache.size).toBe(0);
    await buildDeck(sample, { cache });
    expect(cache.size).toBeGreaterThan(0);
  });

  it('keeps no more than its budget, the least recently used going first', () => {
    // An empty file takes 1024 bytes of it: room for three.
    const cache = createCache(3 * 1024);
    const file = (code: string) =>
      ({ code, imports: [], analysis: { media: [], problems: [] }, problems: [] }) as never;
    for (const key of ['a', 'b', 'c']) cache.set(key, file(''));
    expect(cache.get('a')).toBeDefined();
    cache.set('d', file(''));
    // b was used least lately.
    expect(cache.get('b')).toBeUndefined();
    for (const key of ['a', 'c', 'd']) expect(cache.get(key), key).toBeDefined();
    expect(cache.bytes).toBeLessThanOrEqual(3 * 1024);
    // One larger than the whole budget isn't kept, and pushes nothing out.
    cache.set('e', file('x'.repeat(5000)));
    expect(cache.get('e')).toBeUndefined();
    expect(cache.size).toBe(3);
  });
});

describe('deck.json', () => {
  it('must exist', async () => {
    expect(await checkDeck(variant({ 'deck.json': null }))).toMatchObject([{ rule: 'deck-json' }]);
  });

  it('must be valid JSON', async () => {
    expect(await checkDeck(variant({ 'deck.json': '{' }))).toMatchObject([{ rule: 'deck-json' }]);
  });

  it('keeps titles to 200 characters, and passes on only what Tobos reads', async () => {
    const deck = JSON.parse(text(sample.read('deck.json')));
    deck.chapters[0].title = 'x'.repeat(201);
    expect(
      (await checkDeck(variant({ 'deck.json': JSON.stringify(deck) }))).map((p) => p.message),
    ).toEqual(['chapters[0].title is 201 characters; at most 200.']);
    deck.chapters[0].title = 'Opening';
    deck.notes = 'ours';
    deck.chapters[0].colour = 'red';
    deck.chapters[0].scenes[0].draft = true;
    const built = await buildDeck(variant({ 'deck.json': JSON.stringify(deck) }));
    expect(built.problems).toEqual([]);
    expect(Object.keys(built.deck!)).toEqual(['title', 'chapters']);
    expect(Object.keys(built.deck!.chapters[0]!)).toEqual(['id', 'title', 'scenes']);
    expect(Object.keys(built.deck!.chapters[0]!.scenes[0]!)).toEqual(['id', 'title']);
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

  it('play a sound until a later beat of the scene, named by a literal', async () => {
    const until = async (value: string) =>
      (
        await checkDeck(
          variant({
            'scenes/title.svelte': scene(
              "import { playAudio } from '@tobos/present';\n" +
                "export const beats = [{ id: 'a' }, { id: 'b', enter: (tl, q) => " +
                `playAudio(tl, q('audio'), { until: ${value} }) }, { id: 'c' }];`,
            ),
          }),
        )
      ).map((p) => p.message);
    expect(await until("'c'")).toEqual([]);
    expect(await until("'a'")).toEqual([
      '`until` names "a", which doesn\'t come after "b", where the sound starts: it would never play. Name a later beat (c).',
    ]);
    expect(await until("'nope'")).toEqual([
      '`until` names "nope", which is not a beat of this scene (a, b, c).',
    ]);
    expect(await until('name')).toEqual([
      '`until` must be a string literal naming a later beat of this scene, so Tobos can check it.',
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

  it('reports a module that is no JavaScript where it stops being, and checks nothing else in it', async () => {
    const problems = await checkDeck(
      variant({
        'lib/format.ts': "export const far = 1;\nexport const far = 2;\nmedia('cow.jpg');",
      }),
    );
    expect(problems).toEqual([
      {
        file: 'lib/format.ts',
        line: 2,
        column: 14,
        rule: 'compile',
        message: "Identifier 'far' has already been declared",
        severity: 'error',
      },
    ]);
  });

  it('refuses JavaScript nested deeper than the check can read, valid or not past that, saying what to do', async () => {
    // More than acorn's stack takes: a long sum, which es-module-lexer reads flat, then an error
    // nothing here would see.
    const deep = `export const t = ${Array.from({ length: 10_000 }, (_, i) => `'s${i}'`).join(' + ')};`;
    for (const source of [deep, `${deep}\nexport const = 1;`]) {
      const problems = await checkDeck(
        variant({
          'lib/deep.js': source,
          // What scenes/tokens.svelte imports stays, so that the deep file is all that's wrong.
          'lib/format.ts':
            "export { t } from './deep.js';\nexport const visible = (s: string) => s;",
        }),
      );
      expect(problems).toMatchObject([
        {
          file: 'lib/deep.js',
          rule: 'compile',
          severity: 'error',
          message: expect.stringMatching(/nested too deeply.*data\//),
        },
      ]);
    }
  });

  it('reports a JavaScript file that is no JavaScript once', async () => {
    const problems = await checkDeck(
      variant({
        'lib/broken.js': "export const s = 'abc",
        'lib/format.ts':
          "export { s } from './broken.js';\nexport const visible = (s: string) => s;",
      }),
    );
    expect(problems).toEqual([
      {
        file: 'lib/broken.js',
        line: 1,
        column: 18,
        rule: 'compile',
        message: 'Unterminated string constant',
        severity: 'error',
      },
    ]);
  });

  it('puts the error on the line an editor shows, a line separator in a string or not', async () => {
    const problems = await checkDeck(
      variant({
        'lib/format.ts':
          "export const s = 'a\u2028b';\nexport const far = 1;\nexport const far = 2;",
      }),
    );
    expect(problems).toMatchObject([{ file: 'lib/format.ts', line: 3, column: 14 }]);
  });

  it('reports TypeScript it cannot read, not failing the check', async () => {
    const problems = await checkDeck(variant({ 'lib/format.ts': 'export const x: = 1;' }));
    expect(problems).toMatchObject([
      {
        file: 'lib/format.ts',
        rule: 'compile',
        message: expect.stringMatching(/^TypeScript can't read this file: Unexpected token/),
        severity: 'error',
      },
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

describe('data', () => {
  it('is JSON to the browser too: a key named __proto__ is a key', async () => {
    const tree = variant({
      'data/odd.json': '{"__proto__": {"polluted": true}, "a": 1}',
      'scenes/title.svelte': scene(
        "export const beats = [{ id: 'a' }];",
        '<p>{odd.a}</p>',
        "import odd from '../data/odd.json';",
      ),
    });
    const { manifest, modules } = await buildDeck(tree);
    const code = modules.get(manifest!.imports['@deck/data/odd.json']!)!;
    const odd = (await import(`data:text/javascript,${encodeURIComponent(code)}`)).default;
    expect(Object.hasOwn(odd, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(odd)).toBe(Object.prototype);
    expect(odd.a).toBe(1);
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

  it("reject a name the deck's file doesn't export, which stops the browser loading the scene", async () => {
    const problems = await checkDeck(
      importing(
        "import { Content, Chart } from '../master/index.ts';\nimport format, { visible, hidden } from '../lib/format.ts';",
      ),
    );
    expect(problems).toMatchObject([
      {
        file: 'scenes/title.svelte',
        line: 5,
        rule: 'imports',
        severity: 'error',
        message: expect.stringMatching(
          /^"\.\.\/master\/index\.ts" doesn't export Chart\. It exports Title, .*, Stat, .* and column\. master\/GUIDE\.md says what the master has\.$/,
        ),
      },
      {
        line: 6,
        message: '"../lib/format.ts" has no default export. It exports visible.',
      },
      {
        line: 6,
        message:
          '"../lib/format.ts" doesn\'t export hidden. It exports visible. A type is imported with `import type`.',
      },
    ]);
  });

  it('follow re-exports, and take a type imported as one', async () => {
    const tree = variant({
      'lib/all.ts':
        "export * from './format.ts';\nexport * as format from './format.ts';\nexport { default as Pill } from './Pill.svelte';\nexport { default as tokens } from '../data/tokens.json';\nexport interface Point { x: number }",
      'scenes/title.svelte': scene(
        "export const beats = [{ id: 'a' }];",
        '<p>hi</p>',
        "import { visible, format, Pill, tokens, type Point } from '../lib/all.ts';\nimport Question, { beats as asked } from './question.svelte';",
      ),
    });
    expect(await checkDeck(tree)).toEqual([]);

    const problems = await checkDeck(
      variant({
        'lib/all.ts': "export * from './format.ts';\nexport { hidden } from './format.ts';",
        'scenes/title.svelte': scene(
          "export const beats = [{ id: 'a' }];",
          '<p>hi</p>',
          "import { visible, Point } from '../lib/all.ts';",
        ),
      }),
    );
    expect(problems.map((p) => [p.file, p.message])).toEqual([
      [
        'lib/all.ts',
        '"./format.ts" doesn\'t export hidden. It exports visible. A type is imported with `import type`.',
      ],
      [
        'scenes/title.svelte',
        '"../lib/all.ts" doesn\'t export Point. It exports hidden and visible. A type is imported with `import type`.',
      ],
    ]);
  });

  it('read names as the browser does, escapes and all', async () => {
    const tree = variant({
      'lib/names.js': "const x = 1;\nexport { x as 'a-b' };\nexport const \\u0063 = 2;",
      'lib/use.js':
        "import { 'a\\x2db' as y, c } from './names.js';\nimport { \\u0063 as d } from './names.js';\nexport { 'a-b' as e } from './names.js';\nexport const z = y + c + d;",
      'scenes/title.svelte': scene(
        "export const beats = [{ id: 'a' }];",
        '<p>hi</p>',
        "import { 'a\\u002db' as y } from '../lib/names.js';\nimport { z, e } from '../lib/use.js';",
      ),
    });
    expect(await checkDeck(tree)).toEqual([]);
  });

  it('point at the import that fails, when a file imports one module twice', async () => {
    const problems = await checkDeck(
      variant({
        'scenes/title.svelte': scene(
          "import { motion } from '../master/index.ts';\nexport const beats = [{ id: 'a' }];",
          '<p>hi</p>',
          "import { Title, Hero } from '../master/index.ts';",
        ),
        'lib/x.ts': "import type { T } from './format.ts';\nimport { nope } from './format.ts';",
      }),
    );
    expect(problems.map((p) => [p.file, p.line, p.message.split(' ')[0]]).sort()).toEqual([
      ['lib/x.ts', 2, '"./format.ts"'],
      ['scenes/title.svelte', 6, '"../master/index.ts"'],
    ]);
  });

  it('refuse a name two `export *` bring from different places, as the browser does', async () => {
    const importing = (instance: string, files: Record<string, string>) =>
      checkDeck(
        variant({
          ...files,
          'scenes/title.svelte': scene(
            "export const beats = [{ id: 'a' }];",
            '<p>hi</p>',
            instance,
          ),
        }),
      );
    const stars = { 'lib/top.ts': "export * from './l.ts';\nexport * from './r.ts';" };
    // Two declarations of x: neither counts, here or through another `export *`.
    const two = {
      ...stars,
      'lib/l.ts': 'export const x = 1;',
      'lib/r.ts': 'export const x = 2;',
      'lib/outer.ts': "export * from './top.ts';",
    };
    expect(
      (
        await importing(
          "import { x } from '../lib/top.ts';\nimport { x as y } from '../lib/outer.ts';",
          two,
        )
      ).map((p) => [p.line, p.message]),
    ).toEqual([
      [
        5,
        '"../lib/top.ts" exports x from two of its `export *` modules, which cancel out: export it by name from the one it means.',
      ],
      [
        6,
        '"../lib/outer.ts" exports x from two of its `export *` modules, which cancel out: export it by name from the one it means.',
      ],
    ]);
    // One declaration reached twice, two files with the same code (one module to the browser), a
    // name of the module's own, a namespace, and a circle: all fine.
    for (const files of [
      {
        ...stars,
        'lib/base.ts': 'export const x = 1;',
        'lib/l.ts': "export { x } from './base.ts';",
        'lib/r.ts': "export * from './base.ts';",
      },
      { ...stars, 'lib/l.ts': 'export const x = 1;', 'lib/r.ts': 'export const x = 1;' },
      // An import passed on by name is the imported binding, not one of the file's own.
      {
        ...stars,
        'lib/base.ts': 'export const x = 1;',
        'lib/l.ts': "import { x } from './base.ts';\nexport { x };\nexport const l = 1;",
        'lib/r.ts': "export * from './base.ts';\nexport const r = 2;",
      },
      // A package is one module, whoever passes its names on.
      {
        ...stars,
        'lib/l.ts': "export { gsap as x } from 'gsap';\nexport const l = 1;",
        'lib/r.ts': "import { gsap } from 'gsap';\nexport { gsap as x };\nexport const r = 2;",
      },
      {
        ...two,
        'lib/top.ts': "export * from './l.ts';\nexport * from './r.ts';\nexport const x = 3;",
      },
    ])
      expect(await importing("import { x } from '../lib/top.ts';", files)).toEqual([]);
    expect(await importing("import * as top from '../lib/top.ts';", two)).toEqual([]);
    const circle = {
      'lib/a.ts': "export * from './b.ts';\nexport const x = 1;",
      'lib/b.ts': "export * from './a.ts';\nexport const y = 2;",
    };
    for (const first of ['a', 'b'])
      expect(
        await importing(
          `import { x, y } from '../lib/${first}.ts';\nimport { x as x2, y as y2 } from '../lib/${first === 'a' ? 'b' : 'a'}.ts';`,
          circle,
        ),
      ).toEqual([]);
  });

  it("leave the names of a package's module, re-exported, to the package", async () => {
    const tree = variant({
      'lib/all.ts': "export * from 'gsap';",
      'scenes/title.svelte': scene(
        "export const beats = [{ id: 'a' }];",
        '<p>hi</p>',
        "import { anything } from '../lib/all.ts';",
      ),
    });
    expect(await checkDeck(tree)).toEqual([]);
  });
});

describe('media', () => {
  it("are the deck's own names: nothing an object inherits counts as a file", async () => {
    const problems = await checkDeck(
      variant({
        'scenes/title.svelte': scene(
          "export const beats = [{ id: 'a' }];",
          '<img src={media("constructor")} alt="" />',
          "import { media } from '@tobos/present';",
        ),
        'master/tokens.css': ':root { --x: url(../media/toString); }',
      }),
    );
    expect(problems.map((p) => [p.file, p.rule])).toEqual([
      ['scenes/title.svelte', 'media'],
      ['master/tokens.css', 'media'],
    ]);
  });

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
      { file: 'scenes/sound.svelte', rule: 'media', message: expect.stringContaining('tone.wav') },
      { file: 'scenes/sound.svelte', rule: 'media', message: expect.stringContaining('tone.wav') },
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
          "import { media } from '@tobos/present';\nexport const cow = media('cow.jpg');\nexport const visible = (text: string) => text;",
      }),
    );
    expect(problems).toMatchObject([{ file: 'lib/format.ts', line: 2, rule: 'media' }]);
  });

  it('rejects a malformed media.json', async () => {
    const problems = await checkDeck(variant({ 'media.json': '{"a.jpg": {"hash": "x"}}' }));
    expect(problems).toMatchObject([{ file: 'media.json', rule: 'media-json' }]);
  });

  it('is called by its own name, which the check reads', async () => {
    const problems = await checkDeck(
      variant({
        'scenes/title.svelte': scene(
          "export const beats = [{ id: 'a' }];",
          '<img src={m("scan.png")} alt="" />',
          "import { media as m } from '@tobos/present';",
        ),
      }),
    );
    expect(errors(problems)).toMatchObject([
      {
        file: 'scenes/title.svelte',
        rule: 'media',
        message: expect.stringContaining("`import { media } from '@tobos/present'`"),
      },
    ]);
  });

  it("warns about files media.json lists that no slide shows, but the master's own", async () => {
    const media = JSON.parse(text(sample.read('media.json')));
    const entry = (hash: string, size: number) => ({
      hash: hash.repeat(64),
      size,
      type: 'image/png',
    });
    const listed = (more: Record<string, unknown>) =>
      variant({ 'media.json': JSON.stringify({ ...media, ...more }) });
    expect(
      await checkDeck(
        listed({ 'old/a.png': entry('a', 1_500_000), 'old/b.png': entry('b', 1_000_000) }),
      ),
    ).toEqual([
      {
        file: 'media.json',
        rule: 'media',
        message:
          "media.json lists 2 files no slide shows (2.5 MB): old/a.png and old/b.png. They don't count toward the plan, and the server keeps them for 7 days: to show one after that, drop it again, or push it from media/.",
        severity: 'warning',
      },
    ]);
    expect(await checkDeck(listed({ 'master/unused.png': entry('c', 1000) }))).toEqual([]);
  });
});

describe('what a share gets', () => {
  const entry = (hash: string) => ({ hash: hash.repeat(64), size: 1000, type: 'image/png' });
  const deck = JSON.parse(text(sample.read('deck.json')));
  deck.chapters[0].scenes.push({ id: 'quiz', title: 'Quiz' });
  const tree = variant({
    'deck.json': JSON.stringify(deck),
    'media.json': JSON.stringify({
      ...JSON.parse(text(sample.read('media.json'))),
      'frames/a.png': entry('a'),
      'frames/b.png': entry('b'),
      'later.png': entry('c'),
      'quiz/answer.png': entry('d'),
      'quiz/reveal.png': entry('e'),
      'draft.png': entry('f'),
      'old/deleted.png': entry('0'),
    }),
    'scenes/title.svelte': scene(
      "export const beats = [{ id: 'a' }];\nexport const preload = () => import('../lib/later.ts');",
      '<Frame kind="a" />',
      "import Frame from '../lib/Frame.svelte';",
    ),
    'lib/Frame.svelte':
      '<script lang="ts">\n  import { media } from \'@tobos/present\';\n  let { kind }: { kind: string } = $props();\n</script>\n<img src={media(`frames/${kind}.png`)} alt="" />\n',
    'lib/later.ts':
      "import { media } from '@tobos/present';\nexport const later = media('later.png');\n",
    'scenes/quiz.svelte': scene(
      "export const beats = [{ id: 'ask' }, { id: 'result' }];\nexport const activity = { id: 'quiz', kind: 'choice', prompt: 'Which?', options: ['A', 'B'], reveals: 'result' };",
      '<Frame kind="b" /><img src={media("quiz/answer.png")} alt="" /><Reveal />',
      "import { media } from '@tobos/present';\nimport Frame from '../lib/Frame.svelte';\nimport Reveal from './quiz/Reveal.svelte';",
    ),
    'scenes/quiz/Reveal.svelte':
      '<script lang="ts">\n  import { media } from \'@tobos/present\';\n</script>\n<img src={media(\'quiz/reveal.png\')} alt="" />\n',
    'scenes/draft.svelte': scene(
      "export const beats = [{ id: 'a' }];",
      '<img src={media("draft.png")} alt="" />',
      "import { media } from '@tobos/present';",
    ),
  });

  it('is recorded in the manifest: what each module imports, and the media it shows', async () => {
    const { manifest, problems } = await buildDeck(tree);
    expect(errors(problems)).toEqual([]);
    const { modules, styles } = manifest!.uses!;
    expect(Object.keys(modules)).toEqual(Object.keys(manifest!.imports));
    expect(modules['@deck/scenes/title.svelte']).toEqual({
      imports: ['@deck/lib/Frame.svelte', '@deck/lib/later.ts'],
    });
    // A pattern as written, which a share matches against media.json.
    expect(modules['@deck/lib/Frame.svelte']).toEqual({ patterns: ['frames/*.png'] });
    expect(modules['@deck/scenes/quiz.svelte']).toEqual({
      imports: ['@deck/lib/Frame.svelte', '@deck/scenes/quiz/Reveal.svelte'],
      media: ['quiz/answer.png'],
    });
    expect(modules['@deck/data/tokens.json']).toEqual({});
    expect(styles).toContain('master/fonts/hanken-grotesk-latin.woff2');
    expect(styles.every((name) => name in manifest!.media)).toBe(true);
  });

  it('is what the scenes it shows reach, and no more', async () => {
    const { manifest } = await buildDeck(tree);
    const shared = sharedManifest(manifest!);
    const imports = Object.keys(shared.imports);
    for (const kept of [
      '@deck/scenes/title.svelte',
      '@deck/lib/Frame.svelte',
      '@deck/lib/later.ts',
      '@deck/lib/Pill.svelte',
      '@deck/data/tokens.json',
      '@deck/master/index.ts',
    ])
      expect(imports).toContain(kept);
    for (const left of [
      '@deck/scenes/quiz.svelte',
      '@deck/scenes/quiz/Reveal.svelte',
      '@deck/scenes/draft.svelte',
    ])
      expect(imports).not.toContain(left);
    expect(
      Object.keys(shared.media)
        .filter((name) => !name.startsWith('master/'))
        .sort(),
    ).toEqual(['clip.webm', 'frames/a.png', 'frames/b.png', 'later.png', 'scan.png', 'tone.wav']);
    expect(Object.keys(shared.media)).toContain('master/fonts/hanken-grotesk-latin.woff2');
  });

  it('leaves out what nothing uses, which the check warns about with what no slide shows', async () => {
    const { problems } = await buildDeck(tree);
    // A scene deck.json doesn't list shows nothing, so its file is on no slide either.
    expect(problems.filter((p) => p.file === 'media.json')).toMatchObject([
      {
        rule: 'media',
        severity: 'warning',
        message: expect.stringContaining(
          'lists 2 files no slide shows (2 KB): draft.png and old/deleted.png.',
        ),
      },
    ]);
  });

  it('grows with the modules and media.json, not with the one times the other', async () => {
    // Modules that each show files by the same pattern, and many files it matches.
    const build = async (modules: number, files: number) => {
      const media = JSON.parse(text(sample.read('media.json')));
      for (let i = 0; i < files; i++)
        media[`parts/${i}.png`] = {
          hash: i.toString(16).padStart(64, '0'),
          size: 1000,
          type: 'image/png',
        };
      const parts: Record<string, string> = {};
      for (let i = 0; i < modules; i++)
        parts[`lib/parts/${i}.ts`] =
          "import { media } from '@tobos/present';\nexport const part = (name: string) => media(`parts/${name}.png`);\n";
      const { manifest, problems } = await buildDeck(
        variant({
          ...parts,
          'lib/parts.ts': Object.keys(parts)
            .map((_, i) => `export { part as part${i} } from './parts/${i}.ts';`)
            .join('\n'),
          'media.json': JSON.stringify(media),
          'scenes/title.svelte': scene(
            "export const beats = [{ id: 'a' }];",
            '<img src={part0("0")} alt="" />',
            "import { part0 } from '../lib/parts.ts';",
          ),
        }),
      );
      expect(errors(problems)).toEqual([]);
      return manifest!;
    };
    const size = (manifest: Manifest) => JSON.stringify(manifest).length;
    const small = await build(50, 1000);
    const large = await build(100, 2000);
    // Twice the modules and twice the files make about twice the manifest, not four times.
    expect(size(large)).toBeLessThan(2.2 * size(small));
    expect(large.uses!.modules['@deck/lib/parts/99.ts']).toEqual({ patterns: ['parts/*.png'] });
    // A share still gets every file the pattern matches.
    const shared = Object.keys(sharedManifest(large).media);
    expect(shared.filter((name) => name.startsWith('parts/'))).toHaveLength(2000);
  });
});

describe("media() through the deck's own files", () => {
  const titled = (body: string, instance: string, more: Record<string, string> = {}) =>
    variant({
      'scenes/title.svelte': scene("export const beats = [{ id: 'a' }];", body, instance),
      ...more,
    });

  it("is read where one of them passes the engine's on", async () => {
    const { manifest, problems } = await buildDeck(
      titled(
        '<img src={media("scan.png")} alt="" /><img src={tools.media(`${name}.webm`)} alt="" />',
        "import { media } from '../lib/engine.ts';\nimport * as tools from '../lib/tools.ts';\nconst name = 'clip';",
        {
          'lib/engine.ts': "export { media, useDeck } from '@tobos/present';\n",
          'lib/tools.ts': "export * from './engine.ts';\nexport const two = 2;\n",
        },
      ),
    );
    expect(errors(problems)).toEqual([]);
    expect(manifest!.uses!.modules['@deck/scenes/title.svelte']).toMatchObject({
      media: ['scan.png'],
      patterns: ['*.webm'],
    });
  });

  it("leaves alone a `media` of the deck's own", async () => {
    const problems = await checkDeck(
      titled('<p>{media.phone}</p>', "import { media as m, media } from '../lib/queries.ts';", {
        'lib/queries.ts': "export const media = { phone: '(max-width: 600px)' };\n",
      }),
    );
    expect(errors(problems)).toEqual([]);
  });

  it("refuses it under another name, or as a value, where one passes the engine's on", async () => {
    const refused = async (instance: string, more: Record<string, string> = {}) =>
      errors(
        await checkDeck(
          titled('<p>hi</p>', instance, {
            'lib/engine.ts': "export * from '@tobos/present';\n",
            ...more,
          }),
        ),
      ).map((p) => [p.file, p.line, p.rule]);
    expect(await refused("import { media as m } from '../lib/engine.ts';")).toEqual([
      ['scenes/title.svelte', 5, 'media'],
    ]);
    expect(
      await refused("import * as engine from '../lib/engine.ts';\nconst m = engine.media;"),
    ).toEqual([['scenes/title.svelte', 6, 'media']]);
    expect(await refused("const later = () => import('../lib/engine.ts');")).toEqual([
      ['scenes/title.svelte', 5, 'media'],
    ]);
    expect(
      await refused('', { 'lib/more.ts': "export * as engine from './engine.ts';\n" }),
    ).toEqual([['lib/more.ts', 1, 'media']]);
    const [problem] = errors(
      await checkDeck(
        titled('<p>hi</p>', "import { media as m } from '../lib/engine.ts';", {
          'lib/engine.ts': "export * from '@tobos/present';\n",
        }),
      ),
    );
    expect(problem!.message).toContain("`import { media } from '@tobos/present'`");
    expect(problem!.message).toContain('a share link gets only those');
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

  it('read code, not what a slide says or a comment', async () => {
    for (const body of [
      '<Content><p>Write font-size: 12px, and font: 10px serif, in your CSS.</p></Content>',
      '<Content><p>See url(https://example.com/x.png).</p></Content>',
      '<Content><!-- font-size: 12px --><p>a</p></Content>',
      '<Content><img alt="Set font-size: 12px" title="font: 10px serif" src="x" /></Content>',
      '<Content><p>a</p></Content>\n<style>/* p { font-size: 12px } */ p { color: red; }</style>',
    ])
      expect(await rulesOf(body), body).toEqual([]);
    expect(
      await rulesOf(
        '<Content><p>a</p></Content>',
        "import { Content } from '../master/index.ts';\n// const grow = { fontSize: 12 };\n/* animation: pulse 1s infinite */",
      ),
    ).toEqual([]);
    // The same, as code, still counts.
    expect(
      await rulesOf('<Content><p style="font-size: 12px">Write font-size: 12px</p></Content>'),
    ).toEqual([['master/min-font-size', 'error']]);
  });

  it('reject the network, which the viewer blocks', async () => {
    for (const call of [
      "window.fetch('https://example.com/data.json');",
      "globalThis.fetch('/data.json');",
      "navigator.sendBeacon('https://example.com', 'x');",
      "new window.WebSocket('wss://example.com');",
    ])
      expect(
        await rulesOf(
          '<Content>a</Content>',
          `import { Content } from '../master/index.ts';\n${call}`,
        ),
        call,
      ).toEqual([['network', 'error']]);
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

describe('source anyone can push', () => {
  // The server checks every push in its one process, so no file may make a check slow. These
  // took seconds at 2,000 characters before; at 50,000 they would take hours.
  const long = 50_000;
  const inputs: Record<string, Record<string, string>> = {
    "url( in tokens.css that doesn't close": {
      'master/tokens.css': `${text(sample.read('master/tokens.css'))}a { b: url(${' '.repeat(long)}`,
    },
    'style:font-size with no size': { 'lib/a.js': `// style:font-size=${' '.repeat(long)}` },
    'font: with no size': { 'lib/a.js': `// ${'font:'.repeat(long)}` },
    'animation: with no end': { 'lib/a.js': `// ${'animation:'.repeat(long)}` },
  };

  for (const [name, files] of Object.entries(inputs))
    it(`checks ${name} in linear time`, async () => {
      const started = performance.now();
      await checkDeck(variant({ ...files, 'master/master.json': RULES }));
      expect(performance.now() - started).toBeLessThan(3000);
    });

  it('still finds what those patterns are for', async () => {
    const problems = await checkDeck(
      variant({
        'master/master.json': RULES,
        'lib/a.js': [
          "export const a = 'font: italic 20px serif';",
          'export const b = \'style:font-size = { "14px" }\';',
          "export const c = 'animation: pulse 1s infinite';",
        ].join('\n'),
        'master/tokens.css': `${text(sample.read('master/tokens.css'))}a { b: url( 'nowhere.png' ); }`,
      }),
    );
    expect(problems.map((p) => [p.file, p.rule, p.line])).toEqual(
      expect.arrayContaining([
        ['lib/a.js', 'master/min-font-size', 1],
        ['lib/a.js', 'master/min-font-size', 2],
        ['lib/a.js', 'motion/loop', 3],
        ['master/tokens.css', 'media', expect.any(Number)],
      ]),
    );
  });
});
