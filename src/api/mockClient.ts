import { tgUser } from '../telegram/webapp';
import {
  ADMIN_IDS,
  FREE_ATTEMPTS_PER_DAY,
  PRIZE_PLACES,
  currentDayStart,
  currentSeasonEnd,
  currentSeasonStart,
  nextDailyReset,
} from './config';
import type {
  AdminUserRow,
  ApiClient,
  AttemptState,
  Entitlement,
  EntitlementSource,
  Leaderboard,
  LeaderboardEntry,
  Profile,
  RoundResult,
  Tier,
} from './types';

/**
 * Реализация ApiClient поверх localStorage.
 *
 * Зачем: экраны, лимиты попыток, рейтинг и админка работают целиком на клиенте,
 * пока нет бэкенда. Заменяется на Supabase без правок UI.
 *
 * ВАЖНО: только для разработки. В проде и списание попыток, и запись очков,
 * и проверка прав админа обязаны жить на сервере.
 */

const KEY = 'rgc.mock.v2';

interface StoredUser {
  userId: number;
  name: string;
  username?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  betaOfferAccepted: boolean;
  coins: number;
}

interface DayCounter {
  /** ISO начала суток, к которым относится счётчик. */
  day: string;
  used: number;
}

interface SeasonScore {
  season: string;
  total: number;
  best: number;
}

interface Store {
  users: Record<string, StoredUser>;
  entitlements: Entitlement[];
  /** Ключ — `${userId}:${gameId}`. */
  attempts: Record<string, DayCounter>;
  scores: Record<string, SeasonScore>;
  roundsTotal: Record<string, number>;
}

/** Соперники в дев-режиме: они же наполняют список в админке. */
const SEED_RIVALS: Array<[number, string, string | undefined, number]> = [
  [1001, 'Мария К.', 'maria_k', 18420],
  [1002, 'nikita_z', 'nikita_z', 16780],
  [1003, 'Дима', undefined, 15390],
  [1004, 'pixel_wolf', 'pixel_wolf', 14120],
  [1005, 'Алина', 'alina', 12960],
  [1006, 'stas.exe', 'stasexe', 11470],
  [1007, 'Роман', undefined, 9840],
  [1008, 'kate_99', 'kate99', 8210],
  [1009, 'Тимур', 'timur', 6930],
  [1010, 'vova', 'vova', 5480],
];

const GAME = 'bubble-blast';
const now = () => new Date().toISOString();
const uid = () => Math.random().toString(36).slice(2, 10);

function seed(): Store {
  const store: Store = { users: {}, entitlements: [], attempts: {}, scores: {}, roundsTotal: {} };
  const season = currentSeasonStart().toISOString();
  const t = now();

  for (const [id, name, username, score] of SEED_RIVALS) {
    store.users[id] = {
      userId: id,
      name,
      username,
      firstSeenAt: t,
      lastSeenAt: new Date(Date.now() - Math.random() * 3 * 86400000).toISOString(),
      betaOfferAccepted: true,
      coins: 0,
    };
    store.entitlements.push({
      id: uid(),
      userId: id,
      source: 'beta',
      startsAt: t,
      endsAt: null,
      revokedAt: null,
    });
    store.scores[`${id}:${GAME}`] = { season, total: score, best: Math.round(score / 6) };
    store.roundsTotal[id] = Math.round(score / 900);
  }
  return store;
}

function load(): Store {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '');
    if (parsed && typeof parsed === 'object' && parsed.users) return parsed as Store;
  } catch {
    /* пустое или битое хранилище — засеваем заново */
  }
  const fresh = seed();
  save(fresh);
  return fresh;
}

function save(s: Store): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}

const delay = <T>(value: T, ms = 120): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

// ---------- выдачи PRO ----------

const isActive = (e: Entitlement, at = Date.now()): boolean =>
  e.revokedAt === null &&
  new Date(e.startsAt).getTime() <= at &&
  (e.endsAt === null || new Date(e.endsAt).getTime() > at);

/** Действующая выдача пользователя. Статус PRO — это её наличие, а не поле. */
function activeEntitlement(store: Store, userId: number): Entitlement | null {
  return store.entitlements.find((e) => e.userId === userId && isActive(e)) ?? null;
}

const tierOf = (store: Store, userId: number): Tier =>
  activeEntitlement(store, userId) ? 'pro' : 'free';

function grant(store: Store, userId: number, source: EntitlementSource, grantedBy?: number): void {
  store.entitlements.push({
    id: uid(),
    userId,
    source,
    startsAt: now(),
    endsAt: null,
    revokedAt: null,
    grantedBy,
  });
}

/** Отзыв не удаляет записи — проставляет revokedAt, чтобы история осталась. */
function revokeAll(store: Store, userId: number): void {
  const stamp = now();
  for (const e of store.entitlements) {
    if (e.userId === userId && isActive(e)) e.revokedAt = stamp;
  }
}

// ---------- пользователи ----------

function currentUser(store: Store): StoredUser {
  const id = tgUser.id;
  const existing = store.users[id];
  if (existing) return existing;

  const created: StoredUser = {
    userId: id,
    name: [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' '),
    username: tgUser.username,
    firstSeenAt: now(),
    lastSeenAt: now(),
    betaOfferAccepted: false,
    coins: 0,
  };
  store.users[id] = created;
  return created;
}

function profileOf(store: Store, user: StoredUser): Profile {
  const ent = activeEntitlement(store, user.userId);
  return {
    userId: user.userId,
    name: user.name,
    username: user.username,
    tier: ent ? 'pro' : 'free',
    proSource: ent?.source ?? null,
    proEndsAt: ent?.endsAt ?? null,
    betaOfferAccepted: user.betaOfferAccepted,
    coins: user.coins,
  };
}

function counterFor(store: Store, userId: number, gameId: string): DayCounter {
  const day = currentDayStart().toISOString();
  const key = `${userId}:${gameId}`;
  const existing = store.attempts[key];
  if (!existing || existing.day !== day) store.attempts[key] = { day, used: 0 };
  return store.attempts[key];
}

function scoreFor(store: Store, userId: number, gameId: string): SeasonScore {
  const season = currentSeasonStart().toISOString();
  const key = `${userId}:${gameId}`;
  const existing = store.scores[key];
  if (!existing || existing.season !== season) store.scores[key] = { season, total: 0, best: 0 };
  return store.scores[key];
}

function attemptState(store: Store, userId: number, gameId: string): AttemptState {
  const counter = counterFor(store, userId, gameId);
  return {
    gameId,
    remaining: tierOf(store, userId) === 'pro' ? null : Math.max(0, FREE_ATTEMPTS_PER_DAY - counter.used),
    limit: FREE_ATTEMPTS_PER_DAY,
    resetsAt: nextDailyReset().toISOString(),
  };
}

function adminRow(store: Store, user: StoredUser): AdminUserRow {
  const ent = activeEntitlement(store, user.userId);
  return {
    userId: user.userId,
    name: user.name,
    username: user.username,
    tier: ent ? 'pro' : 'free',
    proSource: ent?.source ?? null,
    firstSeenAt: user.firstSeenAt,
    lastSeenAt: user.lastSeenAt,
    roundsTotal: store.roundsTotal[user.userId] ?? 0,
  };
}

export const mockClient: ApiClient = {
  async touchSession() {
    const store = load();
    const user = currentUser(store);
    user.lastSeenAt = now();
    save(store);
    return delay(profileOf(store, user));
  },

  async getProfile() {
    const store = load();
    const user = currentUser(store);
    save(store);
    return delay(profileOf(store, user));
  },

  async getAttempts(gameId) {
    const store = load();
    const user = currentUser(store);
    const state = attemptState(store, user.userId, gameId);
    save(store);
    return delay(state);
  },

  async consumeAttempt(gameId) {
    const store = load();
    const user = currentUser(store);
    if (tierOf(store, user.userId) === 'pro') {
      save(store);
      return delay(attemptState(store, user.userId, gameId));
    }

    const counter = counterFor(store, user.userId, gameId);
    if (counter.used >= FREE_ATTEMPTS_PER_DAY) {
      save(store);
      return delay(null);
    }
    counter.used += 1;
    save(store);
    return delay(attemptState(store, user.userId, gameId));
  },

  async submitScore(gameId, score) {
    const store = load();
    const user = currentUser(store);
    const entry = scoreFor(store, user.userId, gameId);
    const counted = tierOf(store, user.userId) === 'pro';
    if (counted) {
      entry.total += score;
      entry.best = Math.max(entry.best, score);
    }
    store.roundsTotal[user.userId] = (store.roundsTotal[user.userId] ?? 0) + 1;
    save(store);
    return delay<RoundResult>({
      score,
      personalBest: Math.max(entry.best, score),
      seasonTotal: entry.total,
      counted,
    });
  },

  async getLeaderboard(gameId) {
    const store = load();
    const user = currentUser(store);
    const eligible = tierOf(store, user.userId) === 'pro';

    const rows = Object.values(store.users)
      .filter((u) => tierOf(store, u.userId) === 'pro')
      .map((u) => ({
        userId: u.userId,
        name: u.name || 'Игрок',
        score: scoreFor(store, u.userId, gameId).total,
        isSelf: u.userId === user.userId,
      }))
      .filter((row) => row.score > 0);

    rows.sort((a, b) => b.score - a.score);
    const entries: LeaderboardEntry[] = rows.map((r, i) => ({ ...r, rank: i + 1 }));
    save(store);

    return delay<Leaderboard>({
      gameId,
      seasonStart: currentSeasonStart().toISOString(),
      seasonEnd: currentSeasonEnd().toISOString(),
      prizeFund: 0,
      prizePlaces: PRIZE_PLACES,
      entries,
      self: entries.find((e) => e.isSelf) ?? null,
      selfEligible: eligible,
    });
  },

  async acceptBetaPro() {
    const store = load();
    const user = currentUser(store);
    user.betaOfferAccepted = true;
    if (!activeEntitlement(store, user.userId)) grant(store, user.userId, 'beta');
    save(store);
    return delay(profileOf(store, user));
  },

  async startProCheckout() {
    // В проде здесь запрос к бэкенду → Tribute Shop API → webappPaymentUrl.
    return delay({ paymentUrl: 'https://t.me/tribute/app?startapp=mock' });
  },

  async isAdmin() {
    return delay(ADMIN_IDS.includes(tgUser.id));
  },

  async adminListUsers() {
    const store = load();
    currentUser(store);
    save(store);
    const rows = Object.values(store.users)
      .map((u) => adminRow(store, u))
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
    return delay(rows);
  },

  async adminSetTier(userId, tier) {
    const store = load();
    const user = store.users[userId];
    if (!user) throw new Error(`Нет пользователя ${userId}`);

    if (tier === 'pro') {
      if (!activeEntitlement(store, userId)) grant(store, userId, 'admin', tgUser.id);
    } else {
      revokeAll(store, userId);
    }
    save(store);
    return delay(adminRow(store, user));
  },

  async adminUserEntitlements(userId) {
    const store = load();
    const list = store.entitlements
      .filter((e) => e.userId === userId)
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt));
    return delay(list);
  },
};
