/**
 * Публичные параметры проекта Supabase.
 *
 * Эти два значения лежат в открытом репозитории намеренно — они и так
 * уезжают в браузер каждого игрока, скрывать их негде и незачем. Ключ
 * publishable даёт ровно ноль прав сам по себе: все таблицы закрыты RLS
 * без политик, а функции доступны только роли authenticated, то есть
 * держателю JWT, выданного после проверки подписи initData.
 *
 * Секреты — токен бота и JWT-секрет — живут в переменных Edge Functions
 * и в репозиторий не попадают никогда.
 */

export const SUPABASE_URL = 'https://jcrwxfqhfaojpgtkhmbn.supabase.co';

export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_pd5byjEcylUExbHrj1MTmA_IAPrPk3L';

export const SESSION_ENDPOINT = `${SUPABASE_URL}/functions/v1/session`;
export const RPC_ENDPOINT = `${SUPABASE_URL}/rest/v1/rpc`;
