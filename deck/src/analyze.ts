import { parse as parseJs } from 'acorn';
import { parse as parseSvelte } from 'svelte/compiler';
import { walk } from 'zimmerframe';
import { position } from './tree.ts';
import type { Problem } from './types.ts';

// The parts of the ESTree and Svelte ASTs this module reads.
interface Node {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

export interface BeatInfo {
  id: string;
  line: number;
}

export interface Analysis {
  /** The scene's beats, if the file is a scene and they could be read. */
  beats?: BeatInfo[];
  /** Names passed to media(), with where they were used. */
  media: { name: string; pattern?: boolean; line: number; column: number }[];
  problems: Problem[];
}

export interface Rules {
  /** The smallest font size allowed on the stage, in px. */
  minFontSize?: number;
  /** Every scene renders one layout as its root (a warning otherwise). */
  layoutRoot?: boolean;
}

function unwrap(node: Node | undefined): Node | undefined {
  // `[...] satisfies Beat[]`, `[...] as const`, `[...] as Beat[]`
  while (
    node &&
    (node.type === 'TSSatisfiesExpression' ||
      node.type === 'TSAsExpression' ||
      node.type === 'TSNonNullExpression' ||
      node.type === 'ParenthesizedExpression')
  )
    node = node.expression as Node;
  return node;
}

function readBeats(
  file: string,
  source: string,
  module: Node | null,
): Pick<Analysis, 'beats' | 'problems'> {
  const problems: Problem[] = [];
  const at = (node: Node, message: string, rule = 'beats') => {
    problems.push({ file, ...position(source, node.start), rule, message, severity: 'error' });
  };
  const missing = (): Pick<Analysis, 'beats' | 'problems'> => ({
    problems: [
      {
        file,
        line: 1,
        column: 1,
        rule: 'beats',
        message:
          'A scene exports its beats from <script module>: `export const beats: Beat[] = [{ id: "…" }]`.',
        severity: 'error',
      },
    ],
  });
  if (!module) return missing();

  let list: Node | undefined;
  for (const statement of (module.content as Node).body as Node[]) {
    if (statement.type !== 'ExportNamedDeclaration') continue;
    const declaration = statement.declaration as Node | null;
    if (declaration?.type !== 'VariableDeclaration') continue;
    for (const declarator of declaration.declarations as Node[]) {
      const id = declarator.id as Node;
      if (id.type === 'Identifier' && id.name === 'beats') {
        if (declaration.kind !== 'const') at(declarator, '`beats` must be declared with const.');
        list = unwrap(declarator.init as Node);
        if (!list) at(declarator, '`beats` needs a value.');
      }
    }
  }
  if (!list) return problems.length ? { problems } : missing();
  if (list.type !== 'ArrayExpression') {
    at(list, '`beats` must be an array literal, so Tobos can read it without running the scene.');
    return { problems };
  }

  const beats: BeatInfo[] = [];
  const seen = new Set<string>();
  for (const element of list.elements as (Node | null)[]) {
    const beat = unwrap(element ?? undefined);
    if (!beat || beat.type !== 'ObjectExpression') {
      at(
        element ?? list,
        'Each beat must be an object literal: `{ id: "…", enter: (tl, q) => … }`.',
      );
      continue;
    }
    const idProp = (beat.properties as Node[]).find(
      (p) =>
        p.type === 'Property' &&
        !p.computed &&
        (((p.key as Node).type === 'Identifier' && (p.key as Node).name === 'id') ||
          ((p.key as Node).type === 'Literal' && (p.key as Node).value === 'id')),
    );
    const value = unwrap(idProp?.value as Node | undefined);
    if (!value || value.type !== 'Literal' || typeof value.value !== 'string') {
      at(beat, "A beat's `id` must be a string literal.");
      continue;
    }
    const id = value.value;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      at(value, `Beat ID "${id}" must be lowercase letters, digits and dashes.`);
      continue;
    }
    if (/^\d+$/.test(id)) {
      at(value, `Beat ID "${id}" can't be only digits: #scene/2 already means the third beat.`);
      continue;
    }
    if (seen.has(id)) {
      at(value, `Beat "${id}" is declared twice in this scene.`);
      continue;
    }
    seen.add(id);
    beats.push({ id, line: position(source, value.start).line });
  }
  if (beats.length === 0 && problems.length === 0) at(list, 'A scene needs at least one beat.');
  return { beats, problems };
}

/**
 * media() calls. A string literal names one file. A template literal with a fixed text around
 * its holes (`media(`cow/${part}.png`)`) names a pattern, which must match at least one file.
 */
function readCalls(
  file: string,
  source: string,
  root: unknown,
  problems: Problem[],
): Pick<Analysis, 'media'> {
  const media: Analysis['media'] = [];
  walk(root as Node, null, {
    CallExpression(node, { next }) {
      const callee = node.callee as Node;
      const arg = (node.arguments as Node[])[0];
      const literal = arg?.type === 'Literal' && typeof arg.value === 'string';
      if (callee.type === 'Identifier' && callee.name === 'media') {
        if (literal) {
          media.push({ name: arg.value as string, ...position(source, arg.start) });
        } else if (arg?.type === 'TemplateLiteral') {
          const quasis = (arg.quasis as Node[]).map(
            (q) => ((q.value as { cooked: string | null }).cooked ?? '') as string,
          );
          media.push({ name: quasis.join('*'), pattern: true, ...position(source, arg.start) });
        } else {
          problems.push({
            file,
            ...position(source, node.start),
            rule: 'media',
            message:
              'media() takes the file name as a string literal, or a template literal like `cow/${part}.png`, so Tobos can check the files exist.',
            severity: 'error',
          });
        }
      }
      next();
    },
  });
  return { media };
}

/**
 * Whether a media() pattern matches a name: `*` matches anything, the rest literally. The deck
 * writes both, so no regex: each part is found leftmost in turn, which never backtracks.
 */
export function mediaMatches(pattern: string, name: string): boolean {
  const parts = pattern.split('*');
  if (parts.length === 1) return name === pattern;
  const first = parts[0]!;
  const last = parts.at(-1)!;
  const end = name.length - last.length;
  if (end < first.length || !name.startsWith(first) || !name.endsWith(last)) return false;
  let at = first.length;
  for (const part of parts.slice(1, -1)) {
    at = name.indexOf(part, at);
    if (at < 0 || at + part.length > end) return false;
    at += part.length;
  }
  return true;
}

// Font sizes, in the forms CSS and GSAP write them. `em` and calc() depend on context: unchecked.
const SIZES: RegExp[] = [
  /font-size\s*:\s*(\d+(?:\.\d+)?)(px|rem)\b/g,
  /(?<![\w-])font\s*:\s*[^;{}"'`]*?\b(\d+(?:\.\d+)?)(px|rem)\b/g,
  /style:font-size\s*=\s*\{?\s*["'`]?\s*(\d+(?:\.\d+)?)(px|rem)\b/g,
  /fontSize\s*:\s*["'`]?(\d+(?:\.\d+)?)(px|rem)?(?![\w.%])/g,
];

function readFontSizes(file: string, source: string, rules: Rules, problems: Problem[]) {
  const floor = rules.minFontSize;
  if (!floor) return;
  const seen = new Set<number>();
  for (const pattern of SIZES)
    for (const match of source.matchAll(pattern)) {
      if (seen.has(match.index)) continue;
      seen.add(match.index);
      // rem is relative to the page's 16px, not the stage's body size.
      const size = Number(match[1]) * (match[2] === 'rem' ? 16 : 1);
      if (size < floor)
        problems.push({
          file,
          ...position(source, match.index),
          rule: 'master/min-font-size',
          message: `${size}px is below the master's smallest stage size, ${floor}px. It won't be readable from the back of the room.`,
          severity: 'error',
        });
    }
}

const TIMERS = new Set(['setTimeout', 'setInterval', 'requestAnimationFrame']);
const NETWORK = new Set(['fetch']);
const NETWORK_CLASSES = new Set(['XMLHttpRequest', 'WebSocket', 'EventSource']);
const REMOTE = /^(https?:)?\/\//i;

/**
 * What the engine can't keep in step with the position: timers, loops, animation on mount;
 * and what the viewer blocks anyway: the network.
 */
function readBehaviour(file: string, source: string, root: unknown, problems: Problem[]) {
  const at = (node: Node, rule: string, message: string, severity: Problem['severity']) =>
    problems.push({ file, ...position(source, node.start), rule, message, severity });
  const network =
    "Scenes can't reach the network: the viewer blocks it. Fetch or compute data on your machine, and commit the output to data/ or media/.";
  walk(
    root as Node,
    { inMount: false },
    {
      CallExpression(node, { state, next }) {
        const callee = node.callee as Node;
        const name =
          callee.type === 'Identifier'
            ? (callee.name as string)
            : callee.type === 'MemberExpression' && (callee.property as Node).type === 'Identifier'
              ? ((callee.property as Node).name as string)
              : '';
        if (callee.type === 'Identifier' && NETWORK.has(name))
          at(node, 'network', network, 'error');
        else if (TIMERS.has(name))
          at(
            node,
            'motion/timer',
            `${name}() runs on its own clock, which the position can't recreate. Anything that moves belongs in a beat's enter().`,
            'warning',
          );
        else if (state.inMount && callee.type === 'MemberExpression') {
          const object = callee.object as Node;
          if (object.type === 'Identifier' && object.name === 'gsap')
            at(
              node,
              'motion/on-mount',
              "Animating in onMount plays whenever the scene mounts, even ahead, out of sight, and jumps don't land on its end. Move it into a beat's enter().",
              'warning',
            );
        }
        if (callee.type === 'Identifier' && name === 'onMount') {
          next({ inMount: true });
          return;
        }
        next();
      },
      NewExpression(node, { next }) {
        const callee = node.callee as Node;
        if (callee.type === 'Identifier' && NETWORK_CLASSES.has(callee.name as string))
          at(node, 'network', network, 'error');
        next();
      },
      Property(node, { next }) {
        const key = node.key as Node;
        const value = node.value as Node;
        if (
          ((key.type === 'Identifier' && key.name === 'repeat') ||
            (key.type === 'Literal' && key.value === 'repeat')) &&
          value.type === 'UnaryExpression' &&
          value.operator === '-'
        )
          at(
            node,
            'motion/loop',
            'repeat: -1 loops for ever. Nothing loops while the presenter talks: give it a number of repeats, or make it a beat.',
            'warning',
          );
        next();
      },
      Attribute(node, { next }) {
        const name = node.name as string;
        const value = node.value;
        const text =
          Array.isArray(value) && value.length === 1 && (value[0] as Node).type === 'Text'
            ? ((value[0] as Node).data as string)
            : undefined;
        if (['src', 'srcset', 'poster', 'data'].includes(name) && text && REMOTE.test(text.trim()))
          at(
            node,
            'network',
            `${name}="${text}" loads from another site, which the viewer blocks. Put the file in media/ and use media().`,
            'error',
          );
        next();
      },
    },
  );
  for (const match of source.matchAll(/url\(\s*["']?((?:https?:)?\/\/[^"')]+)/gi))
    problems.push({
      file,
      ...position(source, match.index),
      rule: 'network',
      message: `url(${match[1]}) loads from another site, which the viewer blocks. Put the file in media/.`,
      severity: 'error',
    });
  for (const match of source.matchAll(/animation(?:-iteration-count)?\s*:[^;}]*\binfinite\b/g))
    problems.push({
      file,
      ...position(source, match.index),
      rule: 'motion/loop',
      message: 'A CSS animation that runs for ever. Nothing loops while the presenter talks.',
      severity: 'warning',
    });
}

const IGNORED_ROOT = new Set([
  'Comment',
  'SnippetBlock',
  'ConstTag',
  'SvelteHead',
  'SvelteWindow',
  'SvelteBody',
  'SvelteDocument',
  'SvelteOptions',
]);

/** A scene renders one layout as its root, so it sits on the master's grid. */
function readRoot(
  file: string,
  source: string,
  ast: { fragment: unknown; instance: unknown },
  problems: Problem[],
) {
  const nodes = ((ast.fragment as Node).nodes as Node[]).filter(
    (n) => !IGNORED_ROOT.has(n.type) && !(n.type === 'Text' && !(n.data as string).trim()),
  );
  // Where each component comes from.
  const sources = new Map<string, string>();
  const instance = ast.instance as Node | null;
  for (const statement of ((instance?.content as Node | undefined)?.body as Node[]) ?? [])
    if (statement.type === 'ImportDeclaration')
      for (const spec of statement.specifiers as Node[])
        sources.set(
          (spec.local as Node).name as string,
          (statement.source as Node).value as string,
        );
  const problem = (node: Node, message: string) =>
    problems.push({
      file,
      ...position(source, node.start),
      rule: 'master/layout-root',
      message,
      severity: 'warning',
    });
  if (nodes.length !== 1) {
    problem(
      nodes[1] ?? (ast.fragment as Node),
      `A scene renders one layout from the master as its only root; this one has ${nodes.length} root elements. Put everything inside the layout.`,
    );
    return;
  }
  const root = nodes[0]!;
  if (root.type !== 'Component') {
    problem(
      root,
      'A scene renders one layout from the master as its root, so it sits on the grid. A master usually has a blank one for full-bleed scenes.',
    );
    return;
  }
  const from = sources.get((root.name as string).split('.')[0]!);
  if (from && !from.startsWith('.'))
    problem(root, `${root.name as string} isn't a layout from the master.`);
}

/** Read what Tobos needs from a .svelte file without running it. */
export function analyzeSvelte(
  file: string,
  source: string,
  options: { scene: boolean; rules?: Rules },
): Analysis {
  let ast: ReturnType<typeof parseSvelte>;
  try {
    ast = parseSvelte(source, { modern: true });
  } catch {
    // The compiler reports syntax errors with their position.
    return { media: [], problems: [] };
  }
  const problems: Problem[] = [];
  const result: Analysis = { media: [], problems };
  const rules = options.rules ?? {};
  if (options.scene) {
    const beats = readBeats(file, source, ast.module as unknown as Node | null);
    result.beats = beats.beats;
    problems.push(...beats.problems);
    if (rules.layoutRoot) readRoot(file, source, ast as never, problems);
  }
  Object.assign(result, readCalls(file, source, ast, problems));
  readFontSizes(file, source, rules, problems);
  readBehaviour(file, source, ast, problems);
  return result;
}

/** Read media() calls and behaviour from a plain module (JavaScript, or TypeScript with types stripped). */
export function analyzeScript(file: string, source: string, rules: Rules = {}): Analysis {
  const problems: Problem[] = [];
  let program: unknown;
  try {
    program = parseJs(source, { ecmaVersion: 'latest', sourceType: 'module', locations: false });
  } catch {
    return { media: [], problems };
  }
  const calls = readCalls(file, source, program, problems);
  readFontSizes(file, source, rules, problems);
  readBehaviour(file, source, program, problems);
  return { ...calls, problems };
}
