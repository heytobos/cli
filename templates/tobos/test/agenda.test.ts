/**
 * The Agenda layout, rendered: the master's layout and what it draws with, compiled for the
 * server into a folder of the template's own (so `svelte` resolves), with @tobos/present a
 * stand-in that hands it the deck.
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import { afterAll, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
mkdirSync(join(root, 'node_modules/.cache'), { recursive: true });
const out = mkdtempSync(join(root, 'node_modules/.cache/agenda-'));
afterAll(() => rmSync(out, { recursive: true, force: true }));

const present = join(out, 'present.js');
writeFileSync(
  present,
  "import { getContext } from 'svelte';\nexport const useDeck = () => getContext('tobos:deck');\n",
);
for (const path of [
  'master/layouts/Agenda.svelte',
  'master/components/Frame.svelte',
  'master/components/Wayfinder.svelte',
  'master/components/Guides.svelte',
]) {
  const target = join(out, `${path}.js`);
  mkdirSync(dirname(target), { recursive: true });
  const js = compile(readFileSync(join(root, path), 'utf8'), { generate: 'server', filename: path })
    .js.code.replace(/from '([^']+)\.svelte'/g, "from '$1.svelte.js'")
    .replace(/from '@tobos\/present'/g, `from './${relative(dirname(target), present)}'`);
  writeFileSync(target, js);
}
copyFileSync(join(root, 'master/grid.ts'), join(out, 'master/grid.ts'));
const { default: Agenda } = await import(join(out, 'master/layouts/Agenda.svelte.js'));

const chapters = [
  { id: 'opening', title: 'Opening' },
  { id: 'why', title: 'Why' },
  { id: 'how', title: 'How' },
];
/** Each item's chapter and what it is: current, dimmed (`other`), or neither. */
function items(props: Record<string, unknown>, here: string) {
  const deck = { chapters, chapter: chapters.find((c) => c.id === here) };
  const { body } = render(Agenda, { props, context: new Map([['tobos:deck', deck]]) });
  return [...body.matchAll(/<li[^>]*class="([^"]*)"[^>]*>[\s\S]*?class="name[^"]*">([^<]*)</g)].map(
    (m) =>
      `${m[2]}${/\bcurrent\b/.test(m[1]!) ? ' current' : /\bother\b/.test(m[1]!) ? ' other' : ''}`,
  );
}

describe('the Agenda', () => {
  it('highlights the chapter it is in, and dims the others', () => {
    expect(items({}, 'why')).toEqual(['Opening other', 'Why current', 'How other']);
  });

  it('dims nothing on a slide in a chapter it leaves out', () => {
    expect(items({ skip: ['opening'] }, 'opening')).toEqual(['Why', 'How']);
  });
});
