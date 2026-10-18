import { parse as parseJs } from 'acorn';
import { parse as parseSvelte } from 'svelte/compiler';
import { walk } from 'zimmerframe';
import { TEXT_MAX } from './activity.ts';
import { position } from './tree.ts';
import type { Activity, Problem, TextField } from './types.ts';

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
  /** The scene's activity, if it declares one without problems, and the line of its id. */
  activity?: { activity: Activity; line: number };
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

/** The most beats a scene declares; more is several scenes. */
const BEATS_MAX = 100;

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
  if (beats.length > BEATS_MAX)
    at(
      list,
      `The scene has ${beats.length} beats; it may have ${BEATS_MAX}. Split it into several scenes.`,
    );
  return { beats, problems };
}

/** A value written as literals, with where each part is, for messages. */
interface Literal {
  node: Node;
  value: string | number | boolean | Literal[] | Map<string, Literal>;
}

/** Read a literal, or say which node isn't one. */
function readLiteral(node: Node): Literal | { bad: Node } {
  const value = unwrap(node)!;
  if (value.type === 'Literal' && ['string', 'number', 'boolean'].includes(typeof value.value))
    return { node: value, value: value.value as string | number | boolean };
  if (value.type === 'TemplateLiteral' && (value.expressions as Node[]).length === 0)
    return {
      node: value,
      value: ((value.quasis as Node[])[0]!.value as { cooked: string | null }).cooked ?? '',
    };
  if (value.type === 'ArrayExpression') {
    const items: Literal[] = [];
    for (const element of value.elements as (Node | null)[]) {
      if (!element || element.type === 'SpreadElement') return { bad: element ?? value };
      const item = readLiteral(element);
      if ('bad' in item) return item;
      items.push(item);
    }
    return { node: value, value: items };
  }
  if (value.type === 'ObjectExpression') {
    const props = new Map<string, Literal>();
    for (const prop of value.properties as Node[]) {
      const key = prop.key as Node | undefined;
      const name =
        key?.type === 'Identifier'
          ? (key.name as string)
          : key?.type === 'Literal' && typeof key.value === 'string'
            ? key.value
            : undefined;
      if (prop.type !== 'Property' || prop.computed || prop.kind !== 'init' || prop.method)
        return { bad: prop };
      if (name === undefined) return { bad: prop };
      const item = readLiteral(prop.value as Node);
      if ('bad' in item) return item;
      props.set(name, item);
    }
    return { node: value, value: props };
  }
  return { bad: value };
}

const ACTIVITY_ID = /^[a-z0-9][a-z0-9-]*$/;
const PROMPT_MAX = 200;
const OPTION_MAX = 80;
const LABEL_MAX = 200;
const FIELD_MAX = 2000;
const list = (names: string[]) =>
  names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

/**
 * The scene's activity, from `export const activity = { … }` in its module script: object and
 * array literals of strings, numbers and booleans, read without running the scene.
 */
function readActivity(
  file: string,
  source: string,
  module: Node | null,
  beats: BeatInfo[] | undefined,
): Pick<Analysis, 'activity' | 'problems'> {
  const problems: Problem[] = [];
  const at = (node: Node, message: string) =>
    problems.push({
      file,
      ...position(source, node.start),
      rule: 'activity',
      message,
      severity: 'error',
    });
  let init: Node | undefined;
  for (const statement of ((module?.content as Node | undefined)?.body as Node[]) ?? []) {
    const declaration = statement.declaration as Node | null;
    if (statement.type !== 'ExportNamedDeclaration' || declaration?.type !== 'VariableDeclaration')
      continue;
    for (const declarator of declaration.declarations as Node[]) {
      const id = declarator.id as Node;
      if (id.type !== 'Identifier' || id.name !== 'activity') continue;
      if (declaration.kind !== 'const') at(declarator, '`activity` must be declared with const.');
      init = unwrap(declarator.init as Node);
      if (!init) at(declarator, '`activity` needs a value.');
    }
  }
  if (!init || problems.length) return { problems };
  if (init.type !== 'ObjectExpression') {
    at(
      init,
      '`activity` must be an object literal, so Tobos can read it without running the scene.',
    );
    return { problems };
  }
  const read = readLiteral(init);
  if ('bad' in read) {
    at(
      read.bad,
      '`activity` may hold only string, number and boolean literals, and arrays and objects of them, so Tobos can read it without running the scene.',
    );
    return { problems };
  }
  const props = read.value as Map<string, Literal>;
  const text = (literal: Literal | undefined) =>
    typeof literal?.value === 'string' ? literal.value : undefined;
  /** A string of at most `max` characters, or a problem. */
  const short = (literal: Literal, name: string, max: number) => {
    const value = text(literal);
    if (value === undefined) at(literal.node, `The \`${name}\` is a string.`);
    else if (value.length > max)
      at(literal.node, `The \`${name}\` is ${value.length} characters; it may have ${max}.`);
    return value;
  };
  const only = (map: Map<string, Literal>, allowed: string[], what: string) => {
    for (const [key, literal] of map)
      if (!allowed.includes(key))
        at(literal.node, `${what} has no \`${key}\`: it takes ${list(allowed)}.`);
  };

  const idLiteral = props.get('id');
  const id = text(idLiteral);
  if (id === undefined)
    at(idLiteral?.node ?? init, 'An activity needs an `id`: lowercase letters, digits and dashes.');
  else if (!ACTIVITY_ID.test(id))
    at(idLiteral!.node, `Activity ID "${id}" must be lowercase letters, digits and dashes.`);
  const kind = text(props.get('kind'));
  const prompt = props.get('prompt');

  let activity: Activity | undefined;
  if (kind === 'choice') {
    only(props, ['id', 'kind', 'prompt', 'options', 'reveals'], 'A poll');
    const question = prompt ? short(prompt, 'prompt', PROMPT_MAX) : undefined;
    if (!prompt) at(init, 'A poll needs a `prompt`.');
    else if (question !== undefined && !question.trim())
      at(prompt.node, 'A poll needs a `prompt`.');
    const optionsLiteral = props.get('options');
    const options: string[] = [];
    if (!Array.isArray(optionsLiteral?.value))
      at(optionsLiteral?.node ?? init, 'A poll needs 2 to 8 `options`, as an array of strings.');
    else {
      const items = optionsLiteral.value;
      if (items.length < 2 || items.length > 8)
        at(optionsLiteral.node, `A poll needs 2 to 8 \`options\`; this one has ${items.length}.`);
      for (const item of items) {
        const option = text(item);
        if (option === undefined) at(item.node, 'Each option is a string.');
        else if (!option.trim()) at(item.node, 'An option needs some text.');
        else if (option.length > OPTION_MAX)
          at(item.node, `An option is ${option.length} characters; it may have ${OPTION_MAX}.`);
        else if (options.includes(option)) at(item.node, `Option "${option}" is listed twice.`);
        else options.push(option);
      }
    }
    const revealsLiteral = props.get('reveals');
    const reveals = text(revealsLiteral);
    if (revealsLiteral) {
      const names = (beats ?? []).map((b) => b.id);
      if (reveals === undefined) at(revealsLiteral.node, '`reveals` names a beat of this scene.');
      else if (names[0] === reveals)
        at(
          revealsLiteral.node,
          `\`reveals\` names "${reveals}", the scene's first beat: the poll would never be open. Name a later beat.`,
        );
      else if (beats && !names.includes(reveals))
        at(
          revealsLiteral.node,
          `\`reveals\` names "${reveals}", which is not a beat of this scene (${names.join(', ')}).`,
        );
    }
    if (id !== undefined && question !== undefined)
      activity = {
        id,
        kind,
        prompt: question,
        options,
        ...(reveals !== undefined ? { reveals } : {}),
      };
  } else if (kind === 'text') {
    if (props.has('reveals'))
      at(props.get('reveals')!.node, "A form can't `reveal`: a form's answers are only stored.");
    only(
      new Map([...props].filter(([key]) => key !== 'reveals')),
      ['id', 'kind', 'prompt', 'fields'],
      'A form',
    );
    const question = prompt ? short(prompt, 'prompt', PROMPT_MAX) : undefined;
    const fieldsLiteral = props.get('fields');
    const fields: TextField[] = [];
    if (!Array.isArray(fieldsLiteral?.value))
      at(fieldsLiteral?.node ?? init, 'A form needs 1 to 5 `fields`, as an array of objects.');
    else {
      const items = fieldsLiteral.value;
      if (items.length < 1 || items.length > 5)
        at(fieldsLiteral.node, `A form needs 1 to 5 \`fields\`; this one has ${items.length}.`);
      const seen = new Set<string>();
      for (const item of items) {
        if (!(item.value instanceof Map)) {
          at(item.node, 'Each field is an object: `{ id: "…", label: "…" }`.');
          continue;
        }
        const field = item.value;
        only(field, ['id', 'label', 'multiline', 'max'], 'A field');
        const fieldIdLiteral = field.get('id');
        const fieldId = text(fieldIdLiteral);
        if (fieldId === undefined)
          at(
            fieldIdLiteral?.node ?? item.node,
            'A field needs an `id`: lowercase letters, digits and dashes.',
          );
        else if (!ACTIVITY_ID.test(fieldId))
          at(
            fieldIdLiteral!.node,
            `Field ID "${fieldId}" must be lowercase letters, digits and dashes.`,
          );
        else if (seen.has(fieldId))
          at(fieldIdLiteral!.node, `Field "${fieldId}" is declared twice in this form.`);
        else seen.add(fieldId);
        const labelLiteral = field.get('label');
        const label = labelLiteral ? short(labelLiteral, 'label', LABEL_MAX) : undefined;
        if (!labelLiteral) at(item.node, 'A field needs a `label`.');
        const multiline = field.get('multiline');
        if (multiline && typeof multiline.value !== 'boolean')
          at(multiline.node, '`multiline` is true or false.');
        const max = field.get('max');
        if (
          max &&
          (typeof max.value !== 'number' ||
            !Number.isInteger(max.value) ||
            max.value < 1 ||
            max.value > FIELD_MAX)
        )
          at(max.node, `\`max\` is a whole number of characters from 1 to ${FIELD_MAX}.`);
        if (fieldId !== undefined && label !== undefined)
          fields.push({
            id: fieldId,
            label,
            ...(multiline?.value === true ? { multiline: true } : {}),
            max: typeof max?.value === 'number' ? max.value : TEXT_MAX,
          });
      }
    }
    if (id !== undefined)
      activity = {
        id,
        kind,
        ...(question !== undefined ? { prompt: question } : {}),
        fields,
      };
  } else
    at(
      props.get('kind')?.node ?? init,
      'An activity\'s `kind` is "choice" (a poll) or "text" (a form).',
    );

  if (problems.length || !activity) return { problems };
  return { activity: { activity, line: position(source, idLiteral!.node.start).line }, problems };
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
    const module = ast.module as unknown as Node | null;
    const beats = readBeats(file, source, module);
    result.beats = beats.beats;
    problems.push(...beats.problems);
    const activity = readActivity(file, source, module, beats.beats);
    result.activity = activity.activity;
    problems.push(...activity.problems);
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
