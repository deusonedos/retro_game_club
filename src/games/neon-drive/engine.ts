import { haptic } from '../../telegram/webapp';
import type { GameHandle, GameHooks } from '../types';

/**
 * Neon Drive — бесконечная гонка по ночному шоссе.
 *
 * Палец ведёт машину поперёк дороги, встречный трафик надо объезжать.
 * Счёт растёт с расстоянием, а разъезд в притирку даёт бонус — именно он
 * превращает осторожную езду в рискованную, а рискованную в смотрибельную.
 *
 * Управление ведением, а не тапом по полосам: свободное положение поперёк
 * дороги позволяет проходить впритирку намеренно. С дискретными полосами
 * разъезд получается случайно, а случайное не хочется повторять.
 */

/** Доля ширины экрана под дорогу. */
const ROAD_RATIO = 0.86;
/** Полос для расстановки трафика. Машина ездит свободно, полосы — только сетка спавна. */
const LANES = 4;

/**
 * Ширина машины от ширины дороги и её вытянутость.
 *
 * Машина заметно уже полосы намеренно: между соседними рядами обязан
 * оставаться проезд, иначе разъезд в притирку физически невозможен, а на
 * нём держится и счёт, и вся зрелищность.
 */
const CAR_W_RATIO = 0.165;
const CAR_ASPECT = 1.85;

/** Стартовая и предельная скорость в высотах экрана в секунду. */
const SPEED_START = 0.75;
const SPEED_MAX = 2.6;
/** За сколько секунд скорость доходит до предельной. */
const SPEED_RAMP_SEC = 150;

/** Зазор, который считается разъездом в притирку (доля ширины машины). */
const NEAR_MISS_RATIO = 0.45;

interface CarPaint {
  fill: [string, string];
  glow: string;
}

const TRAFFIC_COLORS: CarPaint[] = [
  { fill: ['#ff2e88', '#c4116a'], glow: 'rgba(255,46,136,0.6)' },
  { fill: ['#ffb703', '#d99400'], glow: 'rgba(255,183,3,0.6)' },
  { fill: ['#b98cff', '#7b4fd6'], glow: 'rgba(185,140,255,0.6)' },
  { fill: ['#28e0ff', '#0f9fc4'], glow: 'rgba(40,224,255,0.6)' },
];

const PLAYER_PAINT: CarPaint = { fill: ['#9dff5c', '#6fce2e'], glow: 'rgba(157,255,92,0.7)' };

interface Car {
  x: number;
  y: number;
  color: number;
  /** Бонус за разъезд уже начислен — второй раз не считаем. */
  scored: boolean;
}

interface Popup {
  x: number;
  y: number;
  text: string;
  life: number;
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

export function createNeonDrive(canvas: HTMLCanvasElement, hooks: GameHooks): GameHandle {
  const ctx = canvas.getContext('2d')!;

  let width = 0;
  let height = 0;
  let roadL = 0;
  let roadR = 0;
  let carW = 0;
  let carH = 0;

  let playerX = 0;
  let targetX = 0;
  let holding = false;

  let traffic: Car[] = [];
  let popups: Popup[] = [];
  let sparks: Spark[] = [];

  let elapsed = 0;
  let distance = 0;
  let dashOffset = 0;
  let nextRowIn = 0;
  let score = 0;
  let nearMisses = 0;
  let shake = 0;
  let over = false;
  let raf = 0;
  let lastTs = 0;

  // ---------- размеры ----------

  function resize(): void {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = rect.width;
    height = rect.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const roadW = width * ROAD_RATIO;
    roadL = (width - roadW) / 2;
    roadR = roadL + roadW;
    carW = roadW * CAR_W_RATIO;
    carH = carW * CAR_ASPECT;
  }

  const playerY = () => height - carH * 1.4;
  const laneX = (i: number) => roadL + ((roadR - roadL) / LANES) * (i + 0.5);

  /** Скорость нарастает, иначе счёт мерит усидчивость, а не реакцию. */
  const speed = () =>
    height * (SPEED_START + (SPEED_MAX - SPEED_START) * Math.min(1, elapsed / SPEED_RAMP_SEC));

  // ---------- ход игры ----------

  function reset(): void {
    playerX = width / 2;
    targetX = playerX;
    traffic = [];
    popups = [];
    sparks = [];
    elapsed = 0;
    distance = 0;
    dashOffset = 0;
    // Короткая пауза перед первой машиной: успеть положить палец, но не
    // смотреть на пустую дорогу — это мёртвое время в начале каждого раунда.
    nextRowIn = 0.55;
    score = 0;
    nearMisses = 0;
    shake = 0;
    over = false;
    hooks.onScore(0);
    hooks.onLevel?.(0);
  }

  /**
   * Ряд трафика. Занятых полос всегда меньше, чем всего, — проезд обязан
   * существовать. Иначе смерть окажется неизбежной, а неизбежную смерть
   * игрок считает нечестной и уходит.
   */
  function spawnRow(): void {
    const hard = Math.min(1, elapsed / 90);
    const occupied = 1 + Math.floor(Math.random() * (1 + Math.round(hard * 1.9)));
    const lanes = [0, 1, 2, 3].sort(() => Math.random() - 0.5).slice(0, Math.min(occupied, LANES - 1));

    for (const l of lanes) {
      traffic.push({
        x: laneX(l),
        y: -carH,
        color: Math.floor(Math.random() * TRAFFIC_COLORS.length),
        scored: false,
      });
    }
  }

  function crash(): void {
    over = true;
    shake = 1;
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = width * (0.15 + Math.random() * 0.5);
      sparks.push({
        x: playerX,
        y: playerY(),
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 1,
        size: width * (0.005 + Math.random() * 0.01),
        color: i % 3 === 0 ? '#ffb703' : '#ff2e88',
      });
    }
    haptic.error();
    hooks.onGameOver(score);
  }

  function step(dt: number): void {
    if (over) {
      for (const s of sparks) {
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vy += height * 1.5 * dt;
        s.life -= dt * 1.2;
      }
      sparks = sparks.filter((s) => s.life > 0);
      shake = Math.max(0, shake - dt * 3);
      return;
    }

    elapsed += dt;
    const v = speed();
    distance += v * dt;
    dashOffset = (dashOffset + v * dt) % (height * 0.12);

    // Машина тянется к пальцу, а не прыгает: рывок сбивал бы прицел
    // на разъездах в притирку.
    if (holding) playerX += (targetX - playerX) * Math.min(1, dt * 16);
    playerX = Math.max(roadL + carW / 2, Math.min(roadR - carW / 2, playerX));

    nextRowIn -= dt;
    if (nextRowIn <= 0) {
      spawnRow();
      // Плотность растёт вместе со скоростью, но не быстрее — иначе
      // проезд физически перестаёт существовать.
      const gap = 0.95 - Math.min(0.45, elapsed / 240);
      nextRowIn = gap;
    }

    const py = playerY();
    for (const c of traffic) {
      c.y += v * dt;

      const dx = Math.abs(c.x - playerX);
      const dy = Math.abs(c.y - py);

      if (dx < carW * 0.86 && dy < carH * 0.82) {
        crash();
        return;
      }

      // Разъезд засчитывается, когда встречная уже позади: иначе бонус
      // капал бы за приближение, а не за пройденный риск.
      if (!c.scored && c.y > py + carH * 0.5) {
        c.scored = true;
        if (dx < carW * (1 + NEAR_MISS_RATIO)) {
          nearMisses++;
          score += 25;
          popups.push({ x: c.x, y: py, text: '+25', life: 1 });
          haptic.tap();
          hooks.onLevel?.(nearMisses);
        }
      }
    }
    traffic = traffic.filter((c) => c.y < height + carH);

    for (const p of popups) {
      p.y -= height * 0.25 * dt;
      p.life -= dt * 1.4;
    }
    popups = popups.filter((p) => p.life > 0);

    const next = Math.floor(distance / (height * 0.5));
    if (next * 10 !== score - nearMisses * 25) {
      score = next * 10 + nearMisses * 25;
      hooks.onScore(score);
    }
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

  function drawCar(x: number, y: number, paint: CarPaint): void {
    ctx.save();
    ctx.shadowColor = paint.glow;
    ctx.shadowBlur = 18;
    const g = ctx.createLinearGradient(0, y - carH / 2, 0, y + carH / 2);
    g.addColorStop(0, paint.fill[0]);
    g.addColorStop(1, paint.fill[1]);
    ctx.fillStyle = g;
    roundedRect(x - carW / 2, y - carH / 2, carW, carH, carW * 0.28);
    ctx.fill();

    // Два тёмных стекла — минимум деталей, при котором прямоугольник
    // начинает читаться машиной. Больше на таком размере не разглядеть.
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.34;
    ctx.fillStyle = '#0a0e1f';
    roundedRect(x - carW * 0.3, y - carH * 0.3, carW * 0.6, carH * 0.17, carW * 0.1);
    ctx.fill();
    roundedRect(x - carW * 0.3, y + carH * 0.12, carW * 0.6, carH * 0.15, carW * 0.1);
    ctx.fill();
    ctx.restore();
  }

  function draw(): void {
    ctx.save();
    if (shake > 0) {
      ctx.translate((Math.random() - 0.5) * shake * width * 0.03, (Math.random() - 0.5) * shake * height * 0.02);
    }

    ctx.clearRect(-width, -height, width * 3, height * 3);

    // Полотно дороги
    ctx.fillStyle = '#0c1128';
    ctx.fillRect(roadL, 0, roadR - roadL, height);

    // Светящиеся обочины
    ctx.save();
    ctx.strokeStyle = '#28e0ff';
    ctx.shadowColor = 'rgba(40,224,255,0.7)';
    ctx.shadowBlur = 14;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(roadL, 0);
    ctx.lineTo(roadL, height);
    ctx.moveTo(roadR, 0);
    ctx.lineTo(roadR, height);
    ctx.stroke();
    ctx.restore();

    // Разметка
    ctx.save();
    ctx.strokeStyle = 'rgba(238,240,251,0.22)';
    ctx.lineWidth = 2;
    ctx.setLineDash([height * 0.05, height * 0.07]);
    ctx.lineDashOffset = -dashOffset;
    for (let i = 1; i < LANES; i++) {
      const x = roadL + ((roadR - roadL) / LANES) * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    ctx.restore();

    for (const c of traffic) drawCar(c.x, c.y, TRAFFIC_COLORS[c.color]);

    if (!over) drawCar(playerX, playerY(), PLAYER_PAINT);

    for (const p of popups) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.font = `800 ${Math.round(height * 0.026)}px Rubik, sans-serif`;
      ctx.fillStyle = '#9dff5c';
      ctx.shadowColor = 'rgba(157,255,92,0.7)';
      ctx.shadowBlur = 12;
      ctx.textAlign = 'center';
      ctx.fillText(p.text, p.x, p.y);
      ctx.restore();
    }

    for (const s of sparks) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, s.life);
      ctx.fillStyle = s.color;
      ctx.shadowColor = s.color;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }

  function frame(ts: number): void {
    const dt = lastTs ? Math.min((ts - lastTs) / 1000, 1 / 20) : 0;
    lastTs = ts;
    step(dt);
    draw();
    raf = requestAnimationFrame(frame);
  }

  // ---------- ввод ----------

  function pointerX(e: PointerEvent): number {
    return e.clientX - canvas.getBoundingClientRect().left;
  }

  const onDown = (e: PointerEvent) => {
    if (over) return;
    holding = true;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* без захвата просто теряем управление при уходе за край */
    }
    targetX = pointerX(e);
  };
  const onMove = (e: PointerEvent) => {
    if (!holding) return;
    e.preventDefault();
    targetX = pointerX(e);
  };
  const onUp = () => {
    holding = false;
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
