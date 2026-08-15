/**
 * Тонкая типизированная обёртка над window.Telegram.WebApp.
 *
 * Единственное место в приложении, которое знает про Telegram SDK.
 * Вне Telegram (обычный браузер, `npm run dev`) отдаёт безопасную заглушку,
 * чтобы каркас можно было гонять локально без туннеля.
 */

export interface TgUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
  is_premium?: boolean;
}

interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { user?: TgUser; start_param?: string };
  version: string;
  platform: string;
  colorScheme: 'light' | 'dark';
  themeParams: Record<string, string>;
  isExpanded: boolean;
  viewportStableHeight: number;
  ready(): void;
  expand(): void;
  close(): void;
  disableVerticalSwipes?(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  openInvoice?(url: string, cb?: (status: string) => void): void;
  openTelegramLink?(url: string): void;
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  HapticFeedback?: {
    impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
    notificationOccurred(type: 'error' | 'success' | 'warning'): void;
    selectionChanged(): void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

const raw = window.Telegram?.WebApp;

/** true — приложение реально запущено внутри Telegram-клиента. */
export const isTelegram = Boolean(raw && raw.initData !== undefined && raw.platform !== 'unknown');

/** Пользователь для дев-режима: стабильный id, чтобы моковые данные не терялись. */
const DEV_USER: TgUser = {
  id: 1,
  first_name: 'Dev',
  username: 'dev_player',
  language_code: 'ru',
};

export const tgUser: TgUser = raw?.initDataUnsafe?.user ?? DEV_USER;

/**
 * Сырая initData — её нужно целиком передавать на бэкенд и там проверять
 * HMAC-подпись ботовым токеном. Никогда не доверяем user.id с клиента.
 */
export const initData: string = raw?.initData ?? '';

export function initTelegram(): void {
  if (!raw) return;
  raw.ready();
  raw.expand();
  raw.disableVerticalSwipes?.(); // иначе свайпы в игре тянут вниз шторку Telegram
  raw.setHeaderColor?.('#0e0e14');
  raw.setBackgroundColor?.('#0e0e14');
}

export const haptic = {
  tap: () => raw?.HapticFeedback?.impactOccurred('light'),
  hit: () => raw?.HapticFeedback?.impactOccurred('medium'),
  success: () => raw?.HapticFeedback?.notificationOccurred('success'),
  error: () => raw?.HapticFeedback?.notificationOccurred('error'),
  select: () => raw?.HapticFeedback?.selectionChanged(),
};

/** Показ нативной кнопки «назад» в шапке Telegram. */
export function useBackButtonHandle() {
  return {
    show(cb: () => void) {
      if (!raw) return () => {};
      raw.BackButton.onClick(cb);
      raw.BackButton.show();
      return () => {
        raw.BackButton.offClick(cb);
        raw.BackButton.hide();
      };
    },
  };
}

/**
 * Открыть платёжную ссылку. Tribute отдаёт `webappPaymentUrl`, который
 * открывается поверх Mini App без выхода к боту.
 */
export function openInvoice(url: string, cb?: (status: string) => void): void {
  if (raw?.openInvoice) raw.openInvoice(url, cb);
  else window.open(url, '_blank');
}
