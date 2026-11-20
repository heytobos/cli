import { describe, expect, it } from 'vitest';
import {
  formatLookRecord,
  lookRecordIn,
  lookRecordOf,
  memoryTree,
  parseLookRecord,
  sha256,
} from '../src/index.ts';

describe('theme.json, where a deck’s look came from (ADR 0010, D2)', () => {
  const master = {
    files: {
      'master/tokens.css': new TextEncoder().encode(':root { --stage-accent: red; }\n'),
      'master/index.ts': new TextEncoder().encode('export {};\n'),
    },
    media: { 'master/logo.svg': { hash: 'a'.repeat(64), size: 10, type: 'image/svg+xml' } },
    dependencies: { 'd3-scale': '4.0.2' },
  };
  const from = {
    theme: '06b48295-7c5c-4e1f-90f5-a082d60941de',
    name: 'Brand',
    version: 'c'.repeat(40),
  };

  it('names each design file it took by its hash: master/ by its bytes, media by media.json’s', () => {
    expect(lookRecordOf(master, from)).toEqual({
      ...from,
      files: {
        'master/index.ts': sha256('export {};\n'),
        'master/tokens.css': sha256(':root { --stage-accent: red; }\n'),
        'media/master/logo.svg': 'a'.repeat(64),
      },
      packages: { 'd3-scale': '4.0.2' },
    });
  });

  it('reads what it writes, and nothing that isn’t the record', () => {
    const text = formatLookRecord(lookRecordOf(master, from));
    expect(text.endsWith('}\n')).toBe(true);
    expect(parseLookRecord(text)).toEqual(lookRecordOf(master, from));
    expect(lookRecordIn(memoryTree({ 'theme.json': text }))).toEqual(lookRecordOf(master, from));
    expect(lookRecordIn(memoryTree({}))).toBeUndefined();
    for (const bad of ['', '[]', '{', '{"theme": 1}', JSON.stringify({ ...from, files: [] })])
      expect(parseLookRecord(bad), bad).toBeUndefined();
  });
});
