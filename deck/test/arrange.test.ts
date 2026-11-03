import { describe, expect, it } from 'vitest';
import { arrange, ArrangeError, parseDeckJson, readArrangements } from '../src/index.ts';

/** deck.json as an agent may write it: scenes a line each, one over several, a key Tobos doesn't read. */
const written = `{
  "title": "Lecture",
  "chapters": [
    {
      "id": "opening",
      "title": "Opening",
      "scenes": [
        { "id": "title", "title": "Title" },
        { "id": "why", "title": "Why now" },
        {
          "id": "backup",
          "title": "Backup: the \\"raw\\" table",
          "hidden": true
        }
      ]
    },
    {
      "id": "close",
      "title": "Close",
      "scenes": [
        { "id": "thanks", "title": "Thanks" }
      ]
    }
  ],
  "dependencies": { "d3": "7.9.0" }
}
`;

/** The deck's order, a chapter at a time: `opening: title why backup | close: thanks`. */
const outline = (text: string) =>
  parseDeckJson(text)
    .deck!.chapters.map((c) => `${c.id}: ${c.scenes.map((s) => s.id).join(' ')}`)
    .join(' | ');

describe('arrange', () => {
  it('renames a scene, leaving the rest of the file as it was', () => {
    expect(arrange(written, [{ op: 'rename', scene: 'why', title: 'Why “now”' }])).toBe(
      written.replace('"Why now"', '"Why “now”"'),
    );
  });

  it('hides and shows scenes again, as setSceneHidden does', () => {
    const hidden = arrange(written, [{ op: 'hide', scenes: ['title', 'thanks'], hidden: true }]);
    expect(hidden).toContain('{ "id": "title", "title": "Title", "hidden": true }');
    expect(hidden).toContain('{ "id": "thanks", "title": "Thanks", "hidden": true }');
    expect(arrange(hidden, [{ op: 'hide', scenes: ['title', 'thanks'], hidden: false }])).toBe(
      written,
    );
  });

  it('moves a scene before another, its text as it was, the lines around it closing up', () => {
    const moved = arrange(written, [
      { op: 'move', scenes: ['backup'], to: { chapter: 'opening', before: 'title' } },
    ]);
    expect(outline(moved)).toBe('opening: backup title why | close: thanks');
    expect(moved).toBe(`{
  "title": "Lecture",
  "chapters": [
    {
      "id": "opening",
      "title": "Opening",
      "scenes": [
        {
          "id": "backup",
          "title": "Backup: the \\"raw\\" table",
          "hidden": true
        },
        { "id": "title", "title": "Title" },
        { "id": "why", "title": "Why now" }
      ]
    },
    {
      "id": "close",
      "title": "Close",
      "scenes": [
        { "id": "thanks", "title": "Thanks" }
      ]
    }
  ],
  "dependencies": { "d3": "7.9.0" }
}
`);
  });

  it('moves several to the end of another chapter, in the order given', () => {
    const moved = arrange(written, [
      { op: 'move', scenes: ['why', 'title'], to: { chapter: 'close', before: null } },
    ]);
    expect(outline(moved)).toBe('opening: backup | close: thanks why title');
    expect(moved).toContain(
      '        { "id": "thanks", "title": "Thanks" },\n        { "id": "why", "title": "Why now" },\n        { "id": "title", "title": "Title" }\n',
    );
  });

  it('takes out a chapter its last scene leaves, and makes one back for undo', () => {
    const moved = arrange(written, [
      { op: 'move', scenes: ['thanks'], to: { chapter: 'opening', before: null } },
    ]);
    expect(outline(moved)).toBe('opening: title why backup thanks');
    expect(moved).not.toContain('"close"');
    const back = arrange(moved, [
      {
        op: 'move',
        scenes: ['thanks'],
        to: { chapter: 'close', before: null, title: 'Close', beforeChapter: null },
      },
    ]);
    expect(outline(back)).toBe('opening: title why backup | close: thanks');
    expect(parseDeckJson(back).deck!.chapters[1]!.title).toBe('Close');
  });

  it('removes scenes from deck.json, and a chapter left with none', () => {
    const removed = arrange(written, [{ op: 'remove', scenes: ['thanks', 'why'] }]);
    expect(outline(removed)).toBe('opening: title backup');
    expect(removed).toContain(
      '        { "id": "title", "title": "Title" },\n        {\n          "id": "backup"',
    );
  });

  it('puts a removed scene back where it was, for undo', () => {
    const removed = arrange(written, [{ op: 'remove', scenes: ['why'] }]);
    const back = arrange(removed, [
      {
        op: 'restore',
        scene: { id: 'why', title: 'Why now' },
        to: { chapter: 'opening', before: 'backup' },
      },
    ]);
    expect(back).toBe(written);
    const hidden = arrange(removed, [
      {
        op: 'restore',
        scene: { id: 'why', title: 'Why now', hidden: true },
        to: { chapter: 'opening', before: null },
      },
    ]);
    expect(outline(hidden)).toBe('opening: title backup why | close: thanks');
    expect(parseDeckJson(hidden).deck!.chapters[0]!.scenes[2]).toEqual({
      id: 'why',
      title: 'Why now',
      hidden: true,
    });
  });

  it('applies several in order, each to the file as the one before left it', () => {
    const done = arrange(written, [
      { op: 'move', scenes: ['title'], to: { chapter: 'close', before: 'thanks' } },
      { op: 'rename', scene: 'title', title: 'Hello' },
      { op: 'hide', scenes: ['why'], hidden: true },
    ]);
    expect(outline(done)).toBe('opening: why backup | close: title thanks');
    expect(parseDeckJson(done).deck!.chapters[1]!.scenes[0]!.title).toBe('Hello');
  });

  it('keeps the lines of a chapter whose scenes all move within it', () => {
    const two = arrange(written, [
      { op: 'move', scenes: ['title', 'why'], to: { chapter: 'close', before: null } },
    ]);
    const back = arrange(two, [
      { op: 'move', scenes: ['why', 'thanks', 'title'], to: { chapter: 'close', before: null } },
    ]);
    expect(outline(back)).toBe('opening: backup | close: why thanks title');
    expect(back).toContain(
      '      "scenes": [\n        { "id": "why", "title": "Why now" },\n        { "id": "thanks", "title": "Thanks" },\n        { "id": "title", "title": "Title" }\n      ]',
    );
  });

  it('works on deck.json written on one line', () => {
    const line =
      '{"title":"x","chapters":[{"id":"a","title":"A","scenes":[{"id":"s","title":"S"},{"id":"t","title":"T"}]},{"id":"b","title":"B","scenes":[{"id":"u","title":"U"}]}]}';
    const moved = arrange(line, [{ op: 'move', scenes: ['u'], to: { chapter: 'a', before: 't' } }]);
    expect(moved).toBe(
      '{"title":"x","chapters":[{"id":"a","title":"A","scenes":[{"id":"s","title":"S"},{"id":"u","title":"U"},{"id":"t","title":"T"}]}]}',
    );
    const within = arrange(line, [
      { op: 'move', scenes: ['t', 's'], to: { chapter: 'a', before: null } },
    ]);
    expect(within).toBe(
      line.replace(
        '{"id":"s","title":"S"},{"id":"t","title":"T"}',
        '{"id":"t","title":"T"},{"id":"s","title":"S"}',
      ),
    );
  });

  it('keeps deck.json on one line, a newline at its end and all, putting a chapter back', () => {
    const line =
      '{"title":"x","chapters":[{"id":"a","title":"A","scenes":[{"id":"s","title":"S"}]},{"id":"b","title":"B","scenes":[{"id":"u","title":"U"}]}]}\n';
    const removed = arrange(line, [{ op: 'remove', scenes: ['u'] }]);
    expect(removed).toBe(
      '{"title":"x","chapters":[{"id":"a","title":"A","scenes":[{"id":"s","title":"S"}]}]}\n',
    );
    expect(
      arrange(removed, [
        {
          op: 'restore',
          scene: { id: 'u', title: 'U' },
          to: { chapter: 'b', before: null, title: 'B', beforeChapter: null },
        },
      ]),
    ).toBe(line);
  });

  it('refuses a scene deck.json doesn’t list, one listed already, and a chapter it can’t make', () => {
    expect(() => arrange(written, [{ op: 'remove', scenes: ['nope'] }])).toThrow(ArrangeError);
    expect(() =>
      arrange(written, [
        {
          op: 'restore',
          scene: { id: 'why', title: 'Why' },
          to: { chapter: 'opening', before: null },
        },
      ]),
    ).toThrow(ArrangeError);
    expect(() =>
      arrange(written, [{ op: 'move', scenes: ['why'], to: { chapter: 'new', before: null } }]),
    ).toThrow(ArrangeError);
    expect(() => arrange('not json', [{ op: 'remove', scenes: ['why'] }])).toThrow(ArrangeError);
  });

  it('moves before a scene that isn’t there any more to the chapter’s end', () => {
    const moved = arrange(written, [
      { op: 'move', scenes: ['title'], to: { chapter: 'close', before: 'gone' } },
    ]);
    expect(outline(moved)).toBe('opening: why backup | close: thanks title');
  });
});

describe('readArrangements', () => {
  it('takes changes as a page sends them, and only those', () => {
    const sent = [
      { op: 'hide', scenes: ['a'], hidden: true },
      { op: 'rename', scene: 'a', title: '  Hello ' },
      { op: 'move', scenes: ['a', 'b'], to: { chapter: 'c', before: null } },
      { op: 'remove', scenes: ['b'] },
      {
        op: 'restore',
        scene: { id: 'b', title: 'B', hidden: false },
        to: { chapter: 'd', before: 'a', title: 'D', beforeChapter: null },
      },
    ];
    expect(readArrangements(sent)).toEqual([
      sent[0],
      { op: 'rename', scene: 'a', title: 'Hello' },
      sent[2],
      sent[3],
      { ...sent[4], scene: { id: 'b', title: 'B' } },
    ]);
    for (const bad of [
      undefined,
      [],
      'x',
      [{ op: 'hide', scenes: [], hidden: true }],
      [{ op: 'hide', scenes: ['A'], hidden: true }],
      [{ op: 'rename', scene: 'a', title: '' }],
      [{ op: 'move', scenes: ['a'], to: { chapter: 'c' } }],
      [{ op: 'restore', scene: { id: 'b' }, to: { chapter: 'c', before: null } }],
      [{ op: 'nope' }],
      Array.from({ length: 51 }, () => ({ op: 'remove', scenes: ['a'] })),
    ])
      expect(readArrangements(bad), JSON.stringify(bad)).toBeUndefined();
  });
});
