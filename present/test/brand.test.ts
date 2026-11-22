import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const brand = readFileSync(fileURLToPath(import.meta.resolve('@tobos/site/tokens.css')), 'utf8');
const value = (css: string, name: string) =>
  new RegExp(`${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim();

describe("the engine's copies of tobos.ai's colours", () => {
  it("are the brand's: only the presenter's ground and red, round a slide", () => {
    const presenter = read('../src/viewer/Presenter.svelte');
    // The presenter takes the tokens from system.css (chrome-style.ts), and keeps no copy of them.
    for (const name of ['--ink', '--grey', '--line', '--pop'])
      expect(value(presenter, name), name).toBeUndefined();
    // Only what is round a slide, where the tokens don't reach, writes the ground and the red out.
    expect(presenter).toContain(value(brand, '--ink'));
    expect(presenter).toContain(value(brand, '--pop'));
  });

  it("aren't on the phone page, which takes the tokens and classes themselves", () => {
    const phone = read('../src/phone/phone.css');
    expect(phone).toContain("@import '@tobos/site/tokens.css';");
    expect(phone).toContain("@import '@tobos/site/system.css';");
    expect(phone).not.toMatch(/^\s*--[\w-]+:/m);
    expect(phone).not.toMatch(/#(?!fff\b)[0-9a-f]{3,8}\b|rgba?\(/i);
  });
});

describe("the phone page's face", () => {
  it('is the one --sans names, loaded from the runtime’s fonts', () => {
    const phone = read('../src/phone/phone.css');
    const sans = /'([^']+)'/.exec(value(brand, '--sans') ?? '')?.[1];
    const faces = [...phone.matchAll(/@font-face\s*{[^}]*font-family:\s*'([^']+)'[^}]*}/g)];
    expect(faces.map((m) => m[1])).toEqual([sans, sans]);
    for (const [face] of faces) expect(face).toMatch(/url\('\.\/fonts\/hanken-grotesk-latin/);
  });
});

describe("the presenter's faces", () => {
  it('are asked for by the names the viewer loads them under, whatever the master loads', () => {
    const css =
      read('../src/viewer/viewer.css') +
      read('../src/viewer/chrome.css') +
      read('../src/viewer/Presenter.svelte');
    const loaded = new Set(
      [...css.matchAll(/@font-face\s*{[^}]*font-family:\s*'([^']+)'/g)].map((m) => m[1]),
    );
    const asked = [...css.matchAll(/(?:font(?:-family)?:)[^;{}]*?'([^']+)'/g)].map((m) => m[1]);
    expect(asked.length).toBeGreaterThan(0);
    for (const face of asked) expect(loaded, face).toContain(face);
  });
});
