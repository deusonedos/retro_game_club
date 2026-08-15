-- Базовая схема Retro Game Club.
--
-- Модель доступа: прямого доступа к таблицам нет ни у кого. RLS включена
-- везде и намеренно оставлена без политик — это закрывает таблицы полностью.
-- Единственная дверь внутрь — функции SECURITY DEFINER (миграция 0002),
-- которые сами достают telegram_id из подписанного JWT.
--
-- Почему так, а не политики на каждую таблицу: у нас одна точка входа и
-- строгие инварианты (нельзя списать чужую попытку, нельзя закрыть чужой
-- раунд). Одну дверь проверить проще, чем десяток политик, а публичный
-- anon-ключ лежит в открытом репозитории и права на ошибку не даёт.

create schema if not exists app;

-- ---------- личность запроса ----------

-- telegram_id текущего запроса из подписанного JWT.
--
-- Ключевое правило всего бэкенда: идентификатор пользователя НИКОГДА не
-- приходит параметром функции. Параметр подделывается тривиально, claim в
-- подписанном токене — нет.
create or replace function app.current_telegram_id() returns bigint
language sql stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'telegram_id', '')::bigint
$$;

-- ---------- время ----------

-- Сброс попыток и границы сезона считаются по Москве (DECISIONS.md §3).
-- В отличие от клиентского расчёта, Postgres знает про переходы на летнее
-- время, поэтому смена правил пояса не сломает границы задним числом.

create or replace function app.day_msk(at timestamptz default now()) returns date
language sql stable
as $$
  select (at at time zone 'Europe/Moscow')::date
$$;

-- Понедельник 00:00 МСК текущего сезона. date_trunc('week') в Postgres
-- обрезает именно до понедельника.
create or replace function app.season_start(at timestamptz default now()) returns timestamptz
language sql stable
as $$
  select date_trunc('week', at at time zone 'Europe/Moscow') at time zone 'Europe/Moscow'
$$;

create or replace function app.season_end(at timestamptz default now()) returns timestamptz
language sql stable
as $$
  select app.season_start(at) + interval '7 days'
$$;

-- ---------- пользователи ----------

create table public.users (
  telegram_id         bigint primary key,
  username            text,
  first_name          text,
  language_code       text,
  -- Кто пригласил. Заполняется из start_param диплинка на первой сессии
  -- и больше не меняется: иначе реферальную награду можно фармить.
  referred_by         bigint references public.users (telegram_id),
  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  beta_offer_accepted boolean     not null default false,
  coins               integer     not null default 0,
  -- Проверка прав админа живёт на сервере, а не в конфиге фронтенда:
  -- репозиторий публичный, клиентскому флагу доверять нельзя.
  is_admin            boolean     not null default false
);

create index users_last_seen_idx on public.users (last_seen_at desc);
create index users_referred_by_idx on public.users (referred_by) where referred_by is not null;

-- ---------- основания для PRO ----------

-- Статус подписки не хранится полем, а выводится из набора выдач
-- (DECISIONS.md §9). Иначе ручное переключение из админки и вебхук платёжки
-- перетирают друг друга, а бета-пользователей потом не найти для перевода
-- на платный тариф.
create type public.entitlement_source as enum ('beta', 'admin', 'tribute', 'promo');

create table public.entitlements (
  id          uuid primary key default gen_random_uuid(),
  user_id     bigint not null references public.users (telegram_id) on delete cascade,
  source      public.entitlement_source not null,
  starts_at   timestamptz not null default now(),
  -- null — бессрочно (бета, ручная выдача без срока).
  ends_at     timestamptz,
  -- Отзыв проставляется здесь, а не удалением строки: история выдач
  -- не переписывается, всегда видно, почему у игрока текущий статус.
  revoked_at  timestamptz,
  granted_by  bigint references public.users (telegram_id),
  external_id text,
  note        text,
  created_at  timestamptz not null default now()
);

create index entitlements_active_idx
  on public.entitlements (user_id)
  where revoked_at is null;

-- ---------- попытки ----------

create table public.attempts (
  user_id bigint  not null references public.users (telegram_id) on delete cascade,
  game_id text    not null,
  -- Сутки по московскому календарю, не по UTC.
  day     date    not null,
  used    integer not null default 0 check (used >= 0),
  primary key (user_id, game_id, day)
);

-- ---------- раунды ----------

create type public.round_status as enum ('active', 'finished', 'abandoned');

-- Раунд как транзакция: попытка списывается при старте, счёт принимается
-- только для активного раунда и только один раз. Это же и античит.
create table public.rounds (
  id          uuid primary key default gen_random_uuid(),
  user_id     bigint not null references public.users (telegram_id) on delete cascade,
  game_id     text   not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  score       integer check (score is null or score >= 0),
  status      public.round_status not null default 'active',
  -- Пошёл ли раунд в турнирный зачёт. Проставляется на сервере по статусу
  -- подписки на момент завершения, а не на момент старта.
  counted     boolean not null default false
);

-- Основной индекс под рейтинг: сумма очков за окно сезона.
create index rounds_leaderboard_idx
  on public.rounds (game_id, finished_at)
  where status = 'finished' and counted;

create index rounds_user_idx on public.rounds (user_id, started_at desc);

-- Один активный раунд на игру у пользователя: защищает от параллельного
-- открытия нескольких раундов на одну списанную попытку.
create unique index rounds_one_active_idx
  on public.rounds (user_id, game_id)
  where status = 'active';

-- ---------- сезоны ----------

create table public.seasons (
  id           bigserial primary key,
  starts_at    timestamptz not null unique,
  ends_at      timestamptz not null,
  -- Фонд объявляется вручную в начале сезона (DECISIONS.md §8):
  -- наружу отдаётся число, формула не публикуется.
  prize_fund   integer not null default 0 check (prize_fund >= 0),
  prize_places integer not null default 3 check (prize_places > 0),
  status       text    not null default 'active',
  created_at   timestamptz not null default now()
);

-- ---------- события ----------

-- Без этой таблицы нечем измерить D1/D7, а на них держится весь план:
-- решение о платёжке и о закупке трафика принимается по retention.
create table public.events (
  id         bigserial primary key,
  user_id    bigint references public.users (telegram_id) on delete set null,
  name       text not null,
  props      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index events_name_idx on public.events (name, created_at desc);
create index events_user_idx on public.events (user_id, created_at desc);

-- ---------- запрет прямого доступа ----------

alter table public.users        enable row level security;
alter table public.entitlements enable row level security;
alter table public.attempts     enable row level security;
alter table public.rounds       enable row level security;
alter table public.seasons      enable row level security;
alter table public.events       enable row level security;

-- RLS без политик закрывает таблицы полностью. Это осознанный выбор:
-- система отказывает в закрытую сторону. Забытая политика проявится как
-- «ничего не работает», а не как тихая утечка через публичный anon-ключ.
revoke all on public.users        from anon, authenticated;
revoke all on public.entitlements from anon, authenticated;
revoke all on public.attempts     from anon, authenticated;
revoke all on public.rounds       from anon, authenticated;
revoke all on public.seasons      from anon, authenticated;
revoke all on public.events       from anon, authenticated;
