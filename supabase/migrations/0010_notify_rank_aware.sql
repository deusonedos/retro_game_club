-- Текст уведомления зависит от места игрока.
--
-- Было: всем подряд «Успеешь подняться?» — включая того, кто уже первый.
-- Сообщение, не учитывающее ситуацию адресата, читается как безразличная
-- рассылка, а такие отключают. Цена ошибки высокая: отписавшегося ещё можно
-- вернуть, заблокировавшего бота — уже нет.
--
-- Главное здесь не вежливость, а разрыв до соседа: в играх с таблицей
-- «не хватает 340 очков» двигает сильнее любого призыва.

/** Русские числительные: 1 очко, 2 очка, 5 очков. */
create or replace function app.plural(
  n bigint, form1 text, form2 text, form5 text
) returns text
language sql immutable set search_path = ''
as $$
  select case
    when n % 100 between 11 and 14 then form5
    when n % 10 = 1                then form1
    when n % 10 between 2 and 4    then form2
    else form5
  end
$$;

/** «340 очков» — число с разделителем плюс согласованное слово. */
create or replace function app.score_words(n bigint) returns text
language sql immutable set search_path = ''
as $$
  select app.fmt_score(n) || ' ' || app.plural(n, 'очка', 'очков', 'очков')
$$;

create or replace function app.notification_batch(p_limit integer default 30)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_start  timestamptz := app.season_start();
  v_end    timestamptz := app.season_end();
  v_places integer;
begin
  select coalesce(max(s.prize_places), 3) into v_places
  from public.seasons s where s.starts_at = v_start;

  return coalesce((
    select jsonb_agg(jsonb_build_object('id', q.id, 'userId', q.user_id, 'text', q.text))
    from (
      select n.id, n.user_id,
        case n.kind
          when 'season_ending' then
            'Сезон заканчивается менее чем через 12 часов.' ||
            coalesce((
              select
                E'\nТы на ' || p.rank || '-м месте со счётом ' || app.fmt_score(p.score) || '.'
                ||
                case
                  -- Первый и единственный: звать соревноваться не с кем.
                  when p.rank = 1 and p.behind is null then
                    E'\n\nПока в таблице больше никого. Позови друзей — одному скучно.'
                  when p.rank = 1 then
                    E'\n\nПреследователь отстаёт на ' || app.score_words(p.score - p.behind)
                    || '. Удержишь первое место?'
                  -- В призах, но не первый: показываем, сколько до места выше.
                  when p.rank <= v_places then
                    E'\n\nДо ' || (p.rank - 1) || '-го места не хватает '
                    || app.score_words(p.ahead - p.score + 1) || '.'
                  -- Вне призов: ориентир — попасть в тройку.
                  else
                    E'\n\nДо призовой тройки не хватает '
                    || app.score_words(coalesce(p.prize_cut, p.ahead) - p.score + 1) || '.'
                end
              from (
                select
                  t.user_id, t.score, t.rank,
                  lag(t.score)  over (order by t.rank) as ahead,
                  lead(t.score) over (order by t.rank) as behind,
                  (select t2.score from (
                     select sum(r2.score) as score,
                            rank() over (order by sum(r2.score) desc) as rank
                     from public.rounds r2
                     where r2.status = 'finished' and r2.counted
                       and r2.finished_at >= v_start and r2.finished_at < v_end
                     group by r2.user_id
                   ) t2 where t2.rank = v_places limit 1) as prize_cut
                from (
                  select r.user_id, sum(r.score) as score,
                         rank() over (order by sum(r.score) desc) as rank
                  from public.rounds r
                  where r.status = 'finished' and r.counted
                    and r.finished_at >= v_start and r.finished_at < v_end
                  group by r.user_id
                ) t
              ) p
              where p.user_id = n.user_id
            ), E'\n\nВ этом сезоне ты ещё не играл — самое время.')
          when 'season_results' then
            'Сезон закрыт. Итоги:' ||
            coalesce((
              select string_agg(E'\n' || sr.rank || '. ' || sr.name || ' — ' ||
                                app.fmt_score(sr.score), '' order by sr.rank)
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

grant execute on function app.notification_batch(integer) to service_role;
