import type { ContentsDeck } from './contents.ts';

/** How long a number typed waits for Enter. */
const WAIT = 2500;

/**
 * A scene by its number, as Keynote and PowerPoint go to a slide: digits typed anywhere on a share
 * link show "Go to 9 ↵" over its bar, and Enter goes there (and `onJump` closes the contents); Esc,
 * or a pause, drops them. A number past the last says how far they go.
 */
export function numberJump(deck: ContentsDeck, onJump: () => void): { dispose: () => void } {
  const chip = document.createElement('div');
  chip.className = 'tobos-jump tobos-chrome on-ink';
  chip.hidden = true;
  chip.setAttribute('role', 'status');
  document.body.append(chip);
  let typed = '';
  let timer = 0;
  const clear = () => {
    typed = '';
    chip.hidden = true;
  };
  const total = () => deck.manifest().chapters.reduce((n, c) => n + c.scenes.length, 0);
  const onKey = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // A field's digits are its own.
    if ((e.target as Element | null)?.closest?.('input, textarea, select, [contenteditable]'))
      return;
    const n = total();
    if (/^[0-9]$/.test(e.key)) {
      if (typed.length >= String(n).length) typed = '';
      typed += e.key;
    } else if (typed && e.key === 'Backspace') typed = typed.slice(0, -1);
    else if (typed && e.key === 'Escape') {
      // Dropped, and still the open contents' Esc (on the window too), but not the deck's.
      clear();
      e.stopPropagation();
      return;
    } else if (typed && e.key === 'Enter') {
      const at = Number(typed);
      // Its own, not also a key of the open contents' (their listener is on the window too).
      e.preventDefault();
      e.stopImmediatePropagation();
      // Past the last, it stays, saying how far they go, to be typed again.
      if (at < 1 || at > n) {
        window.clearTimeout(timer);
        timer = window.setTimeout(clear, WAIT);
        return;
      }
      if (at - 1 !== deck.scene()) deck.go(at - 1);
      clear();
      onJump();
      return;
    } else return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const at = Number(typed);
    const ok = typed !== '' && at >= 1 && at <= n;
    const words = document.createElement('span');
    words.textContent = 'Go to';
    const number = document.createElement('b');
    number.textContent = typed;
    const hint = document.createElement('span');
    hint.className = 'tobos-jump-hint';
    hint.textContent = ok ? '↵' : `1–${n}`;
    chip.replaceChildren(words, number, hint);
    chip.hidden = !typed;
    window.clearTimeout(timer);
    timer = window.setTimeout(clear, WAIT);
  };
  window.addEventListener('keydown', onKey, true);
  return {
    dispose: () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey, true);
      chip.remove();
    },
  };
}
