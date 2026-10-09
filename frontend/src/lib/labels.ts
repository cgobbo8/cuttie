/**
 * Rows for labels laid along a line (passages over the live's curve): each
 * label, left to right, goes on the first row where it clears the previous
 * one, so close passages don't cover each other's names.
 */
export function stackLabels(centers: number[], labelWidth: number): number[] {
  const order = centers.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const lastInRow: number[] = [];
  const rows = new Array<number>(centers.length).fill(0);
  for (const [x, i] of order) {
    let row = lastInRow.findIndex((last) => x - last >= labelWidth);
    if (row === -1) row = lastInRow.length;
    lastInRow[row] = x;
    rows[i] = row;
  }
  return rows;
}
