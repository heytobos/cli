/**
 * A control that asks once more, so a stray click can't do what can't be undone: the first click
 * arms it for a few seconds, and says so, the second within them acts.
 */
export class Confirm {
  armed = $state(false);
  #timer = 0;
  #ms: number;

  constructor(ms: number) {
    this.#ms = ms;
  }

  press(act: () => void) {
    window.clearTimeout(this.#timer);
    if (this.armed) {
      this.armed = false;
      act();
      return;
    }
    this.armed = true;
    this.#timer = window.setTimeout(() => (this.armed = false), this.#ms);
  }

  cancel() {
    window.clearTimeout(this.#timer);
    this.armed = false;
  }
}
