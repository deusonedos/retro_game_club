import { initData as rawInitData, tgUser } from '../telegram/webapp';
import { RPC_ENDPOINT, SESSION_ENDPOINT, SUPABASE_PUBLISHABLE_KEY } from './supabaseConfig';
import type {
  AdminUserRow,
  ApiClient,
  AttemptState,
  Entitlement,
  Leaderboard,
  Profile,
  RoundResult,
  Tier,
} from './types';

/**
 * Реализация ApiClient поверх Supabase.
 *
 * Библиотеку supabase-js намеренно не берём: нам нужны только вызовы RPC,
 * а она добавила бы к бандлу больше, чем весит всё приложение целиком.
 * Для Mini App, который открывают с мобильного интернета, это заметно.
 *
 * Сессия: initData обменивается на JWT один раз при старте, дальше все
 * вызовы идут с этим токеном напрямую в Postgres. Личность игрока сервер
 * берёт из подписанного токена, клиент её не передаёт и подделать не может.
 */

interface Session {
  token: string;
  /** Момент истечения в миллисекундах. */
  expiresAt: number;
  startParam: string | null;
}

let session: Session | null = null;
/** Обмен идёт один раз даже при параллельных вызовах. */
let pending: Promise<Session> | null = null;

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function exchangeInitData(): Promise<Session> {
  const res = await fetch(SESSION_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_PUBLISHABLE_KEY },
    body: JSON.stringify({ initData: rawInitData }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(body?.error ?? 'не удалось начать сессию', res.status);
  }

  return {
    token: body.token,
    // Обновляем чуть раньше срока, чтобы не упереться в истёкший токен
    // посреди раунда.
    expiresAt: Date.now() + (body.expiresIn - 60) * 1000,
    startParam: body.startParam ?? null,
  };
}

async function getSession(): Promise<Session> {
  if (session && session.expiresAt > Date.now()) return session;
  if (pending) return pending;

  pending = exchangeInitData()
    .then((s) => {
      session = s;
      return s;
    })
    .finally(() => {
      pending = null;
    });

  return pending;
}

/** Вызов функции в базе. Идентификатор игрока сервер берёт из токена. */
async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { token } = await getSession();

  const res = await fetch(`${RPC_ENDPOINT}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(args),
  });

  if (res.status === 401) {
    // Токен протух между проверкой и запросом — обмениваем и повторяем один раз.
    session = null;
    const retryToken = (await getSession()).token;
    const retry = await fetch(`${RPC_ENDPOINT}/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${retryToken}`,
      },
      body: JSON.stringify(args),
    });
    if (!retry.ok) throw new ApiError(await errorText(retry), retry.status);
    return retry.json();
  }

  if (!res.ok) throw new ApiError(await errorText(res), res.status);
  return res.json();
}

async function errorText(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  return body?.message ?? body?.error ?? `ошибка ${res.status}`;
}

/** Пустой раунд после списанной попытки: сервер ответил «попыток нет». */
interface StartRoundResponse {
  ok: boolean;
  reason?: string;
  roundId?: string;
  gameId?: string;
  remaining: number | null;
  limit: number;
  resetsAt: string;
}

/**
 * roundId живёт здесь, а не в React-состоянии: экран не должен иметь
 * возможности отправить счёт для чужого или уже закрытого раунда.
 */
const activeRounds = new Map<string, string>();

export const supabaseClient: ApiClient = {
  async touchSession() {
    const s = await getSession();
    return rpc<Profile>('touch_session', {
      p_username: tgUser.username ?? null,
      p_first_name: [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || null,
      p_language_code: tgUser.language_code ?? null,
      p_start_param: s.startParam,
    });
  },

  getProfile() {
    return rpc<Profile>('get_profile');
  },

  getAttempts(gameId) {
    return rpc<AttemptState>('get_attempts', { p_game_id: gameId });
  },

  async consumeAttempt(gameId) {
    const res = await rpc<StartRoundResponse>('start_round', { p_game_id: gameId });
    if (!res.ok) {
      activeRounds.delete(gameId);
      return null;
    }
    activeRounds.set(gameId, res.roundId!);
    return {
      gameId,
      remaining: res.remaining,
      limit: res.limit,
      resetsAt: res.resetsAt,
    };
  },

  async submitScore(gameId, score) {
    const roundId = activeRounds.get(gameId);
    if (!roundId) throw new ApiError('раунд не начат', 400);
    activeRounds.delete(gameId);
    return rpc<RoundResult>('finish_round', { p_round_id: roundId, p_score: score });
  },

  getLeaderboard(gameId) {
    return rpc<Leaderboard>('get_leaderboard', { p_game_id: gameId });
  },

  acceptBetaPro() {
    return rpc<Profile>('accept_beta_pro');
  },

  async startProCheckout() {
    // Появится вместе с интеграцией Tribute (фаза 7).
    return { paymentUrl: 'https://t.me/tribute/app' };
  },

  isAdmin() {
    return rpc<boolean>('is_admin');
  },

  adminListUsers() {
    return rpc<AdminUserRow[]>('admin_list_users');
  },

  adminSetTier(userId: number, tier: Tier) {
    return rpc<AdminUserRow>('admin_set_tier', { p_user_id: userId, p_tier: tier });
  },

  adminUserEntitlements(userId: number) {
    return rpc<Entitlement[]>('admin_user_entitlements', { p_user_id: userId });
  },
};
