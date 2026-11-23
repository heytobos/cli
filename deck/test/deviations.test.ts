import { describe, expect, it } from 'vitest';
import { tokensOf } from '../src/deviations.ts';
import {
  buildDeck,
  formatLookRecord,
  lookRecordOf,
  memoryTree,
  type Problem,
} from '../src/index.ts';

/**
 * The linter of a deck's deviations from its theme: on a deck that follows a theme, what its own
 * files write by hand where the theme has a token is a warning, and never anything more.
 */
const TOKENS = `:root {
  --stage-paper: #ffffff;
  --stage-ink: #121a2c;
  --stage-accent: var(--stage-ink);
  --stage-font-text: 'Hanken Grotesk', system-ui, sans-serif;
  --stage-size-body: 40px;
  --stage-size-title: 64px;
  --stage-space-pair: 32px;
  --stage-space-block: 48px;
  --stage-label-tracking: 0.08em;
  --stage-opacity-dim: 0.25;
}
.tobos-stage { color: #121a2c; }
`;

/** A layout of the theme's, which writes a few values by hand. */
const BOX = `<div class="box"><slot /></div>
<style>
  .box { color: #333333; padding: 24px; font-size: 44px; }
</style>
`;

const scene = (markup: string, style = '') =>
  `<script module lang="ts">\nexport const beats = [{ id: 'a' }];\n</script>\n${markup}\n${style ? `<style>\n${style}\n</style>\n` : ''}`;

const encode = (text: string) => new TextEncoder().encode(text);

/** The theme's design, as a deck takes it. */
const master = {
  files: { 'master/tokens.css': encode(TOKENS), 'master/Box.svelte': encode(BOX) },
  media: {},
  dependencies: {},
};
const record = formatLookRecord(
  lookRecordOf(master, { theme: 't', name: 'Synthesion', version: 'c'.repeat(40) }),
);

/** A deck on that theme, with these files besides; theme.json unless `null`. */
function deck(files: Record<string, string>, look: string | null = record) {
  return memoryTree({
    'deck.json': '{}',
    'media.json': '{}',
    'master/tokens.css': TOKENS,
    'master/Box.svelte': BOX,
    ...(look === null ? {} : { 'theme.json': look }),
    ...files,
  });
}

const theme = (problems: Problem[]) => problems.filter((p) => p.rule.startsWith('theme/'));
const said = (problems: Problem[]) =>
  theme(problems).map((p) => `${p.file}:${p.line} ${p.rule}: ${p.message}`);

describe('the theme’s tokens', () => {
  it('are the custom properties of :root, by what each holds', () => {
    const tokens = tokensOf(TOKENS);
    expect(tokens.colour.map((t) => t.name)).toEqual([
      '--stage-paper',
      '--stage-ink',
      '--stage-accent',
    ]);
    expect(tokens.colour[2]!.value).toBe('#121a2c');
    expect(tokens.font.map((t) => t.name)).toEqual(['--stage-font-text']);
    expect(tokens.size.map((t) => `${t.name} ${t.value}`)).toEqual([
      '--stage-size-body 40px',
      '--stage-size-title 64px',
    ]);
    expect(tokens.spacing.map((t) => t.name)).toEqual([
      '--stage-space-pair',
      '--stage-space-block',
    ]);
  });

  it('are none in a stylesheet that is missing, or Svelte can’t read', () => {
    const none = { colour: [], font: [], size: [], spacing: [] };
    expect(tokensOf(undefined)).toEqual(none);
    expect(tokensOf(':root { --a: #fff; </style> <p>')).toEqual(none);
  });

  it('are read in an @layer block too', () => {
    const tokens = tokensOf('@layer theme { :root { --stage-ink: #121a2c; } }');
    expect(tokens.colour.map((t) => t.name)).toEqual(['--stage-ink']);
  });

  it('take a font named without quotes, but none of a font’s other properties', () => {
    const tokens = tokensOf(`:root {
  --stage-font-text: Arial;
  --stage-font-label: Hanken Grotesk, sans-serif;
  --stage-font-weight: 500;
  --stage-font-style: italic;
  --stage-font-weight-bold: bold;
  --stage-font-mono: var(--brand-mono, Menlo), monospace;
}`);
    expect(tokens.font.map((t) => `${t.name}: ${t.value}`)).toEqual([
      '--stage-font-text: Arial',
      '--stage-font-label: Hanken Grotesk, sans-serif',
      '--stage-font-mono: var(--brand-mono, Menlo), monospace',
    ]);
  });
});

describe('the linter', () => {
  it('names a colour and a font written by hand, prominently, each once a file', async () => {
    const { problems } = await buildDeck(
      deck({
        'scenes/a.svelte': scene(
          '<p class="a">A</p><p style="color: #8c3a27">B</p>',
          ".a { color: #8C3A27; font-family: 'Inter', sans-serif; border: 2px solid red; }",
        ),
      }),
    );
    expect(said(problems)).toEqual([
      'scenes/a.svelte:4 theme/colour: #8c3a27 (2 times in this file) differs from Synthesion: its colours are var(--stage-paper), var(--stage-ink), var(--stage-accent). Write one of them, or keep #8c3a27 if it is on purpose.',
      'scenes/a.svelte:6 theme/colour: red differs from Synthesion: its colours are var(--stage-paper), var(--stage-ink), var(--stage-accent). Write one of them, or keep red if it is on purpose.',
      "scenes/a.svelte:6 theme/font: 'Inter', sans-serif differs from Synthesion: its fonts are var(--stage-font-text). Write one of them, or keep 'Inter', sans-serif if it is on purpose.",
    ]);
  });

  it('names the token a value written by hand already is', async () => {
    const { problems } = await buildDeck(
      deck({ 'scenes/a.svelte': scene('<p>A</p>', 'p { color: #FFF; }') }),
    );
    expect(said(problems)).toEqual([
      "scenes/a.svelte:6 theme/colour: #FFF is Synthesion's --stage-paper: write var(--stage-paper), so it follows the theme.",
    ]);
  });

  it('counts sizes and spacings, quietly, once a file, with a few of them', async () => {
    const { problems } = await buildDeck(
      deck({
        'scenes/a.svelte': scene(
          '<p class="a" style="font-size: 34px">A</p><p style:margin-top="8px">B</p>',
          '.a { font-size: 34px; gap: 96px; padding: 0 1.5rem; } p { font: 600 52px/1.1 var(--stage-font-text); }',
        ),
        'lib/Pill.svelte':
          '<span>p</span>\n<style>\n  span { font-size: 2rem; margin: -8px; }\n</style>\n',
      }),
    );
    expect(said(problems)).toEqual([
      "lib/Pill.svelte:3 theme/size: 1 type size written by hand here (2rem): Synthesion's type scale is var(--stage-size-body) 40px, var(--stage-size-title) 64px. One written as a token changes with the theme; one written by hand stays as it is.",
      "lib/Pill.svelte:3 theme/spacing: 1 spacing written by hand here (margin: -8px): Synthesion's spacings are var(--stage-space-pair) 32px, var(--stage-space-block) 48px. One written as a token changes with the theme; one written by hand stays as it is.",
      "scenes/a.svelte:4 theme/size: 3 type sizes written by hand here (34px, 52px): Synthesion's type scale is var(--stage-size-body) 40px, var(--stage-size-title) 64px. One written as a token changes with the theme; one written by hand stays as it is.",
      "scenes/a.svelte:4 theme/spacing: 3 spacings written by hand here (margin-top: 8px, gap: 96px, padding: 0 1.5rem): Synthesion's spacings are var(--stage-space-pair) 32px, var(--stage-space-block) 48px. One written as a token changes with the theme; one written by hand stays as it is.",
    ]);
  });

  it('reads SVG’s colours and fonts too', async () => {
    const { problems } = await buildDeck(
      deck({
        'scenes/a.svelte': scene(
          '<svg><rect fill="#8c3a27" stroke="none" /><text font-family="Georgia, serif" fill="currentColor">x</text></svg>',
        ),
      }),
    );
    expect(theme(problems).map((p) => [p.rule, p.message.split(' differs')[0]])).toEqual([
      ['theme/colour', '#8c3a27'],
      ['theme/font', 'Georgia, serif'],
    ]);
  });

  it('reads an attribute’s value written as a string in braces', async () => {
    const { problems } = await buildDeck(
      deck({
        'scenes/a.svelte': scene(
          "<p style:color={'#aabbcc'} style:padding={`32px`}>A</p><p style={'color: #aabbcc; padding: 32px'}>B</p><svg><rect fill={\"red\"} /></svg><p style:color={tone}>C</p>",
        ),
      }),
    );
    expect(theme(problems).map((p) => [p.rule, p.message.split(/ \(| differs/)[0]])).toEqual([
      ['theme/colour', '#aabbcc'],
      ['theme/colour', 'red'],
      ['theme/spacing', '2 spacings written by hand here'],
    ]);
  });

  it('reads a size written as a string in braces, and an attribute’s entities decoded', async () => {
    const { problems } = await buildDeck(
      deck({
        'scenes/a.svelte': scene(
          '<p style="font-size: {\'34px\'}">A</p><svg><rect fill="&#35;aabbcc" /></svg><p style="color: &#35;8c3a27">B</p>',
        ),
      }),
    );
    expect(theme(problems).map((p) => [p.rule, p.message.split(/ \(| differs|: /)[0]])).toEqual([
      ['theme/colour', '#aabbcc'],
      ['theme/colour', '#8c3a27'],
      ['theme/size', '1 type size written by hand here'],
    ]);
  });

  it('reads a style attribute’s declarations whole, a string in braces as its value', async () => {
    const { problems } = await buildDeck(
      deck({
        'scenes/a.svelte': scene(
          '<p style="color: {\'#8c3a27\'}; padding: {pad}px; margin: 8px">A</p>',
        ),
      }),
    );
    expect(
      theme(problems).map((p) => [p.rule, p.column, p.message.split(/ \(| differs/)[0]]),
    ).toEqual([
      ['theme/colour', 17, '#8c3a27'],
      ['theme/spacing', 56, '1 spacing written by hand here'],
    ]);
  });

  it('reads a value without its priority, and a family in the font shorthand', async () => {
    const { problems } = await buildDeck(
      deck({
        'scenes/a.svelte': scene(
          '<p class="a">A</p>',
          [
            '.a { font-family: var(--stage-font-text) !important; font-family: inherit !important;',
            '  color: #8c3a27 !important; font: 40px Arial; font: caption; }',
            '.b { font: 64px Arial; font-family: arial; }',
          ].join('\n'),
        ),
      }),
    );
    expect(theme(problems).map((p) => [p.rule, p.message.split(' differs')[0]])).toEqual([
      ['theme/colour', '#8c3a27'],
      // One family however it is written, its size apart.
      ['theme/font', 'Arial (3 times in this file)'],
      ['theme/size', expect.stringContaining('2 type sizes written by hand here (40px, 64px)')],
    ]);
  });

  it('reads the font shorthand by its parts: a family of tokens is none, one after a token’s size is', async () => {
    const { problems } = await buildDeck(
      deck({
        'scenes/a.svelte': scene(
          '<p class="a">A</p>',
          [
            '.a { font: 40px var(--stage-font-text), var(--stage-font-mono);',
            '  font: 40px/calc(1em + 4px) var(--stage-font-text);',
            '  font-family: var(--stage-font-text), var(--stage-font-mono);',
            '  font: italic 600 var(--stage-size-body)/1.2 var(--stage-font-text);',
            '  font: var(--stage-size-body) Arial; }',
          ].join('\n'),
        ),
      }),
    );
    expect(theme(problems).map((p) => [p.rule, p.message.split(' differs')[0]])).toEqual([
      ['theme/font', 'Arial'],
      ['theme/size', expect.stringContaining('2 type sizes written by hand here (40px)')],
    ]);
  });

  it('takes a family’s last word for the family, though it is a size’s keyword too', async () => {
    const { problems } = await buildDeck(
      deck({
        'scenes/a.svelte': scene(
          '<p class="a">A</p>',
          [
            '.a { font: var(--stage-size-body) Roboto Medium;',
            '  font: var(--stage-size-body)/1.2 Roboto Medium;',
            '  font: 40px Roboto Medium; }',
          ].join('\n'),
        ),
      }),
    );
    expect(theme(problems).map((p) => [p.rule, p.message.split(' differs')[0]])).toEqual([
      ['theme/font', 'Roboto Medium (3 times in this file)'],
      ['theme/size', expect.stringContaining('1 type size written by hand here (40px)')],
    ]);
  });

  it('passes what is no value of the theme’s: tokens, 0, auto, percentages, keywords, prose', async () => {
    const { problems } = await buildDeck(
      deck({
        'scenes/a.svelte': scene(
          '<p class="a" style="color: var(--stage-ink, #000); margin: 0 auto">In CSS, color: #8c3a27 and font-size: 34px.</p>',
          [
            '.a { color: currentColor; background: transparent; border-color: inherit;',
            '  font-family: var(--stage-font-text); font-family: inherit; font: inherit;',
            '  font-size: var(--stage-size-body); font-size: 1.5em; font-size: calc(var(--stage-size-body) * 2);',
            '  margin: 0; padding: 0 5%; gap: var(--stage-space-pair); inset: auto;',
            '  width: 480px; top: 120px; transition: color 0.3s; background: url(#grad);',
            "  content: '#1'; /* color: #8c3a27 */ }",
          ].join('\n'),
        ),
      }),
    );
    expect(said(problems)).toEqual([]);
  });

  it('leaves the theme’s own master files alone, and lints one the deck changed or added', async () => {
    const kept = await buildDeck(deck({ 'scenes/a.svelte': scene('<p>A</p>') }));
    expect(said(kept.problems)).toEqual([]);
    const changed = await buildDeck(
      deck({
        'scenes/a.svelte': scene('<p>A</p>'),
        'master/Box.svelte': BOX.replace('#333333', '#444444'),
        'master/Card.svelte': '<div>c</div>\n<style>\n  div { color: #8c3a27; }\n</style>\n',
      }),
    );
    expect(theme(changed.problems).map((p) => [p.file, p.rule])).toEqual([
      ['master/Box.svelte', 'theme/colour'],
      ['master/Box.svelte', 'theme/size'],
      ['master/Box.svelte', 'theme/spacing'],
      ['master/Card.svelte', 'theme/colour'],
    ]);
  });

  it('says nothing on a deck without theme.json, a theme’s or one from before themes', async () => {
    const files = {
      'scenes/a.svelte': scene('<p style="color: #8c3a27; font-size: 34px">A</p>'),
      'master/Box.svelte': BOX.replace('#333333', '#444444'),
    };
    expect(said((await buildDeck(deck(files, null))).problems)).toEqual([]);
    // Nor on one whose theme.json isn't the record Tobos writes.
    expect(said((await buildDeck(deck(files, '{"theme": 1}'))).problems)).toEqual([]);
    // Nor of a kind its tokens.css has no tokens for.
    expect(
      said((await buildDeck(deck({ ...files, 'master/tokens.css': ':root {}' }))).problems),
    ).toEqual([]);
  });

  it('refuses nothing: every warning a warning, and the deck builds as it would without them', async () => {
    const files = {
      'scenes/a.svelte': scene(
        '<p style="color: #8c3a27; font-size: 34px; font-family: Georgia">A</p>',
        '.p { gap: 12px; }',
      ),
    };
    const linted = await buildDeck(deck(files));
    const plain = await buildDeck(deck(files, null));
    expect(theme(linted.problems).length).toBe(4);
    expect(theme(linted.problems).every((p) => p.severity === 'warning')).toBe(true);
    expect(linted.problems.filter((p) => !p.rule.startsWith('theme/'))).toEqual(plain.problems);
    expect(linted.manifest).toEqual(plain.manifest);
    // A scene that fails the check fails it for its own reasons, and only those.
    const broken = { 'scenes/b.svelte': scene('<p style="color: #8c3a27">B</p>{') };
    const refused = await buildDeck(deck({ ...files, ...broken }));
    expect(refused.manifest).toBeUndefined();
    expect(refused.problems.filter((p) => p.severity === 'error')).toEqual(
      (await buildDeck(deck({ ...files, ...broken }, null))).problems.filter(
        (p) => p.severity === 'error',
      ),
    );
  });
});
