import { parse as parseJs } from 'acorn';
import { parse as parseSvelte } from 'svelte/compiler';
import { walk, type Context } from 'zimmerframe';
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

/** A name passed to media(), a template literal's as a pattern (`cow/*.png`), with where. */
export interface MediaRef {
  name: string;
  pattern?: boolean;
  line: number;
  column: number;
}

/**
 * What a file does with the `media` one of the deck's own files exports (`import { media } from
 * '../lib/index.ts'`, or that file's namespace): the media() calls it makes and the problems it
 * would have, if that file passes the engine's media() on. Only the build, which reads every
 * file's exports, knows whether it does.
 */
export interface Through {
  specifier: string;
  media: MediaRef[];
  problems: Problem[];
}

export interface Analysis {
  /** The scene's beats, if the file is a scene and they could be read. */
  beats?: BeatInfo[];
  /** The scene's activity, if it declares one without problems, and the line of its id. */
  activity?: { activity: Activity; line: number };
  /** Names passed to the engine's media(), with where they were used. */
  media: MediaRef[];
  /** What holds only if one of the deck's files passes the engine's media() on. */
  through?: Through[];
  /** The imports and re-exports that take names from a module, if the file could be read. */
  takes?: Take[];
  /** What the file exports, if it could be read. */
  exports?: Exports;
  problems: Problem[];
}

/** An import or a re-export that takes names from a module: `default` for a default import. */
export interface Take {
  specifier: string;
  names: string[];
  line: number;
  column: number;
}

/** What a module exports: its names, and the modules it re-exports everything of (`export *`). */
export interface Exports {
  names: string[];
  /**
   * The names it passes on from another module (`export { a as b } from`): the name, the module
   * and the name there, `*` for the module itself (`export * as b from`).
   */
  from: [name: string, specifier: string, there: string][];
  all: string[];
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

/** Why media() is only ever called by its name, as the check's messages say it. */
const MEDIA_BY_NAME =
  "Tobos reads each media() call to know which files a scene shows, and a share link gets only those; it can't follow media() under another name.";

const ENGINE = '@tobos/present';

const isRelative = (specifier: string) => specifier.startsWith('./') || specifier.startsWith('../');

/** TypeScript's nodes that hold a value, unlike those that are types. */
const TS_VALUES = new Set([
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
  'TSInstantiationExpression',
]);

/** Nodes whose value is the one inside them: `(media)`, `media!`, `media as M`. */
const WRAPPERS = new Set([...TS_VALUES, 'ParenthesizedExpression']);

/** The names a block's own declarations take for it alone: `let`, `const`, `class`, `function`. */
function lexical(statements: Node[]): string[] {
  const names: string[] = [];
  for (const statement of statements) {
    if (statement.type === 'VariableDeclaration' && statement.kind !== 'var')
      for (const declarator of statement.declarations as Node[])
        bound(declarator.id as Node, names);
    else if (statement.type === 'FunctionDeclaration' || statement.type === 'ClassDeclaration')
      bound(statement.id as Node | null, names);
  }
  return names;
}

/** The names `var` declares in a function's body, anywhere but in the functions inside it. */
function hoisted(body: Node): string[] {
  const names: string[] = [];
  const skip = () => {};
  walk(body, null, {
    VariableDeclaration(node, { next }) {
      if (node.kind === 'var')
        for (const declarator of node.declarations as Node[]) bound(declarator.id as Node, names);
      next();
    },
    FunctionDeclaration: skip,
    FunctionExpression: skip,
    ArrowFunctionExpression: skip,
  });
  return names;
}

/** Whether an identifier, where it is, names a value: not a key, a label or what it declares. */
function isReference(node: Node, parent: Node, grandparent: Node | undefined): boolean {
  switch (parent.type) {
    case 'MemberExpression':
      return parent.object === node || Boolean(parent.computed);
    case 'Property':
    case 'MethodDefinition':
    case 'PropertyDefinition':
    case 'AccessorProperty':
      return parent.value === node || (Boolean(parent.computed) && parent.key === node);
    // `export { media } from './x'` names x's.
    case 'ExportSpecifier':
      return parent.local === node && !grandparent?.source;
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ClassDeclaration':
    case 'ClassExpression':
      return parent.id !== node;
    case 'VariableDeclarator':
      return parent.init === node;
    case 'ImportSpecifier':
    case 'ImportDefaultSpecifier':
    case 'ImportNamespaceSpecifier':
    case 'ExportAllDeclaration':
    case 'LabeledStatement':
    case 'BreakStatement':
    case 'ContinueStatement':
    case 'MetaProperty':
    case 'CatchClause':
      return false;
    default:
      return true;
  }
}

/** A scope, as the walk below goes: the file's names that its own declarations hide there. */
type Scope = { hidden: Set<string> };

/**
 * The engine's media() calls. A string literal names one file. A template literal with a fixed
 * text around its holes (`media(`cow/${part}.png`)`) names a pattern, which must match at least
 * one file. media() is the one a file imports from '@tobos/present', or from one of the deck's
 * files that passes it on, and a call through the engine's namespace (`present.media('cow.jpg')`)
 * is one too; a name of the file's own, or a package's, that is also `media` is not it, nor is
 * what a function or a block declares under that name. media() under another name, or passed on
 * as a value, is refused: a call there is one the check can't read, so a share would miss its
 * file.
 */
function readCalls(
  file: string,
  source: string,
  root: unknown,
  problems: Problem[],
): Pick<Analysis, 'media' | 'through'> {
  const media: MediaRef[] = [];
  const through = new Map<string, Through>();
  /** Where a finding goes: the file's own, or what holds if `from`, a deck's file, passes media() on. */
  const into = (from: string | undefined) => {
    if (from === undefined) return { media, problems };
    let found = through.get(from);
    if (!found) through.set(from, (found = { specifier: from, media: [], problems: [] }));
    return found;
  };
  const refuse = (from: string | undefined, node: Node, message: string) =>
    into(from).problems.push({
      file,
      ...position(source, node.start),
      rule: 'media',
      message,
      severity: 'error',
    });
  const passedOn = (from: string | undefined, node: Node) =>
    refuse(
      from,
      node,
      `Call media() where the file is needed, as \`media('cow.jpg')\`, rather than passing it on or giving it another name. ${MEDIA_BY_NAME}`,
    );
  const exportedAs = (from: string | undefined, node: Node, name: string) =>
    refuse(
      from,
      node,
      `Export media() under its own name, or import it from '@tobos/present' where it is called, not as ${name}. ${MEDIA_BY_NAME}`,
    );
  const readCall = (from: string | undefined, call: Node) => {
    const found = into(from);
    const arg = (call.arguments as Node[])[0];
    if (arg?.type === 'Literal' && typeof arg.value === 'string') {
      found.media.push({ name: arg.value, ...position(source, arg.start) });
    } else if (arg?.type === 'TemplateLiteral') {
      const quasis = (arg.quasis as Node[]).map(
        (q) => ((q.value as { cooked: string | null }).cooked ?? '') as string,
      );
      found.media.push({ name: quasis.join('*'), pattern: true, ...position(source, arg.start) });
    } else
      found.problems.push({
        file,
        ...position(source, call.start),
        rule: 'media',
        message:
          'media() takes the file name as a string literal, or a template literal like `cow/${part}.png`, so Tobos can check the files exist.',
        severity: 'error',
      });
  };

  /** The engine (undefined), one of the deck's files (its specifier), or a package (null). */
  const origin = (node: Node | null | undefined): string | undefined | null => {
    const value = node?.value;
    if (value === ENGINE) return undefined;
    return typeof value === 'string' && isRelative(value) ? value : null;
  };
  // The names the file imports that may be media() or a namespace with it: from the engine they
  // are, from one of the deck's files if it passes media() on, and a package's `media` is its own.
  // Imports and exports are a module's own statements: a component's are its scripts'.
  const bindings = new Map<string, { namespace: boolean; from: string | undefined }>();
  const svelte = root as { type: string; instance?: { content: Node }; module?: { content: Node } };
  const scripts =
    svelte.type === 'Program'
      ? [root as Node]
      : [svelte.instance?.content, svelte.module?.content].filter((s) => s !== undefined);
  const statements = scripts
    .flatMap((script) => script.body as Node[])
    .filter((node) => node.importKind !== 'type' && node.exportKind !== 'type');
  for (const node of statements) {
    const from = origin(node.source as Node | null | undefined);
    if (from === null) continue;
    if (node.type === 'ImportDeclaration')
      for (const specifier of node.specifiers as Node[]) {
        const local = (specifier.local as Node).name as string;
        if (specifier.type === 'ImportNamespaceSpecifier')
          bindings.set(local, { namespace: true, from });
        else if (
          specifier.type !== 'ImportSpecifier' ||
          specifier.importKind === 'type' ||
          nameOf(specifier.imported as Node) !== 'media'
        )
          continue;
        else if (local === 'media') bindings.set(local, { namespace: false, from });
        else
          refuse(
            from,
            specifier,
            `Import media() under its own name, \`import { media } from '@tobos/present'\`, not as ${local}. ${MEDIA_BY_NAME}`,
          );
      }
    // `export * as present from '@tobos/present'`: media() as `present.media`.
    else if (node.type === 'ExportAllDeclaration' && node.exported)
      exportedAs(from, node, `${nameOf(node.exported as Node)}.media`);
    else if (node.type === 'ExportNamedDeclaration')
      for (const specifier of node.specifiers as Node[]) {
        const name = nameOf(specifier.exported as Node);
        if (
          specifier.exportKind !== 'type' &&
          nameOf(specifier.local as Node) === 'media' &&
          name !== 'media'
        )
          exportedAs(from, specifier, name);
      }
  }

  const named = new Set(bindings.keys());
  /** The scope inside a node that declares `names`: one of the file's names they take is hidden. */
  const hide = (scope: Scope, names: string[]): Scope => {
    const more = names.filter((name) => named.has(name) && !scope.hidden.has(name));
    return more.length ? { hidden: new Set([...scope.hidden, ...more]) } : scope;
  };
  const declares = (pattern: unknown) => {
    const names: string[] = [];
    bound((pattern ?? null) as Node | null, names);
    return names;
  };
  const fn = (node: Node, { state, next }: Context<Node, Scope>) => {
    const names = named.size ? (node.params as Node[]).flatMap(declares) : [];
    if (named.size && node.type === 'FunctionExpression') names.push(...declares(node.id));
    if (named.size && (node.body as Node).type === 'BlockStatement')
      names.push(...hoisted(node.body as Node));
    next(hide(state, names));
  };
  const block = (node: Node, { state, next }: Context<Node, Scope>) => {
    next(hide(state, lexical(node.body as Node[])));
  };
  const loop = (node: Node, { state, next }: Context<Node, Scope>) => {
    const head = (node.init ?? node.left) as Node | null;
    next(hide(state, head?.type === 'VariableDeclaration' ? lexical([head]) : []));
  };
  const directive = (node: Node, { state, next }: Context<Node, Scope>) => {
    // `use:media`, `transition:present.media`: the directive calls what it names.
    const [first, second] = (node.name as string).split('.');
    const binding = bindings.get(first!);
    if (
      binding &&
      !state.hidden.has(first!) &&
      (!binding.namespace || second === undefined || second === 'media')
    )
      passedOn(binding.from, node);
    next();
  };
  const seen = new Set<number>();
  walk<Node, Scope>(
    root as Node,
    { hidden: new Set() },
    {
      // Svelte's `let:` directives declare their names for the element's content.
      _(node, { state, next }) {
        const lets = Array.isArray(node.attributes)
          ? (node.attributes as Node[]).filter((a) => a.type === 'LetDirective')
          : [];
        next(
          hide(
            state,
            lets.flatMap((d) => (d.expression ? declares(d.expression) : [d.name as string])),
          ),
        );
      },
      FunctionDeclaration: fn,
      FunctionExpression: fn,
      ArrowFunctionExpression: fn,
      BlockStatement: block,
      StaticBlock: block,
      ForStatement: loop,
      ForInStatement: loop,
      ForOfStatement: loop,
      SwitchStatement(node, { state, visit }) {
        visit(node.discriminant as Node, state);
        const cases = node.cases as Node[];
        const inner = hide(state, lexical(cases.flatMap((c) => c.consequent as Node[])));
        for (const c of cases) visit(c, inner);
      },
      CatchClause(node, { state, next }) {
        next(hide(state, declares(node.param)));
      },
      ClassExpression(node, { state, next }) {
        next(hide(state, declares(node.id)));
      },
      // Svelte's markup: what a fragment's tags declare, and what a block declares for its content.
      Fragment(node, { state, next }) {
        const names: string[] = [];
        for (const child of node.nodes as Node[])
          if (child.type === 'ConstTag') names.push(...lexical([child.declaration as Node]));
          else if (child.type === 'SnippetBlock') names.push(...declares(child.expression));
        next(hide(state, names));
      },
      EachBlock(node, { state, visit }) {
        visit(node.expression as Node, state);
        const names = declares(node.context);
        if (typeof node.index === 'string') names.push(node.index);
        const inner = hide(state, names);
        for (const part of [node.context, node.key, node.body] as (Node | null)[])
          if (part) visit(part, inner);
        if (node.fallback) visit(node.fallback as Node, state);
      },
      AwaitBlock(node, { state, visit }) {
        visit(node.expression as Node, state);
        if (node.pending) visit(node.pending as Node, state);
        for (const [pattern, content] of [
          [node.value, node.then],
          [node.error, node.catch],
        ] as (Node | null)[][]) {
          const inner = hide(state, declares(pattern));
          for (const part of [pattern, content]) if (part) visit(part, inner);
        }
      },
      SnippetBlock(node, { state, visit }) {
        // Its name is declared in the fragment it is in.
        const parameters = node.parameters as Node[];
        const inner = hide(state, parameters.flatMap(declares));
        for (const part of [...parameters, node.body as Node]) visit(part, inner);
      },
      UseDirective: directive,
      TransitionDirective: directive,
      AnimateDirective: directive,
      ImportExpression(node, { next }) {
        const specifier = node.source as Node;
        const value =
          specifier.type === 'Literal'
            ? specifier.value
            : specifier.type === 'TemplateLiteral' && (specifier.expressions as Node[]).length === 0
              ? (specifier.quasis as Node[])[0]!.value
              : undefined;
        const name = typeof value === 'object' ? (value as { cooked?: string })?.cooked : value;
        if (name === ENGINE)
          refuse(
            undefined,
            node,
            `Import media() with an import statement, \`import { media } from '@tobos/present'\`, not with import(). ${MEDIA_BY_NAME}`,
          );
        else if (typeof name === 'string' && isRelative(name))
          refuse(
            name,
            node,
            `${name} passes media() on, which import() would give as a value: import that file with an import statement. ${MEDIA_BY_NAME}`,
          );
        next();
      },
      Identifier(node, { path, state }) {
        const name = node.name as string;
        const binding = bindings.get(name);
        if (!binding || state.hidden.has(name) || seen.has(node.start)) return;
        const parent = path.at(-1);
        if (!parent || path.some((n) => n.type.startsWith('TS') && !TS_VALUES.has(n.type))) return;
        if (!isReference(node, parent, path.at(-2))) return;
        // `export { media }` and its shorthand twin are the same name twice: read once.
        seen.add(node.start);
        /** What holds a value in `path` from `at` up, past `(media)`, `media!` and the like. */
        const holding = (value: Node, at: number) => {
          while (at > 0 && WRAPPERS.has(path[at]!.type)) value = path[at--]!;
          return { value, holder: path[at], at };
        };
        const { value: held, holder, at } = holding(node, path.length - 1);
        if (!holder) return;
        if (!binding.namespace) {
          if (holder.type === 'CallExpression' && holder.callee === held)
            readCall(binding.from, holder);
          else if (holder.type !== 'ExportSpecifier') passedOn(binding.from, node);
          else if (nameOf(holder.exported as Node) !== 'media')
            exportedAs(binding.from, holder, nameOf(holder.exported as Node));
          return;
        }
        // The namespace: `present.media('cow.jpg')`, and its other names.
        if (holder.type !== 'MemberExpression' || holder.object !== held) {
          passedOn(binding.from, node);
          return;
        }
        const property = holder.property as Node;
        const key = !holder.computed
          ? nameOf(property)
          : property.type === 'Literal'
            ? String(property.value)
            : undefined;
        if (key !== undefined && key !== 'media') return;
        const { value: member, holder: call } = holding(holder, at - 1);
        if (key === 'media' && call?.type === 'CallExpression' && call.callee === member)
          readCall(binding.from, call);
        else passedOn(binding.from, holder);
      },
    },
  );
  return { media, ...(through.size ? { through: [...through.values()] } : {}) };
}

/**
 * Whether a media() pattern matches a name: `*` matches anything, the rest literally. The deck
 * writes both, so no regex: each part is found leftmost in turn, which never backtracks. The
 * pattern is split once, for the many names it is matched against.
 */
export function mediaMatcher(pattern: string): (name: string) => boolean {
  const parts = pattern.split('*');
  if (parts.length === 1) return (name) => name === pattern;
  const first = parts[0]!;
  const last = parts.at(-1)!;
  const middle = parts.slice(1, -1);
  return (name) => {
    const end = name.length - last.length;
    if (end < first.length || !name.startsWith(first) || !name.endsWith(last)) return false;
    let at = first.length;
    for (const part of middle) {
      at = name.indexOf(part, at);
      if (at < 0 || at + part.length > end) return false;
      at += part.length;
    }
    return true;
  };
}

export const mediaMatches = (pattern: string, name: string): boolean => mediaMatcher(pattern)(name);

/**
 * The names that any of `patterns` matches: each pattern matched once, however many media() calls
 * write it, and one that is only holes (``media(`${name}`)``) matching every name.
 */
export function mediaMatching(names: string[], patterns: Iterable<string>): string[] {
  const distinct = [...new Set(patterns)];
  if (distinct.length === 0) return [];
  if (distinct.some((pattern) => /^\*+$/.test(pattern))) return names;
  const matchers = distinct.map(mediaMatcher);
  return names.filter((name) => matchers.some((matches) => matches(name)));
}

/**
 * Each match of `start`, with the value after it: up to the first of `end` (a global pattern) or
 * the next match. These checks read source anyone can push, on the server, so a pattern that
 * scans on from every match to the file's end would let a few kilobytes take minutes. Here each
 * part of the source is scanned once.
 */
function* declarations(
  source: string,
  start: RegExp,
  end: RegExp,
): Generator<{ index: number; value: string }> {
  const starts = [...source.matchAll(start)];
  let stop = -1;
  for (const [i, match] of starts.entries()) {
    const from = match.index + match[0].length;
    if (stop < from) {
      end.lastIndex = from;
      stop = end.exec(source)?.index ?? source.length;
    }
    const next = starts[i + 1]?.index ?? source.length;
    yield { index: match.index, value: source.slice(from, Math.min(stop, next)) };
  }
}

type Size = { index: number; value: string; unit: string | undefined };

const sizesOf =
  (pattern: RegExp) =>
  (source: string): Size[] =>
    [...source.matchAll(pattern)].map((m) => ({ index: m.index, value: m[1]!, unit: m[2] }));

// Font sizes, in the forms CSS and GSAP write them. `em` and calc() depend on context: unchecked.
// No two neighbouring parts of a pattern take the same characters, so none backtracks for long.
const SIZES: ((source: string) => Size[])[] = [
  sizesOf(/font-size\s*:\s*(\d+(?:\.\d+)?)(px|rem)\b/g),
  // The `font` shorthand: its size is somewhere among the declaration's other values.
  (source) =>
    [...declarations(source, /(?<![\w-])font\s*:/g, /[;{}"'`]/g)].flatMap(({ index, value }) => {
      const size = /\b(\d+(?:\.\d+)?)(px|rem)\b/.exec(value);
      return size ? [{ index, value: size[1]!, unit: size[2] }] : [];
    }),
  sizesOf(/style:font-size\s*=\s*(?:\{\s*)?(?:["'`]\s*)?(\d+(?:\.\d+)?)(px|rem)\b/g),
  sizesOf(/fontSize\s*:\s*["'`]?(\d+(?:\.\d+)?)(px|rem)?(?![\w.%])/g),
];

/**
 * The source as the text checks read it: what isn't code, the markup's prose and every comment,
 * blanked, its lines kept, so each position stays where it was. `font-size: 12px` in a paragraph
 * is something a slide says, not how it looks.
 */
function codeOnly(source: string, prose: { start: number; end: number }[]): string {
  if (prose.length === 0) return source;
  const chars = source.split('');
  for (const { start, end } of prose)
    for (let i = start; i < end; i++) if (chars[i] !== '\n') chars[i] = ' ';
  return chars.join('');
}

/**
 * A Svelte file's prose: the text between its tags and in its attributes, all but `style`, which
 * is CSS, and its comments, HTML, script and CSS.
 */
function proseOf(ast: ReturnType<typeof parseSvelte>): { start: number; end: number }[] {
  const modern = ast as unknown as {
    fragment: Node;
    comments?: { start: number; end: number }[];
    css?: { comments?: { start: number; end: number }[] } | null;
  };
  const prose = [...(modern.comments ?? []), ...(modern.css?.comments ?? [])];
  walk(modern.fragment, null, {
    Fragment(node, { next }) {
      for (const child of node.nodes as Node[])
        if (child.type === 'Text' || child.type === 'Comment')
          prose.push({ start: child.start as number, end: child.end as number });
      next();
    },
    Attribute(node, { next }) {
      if (node.name !== 'style' && Array.isArray(node.value))
        for (const part of node.value as Node[])
          if (part.type === 'Text')
            prose.push({ start: part.start as number, end: part.end as number });
      next();
    },
  });
  return prose;
}

function readFontSizes(file: string, source: string, rules: Rules, problems: Problem[]) {
  const floor = rules.minFontSize;
  if (!floor) return;
  const seen = new Set<number>();
  for (const sizes of SIZES)
    for (const match of sizes(source)) {
      if (seen.has(match.index)) continue;
      seen.add(match.index);
      // rem is relative to the page's 16px, not the stage's body size.
      const size = Number(match.value) * (match.unit === 'rem' ? 16 : 1);
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
/** The global object, by the names code calls it: `window.fetch` is fetch. */
const GLOBALS = new Set(['window', 'globalThis', 'self']);
const onGlobal = (callee: Node) =>
  callee.type === 'MemberExpression' &&
  (callee.object as Node).type === 'Identifier' &&
  GLOBALS.has((callee.object as Node).name as string);
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
        if (
          ((callee.type === 'Identifier' || onGlobal(callee)) && NETWORK.has(name)) ||
          // navigator.sendBeacon(), however navigator is reached.
          (callee.type === 'MemberExpression' && name === 'sendBeacon')
        )
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
        const name =
          callee.type === 'Identifier'
            ? (callee.name as string)
            : onGlobal(callee)
              ? ((callee.property as Node).name as string)
              : '';
        if (NETWORK_CLASSES.has(name)) at(node, 'network', network, 'error');
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
  for (const { index, value } of declarations(
    source,
    /animation(?:-iteration-count)?\s*:/g,
    /[;}]/g,
  ))
    if (/\binfinite\b/.test(value))
      problems.push({
        file,
        ...position(source, index),
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

const nameOf = (node: Node) =>
  node.type === 'Identifier' ? (node.name as string) : String(node.value);

/** The names a declaration binds: `export const { a, b: [c] } = …` exports a and c. */
function bound(pattern: Node | null, names: string[]) {
  if (!pattern) return;
  if (pattern.type === 'Identifier') names.push(pattern.name as string);
  else if (pattern.type === 'ObjectPattern')
    for (const property of pattern.properties as Node[])
      bound((property.type === 'RestElement' ? property.argument : property.value) as Node, names);
  else if (pattern.type === 'ArrayPattern')
    for (const element of pattern.elements as (Node | null)[]) bound(element, names);
  else if (pattern.type === 'RestElement') bound(pattern.argument as Node, names);
  else if (pattern.type === 'AssignmentPattern') bound(pattern.left as Node, names);
}

/**
 * What a script's imports and re-exports take from their modules, by name, as the parser decodes
 * them. TypeScript's type-only imports are gone by the time a browser loads the file, so they
 * take nothing.
 */
function readTakes(source: string, program: Node | null | undefined, takes: Take[]) {
  for (const node of (program?.body as Node[] | undefined) ?? []) {
    if (node.importKind === 'type' || node.exportKind === 'type' || !node.source) continue;
    if (node.type !== 'ImportDeclaration' && node.type !== 'ExportNamedDeclaration') continue;
    const names = (node.specifiers as Node[]).flatMap((specifier) =>
      specifier.importKind === 'type' || specifier.exportKind === 'type'
        ? []
        : specifier.type === 'ImportDefaultSpecifier'
          ? ['default']
          : specifier.type === 'ImportSpecifier'
            ? [nameOf(specifier.imported as Node)]
            : specifier.type === 'ExportSpecifier'
              ? [nameOf(specifier.local as Node)]
              : [],
    );
    const from = node.source as Node;
    if (names.length > 0)
      takes.push({ specifier: String(from.value), names, ...position(source, from.start + 1) });
  }
}

/** What a script exports, but for its types. */
function readExports(program: Node | null | undefined, exports: Exports) {
  const body = (program?.body as Node[] | undefined) ?? [];
  // `import { a } from './m'; export { a }` passes on m's a, as `export { a } from './m'` does; a
  // namespace imported and exported is the module's own.
  const imported = new Map<string, [specifier: string, there: string]>();
  for (const node of body)
    if (node.type === 'ImportDeclaration' && node.importKind !== 'type')
      for (const specifier of node.specifiers as Node[])
        if (specifier.importKind !== 'type' && specifier.type !== 'ImportNamespaceSpecifier')
          imported.set((specifier.local as Node).name as string, [
            String((node.source as Node).value),
            specifier.type === 'ImportDefaultSpecifier'
              ? 'default'
              : nameOf(specifier.imported as Node),
          ]);
  for (const node of body) {
    if (node.exportKind === 'type') continue;
    if (node.type === 'ExportDefaultDeclaration') exports.names.push('default');
    else if (node.type === 'ExportAllDeclaration') {
      const specifier = String((node.source as Node).value);
      if (!node.exported) exports.all.push(specifier);
      else {
        const name = nameOf(node.exported as Node);
        exports.names.push(name);
        exports.from.push([name, specifier, '*']);
      }
    } else if (node.type === 'ExportNamedDeclaration') {
      const declaration = node.declaration as Node | null;
      if (declaration?.type === 'VariableDeclaration')
        for (const declarator of declaration.declarations as Node[])
          bound(declarator.id as Node, exports.names);
      else if (
        declaration?.type === 'FunctionDeclaration' ||
        declaration?.type === 'ClassDeclaration'
      )
        exports.names.push(nameOf(declaration.id as Node));
      for (const specifier of node.specifiers as Node[]) {
        if (specifier.exportKind === 'type') continue;
        const name = nameOf(specifier.exported as Node);
        exports.names.push(name);
        const through = node.source
          ? ([String((node.source as Node).value), nameOf(specifier.local as Node)] as const)
          : imported.get(nameOf(specifier.local as Node));
        if (through) exports.from.push([name, ...through]);
      }
    }
  }
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
  const code = codeOnly(source, proseOf(ast));
  readFontSizes(file, code, rules, problems);
  readBehaviour(file, code, ast, problems);
  // A component exports itself, and what its module script exports; the instance script's
  // exports are the component's own, not the file's.
  const script = ast.module?.content as unknown as Node | undefined;
  result.takes = [];
  readTakes(source, script, result.takes);
  readTakes(source, ast.instance?.content as unknown as Node | undefined, result.takes);
  result.exports = { names: ['default'], from: [], all: [] };
  readExports(script, result.exports);
  return result;
}

/**
 * Read media() calls and behaviour from a plain module (JavaScript, or TypeScript with types
 * stripped). One that isn't JavaScript is an error where it stops being: its viewers' browsers
 * wouldn't run it, and none of its checks could.
 */
export function analyzeScript(file: string, source: string, rules: Rules = {}): Analysis {
  const problems: Problem[] = [];
  const comments: { start: number; end: number }[] = [];
  let program: unknown;
  try {
    program = parseJs(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      locations: false,
      onComment: (_block, _text, start, end) => comments.push({ start, end }),
    });
  } catch (error) {
    // Nested deeper than the parser can follow, it may be JavaScript or not past that point, and
    // nothing here can tell: refused, with the way out. Data that deep is what data/*.json is for.
    if (error instanceof RangeError || /Not enough stack space/.test((error as Error).message)) {
      problems.push({
        file,
        rule: 'compile',
        message:
          'This file is nested too deeply for the check to read. Put data like this in a .json file in data/ and import it, or split the expression up.',
        severity: 'error',
      });
      return { media: [], problems };
    }
    // Where, from the offset as every other problem's: acorn counts lines its own way, U+2028 too.
    const { message, pos } = error as SyntaxError & { pos?: number };
    problems.push({
      file,
      ...(pos === undefined ? {} : position(source, pos)),
      rule: 'compile',
      // Acorn ends its message with where, which the problem says already.
      message: message.replace(/ \(\d+:\d+\)$/, ''),
      severity: 'error',
    });
    return { media: [], problems };
  }
  const calls = readCalls(file, source, program, problems);
  const code = codeOnly(source, comments);
  readFontSizes(file, code, rules, problems);
  readBehaviour(file, code, program, problems);
  const takes: Take[] = [];
  readTakes(source, program as Node, takes);
  const exports: Exports = { names: [], from: [], all: [] };
  readExports(program as Node, exports);
  return { ...calls, takes, exports, problems };
}
