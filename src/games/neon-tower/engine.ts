import { haptic } from '../../telegram/webapp';
import type { GameHandle, GameHooks } from '../types';

/**
 * Neon Tower — башня из блоков.
 *
 * Блок ездит вправо-влево, тап кладёт его на башню. Свисающий край
 * отрезается, и следующий блок становится уже. Промахнулся полностью —
 * конец раунда.
 *
 * Почему именно эта механика выбрана флагманом каталога: счёт здесь виден
 * в кадре физически — это высота башни. Ролику не нужны подписи и интерфейс,
 * зритель считает этажи глазами. И промах всегда собственный, а не «не
 * повезло», отчего тянет немедленно переиграть.
 */

/** Высота одного этажа. Всё остальное считается от неё. */
const BLOCK_H_RATIO = 0.052;
/** Стартовая ширина блока от ширины экрана. */
const START_W_RATIO = 0.62;
/** Промах меньше этого (доля от ширины блока) считается идеальным. */
const PERFECT_RATIO = 0.035;
/** За идеальную укладку блок немного отрастает — иначе башня обречена. */
const PERFECT_REGROW_RATIO = 0.12;
/** Уже этого играть невозможно — конец. */
const MIN_W_RATIO = 0.045;

/** Сколько этажей видно снизу, прежде чем камера начинает подниматься. */
const VISIBLE_FLOORS = 9;

/**
 * Пауза после укладки, в течение которой тап не считается.
 *
 * Без неё быстрый двойной тап клал следующий блок сразу после появления —
 * то есть заведомо мимо, и раунд обрывался будто сам собой. Проигрыш обязан
 * ощущаться своей ошибкой, иначе пропадает желание переигрывать.
 */
const INPUT_COOLDOWN_MS = 180;

const COLORS = [
  { fill: ['#ff2e88', '#c4116a'], glow: 'rgba(255,46,136,0.55)' },
  { fill: ['#28e0ff', '#0f9fc4'], glow: 'rgba(40,224,255,0.55)' },
  { fill: ['#9dff5c', '#6fce2e'], glow: 'rgba(157,255,92,0.55)' },
  { fill: ['#ffb703', '#d99400'], glow: 'rgba(255,183,3,0.55)' },
  { fill: ['#b98cff', '#7b4fd6'], glow: 'rgba(185,140,255,0.55)' },
];

interface Block {
  /** Центр по горизонтали. */
  x: number;
  w: number;
  /** Номер этажа, снизу вверх от нуля. */
  floor: number;
  color: number;
}

/** Отрезанный край: падает и гаснет. */
interface Debris {
  x: number;
  y: number;
  w: number;
  vy: number;
  vx: number;
  rot: number;
  vr: number;
  life: number;
  color: number;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  color: string;
}

export function createNeonTower(canvas: HTMLCanvasElement, hooks: GameHooks): GameHandle {
  const ctx = canvas.getContext('2d')!;

  let width = 0;
  let height = 0;
  let blockH = 0;
  let baseY = 0;

  let stack: Block[] = [];
  let moving: Block | null = null;
  let movingDir = 1;
  let movingSpeed = 0;
  let debris: Debris[] = [];
  let sparks: Spark[] = [];

  let cameraY = 0;
  let cameraTarget = 0;
  let score = 0;
  let combo = 0;
  let over = false;
  let flash = 0;
  let raf = 0;
  let lastTs = 0;
  let readyAt = 0;

  // ---------- размеры ----------

  function resize(): void {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = rect.width;
    height = rect.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    blockH = height * BLOCK_H_RATIO;
    baseY = height - blockH * 1.5;
  }

  /** Экранная координата верхнего края этажа. */
  const floorY = (floor: number) => baseY - floor * blockH + cameraY;

  // ---------- ход игры ----------

  function reset(): void {
    stack = [{ x: width / 2, w: width * START_W_RATIO, floor: 0, color: 0 }];
    debris = [];
    sparks = [];
    cameraY = 0;
    cameraTarget = 0;
    score = 0;
    combo = 0;
    over = false;
    flash = 0;
    spawnMoving();
    hooks.onScore(0);
    hooks.onLevel?.(1);
  }

  function spawnMoving(): void {
    const top = stack[stack.length - 1];
    const floor = top.floor + 1;
    // Скорость растёт с высотой: без этого башня становится тестом на
    // терпение, а не на точность, и счёт мерит усидчивость.
    movingSpeed = width * (0.42 + Math.min(floor, 40) * 0.016);
    movingDir = floor % 2 === 0 ? 1 : -1;
    // Появляется у самого края, но целиком в кадре: игрок должен видеть
    // блок с первого мгновения, иначе укладка вслепую.
    moving = {
      x: movingDir > 0 ? top.w / 2 : width - top.w / 2,
      w: top.w,
      floor,
      color: floor % COLORS.length,
    };
    readyAt = performance.now() + INPUT_COOLDOWN_MS;
  }

  function place(): void {
    if (over || !moving || performance.now() < readyAt) return;

    const top = stack[stack.length - 1];
    const dx = moving.x - top.x;
    const overlap = top.w - Math.abs(dx);

    if (overlap <= 0) {
      // Мимо целиком: блок улетает вниз, раунд закончен.
      debris.push(makeDebris(moving.x, floorY(moving.floor), moving.w, moving.color, 0));
      moving = null;
      finish();
      return;
    }

    const perfect = Math.abs(dx) <= top.w * PERFECT_RATIO;
    let newW = overlap;
    let newX = moving.x - dx / 2;

    if (perfect) {
      // Идеально: не режем, а слегка расширяем. Иначе любая башня обречена
      // на конец, и мастерство не отличается от везения.
      newW = Math.min(width * START_W_RATIO, top.w + width * PERFECT_REGROW_RATIO * 0.25);
      newX = top.x;
      combo++;
      score += 40 + combo * 10;
      flash = 1;
      haptic.success();
      spawnSparks(newX, floorY(moving.floor), COLORS[moving.color].fill[0]);
    } else {
      // Отрезанный край падает — это главная обратная связь: видно, сколько
      // именно потеряно.
      const cutW = Math.abs(dx);
      const cutX = dx > 0 ? moving.x + moving.w / 2 - cutW / 2 : moving.x - moving.w / 2 + cutW / 2;
      debris.push(makeDebris(cutX, floorY(moving.floor), cutW, moving.color, Math.sign(dx)));
      combo = 0;
      score += 10;
      haptic.tap();
    }

    stack.push({ x: newX, w: newW, floor: moving.floor, color: moving.color });
    hooks.onScore(score);
    hooks.onLevel?.(stack.length);

    if (newW < width * MIN_W_RATIO) {
      moving = null;
      finish();
      return;
    }

    // Камера едет вверх, оставляя верх башни на постоянной высоте.
    cameraTarget = Math.max(0, (stack.length - VISIBLE_FLOORS) * blockH);
    spawnMoving();
  }

  function makeDebris(x: number, y: number, w: number, color: number, dir: number): Debris {
    return {
      x,
      y,
      w,
      vy: -height * 0.05,
      vx: dir * width * 0.12,
      rot: 0,
      vr: dir * 2.2 || 1.4,
      life: 1,
      color,
    };
  }

  function spawnSparks(x: number, y: number, color: string): void {
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = width * (0.08 + Math.random() * 0.18);
      sparks.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 1,
        size: width * (0.004 + Math.random() * 0.005),
        color,
      });
    }
  }

  function finish(): void {
    over = true;
    haptic.error();
    hooks.onGameOver(score);
  }

  // ---------- шаг ----------

  function step(dt: number): void {
    if (moving && !over) {
      moving.x += movingDir * movingSpeed * dt;
      const limit = moving.w / 2;
      if (moving.x > width - limit) {
        moving.x = width - limit;
        movingDir = -1;
      } else if (moving.x < limit) {
        moving.x = limit;
        movingDir = 1;
      }
    }

    cameraY += (cameraTarget - cameraY) * Math.min(1, dt * 7);

    for (const d of debris) {
      d.vy += height * 2.2 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.rot += d.vr * dt;
      d.life -= dt * 0.7;
    }
    debris = debris.filter((d) => d.life > 0 && d.y < height + cameraY + blockH * 4);

    for (const s of sparks) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += height * 1.2 * dt;
      s.life -= dt * 2;
    }
    sparks = sparks.filter((s) => s.life > 0);

    if (flash > 0) flash = Math.max(0, flash - dt * 3);
  }

  // ---------- отрисовка ----------

  function roundedRect(x: number, y: number, w: number, h: number, r: number): void {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function drawBlock(cx: number, topY: number, w: number, color: number, alpha = 1): void {
    const c = COLORS[color];
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = c.glow;
    ctx.shadowBlur = 16;
    const g = ctx.createLinearGradient(0, topY, 0, topY + blockH);
    g.addColorStop(0, c.fill[0]);
    g.addColorStop(1, c.fill[1]);
    ctx.fillStyle = g;
    roundedRect(cx - w / 2, topY, w, blockH * 0.92, blockH * 0.22);
    ctx.fill();
    ctx.restore();
  }

  function draw(): void {
    ctx.clearRect(0, 0, width, height);

    // Вспышка на идеальной укладке
    if (flash > 0) {
      ctx.save();
      ctx.globalAlpha = flash * 0.16;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }

    // Башня. Рисуем только то, что попадает в кадр: при сотне этажей
    // отрисовывать всё — впустую жечь кадры.
    for (const b of stack) {
      const y = floorY(b.floor);
      if (y > height + blockH || y < -blockH * 2) continue;
      drawBlock(b.x, y, b.w, b.color);
    }

    for (const d of debris) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, d.life);
      ctx.translate(d.x, d.y);
      ctx.rotate(d.rot);
      const c = COLORS[d.color];
      ctx.fillStyle = c.fill[0];
      ctx.shadowColor = c.glow;
      ctx.shadowBlur = 12;
      roundedRect(-d.w / 2, -blockH * 0.46, d.w, blockH * 0.92, blockH * 0.22);
      ctx.fill();
      ctx.restore();
    }

    for (const s of sparks) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, s.life);
      ctx.fillStyle = s.color;
      ctx.shadowColor = s.color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (moving && !over) drawBlock(moving.x, floorY(moving.floor), moving.w, moving.color);

    // Счётчик серии: единственная подсказка, которую стоит показывать.
    if (combo > 1) {
      ctx.save();
      ctx.font = `700 ${Math.round(height * 0.028)}px Rubik, sans-serif`;
      ctx.fillStyle = '#9dff5c';
      ctx.shadowColor = 'rgba(157,255,92,0.6)';
      ctx.shadowBlur = 14;
      ctx.textAlign = 'center';
      ctx.fillText(`×${combo} подряд`, width / 2, height * 0.09);
      ctx.restore();
    }
  }

  function frame(ts: number): void {
    const dt = lastTs ? Math.min((ts - lastTs) / 1000, 1 / 20) : 0;
    lastTs = ts;
    step(dt);
    draw();
    raf = requestAnimationFrame(frame);
  }

  // ---------- ввод ----------

  const onDown = (e: PointerEvent) => {
    e.preventDefault();
    place();
  };

  canvas.addEventListener('pointerdown', onDown);

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
    },
  };
}
