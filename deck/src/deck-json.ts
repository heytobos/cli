import type { Rules } from './analyze.ts';
import type { DeckJson, MediaJson, Outline, Problem } from './types.ts';

/** An ID of a scene, a chapter or a beat: lowercase letters, digits and dashes, from a letter. */
export const ID = /^[a-z][a-z0-9-]*$/;

const FILE = 'deck.json';
const PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
/** Packages the runtime provides: one copy, shared by the engine and the deck. */
const PROVIDED = new Set(['svelte', 'gsap']);
/** The most scenes a deck's outline places: a bound on what its shared PDF prints. */
export const SCENES_MAX = 500;
/** The longest title, of the deck, a chapter or a scene: they show in lists, tabs and file names. */
export const TITLE_MAX = 200;

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

/** Parse and validate deck.json: the deck's packages. Returns the deck only if it is valid. */
export function parseDeckJson(text: string | undefined): {
  deck?: DeckJson;
  problems: Problem[];
  /** The scenes deck.json's chapters list, while it has them (outlineInDeckJson). */
  listed?: Set<string>;
} {
  if (text === undefined) return { problems: [problem('deck.json is missing.')] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { problems: [problem(`deck.json is not valid JSON: ${(error as Error).message}`)] };
  }
  const problems: Problem[] = [];
  if (!isObject(raw)) return { problems: [problem('deck.json must be an object.')] };

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
  // The outline, from before it moved to Tobos (ADR 0006): read by nothing, and taken out by Tobos.
  let listed: Set<string> | undefined;
  if (raw.title !== undefined || raw.chapters !== undefined) {
    problems.push({ ...problem(OUTLINE_MOVED), severity: 'warning' });
    listed = new Set(
      (Array.isArray(raw.chapters) ? raw.chapters : []).flatMap((chapter: unknown) =>
        isObject(chapter) && Array.isArray(chapter.scenes)
          ? chapter.scenes.flatMap((scene: unknown) =>
              isObject(scene) && typeof scene.id === 'string' ? [scene.id] : [],
            )
          : [],
      ),
    );
  }
  // What Tobos reads, and nothing else: keys it doesn't know stay in the file.
  const deck: DeckJson = {};
  if (raw.dependencies !== undefined)
    deck.dependencies = own(Object.entries(raw.dependencies as Record<string, string>));
  return { deck, problems, ...(listed ? { listed } : {}) };
}

/** What a deck.json with an outline in it is told, by the check and by a write that changes it. */
export const OUTLINE_MOVED =
  'deck.json\'s "title" and "chapters" are read by nothing now: the outline moved to Tobos. `tobos outline` shows and changes it, and .tobos/FORMAT.md explains it. Tobos takes them out of deck.json.';

/** Why a version that adds an outline to deck.json, or changes the one there, is refused. */
export const OUTLINE_IN_DECK_JSON =
  'deck.json has no outline any more: it moved to Tobos, and a "title" or "chapters" there would be read by nothing. `tobos outline` shows and changes it (`write`’s `outline` in a chat), and .tobos/FORMAT.md explains it.';

/** Whether deck.json's text has an outline in it, as it had before ADR 0006, and what it is. */
export function outlineInDeckJson(text: string | undefined): string | undefined {
  try {
    const raw: unknown = JSON.parse(text ?? '');
    if (!isObject(raw) || (raw.title === undefined && raw.chapters === undefined)) return undefined;
    return JSON.stringify([raw.title ?? null, raw.chapters ?? null]);
  } catch {
    return undefined;
  }
}

/**
 * An outline as Tobos's own decks keep it in the codebase, `outline.json` (ADR 0006): its title,
 * its chapters and their scenes, by the rules every change to an outline keeps. Returns it only
 * if it is valid.
 */
export function parseOutline(
  text: string | undefined,
  file = 'outline.json',
): { outline?: Outline; problems: Problem[] } {
  const bad = (message: string): Problem => ({ file, rule: 'outline', message, severity: 'error' });
  if (text === undefined) return { problems: [bad(`${file} is missing.`)] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { problems: [bad(`${file} is not valid JSON: ${(error as Error).message}`)] };
  }
  if (!isObject(raw)) return { problems: [bad(`${file} must be an object.`)] };
  const problems: Problem[] = [];
  const titled = (title: unknown, where: string) => {
    const refused = titleRefusal(title, where);
    if (refused) problems.push(bad(refused));
  };
  titled(raw.title, '"title"');
  const chapterIds = new Set<string>();
  const sceneIds = new Set<string>();
  let shown = 0;
  if (!Array.isArray(raw.chapters)) problems.push(bad('"chapters" must be a list.'));
  else
    raw.chapters.forEach((chapter: unknown, c) => {
      const where = `chapters[${c}]`;
      if (!isObject(chapter)) return problems.push(bad(`${where} must be an object.`));
      if (typeof chapter.id !== 'string' || !ID.test(chapter.id))
        problems.push(bad(`${where}.id must be lowercase letters, digits and dashes.`));
      else if (chapterIds.has(chapter.id))
        problems.push(bad(`Chapter "${chapter.id}" is listed twice.`));
      else chapterIds.add(chapter.id);
      titled(chapter.title, `${where}.title`);
      if (!Array.isArray(chapter.scenes))
        return problems.push(bad(`${where}.scenes must be a list.`));
      chapter.scenes.forEach((scene: unknown, s) => {
        const at = `${where}.scenes[${s}]`;
        if (!isObject(scene)) return problems.push(bad(`${at} must be an object.`));
        if (typeof scene.id !== 'string' || !ID.test(scene.id))
          problems.push(bad(`${at}.id must be lowercase letters, digits and dashes.`));
        else if (sceneIds.has(scene.id)) problems.push(bad(`Scene "${scene.id}" is listed twice.`));
        else sceneIds.add(scene.id);
        titled(scene.title, `${at}.title`);
        if (scene.hidden !== undefined && typeof scene.hidden !== 'boolean')
          problems.push(bad(`${at}.hidden is true or false.`));
        if (scene.hidden !== true) shown++;
      });
    });
  if (sceneIds.size > SCENES_MAX)
    problems.push(bad(`${sceneIds.size} scenes; a deck may have ${SCENES_MAX}.`));
  if (shown === 0) problems.push(bad(AT_LEAST_ONE_SHOWN));
  if (problems.length > 0) return { problems };
  type Raw = { id: string; title: string };
  const outline: Outline = {
    title: (raw.title as string).trim(),
    chapters: (raw.chapters as (Raw & { scenes: (Raw & { hidden?: boolean })[] })[]).map(
      (chapter) => ({
        id: chapter.id,
        title: chapter.title.trim(),
        scenes: chapter.scenes.map((scene) => ({
          id: scene.id,
          title: scene.title.trim(),
          ...(scene.hidden ? { hidden: true as const } : {}),
        })),
      }),
    ),
  };
  return { outline, problems };
}

/** Why a title of the deck, a chapter or a scene can't be one, if it can't. */
export function titleRefusal(title: unknown, where = 'A title'): string | undefined {
  if (typeof title !== 'string' || title.trim() === '')
    return `${where} must be a non-empty string.`;
  if (title.trim().length > TITLE_MAX)
    return `${where} is ${title.trim().length} characters; at most ${TITLE_MAX}.`;
  return undefined;
}

/** Why an outline in which no scene shows is refused: presenting needs one. */
export const AT_LEAST_ONE_SHOWN =
  'At least one scene has to show: one that shows can’t be hidden or taken out while it is the last.';

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
