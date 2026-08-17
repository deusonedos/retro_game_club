-- Расписание рассылки.
--
-- Планировщику нужен CRON_SECRET, чтобы дёрнуть отправщика. Секрет лежит
-- в Vault, а не в тексте задания: cron.job виден всякому, у кого есть доступ
-- к базе, и секрет из расписания утёк бы вместе с любым дампом схемы.
--
-- Значение кладётся владельцем один раз вручную (см. README) — так оно
-- не проходит ни через репозиторий, ни через переписку.

create or replace function app.dispatch_notifications() returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_secret text;
  v_url    text := 'https://jcrwxfqhfaojpgtkhmbn.supabase.co/functions/v1/notify';
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'cron_secret';

  if v_secret is null then
    raise notice 'секрет cron_secret не найден в Vault — рассылка пропущена';
    return;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',   'application/json',
      'x-cron-secret',  v_secret
    ),
    body    := '{}'::jsonb
  );
end $$;

-- Каждые 10 минут. Очередь наполняется раз в час, но отправка чаще — чтобы
-- сообщение о конце сезона не опаздывало на час от момента постановки.
-- Минута смещена от нуля: на :00 приходится пик планировщиков.
select cron.schedule(
  'rgc-notifications-send',
  '3,13,23,33,43,53 * * * *',
  $job$ select app.dispatch_notifications() $job$
);
