/**
 * Вебхук бота: команды /start и /stop.
 *
 * Нужен ради отписки. Рассылка без работающей отписки — это не удержание,
 * а способ собрать блокировки: заблокировавший игрок потерян навсегда, тогда
 * как отписавшийся продолжает играть.
 *
 * Защита: Telegram присылает согласованный секрет в заголовке
 * X-Telegram-Bot-Api-Secret-Token. Без проверки этот адрес мог бы дёрнуть
 * кто угодно и отписать чужих игроков.
 *
 * Регистрация вебхука делается этой же функцией по GET с ?setup=1 и
 * заголовком x-cron-secret. Так токен бота не покидает сервер: иначе его
 * пришлось бы вставлять в URL вручную, а он оседает в истории браузера.
 *
 * Переменные окружения:
 *   BOT_TOKEN                 — токен бота
 *   TELEGRAM_WEBHOOK_SECRET   — согласованный с Telegram секрет
 *   CRON_SECRET               — доступ к служебным вызовам
 *   MINI_APP_URL              — адрес Mini App
 */

const BOT_TOKEN = Deno.env.get('BOT_TOKEN');
const WEBHOOK_SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET');
const CRON_SECRET = Deno.env.get('CRON_SECRET');
const MINI_APP_URL = Deno.env.get('MINI_APP_URL') ?? 'https://deusonedos.github.io/retro_game_club/';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const api = (method: string, body: unknown) =>
  fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

async function rpc(name: string, args: Record<string, unknown>): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify(args),
  });
}

const openButton = {
  inline_keyboard: [[{ text: '🎮 Играть', web_app: { url: MINI_APP_URL } }]],
};

async function handleCommand(chatId: number, text: string): Promise<void> {
  const command = text.trim().split(/\s+/)[0].toLowerCase().split('@')[0];

  if (command === '/stop') {
    await rpc('notify_subscription', { p_uid: chatId, p_enabled: false });
    await api('sendMessage', {
      chat_id: chatId,
      text:
        'Уведомления выключены. Об итогах сезона больше писать не буду.\n\n' +
        'Играть это не мешает — заходи когда захочешь. Вернуть уведомления: /start',
    });
    return;
  }

  if (command === '/start') {
    // Возврат после отписки — тоже /start, поэтому подписку включаем здесь же.
    await rpc('notify_subscription', { p_uid: chatId, p_enabled: true });
    await api('sendMessage', {
      chat_id: chatId,
      text:
        'Retro Game Club — аркадные игры прямо в Telegram.\n\n' +
        'Сезон длится неделю, очки за раунды суммируются, в понедельник таблица обнуляется.\n\n' +
        'Напишу только по делу: когда сезон подходит к концу и когда объявлены итоги. ' +
        'Не чаще раза в сутки. Отключить: /stop',
      reply_markup: openButton,
    });
    return;
  }

  await api('sendMessage', {
    chat_id: chatId,
    text: 'Такой команды нет. Есть /start и /stop.',
    reply_markup: openButton,
  });
}

Deno.serve(async (req) => {
  if (!BOT_TOKEN) return Response.json({ error: 'нет BOT_TOKEN' }, { status: 500 });

  const url = new URL(req.url);

  // Разовая регистрация вебхука в Telegram.
  if (req.method === 'GET' && url.searchParams.get('setup') === '1') {
    if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) {
      return Response.json({ error: 'нет доступа' }, { status: 403 });
    }
    if (!WEBHOOK_SECRET) {
      return Response.json({ error: 'нет TELEGRAM_WEBHOOK_SECRET' }, { status: 500 });
    }
    const res = await api('setWebhook', {
      url: `${SUPABASE_URL}/functions/v1/telegram`,
      secret_token: WEBHOOK_SECRET,
      allowed_updates: ['message'],
      drop_pending_updates: true,
    });
    return Response.json(await res.json());
  }

  if (req.method !== 'POST') return Response.json({ error: 'только POST' }, { status: 405 });

  if (!WEBHOOK_SECRET || req.headers.get('x-telegram-bot-api-secret-token') !== WEBHOOK_SECRET) {
    return Response.json({ error: 'нет доступа' }, { status: 403 });
  }

  const update = await req.json().catch(() => null);
  const message = update?.message;
  const chatId = message?.chat?.id;
  const text = message?.text;

  // Telegram считает доставленным любой 200. Отвечаем им всегда, иначе
  // он будет повторять одно и то же обновление и множить сообщения.
  if (typeof chatId === 'number' && typeof text === 'string') {
    try {
      await handleCommand(chatId, text);
    } catch (e) {
      console.error('обработка команды не удалась', e);
    }
  }

  return Response.json({ ok: true });
});
