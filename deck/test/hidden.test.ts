import { describe, expect, it } from 'vitest';
import { parseDeckJson, setSceneHidden } from '../src/index.ts';

/** deck.json as an agent may write it: one scene a line, another over several. */
const written = `{
  "title": "Lecture",
  "chapters": [
    {
      "id": "opening",
      "title": "Opening",
      "scenes": [
        { "id": "title", "title": "Title" },
        {
          "id": "backup",
          "title": "Backup: the \\"raw\\" table"
        }
      ]
    }
  ]
}
`;

describe('setSceneHidden', () => {
  it('adds "hidden": true to a scene on one line, after its last key', () => {
    expect(setSceneHidden(written, 'title', true)).toBe(
      written.replace(
        '{ "id": "title", "title": "Title" }',
        '{ "id": "title", "title": "Title", "hidden": true }',
      ),
    );
  });

  it('adds it on a line of its own, indented as the keys, to a scene over several lines', () => {
    expect(setSceneHidden(written, 'backup', true)).toBe(
      written.replace(
        '"title": "Backup: the \\"raw\\" table"\n',
        '"title": "Backup: the \\"raw\\" table",\n          "hidden": true\n',
      ),
    );
  });

  it('takes it out again, leaving the file as it was', () => {
    for (const id of ['title', 'backup']) {
      const hidden = setSceneHidden(written, id, true)!;
      expect(setSceneHidden(hidden, id, false)).toBe(written);
    }
  });

  it('takes it out first or in the middle, with the comma that joined it', () => {
    const first =
      '{"title":"x","chapters":[{"id":"a","title":"A","scenes":[{"hidden":true,"id":"s","title":"S"}]}]}';
    expect(setSceneHidden(first, 's', false)).toBe(
      '{"title":"x","chapters":[{"id":"a","title":"A","scenes":[{"id":"s","title":"S"}]}]}',
    );
    const middle =
      '{"title":"x","chapters":[{"id":"a","title":"A","scenes":[{"id":"s", "hidden": false, "title":"S"}]}]}';
    expect(setSceneHidden(middle, 's', false)).toBe(
      '{"title":"x","chapters":[{"id":"a","title":"A","scenes":[{"id":"s", "title":"S"}]}]}',
    );
    expect(setSceneHidden(middle, 's', true)).toBe(middle.replace('false', 'true'));
  });

  it('changes nothing to show a scene that shows, and reads the result back as hidden', () => {
    expect(setSceneHidden(written, 'title', false)).toBe(written);
    const { deck } = parseDeckJson(setSceneHidden(written, 'backup', true));
    expect(deck!.chapters[0]!.scenes).toEqual([
      { id: 'title', title: 'Title' },
      { id: 'backup', title: 'Backup: the "raw" table', hidden: true },
    ]);
  });

  it('is undefined for a scene deck.json lists nowhere, or a text that is not JSON', () => {
    expect(setSceneHidden(written, 'nope', true)).toBeUndefined();
    expect(setSceneHidden('{', 'title', true)).toBeUndefined();
    // A string with "id" in it is no scene.
    expect(
      setSceneHidden('{"title":"{\\"id\\": \\"t\\"}","chapters":[]}', 't', true),
    ).toBeUndefined();
  });
});

describe('parseDeckJson, on hidden scenes', () => {
  const deck = (scenes: unknown[]) =>
    JSON.stringify({ title: 'x', chapters: [{ id: 'a', title: 'A', scenes }] });

  it('takes "hidden" as true or false, and passes on only true', () => {
    const { deck: parsed, problems } = parseDeckJson(
      deck([
        { id: 'a', title: 'A', hidden: false },
        { id: 'b', title: 'B', hidden: true },
      ]),
    );
    expect(problems).toEqual([]);
    expect(parsed!.chapters[0]!.scenes).toEqual([
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B', hidden: true },
    ]);
    expect(
      parseDeckJson(deck([{ id: 'a', title: 'A', hidden: 'yes' }])).problems.map((p) => p.message),
    ).toEqual(['chapters[0].scenes[0].hidden is true or false.']);
  });

  it('needs one scene that shows', () => {
    expect(
      parseDeckJson(deck([{ id: 'a', title: 'A', hidden: true }])).problems.map((p) => p.message),
    ).toEqual(['Every scene is hidden: at least one has to show.']);
  });
});
