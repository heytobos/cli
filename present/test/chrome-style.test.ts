import { describe, expect, it } from 'vitest';
import { bundledCss } from '../build-css.ts';
import { chromeStylesheet } from '../src/viewer/chrome-style.ts';

// As build.ts makes it.
const css = chromeStylesheet(await bundledCss('src/viewer/chrome.css'));
const scope = css.indexOf('@scope (.tobos-chrome) to (.tobos-stage) {');

describe("the chrome's stylesheet", () => {
  it('has every rule scoped to the chrome and stopping at a slide', () => {
    expect(scope).toBeGreaterThan(0);
    // Before the scope, only keyframes; after it, nothing.
    expect(
      css
        .slice(0, scope)
        .replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
        .trim(),
    ).toBe('');
    expect(css.slice(scope).trimEnd().endsWith('}')).toBe(true);
    expect(css).not.toContain('@layer');
    let depth = 0;
    for (const c of css) {
      depth += c === '{' ? 1 : c === '}' ? -1 : 0;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
    expect(depth).toBe(0);
  });

  it("holds the system's tokens and classes, and the chrome's own rules after them", () => {
    expect(css).toContain('.btn-primary');
    expect(css.search(/--sans:\s*["']Tobos Sans/)).toBeGreaterThan(css.indexOf('.btn-primary'));
  });

  it("sets the tokens on the chrome's own elements, never on the page's root", () => {
    expect(css).not.toMatch(/:root\b/);
    expect(css).toMatch(/:scope\s*\{\s*--ink:/);
    // .on-ink marks a chrome element itself, which a selector in @scope reaches only as :scope,
    // and weighs as it does in the app.
    expect(css).not.toMatch(/(?<!:where\(:scope\))\.on-ink/);
    expect(css).toContain(':where(:scope).on-ink .btn-primary');
  });

  it('keeps the keyframes outside the scope, which holds only style rules', () => {
    const keyframes = [...css.matchAll(/@keyframes [\w-]+/g)];
    expect(keyframes.map((k) => k[0])).toEqual([
      '@keyframes tobos-chrome-skeleton-pulse',
      '@keyframes tobos-chrome-spinner-turn',
    ]);
    for (const k of keyframes) expect(k.index).toBeLessThan(scope);
    // Under names a deck's own keyframes can't meet, and the rules use them by those names.
    expect(css).not.toMatch(/(?<![\w-])(skeleton-pulse|spinner-turn)/);
    expect(css).toContain('animation: tobos-chrome-skeleton-pulse');
  });

  it('asks for the faces by the names the viewer loads them under', () => {
    const last = (name: string) =>
      [...css.matchAll(new RegExp(`${name}:\\s*([^;]+);`, 'g'))].at(-1)?.[1];
    expect(last('--sans')).toMatch(/^["']Tobos Sans["']/);
    expect(last('--mono')).toMatch(/^["']Tobos Mono["']/);
  });
});
