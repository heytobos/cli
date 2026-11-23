/**
 * The check's linter for a deck that follows a theme: where the deck's own code writes by hand a
 * value of a kind its theme names in tokens, a colour, a font family, a type size or a spacing, it
 * says so, and never refuses it. Deviating is allowed: a colour or a font is named where it is
 * written, as it changes how the deck looks next to the theme; sizes and spacings, which scenes
 * write by the hundred, are counted once a file. The tokens are the deck's own master/tokens.css,
 * the custom properties of its `:root`.
 *
 * What the deck took from its theme and kept as it was, a master/ file whose bytes theme.json
 * records, is the theme's, and its values are the theme's choice; everything else is the deck's
 * own: its scenes, lib/, and a master/ file it changed or added. A deck without theme.json, a
 * theme or a deck from before themes, is linted for none of this.
 */
import { parse as parseSvelte } from 'svelte/compiler';
import type { Written } from './analyze.ts';
import { isColour, isFamily, isLength, normalValue } from './css-values.ts';
import { sha256 } from './hash.ts';
import { lookRecordIn } from './look.ts';
import { readText } from './tree.ts';
import type { DeckTree, Problem } from './types.ts';

interface Token {
  name: string;
  value: string;
}

/** A master's tokens by the kind of value they hold, each in the order tokens.css has them. */
export type Tokens = Record<Written['kind'], Token[]>;

const TOKENS = 'master/tokens.css';
/** A token named for a font, but not for one of its other properties. */
const FONT_TOKEN = /font|family|face/;
const FONT_OTHER = /size|weight|style|stretch|variant|feature|tracking|height|spacing|smoothing/;

/**
 * The tokens of a tokens.css: the custom properties on its `:root`, by the value each holds, a
 * colour, a font stack, or a length named for a size or a spacing. One that is another's,
 * `--stage-accent: var(--stage-ink)`, holds what that one does.
 */
export function tokensOf(css: string | undefined): Tokens {
  const tokens: Tokens = { colour: [], font: [], size: [], spacing: [] };
  if (!css) return tokens;
  // Svelte's parser reads the CSS: the stylesheet as a component's <style>.
  const source = `<style>${css}</style>`;
  let ast: ReturnType<typeof parseSvelte>;
  try {
    ast = parseSvelte(source, { modern: true });
  } catch {
    return tokens;
  }
  type Rule = {
    type: string;
    name?: string;
    start: number;
    block?: { start: number; children: (Rule & { property?: string; value?: string })[] };
  };
  // The stylesheet's rules, and those of its `@layer` blocks, which apply as they are.
  const rules: Rule[] = [];
  const read = (children: Rule[]) => {
    for (const rule of children)
      if (rule.type === 'Atrule' && rule.name === 'layer' && rule.block) read(rule.block.children);
      else rules.push(rule);
  };
  read((ast.css?.children ?? []) as unknown as Rule[]);
  const declared = new Map<string, string>();
  for (const rule of rules) {
    if (
      rule.type !== 'Rule' ||
      !rule.block ||
      !source.slice(rule.start, rule.block.start).includes(':root')
    )
      continue;
    for (const node of rule.block.children)
      if (node.type === 'Declaration' && node.property!.startsWith('--'))
        declared.set(node.property!, node.value!.trim());
  }
  const resolved = (value: string, depth = 0): string => {
    const other = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value)?.[1];
    const next = other === undefined ? undefined : declared.get(other);
    return next === undefined || depth > 8 ? value : resolved(next, depth + 1);
  };
  for (const [name, written] of declared) {
    const value = resolved(written);
    const kind = isColour(value)
      ? 'colour'
      : FONT_TOKEN.test(name) && !FONT_OTHER.test(name) && isFamily(value)
        ? 'font'
        : !isLength(value)
          ? undefined
          : /size/.test(name)
            ? 'size'
            : /space|spacing|gap|gutter|margin|padding|inset/.test(name)
              ? 'spacing'
              : undefined;
    if (kind) tokens[kind].push({ name, value });
  }
  return tokens;
}

/** Up to `most` of the items, and how many more there are, where. */
function some(items: string[], most: number, more = ''): string {
  if (items.length <= most) return items.join(', ');
  return `${items.slice(0, most).join(', ')} and ${items.length - most} more${more}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The check's warnings for the values the deck's own files write by hand, from what analyze.ts
 * read of each compiled file (`written`), if the deck follows a theme. Never an error.
 */
export function deviationsOf(tree: DeckTree, written: Map<string, Written[]>): Problem[] {
  const record = lookRecordIn(tree);
  if (!record) return [];
  const tokens = tokensOf(readText(tree, TOKENS));
  const theme = record.name;
  /** Whether the file is the deck's own: anything but a master/ file kept as the theme had it. */
  const own = (file: string) => {
    if (!file.startsWith('master/') || !Object.hasOwn(record.files, file)) return true;
    const bytes = tree.read(file);
    return bytes === undefined || sha256(bytes) !== record.files[file];
  };
  const vars = (list: Token[]) => list.map((t) => `var(${t.name})`);
  const scale = (list: Token[]) => list.map((t) => `var(${t.name}) ${t.value}`);
  const inTokens = ` in ${TOKENS}`;
  const counted = [
    ['size', 'type size', `type scale is ${some(scale(tokens.size), 10, inTokens)}`],
    ['spacing', 'spacing', `spacings are ${some(scale(tokens.spacing), 12, inTokens)}`],
  ] as const;

  const problems: Problem[] = [];
  for (const [file, values] of [...written].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (values.length === 0 || !own(file)) continue;
    const at = (first: Written, rule: string, message: string) =>
      problems.push({
        file,
        line: first.line,
        column: first.column,
        rule,
        message,
        severity: 'warning',
      });

    // A colour or a font: each named once a file, where it is first written, as often as it is.
    for (const kind of ['colour', 'font'] as const) {
      const list = tokens[kind];
      if (list.length === 0) continue;
      const each = new Map<string, Written[]>();
      for (const value of values.filter((v) => v.kind === kind)) {
        const key = normalValue(value.value);
        const group = each.get(key);
        if (group) group.push(value);
        else each.set(key, [value]);
      }
      const what = kind === 'colour' ? 'colours' : 'fonts';
      for (const [key, found] of each) {
        const { value } = found[0]!;
        const times = found.length > 1 ? ` (${found.length} times in this file)` : '';
        const same = list.find((t) => normalValue(t.value) === key);
        at(
          found[0]!,
          `theme/${kind}`,
          same
            ? `${value}${times} is ${theme}'s ${same.name}: write var(${same.name}), so it follows the theme.`
            : `${value}${times} differs from ${theme}: its ${what} are ${some(vars(list), 8, inTokens)}. Write one of them, or keep ${value} if it is on purpose.`,
        );
      }
    }

    // Sizes and spacings: counted, with a few of them, once a file.
    for (const [kind, name, has] of counted) {
      const found = values.filter((v) => v.kind === kind);
      if (found.length === 0 || tokens[kind].length === 0) continue;
      const shown = [...new Set(found.map((v) => v.value))];
      at(
        found[0]!,
        `theme/${kind}`,
        `${plural(found.length, name)} written by hand here (${some(shown, 4)}): ${theme}'s ${has}. One written as a token changes with the theme; one written by hand stays as it is.`,
      );
    }
  }
  return problems;
}
