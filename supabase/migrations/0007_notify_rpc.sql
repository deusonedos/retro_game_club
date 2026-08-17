-- Обёртки для отправщика уведомлений.
--
-- Логика живёт в схеме app, но PostgREST публикует только public — значит
-- вызвать её снаружи нельзя. Вместо того чтобы открывать всю схему app,
-- выставляем ровно две точки и только для service_role: ни анониму, ни
-- обычному игроку они недоступны даже по имени.

create or replace function public.notify_batch(p_limit integer default 30)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  return app.notification_batch(p_limit);
end $$;

create or replace function public.notify_record(
  p_id bigint, p_ok boolean, p_error text default null, p_blocked boolean default false
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform app.record_notification(p_id, p_ok, p_error, p_blocked);
end $$;

/** Подписка и отписка по командам бота. */
create or replace function public.notify_subscription(p_uid bigint, p_enabled boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform app.set_notifications(p_uid, p_enabled);
end $$;

revoke all on function
  public.notify_batch(integer),
  public.notify_record(bigint, boolean, text, boolean),
  public.notify_subscription(bigint, boolean)
from public, anon, authenticated;

grant execute on function
  public.notify_batch(integer),
  public.notify_record(bigint, boolean, text, boolean),
  public.notify_subscription(bigint, boolean)
to service_role;
