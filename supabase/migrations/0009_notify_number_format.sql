-- Разделитель тысяч в текстах уведомлений.
--
-- to_char с шаблоном G берёт разделитель из локали сервера, а там английская
-- запятая: «5,380» вместо «5 380». Мелочь, но она бросается в глаза в первом
-- же сообщении от бота и читается как небрежность.
--
-- Отдельная функция вместо правки на месте: форматирование чисел понадобится
-- и в итогах сезона, и в будущих поводах — пусть будет одно место.

create or replace function app.fmt_score(p_score numeric) returns text
language sql immutable set search_path = ''
as $$
  -- Неразрывный пробел: иначе перенос строки может разорвать число пополам.
  select replace(pg_catalog.to_char(p_score, 'FM999G999G999'), ',', U&'\00A0')
$$;

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
                      app.fmt_score(pos.score) || '.'
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
