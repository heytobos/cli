import { describe, expect, it, vi } from 'vitest';
import { mediaUrl, setMedia } from '../src/registry.ts';

describe('media()', () => {
  it("names only the deck's own files, never what an object inherits", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setMedia(JSON.parse('{"cow.jpg": {"hash": "abc"}}'));
    expect(mediaUrl('cow.jpg')).toBe('media/abc');
    expect(mediaUrl('constructor')).toBe('');
    expect(mediaUrl('__proto__')).toBe('');
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
