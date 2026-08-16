-- Единый вид строки админки.
--
-- Было: admin_list_users отдавал строку списка, а admin_set_tier — профиль
-- игрока. Экран после переключения тарифа подставлял ответ в список и терял
-- «последний визит» и число раундов. Теперь обе функции собирают строку
-- одной и той же функцией, разъехаться нечему.

create or replace function app.admin_row_json(p_uid bigint) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'userId',      u.telegram_id,
    'name',        coalesce(nullif(u.first_name, ''), 'Игрок'),
    'username',    u.username,
    'tier',        case when e.id is null then 'free' else 'pro' end,
    'proSource',   e.source,
    'firstSeenAt', u.first_seen_at,
    'lastSeenAt',  u.last_seen_at,
    'roundsTotal', (select count(*) from public.rounds r
                    where r.user_id = u.telegram_id and r.status = 'finished')
  )
  from public.users u
  left join lateral (
    select en.id, en.source from public.entitlements en
    where en.user_id = u.telegram_id
      and en.revoked_at is null
      and en.starts_at <= now()
      and (en.ends_at is null or en.ends_at > now())
    order by en.starts_at desc
    limit 1
  ) e on true
  where u.telegram_id = p_uid
$$;

create or replace function public.admin_list_users() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_admin bigint := app.require_admin();
begin
  return coalesce((
    select jsonb_agg(app.admin_row_json(u.telegram_id) order by u.last_seen_at desc)
    from public.users u
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
    update public.entitlements e set revoked_at = now()
     where e.user_id = p_user_id and e.revoked_at is null
       and e.starts_at <= now() and (e.ends_at is null or e.ends_at > now());
  else
    raise exception 'неизвестный тариф: %', p_tier using errcode = '22023';
  end if;

  insert into public.events (user_id, name, props)
  values (v_admin, 'admin_set_tier',
          jsonb_build_object('target', p_user_id, 'tier', p_tier));

  return app.admin_row_json(p_user_id);
end $$;
