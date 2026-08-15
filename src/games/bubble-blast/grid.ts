/**
 * Чистая логика гексагональной сетки Bubble Blast: соседство, группы одного
 * цвета, поиск повисших шаров. Без canvas и DOM — поэтому проверяется отдельно
 * от движка (см. scripts/grid.test.mjs).
 */

export const EMPTY = -1;

export interface Row {
  /** true — строка сдвинута вправо на радиус. */
  offset: boolean;
  cells: number[];
}

export type Cell = [row: number, col: number];

/**
 * Соседи ячейки в гекс-сетке.
 *
 * Строка со смещением «нависает» между ячейками соседних строк правее, без
 * смещения — левее. Отсюда две разные пары вертикальных соседей.
 */
export function neighbors(rows: Row[], ri: number, ci: number): Cell[] {
  const row = rows[ri];
  if (!row) return [];
  const [a, b] = row.offset ? [ci, ci + 1] : [ci - 1, ci];
  const candidates: Cell[] = [
    [ri, ci - 1],
    [ri, ci + 1],
    [ri - 1, a],
    [ri - 1, b],
    [ri + 1, a],
    [ri + 1, b],
  ];
  return candidates.filter(([y, x]) => {
    const rr = rows[y];
    return rr !== undefined && x >= 0 && x < rr.cells.length;
  });
}

/** Связная группа ячеек того же цвета, включая стартовую. */
export function sameColorGroup(rows: Row[], ri: number, ci: number): Cell[] {
  const color = rows[ri]?.cells[ci];
  if (color === undefined || color === EMPTY) return [];

  const seen = new Set<string>([`${ri}:${ci}`]);
  const stack: Cell[] = [[ri, ci]];
  const out: Cell[] = [];

  while (stack.length) {
    const cell = stack.pop()!;
    out.push(cell);
    for (const [y, x] of neighbors(rows, cell[0], cell[1])) {
      const key = `${y}:${x}`;
      if (seen.has(key) || rows[y].cells[x] !== color) continue;
      seen.add(key);
      stack.push([y, x]);
    }
  }
  return out;
}

/** Шары, потерявшие связь с верхней строкой, — они должны упасть. */
export function floatingCells(rows: Row[]): Cell[] {
  const anchored = new Set<string>();
  const stack: Cell[] = [];

  rows[0]?.cells.forEach((c, ci) => {
    if (c !== EMPTY) {
      anchored.add(`0:${ci}`);
      stack.push([0, ci]);
    }
  });

  while (stack.length) {
    const [ri, ci] = stack.pop()!;
    for (const [y, x] of neighbors(rows, ri, ci)) {
      const key = `${y}:${x}`;
      if (anchored.has(key) || rows[y].cells[x] === EMPTY) continue;
      anchored.add(key);
      stack.push([y, x]);
    }
  }

  const out: Cell[] = [];
  rows.forEach((row, ri) => {
    row.cells.forEach((c, ci) => {
      if (c !== EMPTY && !anchored.has(`${ri}:${ci}`)) out.push([ri, ci]);
    });
  });
  return out;
}
