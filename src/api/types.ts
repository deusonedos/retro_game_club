export type Tier = 'free' | 'pro';

/**
 * Откуда у пользователя взялся PRO.
 *
 * Ключевое решение схемы: статус подписки НЕ хранится полем `tier`, а выводится
 * из набора «выдач». Иначе ручное переключение из админки и вебхук платёжки
 * начинают перетирать друг друга, и причина статуса теряется.
 *
 * Побочная выгода: список бета-пользователей для перевода на платный тариф —
 * это запрос `source = 'beta'` среди действующих, забыть их невозможно.
 */
export type EntitlementSource = 'beta' | 'admin' | 'tribute' | 'promo';

export interface Entitlement {
  id: string;
  userId: number;
  source: EntitlementSource;
  startsAt: string;
  /** null — бессрочно (бета, ручная выдача без срока). */
  endsAt: string | null;
  /** Проставляется вместо удаления: история выдач не переписывается. */
  revokedAt: string | null;
  /** Кто выдал — telegram id админа. Для платежей не заполняется. */
  grantedBy?: number;
  /** Идентификатор платежа у провайдера. */
  externalId?: string;
  note?: string;
}

export interface Profile {
  userId: number;
  name: string;
  username?: string;
  /** Выводится из действующих выдач, а не хранится. */
  tier: Tier;
  /** Основание текущего PRO. null для free. */
  proSource: EntitlementSource | null;
  /** ISO-дата окончания текущей выдачи; null — бессрочно. */
  proEndsAt: string | null;
  /** Уже нажимал «Перейти на PRO» в бете — второй раз оффер не показываем. */
  betaOfferAccepted: boolean;
  /** Внутриигровая валюта. */
  coins: number;
}

export interface AttemptState {
  gameId: string;
  /** Для PRO — null (безлимит). */
  remaining: number | null;
  limit: number;
  /** ISO-дата, когда счётчик обнулится. */
  resetsAt: string;
}

export interface LeaderboardEntry {
  rank: number;
  userId: number;
  name: string;
  score: number;
  isSelf: boolean;
}

export interface Leaderboard {
  gameId: string;
  seasonStart: string;
  seasonEnd: string;
  /** Фонд сезона в рублях. 0 — пока не объявлен. */
  prizeFund: number;
  /** Сколько мест делят фонд. */
  prizePlaces: number;
  entries: LeaderboardEntry[];
  /** Позиция игрока. null если он ещё не играл в этом сезоне. */
  self: LeaderboardEntry | null;
  /** false для free-тарифа: очки не попадают в зачёт сезона. */
  selfEligible: boolean;
}

export interface RoundResult {
  score: number;
  /** Лучший результат за раунд в этом сезоне. */
  personalBest: number;
  /** Сумма очков за сезон после засчитывания раунда. */
  seasonTotal: number;
  /** false, если раунд не пошёл в зачёт (free-тариф). */
  counted: boolean;
}

/** Строка списка в админке. */
export interface AdminUserRow {
  userId: number;
  name: string;
  username?: string;
  tier: Tier;
  proSource: EntitlementSource | null;
  firstSeenAt: string;
  lastSeenAt: string;
  roundsTotal: number;
}

/**
 * Контракт бэкенда. Сейчас реализован моком на localStorage;
 * при переезде на Supabase меняется только реализация.
 */
export interface ApiClient {
  /** Регистрирует вход и обновляет lastSeenAt. Вызывается при старте. */
  touchSession(): Promise<Profile>;
  getProfile(): Promise<Profile>;

  getAttempts(gameId: string): Promise<AttemptState>;
  /** Списывает попытку. Возвращает null, если попыток не осталось. */
  consumeAttempt(gameId: string): Promise<AttemptState | null>;
  submitScore(gameId: string, score: number): Promise<RoundResult>;
  getLeaderboard(gameId: string): Promise<Leaderboard>;

  /** Игрок принял бета-оффер: выдача PRO с источником 'beta'. */
  acceptBetaPro(): Promise<Profile>;

  /** Заглушка платежа: в проде вернёт Tribute `webappPaymentUrl`. */
  startProCheckout(): Promise<{ paymentUrl: string }>;

  /** Проверяется на сервере по telegram id — клиентскому флагу доверять нельзя. */
  isAdmin(): Promise<boolean>;
  adminListUsers(): Promise<AdminUserRow[]>;
  /** Ручная выдача/отзыв PRO с источником 'admin'. */
  adminSetTier(userId: number, tier: Tier): Promise<AdminUserRow>;
  /** История выдач пользователя — видно, почему у него текущий статус. */
  adminUserEntitlements(userId: number): Promise<Entitlement[]>;
}
