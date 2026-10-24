import { describe, expect, it } from 'vitest';
import { formatMediaJson } from '../src/index.ts';

describe('media.json, as Tobos writes it', () => {
  it('is by name, two spaces, a line at the end, as `tobos push` and a chat’s edit leave it', () => {
    const hash = 'a'.repeat(64);
    expect(
      formatMediaJson({
        'photo.jpg': { hash, size: 3, type: 'image/jpeg' },
        'cow.png': { hash, size: 4, type: 'image/png' },
      }),
    ).toBe(
      `{\n  "cow.png": {\n    "hash": "${hash}",\n    "size": 4,\n    "type": "image/png"\n  },\n  "photo.jpg": {\n    "hash": "${hash}",\n    "size": 3,\n    "type": "image/jpeg"\n  }\n}\n`,
    );
  });
});
