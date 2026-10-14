import { describe, expect, it } from 'vitest';
import { openActivity, type Activity, type Manifest } from '../src/index.ts';

const poll: Activity = {
  id: 'used-llm-api',
  kind: 'choice',
  prompt: 'Have you called an LLM API yourself?',
  options: ['Never', 'Once or twice', 'Regularly'],
  reveals: 'result',
};
const form: Activity = {
  id: 'course-wishes',
  kind: 'text',
  fields: [{ id: 'amazing', label: 'What would make this course amazing?', max: 500 }],
};

const manifest: Manifest = {
  format: 1,
  title: 'Lecture',
  chapters: [
    {
      id: 'one',
      title: 'One',
      scenes: [
        { id: 'title', title: 'Title', beats: ['title'], module: '@deck/scenes/title.svelte' },
        {
          id: 'poll',
          title: 'Poll',
          beats: ['intro', 'ask', 'result', 'after'],
          module: '@deck/scenes/poll.svelte',
          activity: poll,
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
          beats: ['ask', 'thanks'],
          module: '@deck/scenes/wishes.svelte',
          activity: form,
        },
      ],
    },
  ],
  imports: {},
  media: {},
  dependencies: {},
  packages: {},
};

const at = (scene: string, beat: string) => openActivity(manifest, { scene, beat });

describe('openActivity', () => {
  it('is nothing before the scene and on scenes without one', () => {
    expect(at('title', 'title')).toBeUndefined();
  });

  it("is the scene's activity from its first beat up to its reveals beat", () => {
    expect(at('poll', 'intro')).toBe(poll);
    expect(at('poll', 'ask')).toBe(poll);
  });

  it('closes at the reveals beat and stays closed after it', () => {
    expect(at('poll', 'result')).toBeUndefined();
    expect(at('poll', 'after')).toBeUndefined();
  });

  it('is open on every beat of a scene without reveals', () => {
    expect(at('wishes', 'ask')).toBe(form);
    expect(at('wishes', 'thanks')).toBe(form);
  });

  it('is nothing at a position the manifest does not have', () => {
    expect(at('gone', 'ask')).toBeUndefined();
    expect(at('poll', 'gone')).toBeUndefined();
  });
});
