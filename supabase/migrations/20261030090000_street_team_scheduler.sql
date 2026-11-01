-- Ten-minute dispatcher; the route itself applies game-state and quota-budget gates.
-- A Vault secret named FDS_SCHEDULER_BEARER_SECRET is required before any HTTP request is sent.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'street-team-incremental-dispatcher') then
    perform cron.unschedule('street-team-incremental-dispatcher');
  end if;

  perform cron.schedule(
    'street-team-incremental-dispatcher',
    '*/10 * * * *',
    $command$
      select net.http_post(
        url := 'https://floyd-dfs.vercel.app/api/street-team/scheduler',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || secret.decrypted_secret,
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb
      )
      from vault.decrypted_secrets as secret
      where secret.name = 'FDS_SCHEDULER_BEARER_SECRET'
        and nullif(secret.decrypted_secret, '') is not null;
    $command$
  );
end;
$$;
