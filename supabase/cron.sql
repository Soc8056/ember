-- Ember scheduler wiring (PRD §10 Scheduler) — PRIMARY path: pg_cron → sweep Edge Function.
-- Run this ONCE in the Supabase SQL editor after deploying the `sweep` function and setting its
-- secrets. It is NOT a migration (it embeds your project ref + sweep secret), so it lives apart
-- from supabase/migrations. The GitHub Actions workflow is the documented fallback (§12).
--
-- Fill in:
--   <PROJECT-REF>   your Supabase project ref (e.g. abcd1234)
--   <SWEEP_SECRET>  the same value you set as the `SWEEP_SECRET` function secret

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- every 15 minutes (SCHED_SWEEP_MINUTES); the function itself honors each user's local time.
select cron.schedule(
  'ember-sweep',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT-REF>.functions.supabase.co/sweep',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sweep-secret', '<SWEEP_SECRET>'),
    body    := '{}'::jsonb
  );
  $$
);

-- Manage:
--   select * from cron.job;                    -- list schedules
--   select cron.unschedule('ember-sweep');     -- remove
