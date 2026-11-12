/**
 * A slide's ghost while it loads: a title, a few lines of text and a picture beside them, in the
 * deck's paper (skeleton.css). The viewer's page holds one from its first paint (runtime.ts), a
 * player takes it onto its stage and fades it once its first scene is drawn (player.ts), and the
 * app shows the same one where a slide's picture or preview is still on its way.
 */
export const SKELETON =
  '<div class="tobos-skeleton" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>';

/**
 * A ghost on `stage`: the page's own, the one its HTML came with, while no stage has taken it,
 * or a new one.
 */
export function skeleton(stage: HTMLElement): HTMLElement {
  let ghost = document.querySelector<HTMLElement>('#tobos > .tobos-skeleton');
  if (!ghost) {
    const box = document.createElement('div');
    box.innerHTML = SKELETON;
    ghost = box.firstElementChild as HTMLElement;
  }
  stage.append(ghost);
  return ghost;
}

/** The ghost fades, then goes. */
export function unveil(ghost: HTMLElement) {
  ghost.classList.add('tobos-drawn');
  window.setTimeout(() => ghost.remove(), 600);
}
