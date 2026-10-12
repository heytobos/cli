export type Action = 'next' | 'prev' | 'fullscreen' | 'end' | 'present' | 'guides';

const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

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
