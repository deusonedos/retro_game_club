/** Продуктовые константы. Решения зафиксированы в DECISIONS.md. */

/** Попытки на каждую игру отдельно, не общий пул. */
export const FREE_ATTEMPTS_PER_DAY = 7;

/**
 * Единая временная база для сброса попыток и границ сезона — Москва.
 *
 * Пояс фиксированный, а не локальный у игрока: локальный подделывается сменой
 * часового пояса на телефоне. У Москвы с 2014 года нет перехода на летнее
 * время, поэтому смещение — константа, и граничных багов дважды в год не будет.
 * Для пояса с DST такой расчёт был бы неверен.
 */
export const RESET_TIMEZONE = 'Europe/Moscow';
const OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Сезон — 7 дней, старт в понедельник 00:00 МСК. */
export const SEASON_LENGTH_DAYS = 7;

/** Сколько призовых мест делят фонд сезона. */
export const PRIZE_PLACES = 3;

export const PRO_PRICE_RUB = 40;
export const PRO_PERIOD = 'неделя';
export const TRIAL_DAYS = 3;

/** Пока идёт бета, PRO выдаётся бесплатно по кнопке. */
export const IS_BETA = true;

/**
 * Кому доступна админка. Здесь — только для дев-режима: в проде проверка
 * обязана быть серверной, клиентский список правится через консоль.
 * Заменить на свой telegram id перед деплоем.
 */
export const ADMIN_IDS: number[] = [1];

/** Сколько строк лидерборда видит free-пользователь (остальное под замком). */
export const FREE_LEADERBOARD_PREVIEW = 3;

/** Начало текущих суток по московскому времени, как момент в UTC. */
export function currentDayStart(now = new Date()): Date {
  const shifted = new Date(now.getTime() + OFFSET_MS);
  const midnight = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  return new Date(midnight - OFFSET_MS);
}

export function nextDailyReset(now = new Date()): Date {
  return new Date(currentDayStart(now).getTime() + DAY_MS);
}

/** Понедельник 00:00 МСК текущего сезона. */
export function currentSeasonStart(now = new Date()): Date {
  const dayStart = currentDayStart(now);
  const shifted = new Date(dayStart.getTime() + OFFSET_MS);
  const dow = (shifted.getUTCDay() + 6) % 7; // 0 = понедельник
  return new Date(dayStart.getTime() - dow * DAY_MS);
}

export function currentSeasonEnd(now = new Date()): Date {
  return new Date(currentSeasonStart(now).getTime() + SEASON_LENGTH_DAYS * DAY_MS);
}
