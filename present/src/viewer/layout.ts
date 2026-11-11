/**
 * How the presenter's view divides its screen: Now and the notes on the left, the time, Next and
 * the scenes on the right. Two dividers move by dragging, the notes' size by steps, and the choice
 * stays, in this browser, for every deck. Left as it comes, the view fits itself to the screen.
 */
export interface Layout {
  /** The left column's share of the width; 0 fits it to the slide. */
  left: number;
  /** The slide's share of the left column's height; 1 fits it, as wide as the column. */
  slide: number;
  /** The notes' size, in pixels: one of NOTE_SIZES. */
  notes: number;
}

export const DEFAULT_LAYOUT: Layout = { left: 0, slide: 1, notes: 24 };
export const NOTE_SIZES = [16, 18, 20, 24, 28, 32, 40];
/** A divider's width: it is dragged from anywhere across it. */
export const GUTTER = 18;
/**
 * Room kept for the notes: their heading, and nine lines at the default size, whatever it is; on
 * a short screen, no more than 45% of it, so the slide stays the larger.
 */
export const NOTES_ROOM = 40 + 9 * 24 * 1.5;
const KEY = 'tobos:presenter-layout';
/**
 * The left column's share: no less than this, nor more; fitted to the notes' room, no more than
 * LEFT_FITTED_MOST, so the right column keeps room.
 */
const LEFT_LEAST = 0.45;
const LEFT_FITTED_MOST = 0.7;
const LEFT_MOST = 0.8;
/** The slide's share of its column, dragged or followed: between these, so notes keep a fifth. */
const SLIDE_LEAST = 0.3;
const SLIDE_MOST = 0.8;

const clamp = (x: number, low: number, high: number) => Math.max(low, Math.min(high, x));

export function loadLayout(storage: Pick<Storage, 'getItem'> | undefined): Layout {
  try {
    const saved = JSON.parse(storage?.getItem(KEY) ?? '{}') as Partial<Layout>;
    const number = (x: unknown, low: number, high: number) =>
      typeof x === 'number' && x >= low && x <= high ? x : undefined;
    return {
      left: number(saved.left, 0, LEFT_MOST) ?? DEFAULT_LAYOUT.left,
      slide: number(saved.slide, SLIDE_LEAST, 1) ?? DEFAULT_LAYOUT.slide,
      notes: NOTE_SIZES.includes(saved.notes as number) ? saved.notes! : DEFAULT_LAYOUT.notes,
    };
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

export function saveLayout(storage: Pick<Storage, 'setItem'> | undefined, layout: Layout) {
  try {
    storage?.setItem(KEY, JSON.stringify(layout));
  } catch {
    // Storage refused, as in a private window: the layout holds until the page goes.
  }
}

/** The notes' size a step larger or smaller, within NOTE_SIZES. */
export function noteSize(size: number, by: 1 | -1): number {
  return NOTE_SIZES[clamp(NOTE_SIZES.indexOf(size) + by, 0, NOTE_SIZES.length - 1)]!;
}

export interface Arranged {
  /** The left column's width. */
  left: number;
  /** The height of Now: its label and its slide. */
  pane: number;
  /** The height at which Now's slide fills the column's width: the most it takes. */
  fullSlide: number;
  /** Next's widest: half of Now's slide, so it reads as the smaller of the two. */
  next: number;
}

/**
 * Sizes for a main area `width` by `height`, Now's label `label` high (with its gap), and notes or
 * none. The slide gets the height the notes leave, or the height its divider was dragged to, and
 * the left column is as wide as that slide, so no empty ground opens beside it; the right column
 * takes the rest. A column dragged wider has the slide fill it.
 */
export function arrange(
  layout: Layout,
  { width, height, label, notes }: { width: number; height: number; label: number; notes: boolean },
): Arranged {
  const room = notes ? Math.min(NOTES_ROOM, 0.45 * height) + GUTTER / 2 : 0;
  // The slide's height: where its divider was dragged, or what the notes' room leaves.
  const dragged = notes && layout.slide < 1 ? layout.slide * height - GUTTER / 2 : undefined;
  const fitted = clamp(
    ((((dragged ?? height - room) - label) * 16) / 9 + GUTTER / 2) / width,
    LEFT_LEAST,
    dragged === undefined ? LEFT_FITTED_MOST : LEFT_MOST,
  );
  // A column dragged wider has the slide grow into the notes' room, as far as one dragged would,
  // and goes no wider than that slide, so no ground opens beside it.
  const most = !notes ? height : layout.left ? SLIDE_MOST * height - GUTTER / 2 : height - room;
  const left = Math.max(
    0,
    layout.left
      ? Math.min(layout.left * width - GUTTER / 2, ((most - label) * 16) / 9)
      : fitted * width - GUTTER / 2,
  );
  const fullSlide = label + (left * 9) / 16;
  const pane = !notes
    ? height
    : dragged === undefined
      ? clamp(fullSlide, SLIDE_LEAST * height, most)
      : Math.min(dragged, fullSlide);
  const now = Math.min(left, ((pane - label) * 16) / 9);
  return { left, pane: Math.max(0, pane), fullSlide, next: Math.max(0, now / 2) };
}

/** The left column's share for a divider dragged to `x` of a main area `width` wide. */
export const dragLeft = (x: number, width: number) => clamp(x / width, LEFT_LEAST, LEFT_MOST);

/** The slide's share for a divider dragged to `y` of a column `height` high. */
export const dragSlide = (y: number, height: number) => clamp(y / height, SLIDE_LEAST, SLIDE_MOST);
