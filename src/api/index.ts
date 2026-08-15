import { mockClient } from './mockClient';
import type { ApiClient } from './types';

/**
 * Единственная точка выбора реализации бэкенда.
 * Переезд на Supabase: положить рядом supabaseClient.ts и переключить здесь.
 */
export const api: ApiClient = mockClient;

/** Мок живёт в localStorage — в проде здесь будет false. */
export const IS_MOCK_BACKEND = true;

export * from './types';
