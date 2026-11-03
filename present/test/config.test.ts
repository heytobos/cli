import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** An address bar as Safari keeps it: it throws past 100 changes in 10 seconds. */
function addressBar() {
  const bar = { hash: '#a/1', refused: 0, recent: [] as number[] };
  vi.stubGlobal('location', {
    pathname: '/v/x/',
    search: '',
    get hash() {
      return bar.hash;
    },
  });
  vi.stubGlobal('history', {
    replaceState(_state: unknown, _title: string, url: string) {
      const now = Date.now();
      bar.recent = bar.recent.filter((at) => now - at < 10_000);
      if (bar.recent.length >= 100) {
        bar.refused++;
        throw new DOMException('Attempt to use history.replaceState() more than 100 times');
      }
      bar.recent.push(now);
      bar.hash = url.slice(url.indexOf('#'));
    },
  });
  return bar;
}

/** The module afresh: what it wrote in an earlier test is not this one's. */
const load = async () => {
  vi.resetModules();
  return (await import('../src/viewer/config.ts')).showHash;
};

describe('the position in the address bar', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows each move at once', async () => {
    const showHash = await load();
    const bar = addressBar();
    for (const hash of ['#b/1', '#b/2', '#c/1']) {
      showHash(hash);
      expect(bar.hash).toBe(hash);
      vi.advanceTimersByTime(300);
    }
  });

  it('keeps up with an arrow key held down, and the browser refuses none', async () => {
    const showHash = await load();
    const bar = addressBar();
    // Thirty moves a second, for twenty seconds, as a held key repeats.
    for (let move = 0; move < 600; move++) {
      expect(() => showHash(`#s/${move}`)).not.toThrow();
      vi.advanceTimersByTime(33);
    }
    expect(bar.refused).toBe(0);
    // Once there is room, the last move is there.
    vi.advanceTimersByTime(10_000);
    expect(bar.hash).toBe('#s/599');
  });

  it('writes none it is refused, and the next', async () => {
    const showHash = await load();
    const bar = addressBar();
    vi.spyOn(history, 'replaceState').mockImplementationOnce(() => {
      throw new DOMException('refused');
    });
    expect(() => showHash('#c/1')).not.toThrow();
    expect(bar.hash).toBe('#a/1');
    showHash('#c/2');
    expect(bar.hash).toBe('#c/2');
  });
});
