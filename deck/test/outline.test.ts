import { describe, expect, it } from 'vitest';
import {
  buildScenes,
  chapterId,
  chaptersOf,
  currentBuild,
  ID,
  joinOutline,
  legacyOutline,
  mediaInUse,
  NO_CHAPTER,
  outlineFrom,
  parseOutline,
  unplacedScenes,
  type Build,
  type LegacyBuild,
  type Outline,
} from '../src/index.ts';

const scene = (id: string) => ({ beats: ['a'], module: `@deck/scenes/${id}.svelte` });
const build: Build = {
  format: 2,
  scenes: { intro: scene('intro'), backup: scene('backup'), draft: scene('draft') },
  imports: {},
  media: {},
  dependencies: {},
  packages: {},
  uses: { modules: {}, styles: [] },
};
const outline: Outline = {
  title: 'Lecture',
  chapters: [
    {
      id: 'opening',
      title: 'Opening',
      scenes: [
        { id: 'intro', title: 'Intro' },
        { id: 'gone', title: 'A scene whose file went' },
      ],
    },
    { id: 'later', title: 'Later', scenes: [{ id: 'backup', title: 'Backup', hidden: true }] },
    { id: 'empty', title: 'Nothing yet', scenes: [] },
  ],
};

describe('joinOutline', () => {
  it('reads the outline’s order, titles and hidden scenes onto the build’s scenes', () => {
    const manifest = joinOutline(build, outline);
    expect(manifest.title).toBe('Lecture');
    expect(manifest).not.toHaveProperty('scenes');
    expect(manifest.chapters).toEqual([
      {
        id: 'opening',
        title: 'Opening',
        scenes: [{ id: 'intro', title: 'Intro', ...scene('intro') }],
      },
      {
        id: 'later',
        title: 'Later',
        scenes: [{ id: 'backup', title: 'Backup', hidden: true, ...scene('backup') }],
      },
    ]);
  });

  it('reads a build stored before the outline left deck.json, which listed its scenes', () => {
    const legacy: LegacyBuild = {
      ...build,
      title: 'Old',
      chapters: [
        { id: 'c', title: 'C', scenes: [{ id: 'intro', title: 'Old intro', ...scene('intro') }] },
      ],
    };
    delete (legacy as Partial<Build>).scenes;
    expect(buildScenes(legacy)).toEqual({ intro: scene('intro') });
    expect(legacyOutline(legacy)).toEqual({
      title: 'Old',
      chapters: [{ id: 'c', title: 'C', scenes: [{ id: 'intro', title: 'Old intro' }] }],
    });
    const joined = joinOutline(legacy, outline);
    expect(joined.title).toBe('Lecture');
    expect(joined.chapters.flatMap((c) => c.scenes.map((s) => s.title))).toEqual(['Intro']);
    expect(mediaInUse(legacy)).toEqual({});
    // Stored again as a build of now: its scenes, no outline of its own to fill a deck's from.
    const current = currentBuild(legacy);
    expect(current).not.toHaveProperty('chapters');
    expect(current).not.toHaveProperty('title');
    expect(current.scenes).toEqual({ intro: scene('intro') });
    expect(currentBuild(build)).toBe(build);
  });

  it('says which scenes wait to be placed', () => {
    expect(unplacedScenes(build, outline)).toEqual(['draft']);
    expect(unplacedScenes(build, { title: 'T', scenes: [{ id: 'intro', title: 'I' }] })).toEqual([
      'backup',
      'draft',
    ]);
  });

  it('gives a deck with no chapters one with no id and no title, which layouts name nothing of', () => {
    const manifest = joinOutline(build, {
      title: 'Flat',
      scenes: [
        { id: 'backup', title: 'Backup' },
        { id: 'intro', title: 'Intro', hidden: true },
      ],
    });
    expect(manifest.chapters).toEqual([
      {
        id: '',
        title: '',
        scenes: [
          { id: 'backup', title: 'Backup', ...scene('backup') },
          { id: 'intro', title: 'Intro', hidden: true, ...scene('intro') },
        ],
      },
    ]);
  });
});

describe('a deck with no chapters', () => {
  const flat = [{ id: 'a', title: 'A' }];

  it('is one chapter with no id inside Tobos, and `scenes` in the outline’s JSON', () => {
    expect(chaptersOf({ title: 'T', scenes: flat })).toEqual([
      { id: NO_CHAPTER, title: '', scenes: flat },
    ]);
    expect(chaptersOf({ title: 'T', chapters: [] })).toEqual([
      { id: NO_CHAPTER, title: '', scenes: [] },
    ]);
    expect(chaptersOf(outline)).toBe(outline.chapters);
    expect(outlineFrom('T', [{ id: NO_CHAPTER, title: '', scenes: flat }])).toEqual({
      title: 'T',
      scenes: flat,
    });
    expect(outlineFrom('T', [])).toEqual({ title: 'T', scenes: [] });
    expect(outlineFrom('T', outline.chapters)).toEqual({ title: 'T', chapters: outline.chapters });
  });
});

describe('chapterId', () => {
  it('makes six lowercase letters and digits, from a letter, none taken', () => {
    const ids = Array.from({ length: 200 }, () => chapterId());
    for (const id of ids) {
      expect(id).toMatch(/^[a-z][a-z0-9]{5}$/);
      expect(id).toMatch(ID);
    }
    expect(new Set(ids).size).toBeGreaterThan(190);
    let calls = 0;
    expect(chapterId(() => ++calls < 3)).toMatch(/^[a-z][a-z0-9]{5}$/);
    expect(calls).toBe(3);
  });
});

describe('outline.json', () => {
  const written = (value: unknown) => parseOutline(JSON.stringify(value));

  it('is read as Tobos holds an outline, titles trimmed and only what it reads', () => {
    const { outline: read, problems } = written({
      title: ' Talk ',
      notes: 'ours',
      chapters: [
        { id: 'a', title: 'A', colour: 'red', scenes: [{ id: 's', title: 'S', hidden: false }] },
      ],
    });
    expect(problems).toEqual([]);
    expect(read).toEqual({
      title: 'Talk',
      chapters: [{ id: 'a', title: 'A', scenes: [{ id: 's', title: 'S' }] }],
    });
  });

  it('is read with `scenes` in place of `chapters`, for a deck with none', () => {
    expect(written({ title: 'Talk', scenes: [{ id: 's', title: ' S ' }] })).toEqual({
      outline: { title: 'Talk', scenes: [{ id: 's', title: 'S' }] },
      problems: [],
    });
    const messages = (value: unknown) => written(value).problems.map((p) => p.message);
    expect(messages({ title: 'T', chapters: [], scenes: [] })).toEqual([
      'An outline has "chapters" or, for a deck with none, "scenes": not both.',
    ]);
    expect(messages({ title: 'T' })).toEqual([
      '"chapters" must be a list, or "scenes" for a deck with no chapters.',
      expect.stringContaining('At least one scene has to show'),
    ]);
    expect(messages({ title: 'T', scenes: [{ id: 'S', title: 'S' }] })).toEqual([
      'scenes[0].id must be lowercase letters, digits and dashes.',
    ]);
  });

  it('keeps the rules every change to an outline keeps', () => {
    const messages = (value: unknown) => written(value).problems.map((p) => p.message);
    expect(
      messages({
        title: 'x'.repeat(201),
        chapters: [
          {
            id: 'A',
            title: 'A',
            scenes: [
              { id: 's', title: 'S', hidden: true },
              { id: 's', title: 'S', hidden: true },
            ],
          },
        ],
      }),
    ).toEqual([
      '"title" is 201 characters; at most 200.',
      'chapters[0].id must be lowercase letters, digits and dashes.',
      'Scene "s" is listed twice.',
      expect.stringContaining('At least one scene has to show'),
    ]);
    const many = Array.from({ length: 501 }, (_, i) => ({ id: `s${i}`, title: 'S' }));
    expect(messages({ title: 'T', chapters: [{ id: 'a', title: 'A', scenes: many }] })).toEqual([
      '501 scenes; a deck may have 500.',
    ]);
  });
});
