-- Жизненный цикл сезона: заведение, закрытие, фиксация итогов.
--
-- Зачем фиксировать итоги отдельной таблицей, а не считать задним числом:
-- рейтинг — это агрегат по раундам, и он поедет при любой правке формулы
-- счёта или при удалении пользователя. Победители прошлых сезонов должны
-- остаться такими, какими были объявлены, — иначе призы не с чем сверить.

create extension if not exists pg_cron;

create table public.season_results (
  season_id    bigint  not null references public.seasons (id) on delete cascade,
  game_id      text    not null,
  rank         integer not null,
  user_id      bigint  references public.users (telegram_id) on delete set null,
  -- Имя копируется на момент закрытия: игрок может сменить его позже или
  -- удалиться совсем, а список победителей должен остаться читаемым.
  name         text    not null,
  score        integer not null,
  prize_amount integer not null default 0,
  paid_at      timestamptz,
  created_at   timestamptz not null default now(),
  primary key (season_id, game_id, rank)
);

alter table public.season_results enable row level security;
revoke all on public.season_results from anon, authenticated;

-- Заводит запись текущего сезона, если её ещё нет. Нужна, чтобы было куда
-- проставить призовой фонд до того, как сезон закончится.
create or replace function app.ensure_season() returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.seasons (starts_at, ends_at)
  values (app.season_start(), app.season_end())
  on conflict (starts_at) do nothing;
end $$;

-- Закрывает все сезоны, чей срок вышел, и записывает победителей по каждой
-- игре, где вообще были зачтённые раунды.
create or replace function app.close_due_seasons() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  s public.seasons;
  closed integer := 0;
begin
  for s in
    select * from public.seasons
    where status = 'active' and ends_at <= now()
    order by starts_at
  loop
    insert into public.season_results (season_id, game_id, rank, user_id, name, score)
    select s.id, t.game_id, t.rank, t.user_id, t.name, t.score
    from (
      select
        r.game_id,
        r.user_id,
        coalesce(nullif(u.first_name, ''), u.username, 'Игрок') as name,
        sum(r.score)::integer as score,
        rank() over (partition by r.game_id order by sum(r.score) desc) as rank
      from public.rounds r
      join public.users u on u.telegram_id = r.user_id
      where r.status = 'finished'
        and r.counted
        and r.finished_at >= s.starts_at
        and r.finished_at <  s.ends_at
      group by r.game_id, r.user_id, u.first_name, u.username
    ) t
    where t.rank <= s.prize_places
    on conflict (season_id, game_id, rank) do nothing;

    update public.seasons set status = 'closed' where id = s.id;
    closed := closed + 1;
  end loop;

  -- Следом заводим текущий сезон, чтобы между закрытием и первым раундом
  -- новой недели не было дыры.
  perform app.ensure_season();
  return closed;
end $$;

create or replace function app.tick_seasons() returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform app.close_due_seasons();
end $$;

-- Раз в час в :07. Точность до часа достаточна: сезон переключается в
-- понедельник в полночь по Москве, а рейтинг всё это время считается по
-- временны́м границам, а не по записи в таблице. Запись нужна лишь для
-- фонда и итогов.
--
-- Минута выбрана не нулевая намеренно: на :00 приходится пик планировщиков.
select cron.schedule(
  'rgc-seasons',
  '7 * * * *',
  $job$ select app.tick_seasons() $job$
);

-- Первый прогон сразу, чтобы текущий сезон появился не через час.
select app.tick_seasons();

-- Итоги прошлых сезонов — публичное чтение для экрана «Рейтинг».
create or replace function public.get_season_results(p_game_id text, p_limit integer default 3)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform app.require_uid();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'rank', sr.rank, 'name', sr.name, 'score', sr.score,
      'prize', sr.prize_amount,
      'seasonStart', s.starts_at, 'seasonEnd', s.ends_at
    ) order by s.starts_at desc, sr.rank)
    from public.season_results sr
    join public.seasons s on s.id = sr.season_id
    where sr.game_id = p_game_id
      and s.starts_at = (select max(s2.starts_at) from public.seasons s2
                         where s2.status = 'closed')
      and sr.rank <= p_limit
  ), '[]'::jsonb);
end $$;

revoke all on function public.get_season_results(text, integer) from public, anon;
grant execute on function public.get_season_results(text, integer) to authenticated;
