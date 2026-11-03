/**
 * The deck's scenes arranged on its page (PRODUCT-BRIEF.md, decision 5): hidden or shown, renamed,
 * moved, taken out of deck.json, or put back. Each change edits deck.json's text where it must and
 * leaves the rest as it was written, so an agent's working copy merges it line by line; a scene
 * moved keeps its own text. A chapter its last scene leaves goes, as deck.json has no empty
 * chapter. What a change leaves is the check's to judge, as for any push.
 */
import {
  ID,
  keyOf,
  locate,
  SCENES_MAX,
  setSceneHidden,
  TITLE_MAX,
  type Located,
} from './deck-json.ts';

/**
 * Where scenes go: into chapter `chapter`, before scene `before`, or at the chapter's end when
 * `before` is null or no longer in it. A chapter deck.json doesn't list is made, with `title`,
 * before chapter `beforeChapter`, or last: an undo puts back a chapter a move took out.
 */
export interface Place {
  chapter: string;
  before: string | null;
  title?: string;
  beforeChapter?: string | null;
}

/** One change to the deck's scenes. */
export type Arrangement =
  | { op: 'hide'; scenes: string[]; hidden: boolean }
  | { op: 'rename'; scene: string; title: string }
  | { op: 'move'; scenes: string[]; to: Place }
  | { op: 'remove'; scenes: string[] }
  | { op: 'restore'; scene: { id: string; title: string; hidden?: boolean }; to: Place };

/** A change deck.json can't take as it is now: the person's page is behind, or it isn't JSON. */
export class ArrangeError extends Error {}

type List = Extract<Located, { kind: 'array' }>;

/** deck.json's chapters, where they are in its text. */
function chaptersIn(text: string): List {
  const chapters = keyOf(locate(text), 'chapters')?.value;
  if (chapters?.kind !== 'array')
    throw new ArrangeError('deck.json isn’t JSON with chapters: ask your agent to fix it first.');
  return chapters;
}

const scenesOf = (chapter: Located): List | undefined => {
  const scenes = keyOf(chapter, 'scenes')?.value;
  return scenes?.kind === 'array' ? scenes : undefined;
};

const idOf = (node: Located): string | undefined => {
  const id = keyOf(node, 'id')?.value;
  return id?.kind === 'value' && typeof id.value === 'string' ? id.value : undefined;
};

/** Scene `id`: its chapter's list of scenes, and where it is in it. */
function sceneIn(text: string, id: string) {
  for (const chapter of chaptersIn(text).items) {
    const scenes = scenesOf(chapter);
    const index = scenes?.items.findIndex((node) => idOf(node) === id) ?? -1;
    if (scenes && index >= 0) return { scenes, index, node: scenes.items[index]! };
  }
  return undefined;
}

function needScene(text: string, id: string) {
  const found = sceneIn(text, id);
  if (!found) throw new ArrangeError(`“${id}” isn’t in deck.json any more: reload the page.`);
  return found;
}

/** The text without a list's item, and the comma that joined it to the one before, or after. */
function cut(text: string, list: List, index: number): string {
  const { items } = list;
  const item = items[index]!;
  if (index > 0) return text.slice(0, items[index - 1]!.end) + text.slice(item.end);
  if (items.length > 1) return text.slice(0, item.start) + text.slice(items[1]!.start);
  // The only one: the lines around it stay, for one put back in its place.
  return text.slice(0, item.start) + text.slice(item.end);
}

/** What joins a list's items: as between its first two, else a new line indented as the first. */
function separator(text: string, list: List): string {
  const [first, second] = list.items;
  if (first && second) return text.slice(first.end, second.start);
  const before = text.slice(list.start + 1, first?.start ?? list.start + 1);
  const line = before.lastIndexOf('\n');
  return line === -1 ? `,${before}` : `,\n${before.slice(line + 1)}`;
}

/** The text with `item` in a list, before its item `index`, or last. */
function insert(text: string, list: List, index: number, item: string): string {
  const { items } = list;
  if (items.length === 0) {
    // Into the line an item it had sat on, if it was written over lines.
    const lines = /^\s*?\n[ \t]*/.exec(text.slice(list.start + 1, list.end - 1));
    const at = list.start + 1 + (lines?.[0].length ?? 0);
    return text.slice(0, at) + item + text.slice(at);
  }
  const join = separator(text, list);
  if (index >= items.length) {
    const last = items.at(-1)!;
    return text.slice(0, last.end) + join + item + text.slice(last.end);
  }
  const at = items[index]!.start;
  return text.slice(0, at) + item + join + text.slice(at);
}

/** Whether deck.json is written over several lines, so a new value takes lines of its own. */
const multiline = (text: string) => {
  const chapters = chaptersIn(text);
  return text.slice(chapters.start, chapters.end).includes('\n');
};

/** A chapter for an undo, holding `scene`, written as deck.json's chapters are. */
function chapterText(text: string, id: string, title: string, scene: string): string {
  if (!multiline(text))
    return `{"id":${JSON.stringify(id)},"title":${JSON.stringify(title)},"scenes":[${scene}]}`;
  const chapters = chaptersIn(text);
  const indentOf = (at: number) => /[ \t]*$/.exec(text.slice(0, at))![0];
  const first = chapters.items[0];
  const outer = first ? indentOf(first.start) : '    ';
  const inner =
    first?.kind === 'object' && first.keys[0] ? indentOf(first.keys[0].start) : outer + '  ';
  const step = inner.slice(outer.length) || '  ';
  return [
    '{',
    `${inner}"id": ${JSON.stringify(id)},`,
    `${inner}"title": ${JSON.stringify(title)},`,
    `${inner}"scenes": [`,
    `${inner}${step}${scene}`,
    `${inner}]`,
    `${outer}}`,
  ].join('\n');
}

/** The text without the chapters no scene is left in. */
function withoutEmptyChapters(text: string): string {
  for (;;) {
    const chapters = chaptersIn(text);
    const index = chapters.items.findIndex((c) => scenesOf(c)?.items.length === 0);
    if (index < 0) return text;
    text = cut(text, chapters, index);
  }
}

/** The text with scenes' texts at `to`, in order, making its chapter if `to` says how. */
function place(text: string, to: Place, scenes: string[]): string {
  let rest = scenes;
  if (!chaptersIn(text).items.some((c) => idOf(c) === to.chapter)) {
    if (to.title === undefined)
      throw new ArrangeError(
        `The chapter “${to.chapter}” isn’t in deck.json any more: reload the page.`,
      );
    const chapters = chaptersIn(text);
    const before = chapters.items.findIndex((c) => idOf(c) === to.beforeChapter);
    const made = chapterText(text, to.chapter, to.title, scenes[0]!);
    text = insert(text, chapters, before < 0 ? chapters.items.length : before, made);
    rest = scenes.slice(1);
  }
  for (const scene of rest) {
    const chapter = chaptersIn(text).items.find((c) => idOf(c) === to.chapter)!;
    const list = scenesOf(chapter);
    if (!list) throw new ArrangeError(`The chapter “${to.chapter}” lists no scenes in deck.json.`);
    const at = to.before === null ? -1 : list.items.findIndex((node) => idOf(node) === to.before);
    // Each before `before` in turn, so those placed already stay ahead of it, in order.
    text = insert(text, list, at < 0 ? list.items.length : at, scene);
  }
  return text;
}

/** deck.json's text with `changes` made, in order, each on the text the one before left. */
export function arrange(text: string, changes: Arrangement[]): string {
  chaptersIn(text);
  for (const change of changes) {
    switch (change.op) {
      case 'hide':
        for (const id of change.scenes) {
          needScene(text, id);
          text = setSceneHidden(text, id, change.hidden)!;
        }
        break;
      case 'rename': {
        const { node } = needScene(text, change.scene);
        const title = keyOf(node, 'title')?.value;
        if (!title)
          throw new ArrangeError(`“${change.scene}” has no title in deck.json to change.`);
        text = text.slice(0, title.start) + JSON.stringify(change.title) + text.slice(title.end);
        break;
      }
      case 'remove':
        for (const id of change.scenes) {
          const { scenes, index } = needScene(text, id);
          text = cut(text, scenes, index);
        }
        text = withoutEmptyChapters(text);
        break;
      case 'move': {
        const moved: string[] = [];
        for (const id of change.scenes) {
          const { scenes, index, node } = needScene(text, id);
          moved.push(text.slice(node.start, node.end));
          text = cut(text, scenes, index);
        }
        // The chapter it leaves goes only once it's placed: it may be the one it goes to.
        text = withoutEmptyChapters(place(text, change.to, moved));
        break;
      }
      case 'restore': {
        const { id, title, hidden } = change.scene;
        if (sceneIn(text, id)) throw new ArrangeError(`“${title}” is in deck.json already.`);
        const spaced = multiline(text);
        const keys = [
          ['id', id] as const,
          ['title', title] as const,
          ...(hidden ? [['hidden', true] as const] : []),
        ];
        const written = keys.map(
          ([key, value]) => `"${key}":${spaced ? ' ' : ''}${JSON.stringify(value)}`,
        );
        const scene = spaced ? `{ ${written.join(', ')} }` : `{${written.join(',')}}`;
        text = place(text, change.to, [scene]);
        break;
      }
    }
  }
  return text;
}

/** The most changes one request makes: a page sends what one gesture did, or one undo. */
const CHANGES_MAX = 50;

const isId = (value: unknown): value is string => typeof value === 'string' && ID.test(value);
const isIds = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length > 0 && value.length <= SCENES_MAX && value.every(isId);
const isTitle = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '' && value.length <= TITLE_MAX;
function isPlace(value: unknown): value is Place {
  if (typeof value !== 'object' || value === null) return false;
  const to = value as Record<string, unknown>;
  return (
    isId(to.chapter) &&
    (to.before === null || isId(to.before)) &&
    (to.title === undefined || isTitle(to.title)) &&
    (to.beforeChapter === undefined || to.beforeChapter === null || isId(to.beforeChapter))
  );
}

/** Changes as a page sent them, if they are changes: what arrange takes, and nothing else. */
export function readArrangements(value: unknown): Arrangement[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > CHANGES_MAX) return undefined;
  const changes: Arrangement[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) return undefined;
    const c = raw as Record<string, unknown>;
    if (c.op === 'hide' && isIds(c.scenes) && typeof c.hidden === 'boolean')
      changes.push({ op: 'hide', scenes: c.scenes, hidden: c.hidden });
    else if (c.op === 'rename' && isId(c.scene) && isTitle(c.title))
      changes.push({ op: 'rename', scene: c.scene, title: c.title.trim() });
    else if (c.op === 'move' && isIds(c.scenes) && isPlace(c.to))
      changes.push({ op: 'move', scenes: c.scenes, to: c.to });
    else if (c.op === 'remove' && isIds(c.scenes)) changes.push({ op: 'remove', scenes: c.scenes });
    else if (c.op === 'restore' && isPlace(c.to) && typeof c.scene === 'object' && c.scene) {
      const s = c.scene as Record<string, unknown>;
      if (
        !isId(s.id) ||
        !isTitle(s.title) ||
        (s.hidden !== undefined && typeof s.hidden !== 'boolean')
      )
        return undefined;
      changes.push({
        op: 'restore',
        scene: { id: s.id, title: s.title, ...(s.hidden ? { hidden: true } : {}) },
        to: c.to,
      });
    } else return undefined;
  }
  return changes;
}
