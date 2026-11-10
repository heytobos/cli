/**
 * A control that asks once more, so a stray press can't do what can't be undone: the first press
 * arms it for a few seconds, and says so, the second within them acts. `armed` is how it was
 * pressed, by a click or a key, so it can say which to press again.
 */
export class Confirm {
  armed = $state<'click' | 'key' | null>(null);
  #timer = 0;
  #ms: number;

  constructor(ms: number) {
    this.#ms = ms;
  }

  press(how: 'click' | 'key', act: () => void) {
    window.clearTimeout(this.#timer);
    if (this.armed) {
      this.armed = null;
      act();
      return;
    }
    this.armed = how;
    this.#timer = window.setTimeout(() => (this.armed = null), this.#ms);
  }

  cancel() {
    window.clearTimeout(this.#timer);
    this.armed = null;
  }
}
