-- Закрытие замечаний линтера безопасности Supabase.
--
-- 1. Фиксация search_path у служебных функций.
--
-- Без явного search_path вызывающий может подсунуть свою схему впереди
-- нашей и подменить смысл неквалифицированного имени внутри функции.
-- Для SECURITY INVOKER это неприятно, для SECURITY DEFINER (миграция 0003)
-- это уже прямой захват прав владельца. Поэтому правило вводим сразу и
-- применяем ко всем функциям проекта: search_path пустой, все имена
-- квалифицированы полностью.
--
-- 2. Закрытие rls_auto_enable.
--
-- Функцию создаёт опция «Enable automatic RLS» при создании проекта. Она
-- лежит в схеме public, а PostgREST публикует всё оттуда наружу — то есть
-- SECURITY DEFINER функция оказывается вызываемой анонимно по HTTP.
-- Практического вреда мало (это триггерная функция, вне контекста триггера
-- она упадёт), но публичный эндпоинт, который никому не нужен, — лишний.
-- Как событийный триггер она продолжит работать: триггеры выполняются от
-- владельца и на GRANT не смотрят.

create or replace function app.current_telegram_id() returns bigint
language sql stable
set search_path = ''
as $$
  select nullif(
    pg_catalog.current_setting('request.jwt.claims', true)::jsonb ->> 'telegram_id',
    ''
  )::bigint
$$;

create or replace function app.day_msk(at timestamptz default now()) returns date
language sql stable
set search_path = ''
as $$
  select (at at time zone 'Europe/Moscow')::date
$$;

create or replace function app.season_start(at timestamptz default now()) returns timestamptz
language sql stable
set search_path = ''
as $$
  select pg_catalog.date_trunc('week', at at time zone 'Europe/Moscow') at time zone 'Europe/Moscow'
$$;

create or replace function app.season_end(at timestamptz default now()) returns timestamptz
language sql stable
set search_path = ''
as $$
  select app.season_start(at) + interval '7 days'
$$;

revoke all on function public.rls_auto_enable() from anon, authenticated, public;
