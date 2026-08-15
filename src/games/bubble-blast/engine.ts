import { haptic } from '../../telegram/webapp';
import type { GameHandle, GameHooks } from '../types';
import { EMPTY, floatingCells, sameColorGroup, type Row } from './grid';

/**
 * Bubble Blast — bubble shooter на canvas.
 *
 * Сетка гексагональная: строки чередуют смещение на радиус.
 * Каждая строка знает своё смещение сама (`offset`), а не выводит его из
 * индекса — иначе вставка новой строки сверху ломала бы всю геометрию.
 * Чистая логика соседства и групп живёт в grid.ts и покрыта тестами.
 *
 * Визуальный слой следует дизайн-системе «неоновая ретро-аркада»:
 * шар = радиальный градиент от белого блика к тёмному краю плюс тень
 * собственного цвета (shadowBlur), поп рождает искры.
 */

const COLS = 8;
const START_ROWS = 5;
/** Через сколько выстрелов сверху добавляется новая строка. */
const SHOTS_PER_NEW_ROW = 6;

interface BubbleColor {
  /** [блик → край] для радиального градиента. */
  fill: [string, string];
  /** Цвет неонового ореола вокруг шара. */
  glow: string;
}

const COLORS: BubbleColor[] = [
  { fill: ['#ff2e88', '#c4116a'], glow: 'rgba(255,46,136,0.55)' },
  { fill: ['#28e0ff', '#0f9fc4'], glow: 'rgba(40,224,255,0.55)' },
  { fill: ['#ffb703', '#d99400'], glow: 'rgba(255,183,3,0.55)' },
  { fill: ['#9dff5c', '#6fce2e'], glow: 'rgba(157,255,92,0.55)' },
  { fill: ['#b98cff', '#7b4fd6'], glow: 'rgba(185,140,255,0.55)' },
];

const SQRT3 = Math.sqrt(3);

interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: number;
}

/** Лопнувший или падающий шар — доигрывает анимацию вне сетки. */
interface Popping {
  x: number;
  y: number;
  color: number;
  /** 0 → 1 */
  t: number;
  vy: number;
}

/** Искра от взрыва. */
interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  color: string;
}

const rowLength = (offset: boolean) => (offset ? COLS - 1 : COLS);

export function createBubbleBlast(canvas: HTMLCanvasElement, hooks: GameHooks): GameHandle {
  const ctx = canvas.getContext('2d')!;

  let width = 0;
  let height = 0;
  let r = 0;
  let rowH = 0;
  let topPad = 0;
  let deathLineY = 0;

  let rows: Row[] = [];
  let projectile: Projectile | null = null;
  let popping: Popping[] = [];
  let sparks: Spark[] = [];
  let current = 0;
  let next = 0;
  let score = 0;
  let level = 1;
  let shots = 0;
  let over = false;
  let aiming = false;
  let aimAngle = -Math.PI / 2;
  let raf = 0;
  let lastTs = 0;

  // ---------- геометрия ----------

  const tileX = (row: Row, col: number) => r + col * 2 * r + (row.offset ? r : 0);
  const tileY = (rowIndex: number) => topPad + r + rowIndex * rowH;

  // ---------- построение поля ----------

  function makeRow(offset: boolean, fill: boolean): Row {
    const len = rowLength(offset);
    const cells = new Array<number>(len);
    for (let i = 0; i < len; i++) {
      cells[i] = fill ? Math.floor(Math.random() * paletteSize()) : EMPTY;
    }
    return { offset, cells };
  }

  /** С уровнем растёт число цветов — и вместе с ним сложность. */
  const paletteSize = () => Math.min(3 + Math.floor(level / 2), COLORS.length);

  function reset(): void {
    rows = [];
    for (let i = 0; i < START_ROWS; i++) rows.push(makeRow(i % 2 === 1, true));
    projectile = null;
    popping = [];
    sparks = [];
    score = 0;
    level = 1;
    shots = 0;
    over = false;
    current = randomColorOnBoard();
    next = randomColorOnBoard();
    hooks.onScore(0);
    hooks.onLevel?.(1);
  }

  function colorsOnBoard(): number[] {
    const set = new Set<number>();
    for (const row of rows) for (const c of row.cells) if (c !== EMPTY) set.add(c);
    return [...set];
  }

  /** Не выдаём цвет, которого нет на поле — иначе выстрел заведомо мёртвый. */
  function randomColorOnBoard(): number {
    const present = colorsOnBoard();
    const pool = present.length ? present : [0, 1, 2];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // ---------- размеры ----------

  function resize(): void {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = rect.width;
    height = rect.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    r = width / (COLS * 2);
    rowH = r * SQRT3;
    topPad = r * 0.5;
    deathLineY = height - r * 5;
  }

  const shooterX = () => width / 2;
  const shooterY = () => height - r * 2.2;

  // ---------- логика выстрела ----------

  function shoot(): void {
    if (over || projectile) return;
    const speed = r * 46;
    projectile = {
      x: shooterX(),
      y: shooterY(),
      vx: Math.cos(aimAngle) * speed,
      vy: Math.sin(aimAngle) * speed,
      color: current,
    };
    current = next;
    next = randomColorOnBoard();
    haptic.tap();
  }

  /** Ближайшая свободная ячейка к точке (x, y). */
  function snapTarget(x: number, y: number): [number, number] {
    const approx = Math.round((y - topPad - r) / rowH);
    let best: [number, number] | null = null;
    let bestDist = Infinity;

    for (let ri = approx - 1; ri <= approx + 1; ri++) {
      if (ri < 0) continue;
      while (ri >= rows.length) rows.push(makeRow(!rows[rows.length - 1].offset, false));
      const row = rows[ri];
      for (let ci = 0; ci < row.cells.length; ci++) {
        if (row.cells[ci] !== EMPTY) continue;
        const d = (tileX(row, ci) - x) ** 2 + (tileY(ri) - y) ** 2;
        if (d < bestDist) {
          bestDist = d;
          best = [ri, ci];
        }
      }
    }
    return best ?? [0, 0];
  }

  function place(ri: number, ci: number, color: number): void {
    rows[ri].cells[ci] = color;

    const group = sameColorGroup(rows, ri, ci);
    if (group.length >= 3) {
      for (const [y, x] of group) burst(y, x);
      score += group.length * 10 + (group.length - 3) * 15;
      haptic.hit();
      dropFloating();
    } else {
      haptic.select();
    }

    hooks.onScore(score);
    checkDefeat();
  }

  /** Шары, потерявшие связь с потолком, падают и дают бонус. */
  function dropFloating(): void {
    const floating = floatingCells(rows);
    for (const [ri, ci] of floating) burst(ri, ci, true);
    if (floating.length) score += floating.length * 25;
  }

  function burst(ri: number, ci: number, falling = false): void {
    const row = rows[ri];
    const color = row.cells[ci];
    const x = tileX(row, ci);
    const y = tileY(ri);

    popping.push({ x, y, color, t: 0, vy: falling ? r * 6 : 0 });
    if (!falling) spawnSparks(x, y, COLORS[color].fill[0]);
    row.cells[ci] = EMPTY;
  }

  function spawnSparks(x: number, y: number, color: string): void {
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = r * (2 + Math.random() * 4);
      sparks.push({
        x,
        y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life: 1,
        size: r * (0.1 + Math.random() * 0.12),
        color,
      });
    }
  }

  function pushNewRow(): void {
    const topOffset = rows.length ? !rows[0].offset : false;
    rows.unshift(makeRow(topOffset, true));
    // Хвостовые пустые строки не нужны — иначе поле растёт бесконечно.
    while (rows.length && rows[rows.length - 1].cells.every((c) => c === EMPTY)) rows.pop();
    checkDefeat();
  }

  function checkDefeat(): void {
    if (over) return;
    for (let ri = rows.length - 1; ri >= 0; ri--) {
      if (rows[ri].cells.every((c) => c === EMPTY)) continue;
      if (tileY(ri) + r >= deathLineY) finish();
      return;
    }
    nextLevel();
  }

  /** Поле очищено полностью — награда и новая волна. */
  function nextLevel(): void {
    score += 500;
    level += 1;
    hooks.onScore(score);
    hooks.onLevel?.(level);
    haptic.success();
    rows = [];
    for (let i = 0; i < START_ROWS; i++) rows.push(makeRow(i % 2 === 1, true));
    current = randomColorOnBoard();
    next = randomColorOnBoard();
  }

  function finish(): void {
    over = true;
    haptic.error();
    hooks.onGameOver(score);
  }

  // ---------- цикл ----------

  function step(dt: number): void {
    if (projectile) {
      // Мелкие шаги, чтобы шар не проскакивал сквозь ряд на высокой скорости.
      const steps = Math.max(1, Math.ceil((Math.abs(projectile.vy) * dt) / (r * 0.5)));
      const sub = dt / steps;

      for (let s = 0; s < steps && projectile; s++) {
        projectile.x += projectile.vx * sub;
        projectile.y += projectile.vy * sub;

        if (projectile.x < r) {
          projectile.x = r;
          projectile.vx *= -1;
        } else if (projectile.x > width - r) {
          projectile.x = width - r;
          projectile.vx *= -1;
        }

        let hit = projectile.y <= topPad + r;
        if (!hit) {
          outer: for (let ri = 0; ri < rows.length; ri++) {
            if (Math.abs(tileY(ri) - projectile.y) > 2 * r) continue;
            const row = rows[ri];
            for (let ci = 0; ci < row.cells.length; ci++) {
              if (row.cells[ci] === EMPTY) continue;
              const dx = tileX(row, ci) - projectile.x;
              const dy = tileY(ri) - projectile.y;
              if (dx * dx + dy * dy < (r * 1.8) ** 2) {
                hit = true;
                break outer;
              }
            }
          }
        }

        if (hit) {
          const [ri, ci] = snapTarget(projectile.x, projectile.y);
          const color = projectile.color;
          projectile = null;
          place(ri, ci, color);
          shots++;
          if (!over && shots % SHOTS_PER_NEW_ROW === 0) pushNewRow();
        }
      }
    }

    for (const p of popping) {
      p.t += dt * 3;
      p.y += p.vy * dt;
      p.vy += r * 30 * dt;
    }
    popping = popping.filter((p) => p.t < 1 && p.y < height + r * 2);

    for (const s of sparks) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += r * 22 * dt;
      s.life -= dt * 2.2;
    }
    sparks = sparks.filter((s) => s.life > 0);
  }

  // ---------- отрисовка ----------

  function drawBubble(x: number, y: number, radius: number, colorIdx: number, alpha = 1): void {
    const c = COLORS[colorIdx];
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = c.glow;
    ctx.shadowBlur = 14;
    const g = ctx.createRadialGradient(x - radius * 0.35, y - radius * 0.4, radius * 0.15, x, y, radius);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.18, c.fill[0]);
    g.addColorStop(1, c.fill[1]);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.94, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawAim(): void {
    if (!aiming || projectile || over) return;
    let x = shooterX();
    let y = shooterY();
    let vx = Math.cos(aimAngle);
    const vy = Math.sin(aimAngle);
    const stepLen = r * 0.9;

    ctx.save();
    ctx.strokeStyle = 'rgba(238,240,251,0.35)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let i = 0; i < 60; i++) {
      x += vx * stepLen;
      y += vy * stepLen;
      if (x < r || x > width - r) vx *= -1;
      if (y < topPad + r) break;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawShooter(): void {
    // Основание пушки
    ctx.save();
    ctx.fillStyle = '#161b3a';
    ctx.strokeStyle = '#2c3564';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(shooterX(), shooterY(), r * 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Ствол, повёрнутый по прицелу
    ctx.save();
    ctx.translate(shooterX(), shooterY());
    ctx.rotate(aimAngle + Math.PI / 2);
    ctx.fillStyle = '#3a4380';
    ctx.fillRect(-r * 0.28, -r * 2.1, r * 0.56, r * 1.6);
    ctx.restore();

    drawBubble(shooterX(), shooterY(), r, current);
    drawBubble(shooterX() - r * 2.6, shooterY(), r * 0.6, next, 0.8);
  }

  function draw(): void {
    ctx.clearRect(0, 0, width, height);

    // Линия поражения
    ctx.save();
    ctx.strokeStyle = 'rgba(255,46,136,0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(0, deathLineY);
    ctx.lineTo(width, deathLineY);
    ctx.stroke();
    ctx.restore();

    rows.forEach((row, ri) => {
      const y = tileY(ri);
      row.cells.forEach((c, ci) => {
        if (c !== EMPTY) drawBubble(tileX(row, ci), y, r, c);
      });
    });

    for (const p of popping) {
      drawBubble(p.x, p.y, r * (1 - p.t * 0.6), p.color, 1 - p.t);
    }

    for (const s of sparks) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, s.life);
      ctx.fillStyle = s.color;
      ctx.shadowColor = s.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    drawAim();

    if (projectile) drawBubble(projectile.x, projectile.y, r, projectile.color);
    if (!over) drawShooter();
  }

  function frame(ts: number): void {
    const dt = lastTs ? Math.min((ts - lastTs) / 1000, 1 / 20) : 0;
    lastTs = ts;
    if (!over) step(dt);
    draw();
    raf = requestAnimationFrame(frame);
  }

  // ---------- ввод ----------

  function pointAngle(e: PointerEvent): void {
    const rect = canvas.getBoundingClientRect();
    const dx = e.clientX - rect.left - shooterX();
    const dy = e.clientY - rect.top - shooterY();
    if (dy > -r * 0.5) return; // не даём целиться вбок и вниз
    const a = Math.atan2(dy, dx);
    const limit = (80 * Math.PI) / 180;
    aimAngle = Math.max(-Math.PI / 2 - limit, Math.min(-Math.PI / 2 + limit, a));
  }

  const onDown = (e: PointerEvent) => {
    if (over) return;
    aiming = true;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* не критично: без захвата просто теряем прицел при уходе за край */
    }
    pointAngle(e);
  };
  const onMove = (e: PointerEvent) => {
    if (!aiming) return;
    e.preventDefault();
    pointAngle(e);
  };
  const onUp = () => {
    if (!aiming) return;
    aiming = false;
    shoot();
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove, { passive: false });
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  const observer = new ResizeObserver(() => resize());
  observer.observe(canvas);

  resize();
  reset();
  raf = requestAnimationFrame(frame);

  return {
    destroy() {
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
    },
  };
}
