-- Публичный API: единственная дверь внутрь закрытых таблиц.
--
-- Все функции SECURITY DEFINER с пустым search_path и правом выполнения
-- только у роли authenticated. Анонимный ключ сам по себе не открывает
-- ничего: сначала Edge Function проверяет подпись initData и выдаёт JWT
-- с claim telegram_id, и лишь потом клиент может что-то вызвать.
--
-- Сквозное правило: идентификатор пользователя берётся из токена, а не из
-- параметра. Поэтому ни одна функция не принимает user_id — кроме админских,
-- где он и означает «над кем действуем», а права проверяются отдельно.
--
-- ОЖИДАЕМО: линтер Supabase помечает каждую функцию ниже предупреждением
-- «Signed-In Users Can Execute SECURITY DEFINER Function». Это описание
-- нашей схемы, а не дефект — она вся построена на том, что дверь одна и
-- открывается только валидным JWT. Векторы, из-за которых линтер обычно
-- беспокоится, закрыты: search_path зафиксирован, идентификатор приходит
-- из подписанного токена, админские функции проверяют права отдельно.
-- Ослаблять это ради зелёного отчёта не нужно.

-- ---------- вспомогательное ----------

create or replace function app.is_pro(p_uid bigint) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.entitlements e
    where e.user_id = p_uid
      and e.revoked_at is null
      and e.starts_at <= now()
      and (e.ends_at is null or e.ends_at > now())
  )
$$;

create or replace function app.profile_json(p_uid bigint) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'userId',            u.telegram_id,
    'name',              coalesce(u.first_name, ''),
    'username',          u.username,
    'tier',              case when e.id is null then 'free' else 'pro' end,
    'proSource',         e.source,
    'proEndsAt',         e.ends_at,
    'betaOfferAccepted', u.beta_offer_accepted,
    'coins',             u.coins
  )
  from public.users u
  left join lateral (
    select en.id, en.source, en.ends_at
    from public.entitlements en
    where en.user_id = u.telegram_id
      and en.revoked_at is null
      and en.starts_at <= now()
      and (en.ends_at is null or en.ends_at > now())
    order by en.starts_at desc
    limit 1
  ) e on true
  where u.telegram_id = p_uid
$$;

-- Момент следующего сброса попыток: полночь по Москве.
create or replace function app.next_reset(p_day date) returns timestamptz
language sql stable set search_path = ''
as $$
  select ((p_day + 1)::timestamp) at time zone 'Europe/Moscow'
$$;

create or replace function app.require_uid() returns bigint
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid bigint := app.current_telegram_id();
begin
  if v_uid is null then
    raise exception 'нет telegram_id в токене' using errcode = '28000';
  end if;
  return v_uid;
end $$;

-- ---------- сессия ----------

create or replace function public.touch_session(
  p_username      text default null,
  p_first_name    text default null,
  p_language_code text default null,
  p_start_param   text default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid bigint := app.require_uid();
  v_ref bigint;
  v_new boolean;
begin
  -- Реферер проставляется только при первом заходе и дальше не меняется:
  -- иначе награду фармят, перезаходя по чужим ссылкам. На себя не считаем.
  if p_start_param ~ '^ref_[0-9]+$' then
    v_ref := substring(p_start_param from 5)::bigint;
    if v_ref = v_uid then v_ref := null; end if;
  end if;

  insert into public.users as u (telegram_id, username, first_name, language_code, referred_by)
  values (
    v_uid, p_username, p_first_name, p_language_code,
    (select r.telegram_id from public.users r where r.telegram_id = v_ref)
  )
  on conflict (telegram_id) do update
    set username      = coalesce(excluded.username, u.username),
        first_name    = coalesce(excluded.first_name, u.first_name),
        language_code = coalesce(excluded.language_code, u.language_code),
        last_seen_at  = now()
  returning (xmax = 0) into v_new;

  insert into public.events (user_id, name, props)
  values (v_uid, 'app_open', jsonb_build_object('new', v_new));

  return app.profile_json(v_uid);
end $$;

create or replace function public.get_profile() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  return app.profile_json(app.require_uid());
end $$;

-- ---------- попытки ----------

create or replace function public.get_attempts(p_game_id text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid   bigint  := app.require_uid();
  v_day   date    := app.day_msk();
  v_limit constant integer := 7;
  v_used  integer;
begin
  select a.used into v_used
  from public.attempts a
  where a.user_id = v_uid and a.game_id = p_game_id and a.day = v_day;

  return jsonb_build_object(
    'gameId',    p_game_id,
    'remaining', case when app.is_pro(v_uid) then null
                      else greatest(0, v_limit - coalesce(v_used, 0)) end,
    'limit',     v_limit,
    'resetsAt',  app.next_reset(v_day)
  );
end $$;

-- ---------- раунд как транзакция ----------

-- Попытка списывается здесь, при старте. Счёт принимается только для
-- активного раунда и только один раз — это и есть античит.
create or replace function public.start_round(p_game_id text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid    bigint  := app.require_uid();
  v_pro    boolean := app.is_pro(v_uid);
  v_day    date    := app.day_msk();
  v_limit  constant integer := 7;
  v_used   integer;
  v_round  uuid;
begin
  -- Незакрытый раунд означает, что игрок вышел не доиграв. Попытка за него
  -- уже списана, поэтому просто помечаем брошенным и идём дальше.
  update public.rounds r
     set status = 'abandoned', finished_at = now()
   where r.user_id = v_uid and r.game_id = p_game_id and r.status = 'active';

  if not v_pro then
    -- Списание атомарное: условие в DO UPDATE не даёт превысить лимит даже
    -- при двух одновременных запросах.
    insert into public.attempts as a (user_id, game_id, day, used)
    values (v_uid, p_game_id, v_day, 1)
    on conflict (user_id, game_id, day) do update
      set used = a.used + 1
      where a.used < v_limit
    returning a.used into v_used;

    if v_used is null then
      return jsonb_build_object('ok', false, 'reason', 'no_attempts',
                                'resetsAt', app.next_reset(v_day));
    end if;
  end if;

  insert into public.rounds (user_id, game_id) values (v_uid, p_game_id)
  returning id into v_round;

  insert into public.events (user_id, name, props)
  values (v_uid, 'round_start', jsonb_build_object('game', p_game_id));

  return jsonb_build_object(
    'ok',        true,
    'roundId',   v_round,
    'gameId',    p_game_id,
    'remaining', case when v_pro then null else v_limit - v_used end,
    'limit',     v_limit,
    'resetsAt',  app.next_reset(v_day)
  );
end $$;

create or replace function public.finish_round(p_round_id uuid, p_score integer) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     bigint := app.require_uid();
  v_round   public.rounds;
  v_secs    numeric;
  v_pro     boolean;
  v_ok      boolean := true;
  v_total   integer;
  v_best    integer;
  -- Потолок правдоподобности. В Bubble Blast выстрел занимает около секунды
  -- и приносит десятки очков; 500 в секунду — заведомо недостижимый предел,
  -- отсекающий подставные значения, но не задевающий честную игру.
  c_max_pps constant integer := 500;
  c_min_sec constant integer := 3;
begin
  select * into v_round
  from public.rounds r
  where r.id = p_round_id and r.user_id = v_uid and r.status = 'active'
  for update;

  if not found then
    raise exception 'раунд не найден, чужой или уже закрыт' using errcode = '22023';
  end if;

  v_secs := extract(epoch from (now() - v_round.started_at));
  v_pro  := app.is_pro(v_uid);

  if p_score < 0 or (p_score > 0 and v_secs < c_min_sec)
     or p_score > c_max_pps * greatest(v_secs, 1) then
    v_ok := false;
    insert into public.events (user_id, name, props)
    values (v_uid, 'suspicious_score',
            jsonb_build_object('round', p_round_id, 'score', p_score, 'secs', v_secs));
  end if;

  -- Раунд закрывается в любом случае: данные сохраняем, но неправдоподобный
  -- результат в зачёт не идёт. Так видно попытки накрутки, а не только их итог.
  update public.rounds r
     set status      = 'finished',
         finished_at = now(),
         score       = greatest(p_score, 0),
         counted     = (v_pro and v_ok)
   where r.id = p_round_id;

  select coalesce(sum(r.score), 0), coalesce(max(r.score), 0)
    into v_total, v_best
  from public.rounds r
  where r.user_id = v_uid
    and r.game_id = v_round.game_id
    and r.status = 'finished'
    and r.counted
    and r.finished_at >= app.season_start()
    and r.finished_at <  app.season_end();

  insert into public.events (user_id, name, props)
  values (v_uid, 'round_finish',
          jsonb_build_object('game', v_round.game_id, 'score', p_score, 'counted', v_pro and v_ok));

  return jsonb_build_object(
    'score',        greatest(p_score, 0),
    'personalBest', v_best,
    'seasonTotal',  v_total,
    'counted',      (v_pro and v_ok)
  );
end $$;

-- ---------- рейтинг ----------

create or replace function public.get_leaderboard(p_game_id text, p_limit integer default 50)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid   bigint := app.require_uid();
  v_start timestamptz := app.season_start();
  v_end   timestamptz := app.season_end();
  v_rows  jsonb;
  v_self  jsonb;
  v_fund  record;
begin
  with totals as (
    select r.user_id, sum(r.score)::integer as score
    from public.rounds r
    where r.game_id = p_game_id
      and r.status = 'finished'
      and r.counted
      and r.finished_at >= v_start
      and r.finished_at <  v_end
    group by r.user_id
    having sum(r.score) > 0
  ),
  ranked as (
    select t.user_id, t.score,
           rank() over (order by t.score desc) as rank,
           coalesce(nullif(u.first_name, ''), u.username, 'Игрок') as name
    from totals t
    join public.users u on u.telegram_id = t.user_id
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'rank', x.rank, 'userId', x.user_id, 'name', x.name,
      'score', x.score, 'isSelf', x.user_id = v_uid
    ) order by x.rank), '[]'::jsonb),
    (select to_jsonb(s) from (
       select y.rank, y.user_id as "userId", y.name, y.score, true as "isSelf"
       from ranked y where y.user_id = v_uid
     ) s)
  into v_rows, v_self
  from (select * from ranked order by rank limit p_limit) x;

  select s.prize_fund, s.prize_places into v_fund
  from public.seasons s where s.starts_at = v_start;

  return jsonb_build_object(
    'gameId',       p_game_id,
    'seasonStart',  v_start,
    'seasonEnd',    v_end,
    'prizeFund',    coalesce(v_fund.prize_fund, 0),
    'prizePlaces',  coalesce(v_fund.prize_places, 3),
    'entries',      v_rows,
    'self',         v_self,
    'selfEligible', app.is_pro(v_uid)
  );
end $$;

-- ---------- бета-оффер ----------

create or replace function public.accept_beta_pro() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid bigint := app.require_uid();
begin
  update public.users u set beta_offer_accepted = true where u.telegram_id = v_uid;

  if not app.is_pro(v_uid) then
    insert into public.entitlements (user_id, source) values (v_uid, 'beta');
  end if;

  insert into public.events (user_id, name, props)
  values (v_uid, 'beta_pro_accepted', '{}'::jsonb);

  return app.profile_json(v_uid);
end $$;

-- ---------- админка ----------

-- Права проверяются в базе, а не по списку в конфигурации фронтенда:
-- репозиторий публичный, клиентскому флагу доверять нельзя.
create or replace function app.require_admin() returns bigint
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid bigint := app.require_uid();
begin
  if not exists (select 1 from public.users u where u.telegram_id = v_uid and u.is_admin) then
    raise exception 'нужны права администратора' using errcode = '42501';
  end if;
  return v_uid;
end $$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.users u
    where u.telegram_id = app.current_telegram_id() and u.is_admin
  )
$$;

create or replace function public.admin_list_users() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_admin bigint := app.require_admin();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'userId',      u.telegram_id,
      'name',        coalesce(nullif(u.first_name, ''), 'Игрок'),
      'username',    u.username,
      'tier',        case when e.id is null then 'free' else 'pro' end,
      'proSource',   e.source,
      'firstSeenAt', u.first_seen_at,
      'lastSeenAt',  u.last_seen_at,
      'roundsTotal', (select count(*) from public.rounds r
                      where r.user_id = u.telegram_id and r.status = 'finished')
    ) order by u.last_seen_at desc)
    from public.users u
    left join lateral (
      select en.id, en.source from public.entitlements en
      where en.user_id = u.telegram_id and en.revoked_at is null
        and en.starts_at <= now() and (en.ends_at is null or en.ends_at > now())
      order by en.starts_at desc limit 1
    ) e on true
  ), '[]'::jsonb);
end $$;

create or replace function public.admin_set_tier(p_user_id bigint, p_tier text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_admin bigint := app.require_admin();
begin
  if p_tier = 'pro' then
    if not app.is_pro(p_user_id) then
      insert into public.entitlements (user_id, source, granted_by)
      values (p_user_id, 'admin', v_admin);
    end if;
  elsif p_tier = 'free' then
    -- Отзыв, а не удаление: история выдач не переписывается.
    update public.entitlements e set revoked_at = now()
     where e.user_id = p_user_id and e.revoked_at is null
       and e.starts_at <= now() and (e.ends_at is null or e.ends_at > now());
  else
    raise exception 'неизвестный тариф: %', p_tier using errcode = '22023';
  end if;

  insert into public.events (user_id, name, props)
  values (v_admin, 'admin_set_tier',
          jsonb_build_object('target', p_user_id, 'tier', p_tier));

  return app.profile_json(p_user_id);
end $$;

create or replace function public.admin_user_entitlements(p_user_id bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_admin bigint := app.require_admin();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'userId', e.user_id, 'source', e.source,
      'startsAt', e.starts_at, 'endsAt', e.ends_at,
      'revokedAt', e.revoked_at, 'grantedBy', e.granted_by
    ) order by e.starts_at desc)
    from public.entitlements e where e.user_id = p_user_id
  ), '[]'::jsonb);
end $$;

-- ---------- права ----------

-- Ничего не отдаём анониму: без JWT с telegram_id вызывать нечего.
revoke all on function
  public.touch_session(text, text, text, text),
  public.get_profile(),
  public.get_attempts(text),
  public.start_round(text),
  public.finish_round(uuid, integer),
  public.get_leaderboard(text, integer),
  public.accept_beta_pro(),
  public.is_admin(),
  public.admin_list_users(),
  public.admin_set_tier(bigint, text),
  public.admin_user_entitlements(bigint)
from public, anon;

grant execute on function
  public.touch_session(text, text, text, text),
  public.get_profile(),
  public.get_attempts(text),
  public.start_round(text),
  public.finish_round(uuid, integer),
  public.get_leaderboard(text, integer),
  public.accept_beta_pro(),
  public.is_admin(),
  public.admin_list_users(),
  public.admin_set_tier(bigint, text),
  public.admin_user_entitlements(bigint)
to authenticated;
