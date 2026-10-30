import { describe, expect, it } from 'vitest';
import { mediaInUse, servesModule, sharedManifest, type Manifest } from '../src/index.ts';

const manifest: Manifest = {
  format: 1,
  title: 'Lecture',
  chapters: [
    {
      id: 'one',
      title: 'One',
      scenes: [
        {
          id: 'title',
          title: 'Title',
          // @ts-expect-error A scene's note, which deck.json no longer has.
          note: 'Wait for the room to settle.',
          beats: ['title'],
          module: '@deck/scenes/title.svelte',
        },
        {
          id: 'poll',
          title: 'Poll',
          beats: ['ask', 'result'],
          module: '@deck/scenes/poll.svelte',
          activity: {
            id: 'used-llm-api',
            kind: 'choice',
            prompt: 'Have you called an LLM API yourself?',
            options: ['Never', 'Regularly'],
            reveals: 'result',
          },
        },
      ],
    },
    {
      id: 'two',
      title: 'Two',
      scenes: [
        {
          id: 'wishes',
          title: 'Wishes',
          beats: ['ask'],
          module: '@deck/scenes/wishes.svelte',
          activity: { id: 'course-wishes', kind: 'text', fields: [{ id: 'a', label: 'A' }] },
        },
      ],
    },
  ],
  imports: {
    '@deck/scenes/title.svelte': 'm/0123456789abcdef0123.js',
    '@deck/scenes/poll.svelte': 'm/1111111111aaaaaaaaaa.js',
    '@deck/scenes/wishes.svelte': 'm/2222222222bbbbbbbbbb.js',
    '@deck/lib/chart.ts': 'm/3333333333cccccccccc.js',
  },
  styles: ['m/4444444444dddddddddd.css'],
  media: {},
  dependencies: {},
  packages: {},
};

describe('sharedManifest', () => {
  const shared = sharedManifest(manifest);

  it('leaves out the scenes with an activity, and chapters with nothing left', () => {
    expect(shared.chapters.map((c) => c.scenes.map((s) => s.id))).toEqual([['title']]);
  });

  it('leaves out a note an older push left in the manifest', () => {
    expect(shared.chapters[0]!.scenes[0]).not.toHaveProperty('note');
    expect(shared.chapters[0]!.scenes[0]).toMatchObject({ id: 'title', beats: ['title'] });
  });

  it('leaves the scenes it leaves out out of the import map: their code holds their prompts', () => {
    expect(shared.imports).toEqual({
      '@deck/scenes/title.svelte': 'm/0123456789abcdef0123.js',
      '@deck/lib/chart.ts': 'm/3333333333cccccccccc.js',
    });
  });

  it('keeps the rest, and the manifest it was given as it was', () => {
    expect(shared.styles).toEqual(manifest.styles);
    expect(manifest.chapters[0]!.scenes[0]).toHaveProperty('note', 'Wait for the room to settle.');
    expect(manifest.chapters[0]!.scenes).toHaveLength(2);
    expect(Object.keys(manifest.imports)).toHaveLength(4);
  });
});

describe('sharedManifest, with what each module uses', () => {
  const entry = (hash: string) => ({ hash: hash.repeat(64), size: 1000, type: 'image/png' });
  const recorded: Manifest = {
    ...manifest,
    imports: {
      '@deck/data/answers.json': 'm/5555555555eeeeeeeeee.js',
      '@deck/lib/Chart.svelte': 'm/3333333333cccccccccc.js',
      '@deck/lib/unused.ts': 'm/6666666666ffffffffff.js',
      '@deck/master/index.ts': 'm/7777777777aaaaaaaaaa.js',
      '@deck/scenes/draft.svelte': 'm/8888888888bbbbbbbbbb.js',
      '@deck/scenes/poll.svelte': 'm/1111111111aaaaaaaaaa.js',
      '@deck/scenes/poll/Reveal.svelte': 'm/9999999999cccccccccc.js',
      '@deck/scenes/title.svelte': 'm/0123456789abcdef0123.js',
      '@deck/scenes/wishes.svelte': 'm/2222222222bbbbbbbbbb.js',
      d3: 'p/0123456789abcdef/d3.js',
    },
    media: {
      'cover.png': entry('a'),
      'chart/a.png': entry('b'),
      'chart/b.png': entry('c'),
      'quiz/answer.png': entry('d'),
      'quiz/reveal.png': entry('e'),
      'old/deleted.png': entry('f'),
      'draft.png': entry('0'),
      'master/fonts/a.woff2': entry('1'),
      'master/logo.svg': entry('2'),
    },
    uses: {
      modules: {
        '@deck/data/answers.json': {},
        '@deck/lib/Chart.svelte': { patterns: ['chart/*.png'] },
        '@deck/lib/unused.ts': {},
        '@deck/master/index.ts': { media: ['master/logo.svg'] },
        '@deck/scenes/draft.svelte': { media: ['draft.png'] },
        '@deck/scenes/poll.svelte': {
          imports: ['@deck/lib/Chart.svelte', '@deck/scenes/poll/Reveal.svelte'],
          media: ['quiz/answer.png'],
        },
        '@deck/scenes/poll/Reveal.svelte': {
          imports: ['@deck/data/answers.json'],
          patterns: ['quiz/*.png'],
        },
        '@deck/scenes/title.svelte': {
          imports: ['@deck/lib/Chart.svelte', '@deck/master/index.ts'],
          media: ['cover.png'],
        },
        '@deck/scenes/wishes.svelte': { imports: ['@deck/master/index.ts'] },
      },
      styles: ['master/fonts/a.woff2'],
    },
  };
  const shared = sharedManifest(recorded);

  it('gives the modules the scenes it shows reach, and the packages, and no other', () => {
    expect(Object.keys(shared.imports)).toEqual([
      '@deck/lib/Chart.svelte',
      '@deck/master/index.ts',
      '@deck/scenes/title.svelte',
      'd3',
    ]);
  });

  it('gives the media the scenes it shows use, and the stylesheet’s, and no other', () => {
    expect(Object.keys(shared.media).sort()).toEqual([
      'chart/a.png',
      'chart/b.png',
      'cover.png',
      'master/fonts/a.woff2',
      'master/logo.svg',
    ]);
    expect(shared.media['cover.png']).toEqual(recorded.media['cover.png']);
  });

  it('says nothing of what the scenes it leaves out use', () => {
    expect(shared).not.toHaveProperty('uses');
    expect(JSON.stringify(shared)).not.toMatch(/quiz|Reveal|draft|deleted|unused|answers/);
    expect(servesModule(shared, 'm/9999999999cccccccccc.js')).toBe(false);
    expect(servesModule(shared, 'm/8888888888bbbbbbbbbb.js')).toBe(false);
    expect(servesModule(shared, 'm/3333333333cccccccccc.js')).toBe(true);
  });

  it('leaves out what it has no record of, rather than giving more', () => {
    const { modules } = recorded.uses!;
    const unrecorded = sharedManifest({
      ...recorded,
      uses: { modules: { ...modules, '@deck/scenes/title.svelte': {} }, styles: [] },
    });
    expect(Object.keys(unrecorded.imports)).toEqual(['@deck/scenes/title.svelte', 'd3']);
    expect(unrecorded.media).toEqual({});
  });

  it("matches a pattern as its format wrote it: media()'s `*` across folders, a glob's within one", () => {
    const deeper = { ...recorded, media: { ...recorded.media, 'chart/old/c.png': entry('3') } };
    expect(Object.keys(sharedManifest(deeper).media)).toContain('chart/old/c.png');
    const globbed = Object.keys(sharedManifest({ ...deeper, format: 2 }).media);
    expect(globbed).toContain('chart/a.png');
    expect(globbed).not.toContain('chart/old/c.png');
    expect(Object.keys(mediaInUse({ ...deeper, format: 2 }))).not.toContain('chart/old/c.png');
  });

  it('shares a manifest pushed before the build recorded it as it did then', () => {
    expect(shared.chapters).toEqual(sharedManifest(manifest).chapters);
    const before = sharedManifest({ ...recorded, uses: undefined });
    expect(Object.keys(before.imports)).not.toContain('@deck/scenes/poll.svelte');
    expect(Object.keys(before.imports)).toContain('@deck/scenes/poll/Reveal.svelte');
    expect(before.media).toEqual(recorded.media);
  });
});

describe('mediaInUse', () => {
  const entry = (hash: string) => ({ hash: hash.repeat(64), size: 1000, type: 'image/png' });
  const recorded: Manifest = {
    ...manifest,
    media: {
      'cover.png': entry('a'),
      'chart/a.png': entry('b'),
      'quiz/answer.png': entry('c'),
      'quiz/reveal.png': entry('d'),
      'old/deleted.png': entry('e'),
      'draft.png': entry('f'),
      'brand.png': entry('0'),
      'master/fonts/a.woff2': entry('1'),
      'master/fonts/LICENSE.txt': entry('2'),
    },
    uses: {
      modules: {
        '@deck/lib/Chart.svelte': { patterns: ['chart/*.png'] },
        '@deck/master/Brand.svelte': { media: ['brand.png'] },
        '@deck/scenes/draft.svelte': { media: ['draft.png'] },
        '@deck/scenes/poll.svelte': {
          imports: ['@deck/scenes/poll/Reveal.svelte'],
          media: ['quiz/answer.png'],
        },
        '@deck/scenes/poll/Reveal.svelte': { patterns: ['quiz/*.png'] },
        '@deck/scenes/title.svelte': {
          imports: ['@deck/lib/Chart.svelte'],
          media: ['cover.png'],
        },
      },
      styles: ['master/fonts/a.woff2'],
    },
  };

  it("is what deck.json's scenes reach, polls too, the master's and tokens.css's", () => {
    expect(Object.keys(mediaInUse(recorded)).sort()).toEqual([
      'brand.png',
      'chart/a.png',
      'cover.png',
      'master/fonts/LICENSE.txt',
      'master/fonts/a.woff2',
      'quiz/answer.png',
      'quiz/reveal.png',
    ]);
    expect(mediaInUse(recorded)['cover.png']).toEqual(recorded.media['cover.png']);
  });

  it("leaves out a scene deck.json doesn't list, and a file nothing names", () => {
    const used = mediaInUse(recorded);
    expect(used).not.toHaveProperty('draft.png');
    expect(used).not.toHaveProperty('old/deleted.png');
  });

  it('is all of media.json in a manifest pushed before the build recorded what it uses', () => {
    expect(mediaInUse({ ...recorded, uses: undefined })).toEqual(recorded.media);
  });
});

describe('servesModule', () => {
  it('serves the modules and stylesheets a manifest names, and no other', () => {
    const shared = sharedManifest(manifest);
    expect(servesModule(shared, 'm/0123456789abcdef0123.js')).toBe(true);
    expect(servesModule(shared, 'm/4444444444dddddddddd.css')).toBe(true);
    expect(servesModule(shared, 'm/1111111111aaaaaaaaaa.js')).toBe(false);
    expect(servesModule(manifest, 'm/1111111111aaaaaaaaaa.js')).toBe(true);
    expect(servesModule(manifest, 'm/9999999999eeeeeeeeee.js')).toBe(false);
  });
});
