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
      });
    });
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
    chapters: (raw.chapters as (Raw & { scenes: Raw[] })[]).map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      scenes: chapter.scenes.map((scene) => ({ id: scene.id, title: scene.title })),
    })),
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
