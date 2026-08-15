/**
 * Проверка чистой логики гексагональной сетки Bubble Blast.
 * Запуск: npm test
 *
 * Главная проверка — геометрическая: соседство из neighbors() сверяется с
 * реальными расстояниями между центрами шаров. Если формула смещения строк
 * поедет, тест это поймает, а не глаз на скриншоте.
 */
import assert from 'node:assert/strict';
import { EMPTY, floatingCells, neighbors, sameColorGroup } from '../.tmp-test/games/bubble-blast/grid.js';

const COLS = 8;
const SQRT3 = Math.sqrt(3);

/** Поле из n строк с чередующимся смещением, как его строит движок. */
function makeRows(n, fill = 0) {
  return Array.from({ length: n }, (_, i) => {
    const offset = i % 2 === 1;
    return { offset, cells: new Array(offset ? COLS - 1 : COLS).fill(fill) };
  });
}

const centre = (rows, ri, ci) => ({
  x: 1 + ci * 2 + (rows[ri].offset ? 1 : 0),
  y: 1 + ri * SQRT3,
});

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

test('соседи совпадают с ячейками на геометрическом расстоянии 2r', () => {
  const rows = makeRows(6);
  for (let ri = 0; ri < rows.length; ri++) {
    for (let ci = 0; ci < rows[ri].cells.length; ci++) {
      const fromGeometry = [];
      for (let y = 0; y < rows.length; y++) {
        for (let x = 0; x < rows[y].cells.length; x++) {
          if (y === ri && x === ci) continue;
          if (Math.abs(dist(centre(rows, ri, ci), centre(rows, y, x)) - 2) < 1e-6) {
            fromGeometry.push(`${y}:${x}`);
          }
        }
      }
      const fromCode = neighbors(rows, ri, ci).map(([y, x]) => `${y}:${x}`);
      assert.deepEqual(
        [...fromCode].sort(),
        [...fromGeometry].sort(),
        `ячейка ${ri}:${ci} — соседи не совпали с геометрией`,
      );
    }
  }
});

test('соседство симметрично', () => {
  const rows = makeRows(6);
  for (let ri = 0; ri < rows.length; ri++) {
    for (let ci = 0; ci < rows[ri].cells.length; ci++) {
      for (const [y, x] of neighbors(rows, ri, ci)) {
        const back = neighbors(rows, y, x).some(([a, b]) => a === ri && b === ci);
        assert.ok(back, `${ri}:${ci} ↔ ${y}:${x} несимметрично`);
      }
    }
  }
});

test('у внутренней ячейки ровно 6 соседей', () => {
  const rows = makeRows(6);
  assert.equal(neighbors(rows, 2, 3).length, 6);
  assert.equal(neighbors(rows, 3, 3).length, 6);
});

test('sameColorGroup собирает связную группу одного цвета', () => {
  const rows = makeRows(4, 9); // 9 — «чужой» цвет-фон
  // Треугольник: две ячейки в строке 1 и одна под ними в строке 2.
  rows[1].cells[2] = 1;
  rows[1].cells[3] = 1;
  rows[2].cells[3] = 1;
  const group = sameColorGroup(rows, 1, 2);
  assert.equal(group.length, 3);
  assert.deepEqual(group.map(([y, x]) => `${y}:${x}`).sort(), ['1:2', '1:3', '2:3']);
});

test('sameColorGroup не перепрыгивает через другой цвет', () => {
  const rows = makeRows(4, 9);
  rows[0].cells[0] = 1;
  rows[0].cells[3] = 1; // изолирована
  assert.equal(sameColorGroup(rows, 0, 0).length, 1);
});

test('floatingCells находит оторванную от потолка гроздь', () => {
  const rows = makeRows(4, EMPTY);
  rows[0].cells[0] = 1; // держится за потолок
  rows[2].cells[5] = 2; // висит в воздухе
  rows[3].cells[5] = 2;
  const floating = floatingCells(rows).map(([y, x]) => `${y}:${x}`).sort();
  assert.deepEqual(floating, ['2:5', '3:5']);
});

test('floatingCells не трогает то, что связано с потолком', () => {
  const rows = makeRows(4, 1);
  assert.equal(floatingCells(rows).length, 0);
});

console.log(`\n${passed} тестов пройдено`);
