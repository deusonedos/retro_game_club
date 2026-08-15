/**
 * Проверка границ суток и сезона.
 *
 * Сброс попыток и старт сезона считаются по Москве (UTC+3), а хранится всё в
 * UTC. Здесь ошибка не падает, а тихо выдаёт лишние попытки или рвёт сезон
 * посередине — поэтому граничные моменты проверяются явно.
 */
import assert from 'node:assert/strict';
import {
  currentDayStart,
  currentSeasonEnd,
  currentSeasonStart,
  nextDailyReset,
} from '../.tmp-test/api/config.js';

const DAY = 86400000;
const MSK = 3 * 60 * 60 * 1000;

/** Разложение момента по московскому календарю. */
function msk(date) {
  const d = new Date(date.getTime() + MSK);
  return {
    weekday: d.getUTCDay(), // 1 = понедельник
    hours: d.getUTCHours(),
    minutes: d.getUTCMinutes(),
    date: d.getUTCDate(),
  };
}

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

test('полночь по Москве — это 21:00 UTC предыдущих суток', () => {
  // 00:30 МСК 13 августа
  const start = currentDayStart(new Date('2026-08-12T21:30:00Z'));
  assert.equal(start.toISOString(), '2026-08-12T21:00:00.000Z');
});

test('23:30 МСК ещё относится к текущим суткам, а не к следующим', () => {
  // 20:30 UTC = 23:30 МСК 12 августа — сутки начались накануне в 21:00 UTC
  const start = currentDayStart(new Date('2026-08-12T20:30:00Z'));
  assert.equal(start.toISOString(), '2026-08-11T21:00:00.000Z');
});

test('UTC-полночь попадает в те же московские сутки, что и 03:00 МСК', () => {
  // Ловушка расчёта в UTC: 00:00 UTC — это уже 03:00 МСК того же дня.
  const a = currentDayStart(new Date('2026-08-13T00:00:00Z'));
  const b = currentDayStart(new Date('2026-08-13T00:30:00Z'));
  assert.equal(a.toISOString(), b.toISOString());
  assert.equal(msk(a).hours, 0);
});

test('сутки всегда содержат текущий момент и длятся ровно 24 часа', () => {
  for (let i = 0; i < 500; i++) {
    const t = new Date(Date.UTC(2026, 0, 1) + Math.floor(Math.random() * 365 * DAY));
    const start = currentDayStart(t);
    const end = nextDailyReset(t);
    assert.ok(start <= t && t < end, `момент ${t.toISOString()} вне своих суток`);
    assert.equal(end - start, DAY);
    assert.equal(msk(start).hours, 0);
    assert.equal(msk(start).minutes, 0);
  }
});

test('сезон начинается в понедельник 00:00 МСК и длится 7 дней', () => {
  for (let i = 0; i < 500; i++) {
    const t = new Date(Date.UTC(2026, 0, 1) + Math.floor(Math.random() * 365 * DAY));
    const start = currentSeasonStart(t);
    const end = currentSeasonEnd(t);
    const m = msk(start);
    assert.equal(m.weekday, 1, `сезон стартует не в понедельник: ${start.toISOString()}`);
    assert.equal(m.hours, 0);
    assert.equal(m.minutes, 0);
    assert.ok(start <= t && t < end, `момент ${t.toISOString()} вне своего сезона`);
    assert.equal(end - start, 7 * DAY);
  }
});

test('переход сезона происходит ровно в понедельник 00:00 МСК', () => {
  // 2026-08-16 — воскресенье. 23:59 МСК = 20:59 UTC.
  const sundayLate = currentSeasonStart(new Date('2026-08-16T20:59:00Z'));
  // Через две минуты уже понедельник 00:01 МСК.
  const mondayEarly = currentSeasonStart(new Date('2026-08-16T21:01:00Z'));

  assert.notEqual(sundayLate.toISOString(), mondayEarly.toISOString());
  assert.equal(mondayEarly - sundayLate, 7 * DAY);
  assert.equal(msk(mondayEarly).weekday, 1);
});

console.log(`\n${passed} тестов пройдено`);
