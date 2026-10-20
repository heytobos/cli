import type { Component } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import { DECK_CONTEXT, type DeckContext } from '@tobos/present';
import Section from '../master/layouts/Section.svelte';
import Code from '../master/components/Code.svelte';

const chapters = [
  { id: 'opening', title: 'Opening', scenes: [] },
  { id: 'why', title: 'Why it matters', scenes: [] },
  { id: 'how', title: 'How it works', scenes: [] },
];

/** A component rendered as a scene of `chapter` is, in this three-part deck: its HTML. */
function html<Props extends Record<string, unknown>>(
  component: Component<Props>,
  props: Props,
  chapter = 'why',
) {
  const deck: DeckContext = {
    title: 'The talk',
    chapters,
    chapter: chapters.find((c) => c.id === chapter)!,
    scene: { id: 'scene', title: 'Scene' },
  };
  return render(component, { props, context: new Map([[DECK_CONTEXT, deck]]) }).body;
}

// Agenda's own tests come with #126, which changes what it highlights.
describe("the master's layouts, in a deck", () => {
  it("gives a section its part's number and title, unless it is told others", () => {
    const kicker = (body: string) =>
      /data-region="kicker">(?:<!--[^>]*-->)?(?:<span[^>]*>([^<]*))?/.exec(body)?.[1];
    const title = (body: string) => /<h1 data-region="title"[^>]*>([^<]*)</.exec(body)?.[1];
    const plain = html(Section, {});
    expect([kicker(plain), title(plain)]).toEqual(['Part 2', 'Why it matters']);
    const told = html(Section, { kicker: 'Intermission', title: 'Coffee' }, 'how');
    expect([kicker(told), title(told)]).toEqual(['Intermission', 'Coffee']);
  });

  it('dims every line of code but the bright ones, and none without any', () => {
    const dimmed = (body: string) =>
      [...body.matchAll(/class="line[^"]*\bdim\b[^"]*" data-line="(\d+)"/g)].map((m) => m[1]);
    expect(dimmed(html(Code, { code: 'a\nb\nc\n', bright: [2] }))).toEqual(['1', '3']);
    expect(dimmed(html(Code, { code: 'a\nb\nc\n' }))).toEqual([]);
  });
});
