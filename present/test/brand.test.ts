import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const brand = readFileSync(fileURLToPath(import.meta.resolve('@tobos/site/tokens.css')), 'utf8');
const value = (css: string, name: string) =>
  new RegExp(`${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim();

describe("the engine's copies of tobos.ai's colours", () => {
  it("are the brand's: the presenter's ink, grey and red, and the phone page's ink", () => {
    const presenter = read('../src/viewer/Presenter.svelte');
    for (const name of ['--ink', '--grey', '--pop'])
      expect(value(presenter, name), name).toBe(value(brand, name));
    expect(value(read('../src/phone/phone.css'), '--ink')).toBe(value(brand, '--ink'));
  });
});

describe("the presenter's faces", () => {
  it('are asked for by the names the viewer loads them under, whatever the master loads', () => {
    const css = read('../src/viewer/viewer.css') + read('../src/viewer/Presenter.svelte');
    const loaded = new Set(
      [...css.matchAll(/@font-face\s*{[^}]*font-family:\s*'([^']+)'/g)].map((m) => m[1]),
    );
    const asked = [...css.matchAll(/(?:font(?:-family)?:)[^;{}]*?'([^']+)'/g)].map((m) => m[1]);
    expect(asked.length).toBeGreaterThan(0);
    for (const face of asked) expect(loaded, face).toContain(face);
  });
});
