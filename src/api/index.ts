import { mockClient } from './mockClient';
import { supabaseClient } from './supabaseClient';
import { isTelegram } from '../telegram/webapp';
import type { ApiClient } from './types';

/**
 * Выбор реализации бэкенда.
 *
 * Внутри Telegram работает настоящий Supabase. В обычном браузере его нет
 * смысла даже пытаться: без initData подпись не выдать, а значит и токен
 * не получить. Поэтому локальная разработка идёт на моке — экраны, лимиты
 * и рейтинг остаются кликабельными без туннеля и без бота.
 *
 * Обе реализации закрыты одним интерфейсом ApiClient, поэтому переключение
 * не требует правок в экранах.
 */
export const api: ApiClient = isTelegram ? supabaseClient : mockClient;

/** true — данные живут в localStorage и видны только на этом устройстве. */
export const IS_MOCK_BACKEND = !isTelegram;

export * from './types';
