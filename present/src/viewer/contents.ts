import type { SharedManifest } from '@tobos/deck';
import { dim, fade, grow, isSheet, pullToClose, rise, sink } from '@tobos/site/grow';
import type { SceneModule } from '../stage.svelte.ts';
import { strip, type Strip } from './contents.svelte.ts';
import { icon } from './icon.ts';
import { numberJump } from './jump.ts';
import { Previews, type Preview } from './previews.ts';

/**
 * A share link's contents: the deck's chapters and the scenes the link shows, numbered as it shows
 * them, from the count button on the bar ("9 / 32", so a viewer can tell someone "scene 9").
 *
 * In a window 640px wide or more, the list grows out of the button, as the app's menus grow out
 * of theirs (grow.ts): pointing at the button a moment opens it, a click too, and leaving the
 * button, the list and the preview closes it. Opened from the keys or by a finger it stays until a
 * pick, Esc, Tab, a press outside or the button again. Beside it, while a mouse points at a row,
 * the slide's preview, and on the row its steps, the deck page's BeatStrip. In a narrower window it
 * is the components library's sheet from the foot, opened by a click or a tap, closed by Close, a
 * pull down, a tap on the scrim or a pick. The window decides the shape, the input the rest.
 *
 * While it is open its keys are the deck's: ↑ ↓ Home End move between rows, ← → step the row's
 * preview, Enter or Space goes there, Esc closes, Tab closes and goes on from the button. Typing a
 * number and Enter goes to that scene, open or not (jump.ts).
 */
export interface ContentsDeck {
  manifest: () => SharedManifest;
  /** The scene on stage, by its index among those the link shows. */
  scene: () => number | undefined;
  /** The beat on stage, by its index in its scene. */
  beat: () => number | undefined;
  /** A scene from its first beat. */
  go: (scene: number) => void;
  /** A scene at one of its beats. */
  goTo: (scene: number, beat: number) => void;
  /** A scene's code, from where the deck now has it (a push moves it): for its preview. */
  load: (scene: number) => Promise<SceneModule>;
}

export interface Contents {
  /** The bar's button that opens them. */
  button: HTMLButtonElement;
  /** The deck moved, or a push changed it. */
  moved: () => void;
  dispose: () => void;
}

/** The house curve (tokens.css, --ease), for what moves here outside the chrome's tokens. */
const EASE = 'cubic-bezier(0.22, 0.61, 0.24, 1)';
/** How long the pointer rests on the button before the list opens: on its way to Fullscreen, not. */
const INTENT = 120;
/** How long the list stays once the pointer has left it, the button and the preview. */
const GRACE = 100;
/** A fade or a glide of the preview. */
const QUICK = 150;
/** A scroll that is browsing, not a notch: past a row, or longer than this. */
const SCROLLED_PX = 36;
const SCROLLED_MS = 100;
/** How long a scroll has stopped before the preview comes back. */
const SETTLE = 120;
/** The preview's widest, and its gap to the list and the window. */
const PREVIEW = 480;
const SMALLEST = 200;

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const total = (m: SharedManifest) => m.chapters.reduce((n, c) => n + c.scenes.length, 0);

/** `onToggle` says when they open or close, for the bar to stay in sight meanwhile. */
export function contents(deck: ContentsDeck, onToggle: (open: boolean) => void): Contents {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-quiet tobos-contents-button';
  button.title = 'Contents';
  button.setAttribute('aria-expanded', 'false');

  const list = document.createElement('nav');
  list.className = 'tobos-contents tobos-chrome on-ink';
  list.setAttribute('aria-label', 'Contents');
  list.hidden = true;
  const chapters = document.createElement('div');
  chapters.className = 'tobos-contents-chapters';
  list.append(chapters);

  // A row's slide, beside the list: titles don't say what a slide looks like. Not chrome, whose
  // tokens and white words a slide inside it would take as its own.
  const peek = document.createElement('div');
  peek.className = 'tobos-preview';
  peek.setAttribute('aria-hidden', 'true');
  peek.hidden = true;

  const scrim = document.createElement('div');
  scrim.className = 'tobos-contents-scrim tobos-chrome';
  scrim.hidden = true;
  document.body.append(scrim, list, peek);

  const previews = new Previews(deck.load);
  // Before the list's keys, so a number's Enter is the number's: it goes there, and closes the list.
  const jump = numberJump(deck, () => {
    if (!open) return;
    const inList = list.contains(document.activeElement);
    hide();
    if (inList) button.focus({ preventScroll: true });
  });

  const label = () => {
    const at = deck.scene();
    const n = total(deck.manifest());
    const count = document.createElement('span');
    count.className = 'tobos-contents-count';
    // As wide as its widest, so the button beside it stays put from 9 to 10.
    count.style.minWidth = `${2 * String(n).length + 3}ch`;
    count.textContent = at === undefined ? String(n) : `${at + 1} / ${n}`;
    button.replaceChildren(icon(LIST), count);
    button.setAttribute('aria-label', `Contents, scene ${count.textContent}`);
  };

  // ———— the list

  /** Each row's go button, by scene. */
  let rows: HTMLButtonElement[] = [];
  /** The step dots mounted, by scene: on the rows that show them, kept while the list is open. */
  const strips = new Map<number, Strip>();
  /** The manifest the list was drawn from: a push brings a new one, a move doesn't. */
  let drawn: SharedManifest | undefined;
  const rowOf = (i: number) => rows[i]?.parentElement ?? null;

  const draw = () => {
    for (const s of strips.values()) s.destroy();
    strips.clear();
    drawn = deck.manifest();
    const digits = String(total(drawn)).length;
    rows = [];
    let index = 0;
    const sections = drawn.chapters.map((chapter) => {
      const section = document.createElement('section');
      section.className = 'tobos-contents-chapter';
      const first = index;
      // A deck with no chapters has its scenes in one with no title: no heading.
      if (chapter.title && chapter.scenes.length) {
        const heading = document.createElement('h3');
        heading.textContent = chapter.title;
        // A chapter's heading goes to its first scene, as a chapter in a document's contents does.
        heading.dataset.scene = String(first);
        section.append(heading);
      }
      const ol = document.createElement('ol');
      for (const scene of chapter.scenes) {
        const i = index++;
        const item = document.createElement('li');
        item.className = 'tobos-contents-row';
        item.dataset.scene = String(i);
        const go = document.createElement('button');
        go.type = 'button';
        // Out of Tab's way, as a menu's items are: the arrows move through the rows, Tab leaves.
        go.tabIndex = -1;
        const count = document.createElement('span');
        count.className = 'tobos-count';
        count.style.minWidth = `${digits}ch`;
        count.textContent = String(i + 1);
        const words = document.createElement('span');
        words.className = 'tobos-title';
        words.textContent = scene.title;
        go.append(count, words);
        item.append(go);
        if (scene.beats.length > 1) {
          const steps = document.createElement('span');
          steps.className = 'tobos-contents-steps';
          item.append(steps);
        }
        ol.append(item);
        rows.push(go);
      }
      section.append(ol);
      return section;
    });
    chapters.replaceChildren(...sections);
    mark();
  };

  /** A row's dots, mounted the first time it shows them. */
  const stripOf = (i: number) => {
    let s = strips.get(i);
    const host = rowOf(i)?.querySelector<HTMLElement>('.tobos-contents-steps');
    if (!s && host) {
      const beats = deck.manifest().chapters.flatMap((c) => c.scenes)[i]?.beats ?? [];
      s = strip(host, [...beats], (k) => pickAt(i, k));
      strips.set(i, s);
      paintStrip(i);
    }
    return s;
  };
  const paintStrip = (i: number) =>
    strips.get(i)?.set({
      on: i === deck.scene(),
      current: deck.beat() ?? 0,
      pointed: shown.scene === i ? shown.step : -1,
    });

  /** The scene on stage marked, in the list as it is, so the row the keys are on keeps its focus. */
  const mark = () => {
    const at = deck.scene();
    rows.forEach((row, i) => {
      if (i === at) row.setAttribute('aria-current', 'step');
      else row.removeAttribute('aria-current');
      row.parentElement!.classList.toggle('tobos-here', i === at);
    });
    for (const section of chapters.querySelectorAll('section'))
      section.classList.toggle('tobos-here', Boolean(section.querySelector('[aria-current]')));
    if (at !== undefined) stripOf(at);
    for (const i of strips.keys()) paintStrip(i);
  };

  /** The row lit as pointed at, its dots shown: the one under the pointer, or a heading's. */
  let pointed: HTMLElement | null = null;
  const point = (i: number) => {
    const row = rowOf(i);
    if (row === pointed) return;
    pointed?.classList.remove('tobos-pointed');
    row?.classList.add('tobos-pointed');
    pointed = row;
    if (i >= 0) stripOf(i);
  };

  /** The list's foot fades while there is more below. */
  const edges = () =>
    list.classList.toggle('tobos-more', list.scrollTop + list.clientHeight < list.scrollHeight - 1);

  // The scenes' code fetched for the rows in sight and half a list's height around them, so a
  // preview draws the frame it shows; none further, for a long deck.
  const near = new IntersectionObserver(
    (entries) => {
      for (const e of entries)
        if (e.isIntersecting)
          previews.warm(deck.manifest(), Number((e.target as HTMLElement).dataset.scene));
    },
    { root: list, rootMargin: '50% 0px' },
  );
  const watchRows = () => {
    near.disconnect();
    for (const row of chapters.querySelectorAll('.tobos-contents-row')) near.observe(row);
  };

  // ———— opening and closing

  /** Open by the mouse (`hover`), which leaving closes, or `held` (the keys, a finger, a sheet). */
  let open: false | 'hover' | 'held' = false;
  let sheet = false;
  let undoPull = () => {};
  let moving: Animation | undefined;

  const show = (how: 'hover' | 'held') => {
    window.clearTimeout(timer);
    if (open) {
      if (how === 'held') open = 'held';
      return;
    }
    sheet = isSheet();
    // A sheet is opened on purpose, and stays until closed.
    open = sheet ? 'held' : how;
    if (deck.manifest() !== drawn) draw();
    else mark();
    list.classList.toggle('tobos-sheet', sheet);
    if (sheet) {
      // As the house's sheet ends in Cancel: Close, kept at the foot as the list scrolls.
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'btn tobos-contents-close';
      close.textContent = 'Close';
      close.addEventListener('click', () => {
        hide();
        button.focus({ preventScroll: true });
      });
      const foot = document.createElement('div');
      foot.className = 'tobos-contents-foot';
      foot.append(close);
      list.replaceChildren(chapters, foot);
      list.style.left = list.style.bottom = list.style.maxHeight = '';
    } else {
      list.replaceChildren(chapters);
      // Out of the button: its left edge on the button's, its foot 8px above it.
      const b = button.getBoundingClientRect();
      list.style.left = `${b.left}px`;
      list.style.bottom = `${innerHeight - b.top + 8}px`;
      list.style.maxHeight = `${Math.min(640, b.top - 24)}px`;
    }
    moving?.cancel();
    list.style.transform = '';
    list.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    onToggle(true);
    // The scene on stage in the middle of the list.
    const here = rowOf(deck.scene() ?? -1);
    if (here) list.scrollTop = here.offsetTop - (list.clientHeight - here.offsetHeight) / 2;
    edges();
    watchRows();
    if (sheet) {
      scrim.hidden = false;
      dim(scrim);
      rise(list);
      undoPull = pullToClose(list, () => hide());
    } else {
      // A sheet's scrim still fading, from a close this open cut short, goes.
      scrim.hidden = true;
      grow(list, list.getBoundingClientRect(), button.getBoundingClientRect());
    }
  };

  const hide = () => {
    window.clearTimeout(timer);
    if (!open) return;
    open = false;
    near.disconnect();
    point(-1);
    fadePeek();
    undoPull();
    undoPull = () => {};
    shown = { scene: -1, step: -1 };
    for (const i of strips.keys()) paintStrip(i);
    button.setAttribute('aria-expanded', 'false');
    onToggle(false);
    list.getAnimations().forEach((a) => a.finish());
    const going = sheet ? sink(list) : fade(list);
    moving = going;
    const done = () => {
      if (moving !== going) return;
      list.hidden = true;
      list.style.transform = '';
      scrim.hidden = true;
    };
    if (!scrim.hidden) fade(scrim);
    if (going) going.finished.then(done, () => undefined);
    else done();
  };

  /** A scene picked, at a step or from its start: there, and closed. */
  const pickAt = (i: number, step: number, byKeys = false) => {
    // Picked from the keys, the focus goes back to the button, as Esc gives it, not to the page.
    const active = document.activeElement;
    const fromKeys =
      byKeys || Boolean(active && list.contains(active) && active.matches(':focus-visible'));
    if (step >= 0) deck.goTo(i, step);
    // The scene on stage stays at its beat.
    else if (i !== deck.scene()) deck.go(i);
    hide();
    if (fromKeys) button.focus({ preventScroll: true });
    // Clicked, the arrows step the deck again rather than a row on its way out.
    else if (active && list.contains(active)) (active as HTMLElement).blur();
  };
  /** What a row or the preview goes to: the step shown on it, if one is, else its start. */
  const pick = (i: number, byKeys = false) =>
    pickAt(i, shown.scene === i ? shown.step : -1, byKeys);

  // ———— the preview

  /** The scene and step the preview shows (-1, its last, the whole slide), and the step's row. */
  let shown = { scene: -1, step: -1 };
  let peeked = -1;
  let current: Preview | undefined;
  let glide: Animation | undefined;
  let fading: Animation | undefined;

  const fadePeek = () => {
    peeked = -1;
    if (peek.hidden) return;
    glide?.cancel();
    fading?.cancel();
    const fade = peek.animate([{ opacity: 1 }, { opacity: 0 }], { duration: QUICK, easing: EASE });
    fading = fade;
    fade.finished.then(
      () => {
        if (fading === fade) fading = undefined;
        // Unless a row was pointed at again meanwhile.
        if (peeked === -1) peek.hidden = true;
      },
      () => undefined,
    );
  };

  /** Scene `i`'s slide beside the list, level with `at` (its row, or its chapter's heading). */
  const showPeek = (i: number, at: HTMLElement) => {
    if (!open || sheet) return;
    // Pointed at again mid-fade: it comes back from where that fade had it.
    const wasFading = fading && !peek.hidden ? Number(getComputedStyle(peek).opacity) : null;
    fading?.cancel();
    fading = undefined;
    const c = list.getBoundingClientRect();
    const w = Math.min(PREVIEW, innerWidth - c.right - 8 - 16);
    if (w < SMALLEST) return fadePeek();
    peek.style.width = `${w}px`;
    peek.style.left = `${c.right + 8}px`;
    const moved = i !== peeked;
    if (moved) {
      current = previews.get(deck.manifest(), i);
      peek.replaceChildren(current.box);
      peeked = i;
    }
    current?.step(shown.scene === i ? shown.step : -1);
    const first = peek.hidden || wasFading !== null;
    peek.hidden = false;
    const r = at.getBoundingClientRect();
    const h = peek.offsetHeight;
    // Where it is on screen now, mid-glide too.
    const from = peek.getBoundingClientRect().top;
    const to = Math.max(16, Math.min(innerHeight - h - 16, r.top + r.height / 2 - h / 2));
    glide?.cancel();
    peek.style.top = `${to}px`;
    // From row to row it glides, from wherever it was; the first time it is just there, fading in.
    if (!first && moved && Math.abs(from - to) > 0.5 && !reduced())
      glide = peek.animate([{ transform: `translateY(${from - to}px)` }, { transform: 'none' }], {
        duration: QUICK,
        easing: EASE,
      });
    if (first)
      peek.animate([{ opacity: wasFading ?? 0 }, { opacity: 1 }], {
        duration: QUICK,
        easing: EASE,
      });
  };

  /** A step of scene `i` in its preview, its dot lit; -1, the whole slide again. */
  const showStep = (i: number, step: number) => {
    const was = shown.scene;
    shown = step >= 0 ? { scene: i, step } : { scene: -1, step: -1 };
    if (was >= 0 && was !== i) paintStrip(was);
    paintStrip(i);
    if (peeked === i) current?.step(step);
  };

  /** Where the mouse is, while it is on the list; null once the keys moved last. */
  let pointer: { x: number; y: number } | null = null;

  /** What the pointer rests on: a row (its title, or a dot's step), or a heading's first scene. */
  const pointAt = (target: Element) => {
    const heading = target.closest<HTMLElement>('h3[data-scene]');
    const row = target.closest<HTMLElement>('.tobos-contents-row');
    if (heading) {
      const i = Number(heading.dataset.scene);
      // The row it goes to lights up as pointed at, its steps shown, so the preview reads as its.
      point(i);
      showStep(i, -1);
      return showPeek(i, heading);
    }
    if (!row) return;
    const i = Number(row.dataset.scene);
    point(i);
    const dot = target.closest<HTMLElement>('[data-beat]');
    if (dot) showStep(i, Number(dot.dataset.beat));
    // The row's bare end, between the dots and the preview, keeps the step a dot showed, so the
    // pointer can carry it over to the preview; the title or the number gives the whole slide.
    else if (target.closest('.tobos-count, .tobos-title') || shown.scene !== i) showStep(i, -1);
    showPeek(i, row);
  };

  list.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    pointer = { x: e.clientX, y: e.clientY };
    // Rows passing under a still pointer while the list scrolls aren't pointed at.
    if (!scrolling) pointAt(e.target as Element);
  });
  list.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    pointer = { x: e.clientX, y: e.clientY };
    // Moved again after the keys moved the selection: the row under it is the selection again.
    const target = e.target as Element;
    const row = target.closest('.tobos-contents-row');
    if (!scrolling && row && row !== pointed && !target.closest('h3')) pointAt(target);
  });
  list.addEventListener('click', (e) => {
    const target = e.target as Element;
    // A dot's own click goes to its step (BeatStrip's show).
    if (target.closest('.tobos-contents-steps [data-beat]')) return;
    const heading = target.closest<HTMLElement>('h3[data-scene]');
    if (heading) return pickAt(Number(heading.dataset.scene), -1);
    const row = target.closest<HTMLElement>('.tobos-contents-row');
    if (row) pick(Number(row.dataset.scene));
  });

  // Scrolling with the mouse is browsing the list; a pointer at rest asks for a preview. While it
  // scrolls, the preview fades and rows don't light up under the pointer; once still a moment, the
  // preview comes back beside the row under the pointer. A scroll the keys made keeps theirs.
  let scrolling = false;
  let settle = 0;
  let scrollFrom = { top: 0, at: 0, faded: false };
  list.addEventListener(
    'scroll',
    () => {
      edges();
      if (!pointer || sheet) return;
      if (!scrolling) {
        scrolling = true;
        list.classList.add('tobos-scrolling');
        scrollFrom = { top: list.scrollTop, at: performance.now(), faded: false };
      }
      // Only a scroll past a row, or longer than a moment, is browsing: a notch just moves on.
      if (
        !scrollFrom.faded &&
        (Math.abs(list.scrollTop - scrollFrom.top) >= SCROLLED_PX ||
          performance.now() - scrollFrom.at >= SCROLLED_MS)
      ) {
        scrollFrom.faded = true;
        point(-1);
        fadePeek();
      }
      window.clearTimeout(settle);
      settle = window.setTimeout(() => {
        scrolling = false;
        list.classList.remove('tobos-scrolling');
        const at = pointer && document.elementFromPoint(pointer.x, pointer.y);
        if (open && at && list.contains(at)) pointAt(at);
      }, SETTLE);
    },
    { passive: true },
  );

  // ———— the mouse: open while it is on the button, the list or the preview

  let timer = 0;
  const stay = () => window.clearTimeout(timer);
  const out = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (open === 'hover') hide();
    }, GRACE);
  };
  button.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'mouse') return;
    window.clearTimeout(timer);
    // A sheet is opened on purpose: by hover it would rise over the button, close as the pointer
    // is off it, and open again.
    if (open || isSheet()) return;
    // Not if the window became a sheet's meanwhile.
    timer = window.setTimeout(() => isSheet() || show('hover'), INTENT);
  });
  button.addEventListener('pointerleave', out);
  list.addEventListener('pointerenter', stay);
  list.addEventListener('pointerleave', () => {
    pointer = null;
    out();
  });
  // The preview is part of the list: the pointer on it keeps both open, and a click goes to the
  // slide it shows, at the step it shows.
  peek.addEventListener('pointerenter', stay);
  peek.addEventListener('pointerleave', out);
  peek.addEventListener('click', () => {
    if (peeked >= 0) pick(peeked);
  });

  // A click by the mouse opens as pointing does, and on an open list does nothing; from the keys
  // or a finger it holds the list open, and a second press closes it.
  let pressedWith = '';
  button.addEventListener('pointerdown', (e) => (pressedWith = e.pointerType));
  button.addEventListener('click', (e) => {
    const byMouse = e.detail !== 0 && pressedWith === 'mouse';
    pressedWith = '';
    if (byMouse && !isSheet()) {
      show('hover');
      button.blur();
      return;
    }
    if (open === 'held') return hide();
    show('held');
    // From the keys (no click count): the scene on stage takes the focus.
    if (e.detail === 0) {
      const row = rows[deck.scene() ?? 0] ?? rows[0];
      row?.focus({ preventScroll: true });
      if (row) lightKeyed(rows.indexOf(row));
    } else button.blur();
  });

  // A press outside only closes, as a menu's does: its pointerup doesn't reach the slide, whose
  // tap would step the deck (taps.ts).
  // That press's own pointerup, by its pointer: one the browser cancels (a pan) leaves none to wait for.
  let swallowUp: number | null = null;
  const onDown = (e: PointerEvent) => {
    if (open !== 'held') return;
    const t = e.target as Node;
    if (list.contains(t) || button.contains(t) || peek.contains(t)) return;
    hide();
    swallowUp = e.pointerId;
    e.stopPropagation();
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== swallowUp) return;
    swallowUp = null;
    e.stopPropagation();
  };
  const onCancel = (e: PointerEvent) => {
    if (e.pointerId === swallowUp) swallowUp = null;
  };
  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onCancel, true);

  // ———— the keys

  /** A row reached by the keys: focused, in sight, previewed, its dots shown. */
  const lightKeyed = (i: number) => {
    const row = rows[i];
    if (!row) return;
    row.focus({ preventScroll: true });
    row.parentElement!.scrollIntoView({ block: 'nearest' });
    point(i);
    showStep(i, -1);
    // A preview needs a mouse: a finger or the keys alone have none, but the mouse may be there.
    if (matchMedia('(hover: hover) and (pointer: fine)').matches) showPeek(i, row.parentElement!);
  };

  const stop = (e: KeyboardEvent, prevent = true) => {
    if (prevent) e.preventDefault();
    e.stopPropagation();
  };

  const onKey = (e: KeyboardEvent) => {
    // Space on the button is a press, as Enter is, not the deck's next beat.
    if (e.key === ' ' && document.activeElement === button) {
      stop(e);
      if (!e.repeat) button.click();
      return;
    }
    if (!open || e.metaKey || e.ctrlKey || e.altKey) return;
    const focused = rows.indexOf(document.activeElement as HTMLButtonElement);
    // The row selected, as in a menu: the one under the pointer while the mouse moved last (or the
    // preview's, with the pointer on it), else the one the keys are on.
    const onPeek = peek.matches(':hover');
    const byPointer = (pointer !== null && list.matches(':hover')) || onPeek;
    const pointedAt = onPeek ? peeked : pointed ? Number(pointed.dataset.scene) : -1;
    const selected = byPointer && pointedAt >= 0 ? pointedAt : focused;
    const steps =
      selected >= 0
        ? (deck.manifest().chapters.flatMap((c) => c.scenes)[selected]?.beats.length ?? 0)
        : 0;
    switch (e.key) {
      case 'Escape':
        hide();
        button.focus({ preventScroll: true });
        return stop(e);
      case 'Tab':
        // Out as from a menu: closed, and on from the button it grew out of, the browser moving
        // the focus from there.
        hide();
        button.focus({ preventScroll: true });
        return;
      case 'ArrowDown':
      case 'ArrowUp': {
        pointer = null;
        const from = selected >= 0 ? selected : (deck.scene() ?? -1);
        const to = e.key === 'ArrowDown' ? from + 1 : from < 0 ? rows.length - 1 : from - 1;
        lightKeyed(Math.max(0, Math.min(rows.length - 1, to)));
        return stop(e);
      }
      case 'Home':
      case 'End':
        pointer = null;
        lightKeyed(e.key === 'Home' ? 0 : rows.length - 1);
        return stop(e);
      case 'ArrowRight':
      case 'ArrowLeft': {
        // A row's steps: Right to the first, then on; Left back, past the first to the whole slide.
        if (steps > 1) {
          const now = shown.scene === selected ? shown.step : -1;
          const next =
            e.key === 'ArrowRight' ? Math.min(steps - 1, now + 1) : Math.max(-1, now - 1);
          stripOf(selected);
          showStep(selected, next);
        }
        return stop(e);
      }
      case 'Enter':
      case ' ':
        // The focused row presses itself (its click picks it, at the step shown); the row under the
        // pointer, this goes to.
        if (selected >= 0 && selected === focused) return stop(e, false);
        if (selected < 0) return stop(e, e.key === ' ');
        if (!e.repeat) pick(selected, true);
        return stop(e);
      case 'PageUp':
      case 'PageDown': {
        // Not the deck's. With a row focused, the list's own scroll, and the keys', which keeps
        // their preview; else nothing.
        const scrolls = list.contains(document.activeElement);
        if (scrolls) pointer = null;
        return stop(e, !scrolls);
      }
    }
  };
  window.addEventListener('keydown', onKey, true);

  // Its shape is the window's at opening: a window that changes it closes it.
  const resized = () => {
    if (open && (isSheet() !== sheet || !sheet)) hide();
  };
  window.addEventListener('resize', resized);

  label();

  return {
    button,
    moved: () => {
      label();
      if (!open) return;
      if (deck.manifest() === drawn) return mark();
      // A push: the rows drawn again, and nothing pointed at or previewed by its old place. The
      // row the keys were on keeps the focus, wherever it went; gone, the button has it.
      const focused = rows.indexOf(document.activeElement as HTMLButtonElement);
      const id = focused >= 0 ? drawn?.chapters.flatMap((c) => c.scenes)[focused]?.id : undefined;
      point(-1);
      fadePeek();
      shown = { scene: -1, step: -1 };
      current = undefined;
      draw();
      watchRows();
      if (id === undefined) return;
      const at = deck
        .manifest()
        .chapters.flatMap((c) => c.scenes)
        .findIndex((x) => x.id === id);
      if (at >= 0) lightKeyed(at);
      else button.focus({ preventScroll: true });
    },
    dispose: () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', resized);
      window.clearTimeout(timer);
      window.clearTimeout(settle);
      near.disconnect();
      for (const s of strips.values()) s.destroy();
      previews.clear();
      jump.dispose();
      list.remove();
      peek.remove();
      scrim.remove();
    },
  };
}

// Lucide's (ISC).
const LIST =
  '<path d="M3 5h.01"/><path d="M3 12h.01"/><path d="M3 19h.01"/><path d="M8 5h13"/><path d="M8 12h13"/><path d="M8 19h13"/>';
