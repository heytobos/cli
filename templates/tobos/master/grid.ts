/** The master's grid on the 1920×1080 stage. tokens.css carries the same values. */
export const grid = {
  width: 1920,
  height: 1080,
  marginX: 112,
  marginTop: 96,
  marginBottom: 96,
  columns: 12,
  gutter: 32,
  /** The headline's baseline area, for content layouts. */
  headerBottom: 248,
} as const;

/** The left edge of column `n` (from 0) and the width of `span` columns, in stage px. */
export function column(n: number, span = 1): { left: number; width: number } {
  const inner = grid.width - 2 * grid.marginX;
  const col = (inner - (grid.columns - 1) * grid.gutter) / grid.columns;
  return {
    left: grid.marginX + n * (col + grid.gutter),
    width: span * col + (span - 1) * grid.gutter,
  };
}
