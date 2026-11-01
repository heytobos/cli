/**
 * The one key map (TOB-404, D2): a key means the same wherever it lands, on the deck's page or in
 * its preview, and its action goes to whichever of the two owns it (ownerOf), in one message
 * (actionIn).
 */
const ACTIONS = ['next', 'prev', 'fullscreen', 'end', 'present', 'guides'] as const;
export type Action = (typeof ACTIONS)[number];

/** Who carries an action out: the deck's page presents; the slides do the rest. */
export function ownerOf(what: Action): 'page' | 'slides' {
  return what === 'present' ? 'page' : 'slides';
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

/** What a key press means on stage. Keys pressed with a modifier are left to the browser. */
export function action(event: KeyboardEvent): Action | null {
  const target = event.target as Element | null;
  if (target?.closest?.(EDITABLE)) return null;
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') return 'present';
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  switch (event.key) {
    case 'ArrowRight':
    case 'ArrowDown':
    case 'PageDown':
    case ' ':
      return 'next';
    case 'ArrowLeft':
    case 'ArrowUp':
    case 'PageUp':
      return 'prev';
    case 'f':
    case 'F':
      return 'fullscreen';
    case 'Escape':
      return 'end';
    case 'l':
    case 'L':
      return 'guides';
    default:
      return null;
  }
}
