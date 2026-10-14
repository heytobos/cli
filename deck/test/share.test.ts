import { describe, expect, it } from 'vitest';
import { sharedManifest, type Manifest } from '../src/index.ts';

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
  imports: { '@deck/scenes/title.svelte': 'm/0123456789abcdef0123.js' },
  media: {},
  dependencies: {},
  packages: {},
};

describe('sharedManifest', () => {
  const shared = sharedManifest(manifest);

  it('leaves out the scenes with an activity, and chapters with nothing left', () => {
    expect(shared.chapters.map((c) => c.scenes.map((s) => s.id))).toEqual([['title']]);
  });

  it("leaves out the scenes' notes", () => {
    expect(shared.chapters[0]!.scenes[0]).not.toHaveProperty('note');
    expect(shared.chapters[0]!.scenes[0]).toMatchObject({ id: 'title', beats: ['title'] });
  });

  it('keeps the rest, and the manifest it was given as it was', () => {
    expect(shared.imports).toEqual(manifest.imports);
    expect(manifest.chapters[0]!.scenes[0]!.note).toBe('Wait for the room to settle.');
    expect(manifest.chapters[0]!.scenes).toHaveLength(2);
  });
});
