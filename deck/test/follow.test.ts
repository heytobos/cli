import { describe, expect, it } from 'vitest';
import {
  lookRecordOf,
  planFollow,
  scenesReaching,
  sha256,
  usedFromScenes,
  type DeckDesign,
} from '../src/index.ts';
import type { Master } from '../src/master.ts';

const text = (s: string) => new TextEncoder().encode(s);
const entry = (hash: string) => ({
  hash: hash.repeat(64).slice(0, 64),
  size: 1,
  type: 'image/svg+xml',
});

/** A theme's design: its master's files and media, and the packages its master imports. */
function master(
  files: Record<string, string>,
  media: Record<string, string> = {},
  dependencies: Record<string, string> = {},
): Master {
  return {
    files: Object.fromEntries(Object.entries(files).map(([p, t]) => [p, text(t)])),
    media: Object.fromEntries(Object.entries(media).map(([n, h]) => [n, entry(h)])),
    dependencies,
  };
}
const V1 = { theme: 't', name: 'Synthesion', version: '1'.repeat(40) };
const V2 = { ...V1, version: '2'.repeat(40) };

describe('following a theme, file by file (ADR 0010, D9)', () => {
  // Version 1 of the theme, which the deck took; version 2, which it follows now.
  const v1 = master(
    {
      'master/tokens.css': 'accent: red',
      'master/layouts/Title.svelte': 'title 1',
      'master/layouts/Old.svelte': 'old',
      'master/GUIDE.md': 'guide 1',
      'master/Deleted.svelte': 'deleted by the deck',
    },
    { 'master/logo.svg': 'a' },
    { katex: '0.16.0' },
  );
  const v2 = master(
    {
      'master/tokens.css': 'accent: orange',
      'master/layouts/Title.svelte': 'title 2',
      'master/GUIDE.md': 'guide 2',
      'master/Deleted.svelte': 'deleted by the deck, changed',
      'master/layouts/New.svelte': 'new',
      'master/layouts/Mine.svelte': 'the theme’s Mine',
    },
    { 'master/logo.svg': 'b' },
    { katex: '0.16.11', d3: '7.9.0' },
  );
  const record = lookRecordOf(v1, V1);
  // The deck: its own Title, Deleted gone, a Mine of its own, the rest as version 1 had it.
  const deck: DeckDesign = {
    files: {
      'master/tokens.css': text('accent: red'),
      'master/layouts/Title.svelte': text('my title'),
      'master/layouts/Old.svelte': text('old'),
      'master/GUIDE.md': text('guide 1'),
      'master/layouts/Mine.svelte': text('my Mine'),
    },
    media: { 'master/logo.svg': entry('a') },
    packages: { katex: '0.16.0', three: '0.170.0' },
  };

  it('replaces what the deck left as it was, keeps its own changes, and keeps a deleted file deleted', () => {
    const plan = planFollow(deck, record, v2, V2, () => false);
    expect(plan.replaced.sort()).toEqual(
      ['master/GUIDE.md', 'master/tokens.css', 'media/master/logo.svg', 'package:katex'].sort(),
    );
    expect(plan.files['master/tokens.css']).toEqual(text('accent: orange'));
    expect(plan.media['master/logo.svg']).toEqual(entry('b'));
    expect(plan.packages.katex).toBe('0.16.11');
    // Its own Title stays, though the theme changed it; Deleted stays deleted.
    expect(plan.kept).toContain('master/layouts/Title.svelte');
    expect(plan.files).not.toHaveProperty(['master/layouts/Title.svelte']);
    expect(plan.files).not.toHaveProperty(['master/Deleted.svelte']);
  });

  it('adds what is new, keeps its own file where the theme has a new one, and says so', () => {
    const plan = planFollow(deck, record, v2, V2, () => false);
    expect(plan.added.sort()).toEqual(['master/layouts/New.svelte', 'package:d3']);
    expect(plan.files['master/layouts/New.svelte']).toEqual(text('new'));
    expect(plan.packages.d3).toBe('7.9.0');
    expect(plan.clashes).toEqual(['master/layouts/Mine.svelte']);
    expect(plan.files).not.toHaveProperty(['master/layouts/Mine.svelte']);
    // A package of the deck's own is none of following's business.
    expect(plan.packages).not.toHaveProperty('three');
  });

  it('removes what is gone from the theme and unused, and keeps what a scene still uses', () => {
    expect(planFollow(deck, record, v2, V2, () => false)).toMatchObject({
      gone: ['master/layouts/Old.svelte'],
      files: { 'master/layouts/Old.svelte': null },
    });
    const kept = planFollow(deck, record, v2, V2, (key) => key === 'master/layouts/Old.svelte');
    expect(kept.gone).toEqual([]);
    expect(kept.kept).toContain('master/layouts/Old.svelte');
    expect(kept.files).not.toHaveProperty(['master/layouts/Old.svelte']);
  });

  it('records the theme’s whole design at its version: the deck’s own changes stay its own', () => {
    const plan = planFollow(deck, record, v2, V2);
    expect(plan.record).toEqual(lookRecordOf(v2, V2));
    expect(plan.record.files['master/layouts/Title.svelte']).toBe(sha256('title 2'));
  });

  it('keeps a file the deck deleted deleted, through a version without it and one that brings it back', () => {
    const v3 = master({ 'master/tokens.css': 'accent: orange' });
    const deleted: DeckDesign = {
      files: { 'master/tokens.css': text('accent: red') },
      media: {},
      packages: {},
    };
    const gone = planFollow(deleted, record, v3, V2, () => false);
    expect(gone.record.files['master/Deleted.svelte']).toBe(record.files['master/Deleted.svelte']);
    const back = planFollow(
      { ...deleted, files: { 'master/tokens.css': text('accent: orange') } },
      gone.record,
      v2,
      { ...V2, version: '3'.repeat(40) },
      () => false,
    );
    expect(back.added).not.toContain('master/Deleted.svelte');
    expect(back.files).not.toHaveProperty(['master/Deleted.svelte']);
  });

  it('takes every design file of a deck without a record for its own', () => {
    const plan = planFollow(deck, undefined, v2, V2);
    expect(plan.replaced).toEqual([]);
    expect(plan.files['master/tokens.css']).toBeUndefined();
    expect(plan.clashes).toContain('master/tokens.css');
    expect(plan.added).toContain('master/layouts/New.svelte');
  });

  it('changes nothing following the version it has', () => {
    const same = planFollow(
      { files: v1.files, media: v1.media, packages: v1.dependencies },
      record,
      v1,
      V1,
    );
    expect([same.replaced, same.added, same.gone, same.clashes]).toEqual([[], [], [], []]);
    expect(same.files).toEqual({});
  });
});

describe('what a deck’s scenes use', () => {
  const files = new Map(
    Object.entries({
      'scenes/intro.svelte': `<script>import { Title } from '../master/index.ts';\nimport cow from '$media/cow.jpg';\nimport * as d3 from 'd3-scale';\nconst frames = import.meta.glob('$media/frames/*.png');</script>`,
      'master/index.ts': `export { default as Title } from './layouts/Title.svelte';`,
      'master/layouts/Title.svelte': `<script>import mark from '$media/master/mark.svg';</script>`,
      'master/layouts/Old.svelte': `<script>import x from '@scope/pkg/sub';</script>`,
      'master/tokens.css': `@font-face { src: url(../media/master/fonts/a.woff2 ), url( "../media/master/fonts/b woff.woff2" ) }`,
    }).map(([p, t]) => [p, text(t)]),
  );
  const used = usedFromScenes(files);

  it('reaches what the scenes import, and what tokens.css links', () => {
    for (const key of [
      'master/index.ts',
      'master/layouts/Title.svelte',
      'media/master/mark.svg',
      'media/cow.jpg',
      'media/master/fonts/a.woff2',
      'media/master/fonts/b woff.woff2',
      'media/frames/1.png',
      'package:d3-scale',
    ])
      expect(used(key), key).toBe(true);
  });

  it('matches globs as the viewer does: lists, template strings, and ** over no folder', () => {
    const globbed = usedFromScenes(
      new Map([
        [
          'scenes/a.svelte',
          text(
            '<script>const a = import.meta.glob([\'$media/one/*.svg\', "$media/two/*.svg"]);\nconst b = import.meta.glob(`$media/master/**/*.png`);</script>',
          ),
        ],
      ]),
    );
    for (const key of [
      'media/one/a.svg',
      'media/two/b.svg',
      'media/master/logo.png',
      'media/master/x/y.png',
    ])
      expect(globbed(key), key).toBe(true);
    expect(globbed('media/three/c.svg')).toBe(false);
  });

  it('reads a stylesheet tokens.css imports by url() for what it links, its path decoded', () => {
    const chained = usedFromScenes(
      new Map(
        Object.entries({
          'master/tokens.css': `@import url('./font%20styles.css#v1');`,
          'master/font styles.css': `@font-face { src: url(../media/master/fonts/c%C3%A9.woff2?v=2#iefix), url(../media/master/fonts/bad%zz.woff2) }`,
        }).map(([p, t]) => [p, text(t)]),
      ),
    );
    expect(chained('master/font styles.css')).toBe(true);
    expect(chained('media/master/fonts/cé.woff2')).toBe(true);
    // A malformed escape names the file as written; so does any, as the build looks it up.
    expect(chained('media/master/fonts/bad%zz.woff2')).toBe(true);
    expect(chained('media/master/fonts/c%C3%A9.woff2')).toBe(true);
  });

  it('leaves out what nothing a scene reaches imports', () => {
    for (const key of ['master/layouts/Old.svelte', 'package:@scope/pkg', 'media/frames/a/1.png'])
      expect(used(key), key).toBe(false);
  });
});

describe('the scenes a theme’s change reaches (ADR 0010, D7)', () => {
  const files = new Map(
    Object.entries({
      'scenes/title.svelte': `<script>import { Title } from '../master/index.ts';</script>`,
      'scenes/chart.svelte': `<script>import Bars from '../lib/Bars.svelte';</script>`,
      'lib/Bars.svelte': `<div class="bars"></div>`,
      'master/index.ts': `export { default as Title } from './layouts/Title.svelte';`,
      'master/layouts/Title.svelte': `<script>import mark from '$media/master/mark.svg';</script>`,
      'master/tokens.css': `@import './base.css';\n@font-face { src: url(../media/master/fonts/a.woff2) }`,
      'master/base.css': `body { margin: 0 }`,
    }).map(([p, t]) => [p, text(t)]),
  );

  it('are those that reach a changed file, by import or media', () => {
    expect(scenesReaching(files, ['master/layouts/Title.svelte'])).toEqual(['title']);
    expect(scenesReaching(files, ['media/master/mark.svg'])).toEqual(['title']);
    expect(scenesReaching(files, ['master/GUIDE.md'])).toEqual([]);
  });

  it('are every scene when tokens.css, or what it imports or links, changes', () => {
    expect(scenesReaching(files, ['master/tokens.css']).sort()).toEqual(['chart', 'title']);
    expect(scenesReaching(files, ['master/base.css']).sort()).toEqual(['chart', 'title']);
    expect(scenesReaching(files, ['media/master/fonts/a.woff2']).sort()).toEqual([
      'chart',
      'title',
    ]);
  });
});
