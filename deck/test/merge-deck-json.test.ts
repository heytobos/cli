import { describe, expect, it } from 'vitest';
import { arrange } from '../src/arrange.ts';
import { mergeDeckJson, mergeFile, mergeText } from '../src/merge.ts';

/** deck.json as an agent writes it. */
const deck = (
  chapters: { id: string; title?: string; scenes: (string | Record<string, unknown>)[] }[],
  more: Record<string, unknown> = {},
) =>
  JSON.stringify(
    {
      title: 'Lecture',
      chapters: chapters.map((c) => ({
        id: c.id,
        title: c.title ?? c.id.toUpperCase(),
        scenes: c.scenes.map((s) =>
          typeof s === 'string' ? { id: s, title: s.toUpperCase() } : s,
        ),
      })),
      ...more,
    },
    null,
    2,
  ) + '\n';

/** The deck's order, a chapter at a time, a hidden scene starred, a retitled one with its title. */
const outline = (text: string) =>
  (JSON.parse(text) as { chapters: { id: string; scenes: Record<string, unknown>[] }[] }).chapters
    .map(
      (c) =>
        `${c.id}: ${c.scenes
          .map(
            (s) =>
              `${s.id}${s.hidden ? '*' : ''}${s.title !== String(s.id).toUpperCase() ? `“${s.title}”` : ''}`,
          )
          .join(' ')}`,
    )
    .join(' | ');

const base = deck([
  { id: 'open', scenes: ['a', 'b', 'c'] },
  { id: 'close', scenes: ['d'] },
]);

describe('merging deck.json scene by scene', () => {
  it('keeps the page’s order and the agent’s new scene, after the one it follows', () => {
    const page = arrange(base, [
      { op: 'move', scenes: ['c'], to: { chapter: 'open', before: 'a' } },
    ]);
    const agent = deck([
      { id: 'open', scenes: ['a', 'b', 'x', 'c'] },
      { id: 'close', scenes: ['d'] },
    ]);
    expect(outline(mergeDeckJson(base, agent, page)!)).toBe('open: c a b x | close: d');
  });

  it('takes the agent’s rename into the page’s new order, where lines alone conflict', () => {
    const page = arrange(base, [
      { op: 'move', scenes: ['a', 'b'], to: { chapter: 'close', before: null } },
    ]);
    const agent = base.replace('"title": "B"', '"title": "Bee"');
    const merged = mergeDeckJson(base, agent, page)!;
    expect(outline(merged)).toBe('open: c | close: d a b“Bee”');
    // Written as the agent writes it: two spaces, and a newline at the end.
    expect(merged).toBe(JSON.stringify(JSON.parse(merged), null, 2) + '\n');
  });

  it('keeps what both changed, each on its own: a hidden scene, and the dependencies', () => {
    const page = arrange(base, [{ op: 'hide', scenes: ['b'], hidden: true }]);
    const agent = deck(
      [
        { id: 'open', scenes: ['a', 'b', 'c'] },
        { id: 'close', scenes: ['d'] },
      ],
      { dependencies: { d3: '7.9.0' } },
    );
    const merged = mergeDeckJson(base, agent, page)!;
    expect(outline(merged)).toBe('open: a b* c | close: d');
    expect(JSON.parse(merged).dependencies).toEqual({ d3: '7.9.0' });
  });

  it('gives a scene both moved the agent’s place: the push is the later word on order', () => {
    const page = arrange(base, [
      { op: 'move', scenes: ['a'], to: { chapter: 'close', before: null } },
    ]);
    const agent = deck([
      { id: 'open', scenes: ['b', 'c', 'a'] },
      { id: 'close', scenes: ['d'] },
    ]);
    expect(outline(mergeDeckJson(base, agent, page)!)).toBe('open: b c a | close: d');
  });

  it('refuses a key both changed differently, as lines do: a true conflict', () => {
    const page = arrange(base, [{ op: 'rename', scene: 'b', title: 'Bee' }]);
    const agent = base.replace('"title": "B"', '"title": "Be"');
    expect(mergeDeckJson(base, agent, page)).toBeUndefined();
    // The same rename on both sides is one.
    expect(outline(mergeDeckJson(base, page, page)!)).toBe('open: a b“Bee” c | close: d');
    const moved = arrange(base, [
      { op: 'move', scenes: ['c'], to: { chapter: 'open', before: 'a' } },
    ]);
    const retitled = (text: string, title: string) =>
      text.replace('"title": "Lecture"', `"title": "${title}"`);
    expect(mergeDeckJson(base, retitled(base, 'Ours'), retitled(moved, 'Theirs'))).toBeUndefined();
  });

  it('keeps the agent’s new order of chapters, and the page’s change inside one', () => {
    const three = deck([
      { id: 'open', scenes: ['a'] },
      { id: 'mid', scenes: ['m'] },
      { id: 'close', scenes: ['d'] },
    ]);
    const page = arrange(three, [{ op: 'hide', scenes: ['m'], hidden: true }]);
    const agent = deck([
      { id: 'close', scenes: ['d'] },
      { id: 'open', scenes: ['a'] },
      { id: 'mid', scenes: ['m'] },
    ]);
    expect(outline(mergeDeckJson(three, agent, page)!)).toBe('close: d | open: a | mid: m*');
  });

  it('leaves a deck.json listing a scene twice to lines, and the check to refuse it', () => {
    const twice = base.replace('{\n          "id": "c",', '{\n          "id": "a",');
    expect(twice).not.toBe(base);
    const page = arrange(base, [{ op: 'hide', scenes: ['d'], hidden: true }]);
    expect(mergeDeckJson(base, twice, page)).toBe(mergeFile('notes.md', base, twice, page));
  });

  it('leaves out a scene the page removed, though the agent changed its title', () => {
    const page = arrange(base, [{ op: 'remove', scenes: ['b'] }]);
    const agent = base.replace('"title": "B"', '"title": "Bee"');
    expect(outline(mergeDeckJson(base, agent, page)!)).toBe('open: a c | close: d');
  });

  it('makes a chapter again that the page emptied, for a scene the agent added to it', () => {
    const page = arrange(base, [
      { op: 'move', scenes: ['d'], to: { chapter: 'open', before: null } },
    ]);
    const agent = deck([
      { id: 'open', scenes: ['a', 'b', 'c'] },
      { id: 'close', scenes: ['d', 'e'] },
    ]);
    expect(outline(mergeDeckJson(base, agent, page)!)).toBe('open: a b c d | close: e');
  });

  it('keeps the text a line merge makes when it says the same, formatting and all', () => {
    // A scene on one line, as the agent wrote it: JSON.stringify wouldn't.
    const written = base.replace(
      /\{\n\s*"id": "d",\n\s*"title": "D"\n\s*\}/,
      '{ "id": "d", "title": "D" }',
    );
    expect(written).toContain('{ "id": "d", "title": "D" }');
    const page = arrange(written, [{ op: 'hide', scenes: ['a'], hidden: true }]);
    const agent = written.replace('{ "id": "d", "title": "D" }', '{ "id": "d", "title": "Dee" }');
    const lines = mergeText(written, agent, page);
    expect(lines).toContain('{ "id": "d", "title": "Dee" }');
    expect(mergeDeckJson(written, agent, page)).toBe(lines);
  });

  it('merges any other file line by line, and deck.json that isn’t JSON as text', () => {
    expect(mergeFile('notes.md', 'a\nb\n', 'A\nb\n', 'a\nB\n')).toBe('A\nB\n');
    expect(mergeFile('deck.json', 'x\ny\n', 'X\ny\n', 'x\nY\n')).toBe('X\nY\n');
  });
});
