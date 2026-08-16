/**
 * Обмен Telegram initData на JWT.
 *
 * Единственная функция, которой нужен токен бота, и единственный вход в
 * систему: всё остальное — функции в Postgres, вызываемые уже с этим JWT.
 *
 * Почему так, а не проверка на каждом запросе: Edge Functions на бесплатном
 * тарифе ограничены 500 тыс. вызовов в месяц. Одна проверка за сессию вместо
 * проверки на каждое действие — это разница между ~30 тыс. и ~600 тыс.
 * вызовов при тысяче активных игроков.
 *
 * Переменные окружения (задаются в панели Supabase, не в репозитории):
 *   BOT_TOKEN       — токен бота от @BotFather
 *   APP_JWT_SECRET  — JWT-секрет проекта, тот же, которым PostgREST
 *                     проверяет подпись. Иначе токен не примут.
 *   ALLOWED_ORIGIN  — адрес Mini App для CORS
 */

import { SignJWT } from 'npm:jose@5.9.6';

const BOT_TOKEN = Deno.env.get('BOT_TOKEN');
const JWT_SECRET = Deno.env.get('APP_JWT_SECRET');
const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? '*';

/**
 * initData старше суток не принимаем. Подпись сама по себе бессрочна, и без
 * этой проверки один перехваченный initData работал бы вечно.
 */
const MAX_AGE_SECONDS = 60 * 60 * 24;

/** Срок жизни выдаваемого токена. Короткий: сессия обновляется при заходе. */
const TOKEN_TTL_SECONDS = 60 * 60 * 6;

const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

async function hmac(key: Uint8Array, data: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

const toHex = (bytes: Uint8Array) =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Сравнение за постоянное время: обычное == подвержено timing-атаке. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

/**
 * Проверка подписи по схеме Telegram: ключ выводится из токена бота, затем
 * им подписывается строка из отсортированных пар key=value без самого hash.
 */
async function verifyInitData(
  initData: string,
  botToken: string,
): Promise<{ user: TelegramUser; startParam: string | null } | null> {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = await hmac(new TextEncoder().encode('WebAppData'), botToken);
  const computed = toHex(await hmac(secretKey, dataCheckString));
  if (!safeEqual(computed, hash)) return null;

  const authDate = Number(params.get('auth_date') ?? 0);
  if (!authDate || Math.floor(Date.now() / 1000) - authDate > MAX_AGE_SECONDS) return null;

  const rawUser = params.get('user');
  if (!rawUser) return null;

  let user: TelegramUser;
  try {
    user = JSON.parse(rawUser);
  } catch {
    return null;
  }
  if (typeof user?.id !== 'number') return null;

  return { user, startParam: params.get('start_param') };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'только POST' }, 405);

  if (!BOT_TOKEN || !JWT_SECRET) {
    // Явная ошибка вместо тихого отказа: так сразу видно, что не задан секрет.
    return json({ error: 'сервер не настроен: нет BOT_TOKEN или APP_JWT_SECRET' }, 500);
  }

  let initData: string;
  try {
    ({ initData } = await req.json());
  } catch {
    return json({ error: 'ожидается JSON с полем initData' }, 400);
  }
  if (typeof initData !== 'string' || initData.length === 0) {
    return json({ error: 'пустой initData' }, 400);
  }

  const verified = await verifyInitData(initData, BOT_TOKEN);
  if (!verified) return json({ error: 'подпись не прошла проверку' }, 401);

  const { user, startParam } = verified;
  const now = Math.floor(Date.now() / 1000);

  // role: authenticated — иначе PostgREST не пустит к функциям.
  // telegram_id — наш claim, из него функции в базе берут личность.
  const token = await new SignJWT({
    role: 'authenticated',
    telegram_id: String(user.id),
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(String(user.id))
    .setAudience('authenticated')
    .setIssuedAt(now)
    .setExpirationTime(now + TOKEN_TTL_SECONDS)
    .sign(new TextEncoder().encode(JWT_SECRET));

  return json({
    token,
    expiresIn: TOKEN_TTL_SECONDS,
    user: {
      id: user.id,
      firstName: user.first_name ?? null,
      lastName: user.last_name ?? null,
      username: user.username ?? null,
      languageCode: user.language_code ?? null,
    },
    startParam,
  });
});
