import type { Rules } from './analyze.ts';
import type { DeckJson, MediaJson, Problem } from './types.ts';

/** An ID in deck.json, or of a beat: lowercase letters, digits and dashes, from a letter. */
export const ID = /^[a-z][a-z0-9-]*$/;

const FILE = 'deck.json';
const PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
/** Packages the runtime provides: one copy, shared by the engine and the deck. */
const PROVIDED = new Set(['svelte', 'gsap']);
/** The most scenes a deck lists: a bound on what a push compiles and its shared PDF prints. */
const SCENES_MAX = 500;
/** The longest title, of the deck, a chapter or a scene: they show in lists, tabs and file names. */
const TITLE_MAX = 200;

/**
 * A map from names a deck chooses (media files, packages) with nothing inherited: `constructor`
 * or `__proto__` is a name like any other, never a lookup that finds Object's own.
 */
const own = <T>(entries: [string, T][]): Record<string, T> =>
  Object.assign(Object.create(null) as Record<string, T>, Object.fromEntries(entries));

function problem(message: string, rule = 'deck-json'): Problem {
  return { file: FILE, rule, message, severity: 'error' };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse and validate deck.json. Returns the deck only if it is valid. */
export function parseDeckJson(text: string | undefined): { deck?: DeckJson; problems: Problem[] } {
  if (text === undefined) return { problems: [problem('deck.json is missing.')] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { problems: [problem(`deck.json is not valid JSON: ${(error as Error).message}`)] };
  }
  const problems: Problem[] = [];
  if (!isObject(raw)) return { problems: [problem('deck.json must be an object.')] };

  const titled = (title: unknown, where: string, empty = true) => {
    if (typeof title !== 'string' || (!empty && title.trim() === ''))
      problems.push(problem(`${where} must be a${empty ? '' : ' non-empty'} string.`));
    else if (title.length > TITLE_MAX)
      problems.push(problem(`${where} is ${title.length} characters; at most ${TITLE_MAX}.`));
  };
  titled(raw.title, '"title"', false);

  const chapterIds = new Set<string>();
  const sceneIds = new Set<string>();
  /** The scenes not hidden: presenting needs one. */
  let shown = 0;
  if (!Array.isArray(raw.chapters) || raw.chapters.length === 0) {
    problems.push(problem('"chapters" must be a list with at least one chapter.'));
  } else {
    raw.chapters.forEach((chapter: unknown, c) => {
      const where = `chapters[${c}]`;
      if (!isObject(chapter)) return problems.push(problem(`${where} must be an object.`));
      if (typeof chapter.id !== 'string' || !ID.test(chapter.id))
        problems.push(problem(`${where}.id must be lowercase letters, digits and dashes.`));
      else if (chapterIds.has(chapter.id))
        problems.push(problem(`Chapter "${chapter.id}" is listed twice.`));
      else chapterIds.add(chapter.id);
      titled(chapter.title, `${where}.title`);
      if (!Array.isArray(chapter.scenes) || chapter.scenes.length === 0)
        return problems.push(problem(`${where}.scenes must be a list with at least one scene.`));
      chapter.scenes.forEach((scene: unknown, s) => {
        const at = `${where}.scenes[${s}]`;
        if (!isObject(scene)) return problems.push(problem(`${at} must be an object.`));
        if (typeof scene.id !== 'string' || !ID.test(scene.id))
          problems.push(problem(`${at}.id must be lowercase letters, digits and dashes.`));
        else if (sceneIds.has(scene.id))
          problems.push(problem(`Scene "${scene.id}" is listed twice.`));
        else sceneIds.add(scene.id);
        titled(scene.title, `${at}.title`);
        if (scene.hidden !== undefined && typeof scene.hidden !== 'boolean')
          problems.push(problem(`${at}.hidden is true or false.`));
        if (scene.hidden !== true) shown++;
      });
    });
    if (shown === 0 && sceneIds.size > 0)
      problems.push(problem('Every scene is hidden: at least one has to show.'));
    const count = raw.chapters.reduce(
      (sum: number, chapter: unknown) =>
        sum + (isObject(chapter) && Array.isArray(chapter.scenes) ? chapter.scenes.length : 0),
      0,
    );
    if (count > SCENES_MAX)
      problems.push(
        problem(
          `deck.json lists ${count} scenes; a deck may have ${SCENES_MAX}. Split it into several decks.`,
          'scenes',
        ),
      );
  }

  if (raw.dependencies !== undefined) {
    if (!isObject(raw.dependencies)) problems.push(problem('"dependencies" must be an object.'));
    else
      for (const [name, version] of Object.entries(raw.dependencies)) {
        if (!PACKAGE.test(name) || name.startsWith('@deck/') || name.startsWith('@tobos/'))
          problems.push(problem(`"${name}" is not a package name a deck can depend on.`));
        else if (PROVIDED.has(name))
          problems.push(
            problem(`"${name}" comes with Tobos: import it without listing it in "dependencies".`),
          );
        if (typeof version !== 'string' || !EXACT_VERSION.test(version))
          problems.push(problem(`"${name}" needs an exact version, like "7.9.0".`));
      }
  }

  if (problems.length > 0) return { problems };
  // What Tobos reads, and nothing else: keys it doesn't know stay in the file.
  type Raw = { id: string; title: string };
  const deck: DeckJson = {
    title: raw.title as string,
    chapters: (raw.chapters as (Raw & { scenes: (Raw & { hidden?: boolean })[] })[]).map(
      (chapter) => ({
        id: chapter.id,
        title: chapter.title,
        scenes: chapter.scenes.map((scene) => ({
          id: scene.id,
          title: scene.title,
          ...(scene.hidden ? { hidden: true as const } : {}),
        })),
      }),
    ),
  };
  if (raw.dependencies !== undefined)
    deck.dependencies = own(Object.entries(raw.dependencies as Record<string, string>));
  return { deck, problems };
}

/** Parse media.json. A missing file means no media. */
export function parseMediaJson(text: string | undefined): {
  media: MediaJson;
  problems: Problem[];
} {
  if (text === undefined) return { media: own([]), problems: [] };
  const bad = (message: string) => ({
    media: own<MediaJson[string]>([]),
    problems: [{ file: 'media.json', rule: 'media-json', message, severity: 'error' as const }],
  });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return bad(`media.json is not valid JSON: ${(error as Error).message}`);
  }
  if (!isObject(raw)) return bad('media.json must be an object.');
  for (const [name, entry] of Object.entries(raw)) {
    if (
      !isObject(entry) ||
      typeof entry.hash !== 'string' ||
      !/^[0-9a-f]{64}$/.test(entry.hash) ||
      typeof entry.size !== 'number' ||
      typeof entry.type !== 'string'
    )
      return bad(`media.json entry "${name}" needs a sha256 "hash", a "size" and a "type".`);
  }
  return { media: own(Object.entries(raw as MediaJson)), problems: [] };
}

/** media.json as Tobos writes it: by name, two spaces, a line at the end. */
export function formatMediaJson(media: MediaJson): string {
  const sorted = Object.entries(media).sort(([a], [b]) => a.localeCompare(b));
  return `${JSON.stringify(Object.fromEntries(sorted), null, 2)}\n`;
}

/** Parse master/master.json: the master's rules. A missing file means no rules. */
export function parseMasterJson(text: string | undefined): { rules: Rules; problems: Problem[] } {
  if (text === undefined) return { rules: {}, problems: [] };
  const bad = (message: string) => ({
    rules: {},
    problems: [{ file: 'master/master.json', rule: 'master', message, severity: 'error' as const }],
  });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return bad(`master/master.json is not valid JSON: ${(error as Error).message}`);
  }
  const rules = isObject(raw) ? raw.rules : undefined;
  if (rules === undefined) return { rules: {}, problems: [] };
  if (!isObject(rules)) return bad('"rules" must be an object.');
  if (
    rules.minFontSize !== undefined &&
    (typeof rules.minFontSize !== 'number' || rules.minFontSize <= 0)
  )
    return bad('"minFontSize" is the smallest font size on stage, in px: a positive number.');
  if (rules.layoutRoot !== undefined && typeof rules.layoutRoot !== 'boolean')
    return bad('"layoutRoot" is true or false.');
  return { rules: rules as Rules, problems: [] };
}

/** A JSON value's place in its text: where it starts and ends, and an object's keys in order. */
type Located =
  | { kind: 'object'; start: number; end: number; keys: Key[] }
  | { kind: 'array'; start: number; end: number; items: Located[] }
  | { kind: 'value'; start: number; end: number; value: unknown };
interface Key {
  name: string;
  /** Where its name starts, quote and all. */
  start: number;
  value: Located;
}

/** Valid JSON, read for where each value is in the text, or undefined if it isn't JSON. */
function locate(text: string): Located | undefined {
  let at = 0;
  const space = () => {
    while (at < text.length && ' \t\n\r'.includes(text[at]!)) at++;
  };
  const string = (): number => {
    const start = at++;
    while (text[at] !== '"') {
      if (at >= text.length) throw new SyntaxError();
      at += text[at] === '\\' ? 2 : 1;
    }
    at++;
    return start;
  };
  const value = (): Located => {
    space();
    const start = at;
    if (text[at] === '{') {
      at++;
      const keys: Key[] = [];
      space();
      if (text[at] === '}') return { kind: 'object', start, end: ++at, keys };
      for (;;) {
        space();
        if (text[at] !== '"') throw new SyntaxError();
        const from = string();
        const name = JSON.parse(text.slice(from, at)) as string;
        space();
        if (text[at++] !== ':') throw new SyntaxError();
        keys.push({ name, start: from, value: value() });
        space();
        if (text[at] === ',') at++;
        else if (text[at] === '}') return { kind: 'object', start, end: ++at, keys };
        else throw new SyntaxError();
      }
    }
    if (text[at] === '[') {
      at++;
      const items: Located[] = [];
      space();
      if (text[at] === ']') return { kind: 'array', start, end: ++at, items };
      for (;;) {
        items.push(value());
        space();
        if (text[at] === ',') at++;
        else if (text[at] === ']') return { kind: 'array', start, end: ++at, items };
        else throw new SyntaxError();
      }
    }
    if (text[at] === '"') string();
    else while (at < text.length && !',]} \t\n\r'.includes(text[at]!)) at++;
    if (at === start) throw new SyntaxError();
    return { kind: 'value', start, end: at, value: JSON.parse(text.slice(start, at)) };
  };
  try {
    JSON.parse(text);
    return value();
  } catch {
    return undefined;
  }
}

const keyOf = (node: Located | undefined, name: string) =>
  node?.kind === 'object' ? node.keys.find((key) => key.name === name) : undefined;

/**
 * deck.json's text with one scene hidden, or shown again: `"hidden": true` added to the scene, or
 * taken out. The rest of the file stays as it was written, so an agent's working copy merges it
 * line by line. Undefined if the text isn't JSON or lists no scene `id`.
 */
export function setSceneHidden(text: string, id: string, hidden: boolean): string | undefined {
  const root = locate(text);
  const chapters = keyOf(root, 'chapters')?.value;
  if (chapters?.kind !== 'array') return undefined;
  const scene = chapters.items
    .flatMap((chapter) => {
      const scenes = keyOf(chapter, 'scenes')?.value;
      return scenes?.kind === 'array' ? scenes.items : [];
    })
    .find((node) => {
      const key = keyOf(node, 'id')?.value;
      return key?.kind === 'value' && key.value === id;
    });
  if (scene?.kind !== 'object') return undefined;
  const at = scene.keys.findIndex((key) => key.name === 'hidden');
  const was = scene.keys[at];
  if (hidden) {
    if (was) return text.slice(0, was.value.start) + 'true' + text.slice(was.value.end);
    const last = scene.keys.at(-1);
    if (!last) return text.slice(0, scene.start + 1) + '"hidden": true' + text.slice(scene.end - 1);
    // On a line of its own, indented as the key before it, if the scene's keys are; else after it.
    const before = text.slice(scene.start, last.start);
    const lineAt = before.lastIndexOf('\n');
    const between = lineAt === -1 ? ', ' : `,\n${before.slice(lineAt + 1).match(/^[ \t]*/)![0]}`;
    return text.slice(0, last.value.end) + between + '"hidden": true' + text.slice(last.value.end);
  }
  if (!was) return text;
  // Out with the comma that joins it to the key before it, or to the one after if it's the first.
  const previous = scene.keys[at - 1];
  const next = scene.keys[at + 1];
  if (previous) return text.slice(0, previous.value.end) + text.slice(was.value.end);
  if (next) return text.slice(0, was.start) + text.slice(next.start);
  return text.slice(0, scene.start + 1) + text.slice(scene.end - 1);
}
