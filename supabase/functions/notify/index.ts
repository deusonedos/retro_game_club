/**
 * Отправщик уведомлений.
 *
 * Берёт готовую очередь из базы, шлёт через Bot API, отчитывается о каждом.
 * Текст собирается в базе, а не здесь: место в рейтинге и счёт всё равно
 * оттуда, и разносить это по двум местам значит однажды разослать «ты на
 * 8-м месте» тому, кто давно на третьем.
 *
 * Вызывается по расписанию. Никаких внешних вызовов не принимает: защищён
 * секретом в заголовке, потому что рассылка от чужого имени — это блокировки
 * бота и потерянные игроки.
 *
 * Переменные окружения:
 *   BOT_TOKEN     — токен бота
 *   MINI_APP_URL  — адрес Mini App для кнопки «Открыть»
 *   CRON_SECRET   — общий секрет с планировщиком
 */

const BOT_TOKEN = Deno.env.get('BOT_TOKEN');
const MINI_APP_URL = Deno.env.get('MINI_APP_URL') ?? 'https://deusonedos.github.io/retro_game_club/';
const CRON_SECRET = Deno.env.get('CRON_SECRET');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/** Bot API ограничивает рассылку; 25 сообщений в секунду — безопасный темп. */
const PAUSE_MS = 45;

interface QueueItem {
  id: number;
  userId: number;
  text: string;
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${name}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? (undefined as T) : res.json();
}

/**
 * Telegram отвечает 403, если бот заблокирован или чат не начат. Такого
 * адресата нужно пометить и больше не трогать: иначе очередь будет вечно
 * биться в закрытую дверь и жечь лимиты Bot API.
 */
function isBlocked(description: string): boolean {
  const d = description.toLowerCase();
  return (
    d.includes('blocked by the user') ||
    d.includes('chat not found') ||
    d.includes('user is deactivated') ||
    d.includes("bot can't initiate conversation")
  );
}

async function send(item: QueueItem): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: item.userId,
      text: item.text,
      reply_markup: {
        inline_keyboard: [[{ text: '🎮 Открыть', web_app: { url: MINI_APP_URL } }]],
      },
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (body?.ok) {
    await rpc('notify_record', { p_id: item.id, p_ok: true });
    return;
  }

  const description = String(body?.description ?? `http ${res.status}`);
  await rpc('notify_record', {
    p_id: item.id,
    p_ok: false,
    p_error: description,
    p_blocked: isBlocked(description),
  });
}

Deno.serve(async (req) => {
  if (!BOT_TOKEN || !CRON_SECRET) {
    return Response.json({ error: 'нет BOT_TOKEN или CRON_SECRET' }, { status: 500 });
  }
  if (req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return Response.json({ error: 'нет доступа' }, { status: 403 });
  }

  const batch = await rpc<QueueItem[]>('notify_batch', { p_limit: 30 });

  let sent = 0;
  let failed = 0;
  for (const item of batch) {
    try {
      await send(item);
      sent++;
    } catch (e) {
      failed++;
      // Одно упавшее сообщение не должно ронять всю рассылку: остальные
      // адресаты ни при чём, а неотправленное останется в очереди.
      console.error('отправка не удалась', item.id, e);
    }
    if (batch.length > 1) await new Promise((r) => setTimeout(r, PAUSE_MS));
  }

  return Response.json({ queued: batch.length, sent, failed });
});
