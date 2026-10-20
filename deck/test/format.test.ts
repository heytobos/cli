import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';
import { buildDeck, memoryTree } from '../src/index.ts';
import { directoryTree } from '../src/node.ts';

const format = readFileSync(new URL('../FORMAT.md', import.meta.url), 'utf8');
/** FORMAT.md's scenes that use the master: what an agent copies into a new deck first. */
const examples = [...format.matchAll(/^```svelte\n([\s\S]*?)^```$/gm)]
  .map((match) => match[1]!)
  .filter((example) => example.includes("from '../master/index.ts'"));

interface Component {
  name: string;
  attributes: { type: string; name?: string }[];
}

/** The components a scene's markup uses. */
function* components(node: unknown): Generator<Component> {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) yield* components(child);
    return;
  }
  if ((node as { type?: string }).type === 'Component') yield node as Component;
  for (const [key, value] of Object.entries(node))
    if (key !== 'metadata' && key !== 'parent') yield* components(value);
}

/** The props a component takes: the names `$props()` is destructured into. */
function propsOf(source: string): string[] {
  const script = parse(source, { modern: true }).instance?.content;
  for (const statement of script?.body ?? [])
    if (statement.type === 'VariableDeclaration')
      for (const declaration of statement.declarations) {
        const init = declaration.init;
        if (
          init?.type === 'CallExpression' &&
          init.callee.type === 'Identifier' &&
          init.callee.name === '$props' &&
          declaration.id.type === 'ObjectPattern'
        )
          return declaration.id.properties.flatMap((property) =>
            property.type === 'Property' && property.key.type === 'Identifier'
              ? [property.key.name]
              : [],
          );
      }
  return [];
}

// Every template there is: here both, in heytobos/cli only tobos (mirror/sync.sh).
const templates = new URL('../../templates/', import.meta.url);
const names = readdirSync(templates, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

describe.each(names)("FORMAT.md's scenes, on the %s template's master", (name) => {
  const root = fileURLToPath(new URL(`${name}/`, templates));
  const tree = directoryTree(root);

  it('build', async () => {
    expect(examples).toHaveLength(2);
    for (const example of examples) {
      const files = Object.fromEntries(tree.files().map((path) => [path, tree.read(path)!]));
      files['scenes/content.svelte'] = new TextEncoder().encode(example);
      expect((await buildDeck(memoryTree(files))).problems, example).toEqual([]);
    }
  });

  it("pass the master's layouts only props they take", () => {
    // The examples may pass none; that the attributes are read at all is checked here.
    const [sample] = components(parse('<Content align="top" />', { modern: true }).fragment);
    expect(sample?.attributes.map((attribute) => attribute.name)).toEqual(['align']);
    const index = readFileSync(`${root}master/index.ts`, 'utf8');
    const files = new Map(
      [...index.matchAll(/export \{ default as (\w+) \} from '\.\/(.+?)'/g)].map((match) => [
        match[1]!,
        `${root}master/${match[2]!}`,
      ]),
    );
    let checked = 0;
    for (const example of examples)
      for (const component of components(parse(example, { modern: true }).fragment)) {
        const file = files.get(component.name);
        if (!file) continue;
        const props = propsOf(readFileSync(file, 'utf8'));
        for (const attribute of component.attributes)
          if (attribute.type === 'Attribute') {
            expect(props, `<${component.name} ${attribute.name}>`).toContain(attribute.name);
            checked++;
          }
        checked++;
      }
    expect(checked).toBeGreaterThan(0);
  });
});
