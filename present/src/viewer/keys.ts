/**
 * The one key map (TOB-404, D2): a key means the same wherever it lands, on the deck's page or in
 * its preview, and its action goes to whichever of the two owns it (ownerOf), in one message
 * (actionIn). Arranging the deck's scenes is the deck page's (ARRANGING), so its keys work while
 * the preview has the focus too.
 */
/**
 * The deck page's changes to its scenes, to those on stage or selected: H hides or unhides, ⌘Z
 * and ⇧⌘Z undo and redo, ⌘↑↓ move one place, ⌘⇧↑↓ to the start or end, ⌘⌫ or Delete removes,
 * ↵ or F2 renames, ⇧F10 or the menu key opens their menu. R renames the deck itself (TOB-480).
 */
const ARRANGE = [
  'hide',
  'undo',
  'redo',
  'up',
  'down',
  'first',
  'last',
  'remove',
  'rename',
  'menu',
  'retitle',
] as const;
const ACTIONS = [
  'next',
  'prev',
  'next-scene',
  'prev-scene',
  'fullscreen',
  'end',
  'present',
  'guides',
  ...ARRANGE,
] as const;
export type Action = (typeof ACTIONS)[number];
export const ARRANGING: ReadonlySet<Action> = new Set(ARRANGE);

/** A move of the stage: a beat, or to the start of a scene, either way. */
export interface Move {
  by: 'beat' | 'scene';
  delta: 1 | -1;
}

const MOVES: Partial<Record<Action, Move>> = {
  next: { by: 'beat', delta: 1 },
  prev: { by: 'beat', delta: -1 },
  'next-scene': { by: 'scene', delta: 1 },
  'prev-scene': { by: 'scene', delta: -1 },
};

/** How the action moves the stage, if it does. */
export function moveOf(what: Action): Move | null {
  return MOVES[what] ?? null;
}

/** What Enter presses where it has the focus, rather than rename a scene. */
export const PRESSED = 'button, a[href], summary, [role=button], [role=tab]';

/** Who carries an action out: the deck's page presents and arranges; the slides do the rest. */
export function ownerOf(what: Action): 'page' | 'slides' {
  return what === 'present' || ARRANGING.has(what) ? 'page' : 'slides';
}

/** The message that hands an action to its owner, either way between the page and the slides. */
export const actionMessage = (what: Action) => ({ type: 'tobos:action', action: what });

/** The action a message hands on, if it is that message. */
export function actionIn(data: unknown): Action | null {
  const { type, action } = (data ?? {}) as { type?: unknown; action?: unknown };
  return type === 'tobos:action' && ACTIONS.includes(action as Action) ? (action as Action) : null;
}

/** A field someone types in, whose keys are its own: on the deck's page as in the slides. */
const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/** What a key press means on stage. Other keys pressed with a modifier are left to the browser. */
export function action(event: KeyboardEvent): Action | null {
  const target = event.target as Element | null;
  if (target?.closest?.(EDITABLE)) return null;
  const command = event.metaKey || event.ctrlKey;
  if (command && event.key === 'Enter') return 'present';
  if (command && !event.altKey) {
    if (event.key.toLowerCase() === 'z') return event.shiftKey ? 'redo' : 'undo';
    if (event.key === 'ArrowUp') return event.shiftKey ? 'first' : 'up';
    if (event.key === 'ArrowDown') return event.shiftKey ? 'last' : 'down';
    if (event.key === 'Backspace') return 'remove';
  }
  if (event.shiftKey && event.key === 'F10') return 'menu';
  if (command || event.altKey) return null;
  switch (event.key) {
    // ← → step a beat, ↓ ↑ a scene, as the outline lists them; a clicker's PageDown and PageUp
    // step beats, so a presenter's goes through every one.
    case 'ArrowRight':
    case 'PageDown':
    case ' ':
      return 'next';
    case 'ArrowLeft':
    case 'PageUp':
      return 'prev';
    case 'ArrowDown':
      return 'next-scene';
    case 'ArrowUp':
      return 'prev-scene';
    case 'f':
    case 'F':
      return 'fullscreen';
    case 'Escape':
      return 'end';
    case 'l':
    case 'L':
      return 'guides';
    case 'h':
    case 'H':
      return 'hide';
    case 'Delete':
      return 'remove';
    case 'Enter':
    case 'F2':
      return 'rename';
    case 'ContextMenu':
      return 'menu';
    case 'r':
    case 'R':
      return 'retitle';
    default:
      return null;
  }
}

/**
 * The presenter's view's own keys, beside the stage's: P pauses the timer, + and − size the notes,
 * ⇧↓ and ⇧↑ scroll them by a paragraph without moving the stage, ⌫ goes back after a jump. The
 * view takes the notes' keys only when it has notes, and ⌫ only after a jump; otherwise they are
 * the stage's, as before.
 */
export type PresenterKey = 'pause' | 'larger' | 'smaller' | 'notes-down' | 'notes-up' | 'back';

export function presenterKey(event: KeyboardEvent): PresenterKey | null {
  const target = event.target as Element | null;
  if (target?.closest?.(EDITABLE)) return null;
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (event.shiftKey && event.key === 'ArrowDown') return 'notes-down';
  if (event.shiftKey && event.key === 'ArrowUp') return 'notes-up';
  switch (event.key) {
    case 'p':
    case 'P':
      return 'pause';
    case '+':
    case '=':
      return 'larger';
    case '-':
      return 'smaller';
    case 'Backspace':
      return 'back';
    default:
      return null;
  }
}
