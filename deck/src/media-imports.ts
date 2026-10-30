import { parse } from 'acorn';
import { walk } from 'zimmerframe';

/** What a deck imports a file of media/ by: `$media/cow.jpg`. */
export const MEDIA = '$media/';

/** The engine's module the compiled lookups import; no module a deck writes imports it. */
export const MEDIA_RUNTIME = '@tobos/present/media';

interface Node {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

/** A string literal's text, as a string or a template literal without holes. */
export function literalText(node: Node | undefined): string | undefined {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral' && (node.expressions as Node[]).length === 0)
    return ((node.quasis as Node[])[0]!.value as { cooked: string | null }).cooked ?? undefined;
  return undefined;
}

/** Whether a node is `import.meta.glob`. */
export function isGlob(node: Node): boolean {
  const object = node.object as Node | undefined;
  const property = node.property as Node | undefined;
  return (
    node.type === 'MemberExpression' &&
    object?.type === 'MetaProperty' &&
    (object.meta as Node).name === 'import' &&
    (object.property as Node).name === 'meta' &&
    !node.computed &&
    property?.type === 'Identifier' &&
    property.name === 'glob'
  );
}

/** A glob's patterns, without `$media/`, if they are literals that each start with it. */
export function globPatterns(call: Node): string[] | undefined {
  const args = call.arguments as Node[];
  if (args.length !== 1) return undefined;
  const items = args[0]!.type === 'ArrayExpression' ? (args[0]!.elements as Node[]) : [args[0]!];
  const patterns = items.map(literalText);
  if (patterns.length === 0 || patterns.some((p) => !p?.startsWith(MEDIA))) return undefined;
  return patterns.map((p) => p!.slice(MEDIA.length));
}

/**
 * A compiled module's `$media` imports and `import.meta.glob` calls, as the browser runs them.
 * Each import becomes a lookup of the file's URL in the revision's media map, at the top of the
 * module, before anything that could use it, its lines kept; each glob the map's files its
 * patterns match, by their specifiers. Looked up when the module runs, a URL never changes the
 * module's code, and a share, whose map has only what it shows, gets only those. What analyze.ts
 * refuses is left as it is: a build with it doesn't pass.
 */
export function compileMedia(code: string): string {
  if (!code.includes(MEDIA)) return code;
  let program: Node;
  try {
    program = parse(code, { ecmaVersion: 'latest', sourceType: 'module' }) as unknown as Node;
  } catch {
    return code;
  }
  const edits: { start: number; end: number; text: string }[] = [];
  const lookups: string[] = [];
  for (const node of program.body as Node[]) {
    const name = literalText(node.source as Node | undefined);
    const [only, ...more] = (node.specifiers as Node[] | undefined) ?? [];
    if (
      node.type !== 'ImportDeclaration' ||
      !name?.startsWith(MEDIA) ||
      only?.type !== 'ImportDefaultSpecifier' ||
      more.length
    )
      continue;
    edits.push({ start: node.start, end: node.end, text: '' });
    const local = (only.local as Node).name as string;
    lookups.push(`const ${local} = __tobos_media(${JSON.stringify(name.slice(MEDIA.length))});`);
  }
  let globs = false;
  walk(program, null, {
    CallExpression(node, { next }) {
      const patterns = isGlob(node.callee as Node) ? globPatterns(node) : undefined;
      if (patterns) {
        edits.push({
          start: node.start,
          end: node.end,
          text: `__tobos_glob(${JSON.stringify(patterns)})`,
        });
        globs = true;
      }
      next();
    },
  });
  if (edits.length === 0) return code;
  const names = [
    ...(lookups.length ? ['mediaUrl as __tobos_media'] : []),
    ...(globs ? ['mediaGlob as __tobos_glob'] : []),
  ];
  let out = `import { ${names.join(', ')} } from '${MEDIA_RUNTIME}';${lookups.join('')}`;
  let last = 0;
  for (const edit of edits.sort((a, b) => a.start - b.start)) {
    out += code.slice(last, edit.start) + edit.text;
    last = edit.end;
  }
  return out + code.slice(last);
}
