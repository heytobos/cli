import { init as initLexer, parse as lexImports } from 'es-module-lexer';
import { compile as compileSvelte, VERSION as SVELTE_VERSION } from 'svelte/compiler';
import {
  analyzeScript,
  analyzeSvelte,
  mediaMatches,
  type Analysis,
  type Rules,
} from './analyze.ts';
import { parseDeckJson, parseMasterJson, parseMediaJson } from './deck-json.ts';
import { sha256 } from './hash.ts';
import { stripTypes } from './strip-types.ts';
import { position, readText, resolvePath } from './tree.ts';
import type { DeckJson, DeckTree, Manifest, ManifestChapter, Problem } from './types.ts';

const DECK_PREFIX = '@deck/';
const SOURCE = /\.(svelte|ts|js|mjs|json)$/;
const RUNTIME_PACKAGES = new Set(['svelte', 'gsap', '@tobos/present']);

export interface BuildOptions {
  /** Reuse compiled files across builds. */
  cache?: BuildCache;
}

export interface BuildResult {
  problems: Problem[];
  /** Present when there are no errors. */
  manifest?: Manifest;
  /** Compiled modules by path relative to the viewer (`m/<hash>.js`). */
  modules: Map<string, string>;
  deck?: DeckJson;
}

interface CompiledFile {
  code: string;
  /** Specifiers as written, with their offsets in `code` and in the source. */
  imports: {
    specifier: string | undefined;
    start: number;
    end: number;
    dynamic: boolean;
    sourceOffset: number;
  }[];
  analysis: Analysis;
  problems: Problem[];
}

export type BuildCache = Map<string, CompiledFile>;
export const createCache = (): BuildCache => new Map();

function packageName(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

const isNotAName = (segment: string) => segment === '' || segment === '.' || segment === '..';

/** Package specifiers the files import, by package, for the packages in `dependencies`. */
function packageImports(
  compiled: Map<string, CompiledFile>,
  dependencies: Record<string, string>,
): Record<string, string[]> {
  const found = new Map<string, Set<string>>();
  for (const file of compiled.values())
    for (const { specifier } of file.imports) {
      if (!specifier || specifier.startsWith('.')) continue;
      const name = packageName(specifier);
      if (!(name in dependencies)) continue;
      if (!found.has(name)) found.set(name, new Set());
      found.get(name)!.add(specifier);
    }
  return Object.fromEntries(
    [...found].sort(([a], [b]) => a.localeCompare(b)).map(([key, set]) => [key, [...set].sort()]),
  );
}

function compileFile(path: string, source: string, rules: Rules, isScene: boolean): CompiledFile {
  const problems: Problem[] = [];
  let code = '';
  let analysis: Analysis = { media: [], problems: [] };
  if (path.endsWith('.json')) {
    try {
      code = `export default ${JSON.stringify(JSON.parse(source))};\n`;
    } catch (error) {
      problems.push({
        file: path,
        rule: 'compile',
        message: `Not valid JSON: ${(error as Error).message}`,
        severity: 'error',
      });
    }
    return { code, imports: [], analysis, problems };
  }
  if (path.endsWith('.svelte')) {
    try {
      const result = compileSvelte(source, {
        filename: path,
        generate: 'client',
        css: 'injected',
        // Svelte names a component's styles by its file alone, and injects them only if no style
        // of that name is in the page yet: a scene swapped in by a push would keep its old rules.
        cssHash: ({ hash, css, filename }) => `svelte-${hash(`${filename}\n${css}`)}`,
        dev: false,
        discloseVersion: false,
      });
      code = result.js.code;
      for (const warning of result.warnings)
        problems.push({
          file: path,
          line: warning.start?.line,
          column: warning.start ? warning.start.column + 1 : undefined,
          rule: `svelte/${warning.code}`,
          message: warning.message.split('\n')[0]!,
          severity: 'warning',
        });
    } catch (error) {
      const e = error as {
        message: string;
        code?: string;
        start?: { line: number; column: number };
      };
      problems.push({
        file: path,
        line: e.start?.line,
        column: e.start ? e.start.column + 1 : undefined,
        rule: `svelte/${e.code ?? 'compile'}`,
        message: e.message.split('\n')[0]!,
        severity: 'error',
      });
      return { code: '', imports: [], analysis, problems };
    }
    analysis = analyzeSvelte(path, source, { scene: isScene, rules });
  } else {
    code = path.endsWith('.ts') ? stripTypes(source) : source;
    analysis = analyzeScript(path, code, rules);
  }
  problems.push(...analysis.problems);

  const imports: CompiledFile['imports'] = [];
  try {
    const [found] = lexImports(code, path);
    for (const entry of found) {
      const dynamic = entry.type === 'dynamic';
      if (entry.specifier === undefined && !dynamic) continue; // import.meta
      if (entry.type === ('import-meta' as string)) continue;
      const specifier = entry.specifier ?? undefined;
      // Locate the specifier in the source, for messages. Svelte rewrites code, so search by text.
      const sourceOffset = specifier ? Math.max(0, source.indexOf(specifier)) : 0;
      imports.push({ specifier, start: entry.start, end: entry.end, dynamic, sourceOffset });
    }
  } catch (error) {
    problems.push({
      file: path,
      rule: 'compile',
      message: `Could not read imports: ${(error as Error).message}`,
      severity: 'error',
    });
  }
  return { code, imports, analysis, problems };
}

/** The source files in these folders, which a build compiles; JSON only when imported. */
const sourcesIn = (files: Iterable<string>, folders: string[]) =>
  [...files].filter(
    (f) => folders.some((folder) => f.startsWith(folder)) && SOURCE.test(f) && !f.endsWith('.json'),
  );

/**
 * The packages in a deck's dependencies that its master imports, with their versions: what a
 * copy of the master needs in its own deck.json. Compiles the master; never runs it.
 */
export async function masterDependencies(tree: DeckTree): Promise<Record<string, string>> {
  const dependencies = parseDeckJson(readText(tree, 'deck.json')).deck?.dependencies ?? {};
  const { rules } = parseMasterJson(readText(tree, 'master/master.json'));
  const { compiled } = await compileGraph(tree, sourcesIn(tree.files(), ['master/']), {
    rules,
    scenes: new Set(),
    dependencies,
  });
  return Object.fromEntries(
    Object.keys(packageImports(compiled, dependencies)).map((name) => [name, dependencies[name]!]),
  );
}

interface GraphOptions {
  rules: Rules;
  cache?: BuildCache;
  /** Files that are scenes (and so must declare beats). */
  scenes: Set<string>;
  /** The deck's packages, which it may import besides the engine's. */
  dependencies: Record<string, string>;
}

/** Compile files and everything they import, checking each import against the policy. */
async function compileGraph(
  tree: DeckTree,
  start: string[],
  options: GraphOptions,
): Promise<{ compiled: Map<string, CompiledFile>; problems: Problem[] }> {
  await initLexer;
  const problems: Problem[] = [];
  const files = new Set(tree.files());
  const compiled = new Map<string, CompiledFile>();
  const queue = [...start];
  while (queue.length > 0) {
    const path = queue.shift()!;
    if (compiled.has(path)) continue;
    const source = readText(tree, path);
    if (source === undefined) continue;
    const isScene = options.scenes.has(path);
    const key = sha256(
      `${SVELTE_VERSION}\0${JSON.stringify(options.rules)}\0${isScene}\0${path}\0${source}`,
    );
    let file = options.cache?.get(key);
    if (!file) {
      file = compileFile(path, source, options.rules, isScene);
      options.cache?.set(key, file);
    }
    compiled.set(path, file);
    problems.push(...file.problems);

    for (const entry of file.imports) {
      const at = { file: path, ...position(source, entry.sourceOffset) };
      const error = (message: string) =>
        problems.push({ ...at, rule: 'imports', message, severity: 'error' });
      const spec = entry.specifier;
      if (spec === undefined) {
        error('import() needs a string literal, so Tobos can check what it loads.');
        continue;
      }
      if (spec.startsWith('./') || spec.startsWith('../')) {
        const target = resolvePath(path, spec);
        if (target === undefined) error(`"${spec}" points outside the deck.`);
        else if (target.endsWith('.css'))
          error(
            `"${spec}" can't be imported: a deck's own CSS goes in a <style> block of a .svelte file. Only a package's CSS can be imported.`,
          );
        else if (!SOURCE.test(target) || target.startsWith('media/'))
          error(
            `"${spec}" can't be imported: only .svelte, .ts, .js and .json files can. Use media() for media.`,
          );
        else if (!files.has(target)) error(`"${spec}" doesn't exist (looked for ${target}).`);
        else queue.push(target);
        continue;
      }
      if (/^[a-z][a-z0-9+.-]*:/i.test(spec) || spec.startsWith('/')) {
        error(
          `"${spec}" can't be imported: a deck imports only its own files, the engine and its dependencies.`,
        );
        continue;
      }
      const name = packageName(spec);
      const subpath = spec.slice(name.length);
      if (subpath && (subpath[0] !== '/' || subpath.split('/').slice(1).some(isNotAName))) {
        error(`"${spec}" is not a path inside a package.`);
        continue;
      }
      if (!RUNTIME_PACKAGES.has(name) && !Object.hasOwn(options.dependencies, name))
        error(
          `"${name}" is not a dependency of this deck. Add it to "dependencies" in deck.json with an exact version.`,
        );
    }
  }
  return { compiled, problems };
}

/**
 * Rewrite relative imports to import-map specifiers (`@deck/<path>`), then address each
 * module by its content: `m/<hash>.js`.
 */
function emitModules(compiled: Map<string, CompiledFile>): {
  modules: Map<string, string>;
  imports: Record<string, string>;
} {
  const modules = new Map<string, string>();
  const imports: Record<string, string> = {};
  for (const [path, file] of compiled) {
    let code = '';
    let last = 0;
    for (const entry of file.imports) {
      const spec = entry.specifier!;
      if (!spec.startsWith('./') && !spec.startsWith('../')) continue;
      const replacement = DECK_PREFIX + resolvePath(path, spec)!;
      const quoted = entry.dynamic && /^['"`]/.test(file.code.slice(entry.start, entry.start + 1));
      code +=
        file.code.slice(last, entry.start) + (quoted ? JSON.stringify(replacement) : replacement);
      last = entry.end;
    }
    code += file.code.slice(last);
    const name = `m/${sha256(code).slice(0, 20)}.js`;
    modules.set(name, code);
    imports[DECK_PREFIX + path] = name;
  }
  return {
    modules,
    imports: Object.fromEntries(Object.entries(imports).sort(([a], [b]) => a.localeCompare(b))),
  };
}

/**
 * Check and compile a deck. Reads text and writes text; never runs deck code.
 * The manifest and modules are only returned when there are no errors.
 */
export async function buildDeck(tree: DeckTree, options: BuildOptions = {}): Promise<BuildResult> {
  const problems: Problem[] = [];
  const modules = new Map<string, string>();

  const { deck, problems: deckProblems } = parseDeckJson(readText(tree, 'deck.json'));
  problems.push(...deckProblems);
  const { media, problems: mediaProblems } = parseMediaJson(readText(tree, 'media.json'));
  problems.push(...mediaProblems);
  // The master's rules, which the check enforces in every scene.
  const { rules, problems: masterProblems } = parseMasterJson(readText(tree, 'master/master.json'));
  problems.push(...masterProblems);
  if (!deck) return { problems, modules };

  const files = new Set(tree.files());
  const sceneFiles = new Set<string>();
  for (const chapter of deck.chapters)
    for (const scene of chapter.scenes) {
      const file = `scenes/${scene.id}.svelte`;
      sceneFiles.add(file);
      if (!files.has(file))
        problems.push({
          file: 'deck.json',
          rule: 'scenes',
          message: `Scene "${scene.id}" has no file: ${file} is missing.`,
          severity: 'error',
        });
    }

  // Compile every scene and every source file in master/ and lib/, then whatever they import.
  const dependencies = deck.dependencies ?? {};
  const graph = await compileGraph(tree, sourcesIn(files, ['scenes/', 'master/', 'lib/']), {
    rules,
    cache: options.cache,
    scenes: sceneFiles,
    dependencies,
  });
  problems.push(...graph.problems);
  for (const path of graph.compiled.keys())
    if (
      path.startsWith('scenes/') &&
      !sceneFiles.has(path) &&
      path.endsWith('.svelte') &&
      !path.slice(7).includes('/')
    )
      problems.push({
        file: path,
        rule: 'scenes',
        message: `${path} is not listed in deck.json, so it is never shown.`,
        severity: 'warning',
      });

  // Media: every media() name must be in media.json (unless media.json itself is broken).
  if (mediaProblems.length === 0)
    for (const [path, file] of graph.compiled)
      for (const ref of file.analysis.media)
        if (
          ref.pattern
            ? !Object.keys(media).some((name) => mediaMatches(ref.name, name))
            : !(ref.name in media)
        )
          problems.push({
            file: path,
            line: ref.line,
            column: ref.column,
            rule: 'media',
            message: ref.pattern
              ? `No file in media.json matches media(\`${ref.name.replaceAll('*', '${…}')}\`). Put the files in media/.`
              : `media("${ref.name}") is not in media.json. Put the file in media/ (tobos check and push record it there).`,
            severity: 'error',
          });

  // Activity IDs name a deck's responses: unique across the deck.
  const activityFiles = new Map<string, string>();
  for (const file of sceneFiles) {
    const found = graph.compiled.get(file)?.analysis.activity;
    if (!found) continue;
    const other = activityFiles.get(found.activity.id);
    if (other)
      problems.push({
        file,
        line: found.line,
        rule: 'activity',
        message: `Activity "${found.activity.id}" is declared in ${other} too: activity IDs are unique across the deck.`,
        severity: 'error',
      });
    else activityFiles.set(found.activity.id, file);
  }

  // Unless media.json itself is broken, as for media() above.
  const stylesheet = masterStylesheet(tree, media, mediaProblems.length ? [] : problems);
  if (problems.some((p) => p.severity === 'error')) return { problems, modules, deck };

  const emitted = emitModules(graph.compiled);
  if (stylesheet) emitted.modules.set(stylesheet.name, stylesheet.code);
  const chapters: ManifestChapter[] = deck.chapters.map((chapter) => ({
    id: chapter.id,
    title: chapter.title,
    scenes: chapter.scenes.map((scene) => {
      const file = `scenes/${scene.id}.svelte`;
      const analysis = graph.compiled.get(file)?.analysis;
      return {
        id: scene.id,
        title: scene.title,
        beats: (analysis?.beats ?? []).map((b) => b.id),
        module: DECK_PREFIX + file,
        ...(analysis?.activity ? { activity: analysis.activity.activity } : {}),
      };
    }),
  }));

  return {
    problems,
    deck,
    modules: emitted.modules,
    manifest: {
      format: 1,
      title: deck.title,
      chapters,
      imports: emitted.imports,
      media,
      dependencies,
      packages: packageImports(graph.compiled, dependencies),
      ...(stylesheet ? { styles: [stylesheet.name] } : {}),
    },
  };
}

/**
 * The master's tokens.css: the deck's one stylesheet, linked on every page that shows it. Its
 * url()s name files in media/, relative to master/ (`url(../media/master/fonts/x.woff2)`), and
 * become those files' addresses.
 */
function masterStylesheet(
  tree: DeckTree,
  media: Record<string, { hash: string }>,
  problems: Problem[],
): { name: string; code: string } | undefined {
  const file = 'master/tokens.css';
  const source = readText(tree, file);
  if (source === undefined) return undefined;
  // Quoted, or bare with no space: parts that can't take the same characters, so a run of
  // spaces with no `)` is one pass, not one for every way to split it.
  const code = source.replace(
    /url\(\s*(?:'([^'\n]*)'|"([^"\n]*)"|([^'"()\s]+))\s*\)/g,
    (
      whole,
      single: string | undefined,
      double: string | undefined,
      bare: string | undefined,
      offset: number,
    ) => {
      const url = single ?? double ?? bare!;
      if (url.startsWith('data:') || url.startsWith('#')) return whole;
      const target = /^[a-z][a-z0-9+.-]*:|^\//i.test(url) ? undefined : resolvePath(file, url);
      const name = target?.startsWith('media/') ? target.slice('media/'.length) : undefined;
      if (name !== undefined && media[name]) return `url(../media/${media[name].hash})`;
      problems.push({
        file,
        ...position(source, offset),
        rule: 'media',
        message: `url(${url}) must name a file in media/ that media.json lists, relative to master/: url(../media/master/fonts/a.woff2).`,
        severity: 'error',
      });
      return whole;
    },
  );
  return { name: `m/${sha256(code).slice(0, 20)}.css`, code };
}
