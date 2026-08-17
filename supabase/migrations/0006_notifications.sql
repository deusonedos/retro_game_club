-- Уведомления бота: очередь, дедупликация, отписка.
--
-- В Mini Apps это главный рычаг возврата и стоит он почти ничего. Но и
-- ломается легче всего: пережали — получили блокировку бота вместо визита,
-- а заблокировавшего уже не вернуть ничем.
--
-- Отсюда три жёстких правила, зашитых в саму очередь, а не в код отправки:
--   1. Не больше одного сообщения в сутки на игрока.
--   2. Каждый повод отправляется один раз (ключ дедупликации).
--   3. Отписка уважается всегда и мгновенно.

create extension if not exists pg_net;

alter table public.users
  add column if not exists notifications_enabled boolean not null default true,
  -- Снимается, когда Telegram ответил, что бот заблокирован или чат не начат.
  -- Без этого мы бы вечно долбились в закрытую дверь и жгли лимиты.
  add column if not exists can_message boolean not null default true,
  add column if not exists last_notified_at timestamptz;

create table public.notifications (
  id         bigserial primary key,
  user_id    bigint not null references public.users (telegram_id) on delete cascade,
  kind       text   not null,
  -- Ключ повода: для «сезон кончается» это дата старта сезона. Уникальность
  -- по (user_id, kind, dedup_key) и есть гарантия «один раз на повод».
  dedup_key  text   not null,
  sent_at    timestamptz,
  ok         boolean,
  error      text,
  created_at timestamptz not null default now(),
  unique (user_id, kind, dedup_key)
);

create index notifications_pending_idx on public.notifications (created_at) where sent_at is null;

alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;

-- ---------- наполнение очереди ----------

/**
 * Ставит в очередь «сезон скоро кончится» тем, кто в нём участвует.
 *
 * Окно — последние 12 часов сезона. Раньше не имеет смысла (ещё успеется),
 * позже бесполезно (уже не отыграться).
 */
create or replace function app.enqueue_season_ending() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_start timestamptz := app.season_start();
  v_end   timestamptz := app.season_end();
  n integer;
begin
  if v_end - now() > interval '12 hours' or v_end <= now() then
    return 0;
  end if;

  insert into public.notifications (user_id, kind, dedup_key)
  select distinct r.user_id, 'season_ending', v_start::date::text
  from public.rounds r
  join public.users u on u.telegram_id = r.user_id
  where r.status = 'finished' and r.counted
    and r.finished_at >= v_start and r.finished_at < v_end
    and u.notifications_enabled
    and u.can_message
    and (u.last_notified_at is null or u.last_notified_at < now() - interval '20 hours')
  on conflict (user_id, kind, dedup_key) do nothing;

  get diagnostics n = row_count;
  return n;
end $$;

/** Итоги сезона — тем, кто в нём играл. */
create or replace function app.enqueue_season_results() returns integer
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  insert into public.notifications (user_id, kind, dedup_key)
  select distinct sr.user_id, 'season_results', s.starts_at::date::text
  from public.season_results sr
  join public.seasons s on s.id = sr.season_id
  join public.users u on u.telegram_id = sr.user_id
  where s.status = 'closed'
    and s.ends_at > now() - interval '2 days'
    and u.notifications_enabled
    and u.can_message
  on conflict (user_id, kind, dedup_key) do nothing;

  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- выдача очереди отправщику ----------

/**
 * Готовые к отправке уведомления с уже собранным текстом.
 *
 * Текст собирается в базе, а не в отправщике: место в рейтинге и счёт всё
 * равно берутся отсюда, и разносить это по двум местам значит однажды
 * разослать «ты на 8-м месте» тому, кто давно на третьем.
 */
create or replace function app.notification_batch(p_limit integer default 30)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_start timestamptz := app.season_start();
  v_end   timestamptz := app.season_end();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', q.id, 'userId', q.user_id, 'text', q.text))
    from (
      select n.id, n.user_id,
        case n.kind
          when 'season_ending' then
            'Сезон заканчивается менее чем через 12 часов.' ||
            coalesce(
              (select E'\nТы на ' || pos.rank || '-м месте со счётом ' ||
                      to_char(pos.score, 'FM999G999') || '.'
               from (
                 select rank() over (order by sum(r.score) desc) as rank,
                        sum(r.score) as score, r.user_id
                 from public.rounds r
                 where r.status = 'finished' and r.counted
                   and r.finished_at >= v_start and r.finished_at < v_end
                 group by r.user_id
               ) pos
               where pos.user_id = n.user_id),
              '')
            || E'\n\nУспеешь подняться?'
          when 'season_results' then
            'Сезон закрыт. Итоги:' ||
            coalesce((
              select string_agg(E'\n' || sr.rank || '. ' || sr.name || ' — ' ||
                                to_char(sr.score, 'FM999G999'), '' order by sr.rank)
              from public.season_results sr
              join public.seasons s2 on s2.id = sr.season_id
              where s2.starts_at::date::text = n.dedup_key
            ), '')
            || E'\n\nНовый сезон уже идёт.'
          else 'Загляни в Retro Game Club'
        end as text
      from public.notifications n
      where n.sent_at is null
      order by n.created_at
      limit p_limit
    ) q
  ), '[]'::jsonb);
end $$;

/** Отчёт отправщика. can_message снимается, если Telegram закрыл дверь. */
create or replace function app.record_notification(
  p_id bigint, p_ok boolean, p_error text default null, p_blocked boolean default false
) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid bigint;
begin
  update public.notifications n
     set sent_at = now(), ok = p_ok, error = p_error
   where n.id = p_id
  returning n.user_id into v_uid;

  if p_ok then
    update public.users u set last_notified_at = now() where u.telegram_id = v_uid;
  elsif p_blocked then
    update public.users u set can_message = false where u.telegram_id = v_uid;
  end if;
end $$;

/** Отписка и подписка — вызывается вебхуком бота по командам. */
create or replace function app.set_notifications(p_uid bigint, p_enabled boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.users u
     set notifications_enabled = p_enabled,
         can_message = case when p_enabled then true else u.can_message end
   where u.telegram_id = p_uid;
end $$;

grant execute on function
  app.notification_batch(integer),
  app.record_notification(bigint, boolean, text, boolean),
  app.set_notifications(bigint, boolean),
  app.enqueue_season_ending(),
  app.enqueue_season_results()
to service_role;

-- ---------- расписание ----------

create or replace function app.tick_notifications() returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform app.enqueue_season_ending();
  perform app.enqueue_season_results();
end $$;

-- Наполнение очереди раз в час в :13. Сама отправка — отдельным заданием,
-- чтобы сбой в одном не блокировал другое.
select cron.schedule(
  'rgc-notifications-enqueue',
  '13 * * * *',
  $job$ select app.tick_notifications() $job$
);
