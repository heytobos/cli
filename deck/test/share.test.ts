import { describe, expect, it } from 'vitest';
import { servesModule, sharedManifest, type Manifest } from '../src/index.ts';

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
