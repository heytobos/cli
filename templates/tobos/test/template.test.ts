import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildDeck } from '@tobos/deck';
import { directoryTree } from '@tobos/deck/node';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));

describe('Tobos standard', () => {
  it('builds as a deck, its scenes showing off its master, under its own rules', async () => {
    const build = await buildDeck(directoryTree(root));
    expect(build.problems).toEqual([]);
    expect(build.manifest!.chapters.map((c) => c.title)).toEqual([
      'Layouts',
      'Components',
      'Foundations',
    ]);
    expect(build.manifest!.styles).toHaveLength(1);
    expect(JSON.parse(readFileSync(`${root}/master/master.json`, 'utf8'))).toEqual({
      rules: { minFontSize: 28, layoutRoot: true },
    });
  });

  it('exports what its guide documents, and documents what it exports', () => {
    const guide = readFileSync(`${root}/master/GUIDE.md`, 'utf8');
    const index = readFileSync(`${root}/master/index.ts`, 'utf8');
    const documented = [...guide.matchAll(/^\| `([A-Z]\w+)`/gm)].map((m) => m[1]!);
    const exported = [...index.matchAll(/default as ([A-Z]\w+) \}/g)].map((m) => m[1]!);
    expect(exported.length).toBeGreaterThan(0);
    expect(documented.toSorted()).toEqual(exported.toSorted());
  });

  it('reads on the dark tone: ink, accent and muted text against the dark, at 4.5:1 or more', () => {
    const tokens = readFileSync(`${root}/master/tokens.css`, 'utf8');
    const frame = readFileSync(`${root}/master/components/Frame.svelte`, 'utf8');
    const value = (name: string) =>
      new RegExp(`--stage-${name}:\\s*(#[0-9a-f]{6})`).exec(tokens)![1]!;
    // What Frame's dark tone maps each token to, resolved through tokens.css.
    const dark = /\.tone-dark \{([^}]*)\}/.exec(frame)![1]!;
    const mapped = (name: string) =>
      value(new RegExp(`--stage-${name}:\\s*var\\(--stage-([\\w-]+)\\)`).exec(dark)![1]!);
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const contrast = (a: string, b: string) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi! + 0.05) / (lo! + 0.05);
    };
    const background = mapped('paper');
    for (const text of ['ink', 'accent', 'muted'])
      expect(contrast(mapped(text), background), text).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps grid.ts and tokens.css in step', async () => {
    const { grid } = await import('../master/grid.ts');
    const tokens = readFileSync(`${root}/master/tokens.css`, 'utf8');
    expect(tokens).toContain(`--stage-margin-x: ${grid.marginX}px`);
    expect(tokens).toContain(`--stage-margin-top: ${grid.marginTop}px`);
    expect(tokens).toContain(`--stage-margin-bottom: ${grid.marginBottom}px`);
    expect(tokens).toContain(`--stage-gutter: ${grid.gutter}px`);
  });

  it("keeps its copy of the brand's colours and faces in step with tobos.ai's", () => {
    const tokens = readFileSync(`${root}/master/tokens.css`, 'utf8');
    const brand = readFileSync(
      fileURLToPath(import.meta.resolve('@tobos/site/tokens.css')),
      'utf8',
    );
    const value = (css: string, name: string) =>
      new RegExp(`${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim();
    const pairs = {
      '--stage-ink': '--ink',
      '--stage-muted': '--ink-2',
      '--stage-accent': '--ink',
      '--stage-soft': '--ink-soft',
      '--stage-highlight': '--pop',
    };
    for (const [stage, site] of Object.entries(pairs))
      expect(value(tokens, stage), stage).toBe(value(brand, site));
    expect(value(tokens, '--stage-font-text')).toMatch(/^'Hanken Grotesk'/);
    expect(value(tokens, '--stage-font-mono')).toMatch(/^'Geist Mono'/);
  });

  it('ships every font with its licence', () => {
    const media = Object.keys(JSON.parse(readFileSync(`${root}/media.json`, 'utf8')));
    const fonts = media.filter((name) => name.endsWith('.woff2'));
    expect(fonts.length).toBeGreaterThan(0);
    for (const font of fonts) {
      const family = /fonts\/(.+)-latin/.exec(font)![1];
      expect(media, font).toContain(`master/fonts/OFL-${family}.txt`);
    }
  });
});
