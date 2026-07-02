-- Ember — Milestone 3 schema (Notifications, best-effort)
-- Push subscriptions, the scheduler's idempotency guard, nudge records, and one
-- security-definer selector the sweep uses to find who's due right now. Everything here is
-- NON-load-bearing: streaks are still a pure function of the day-log (NF-4, Resolved #5) —
-- a missed sweep or a dead subscription can never corrupt a streak.

-- ---------------------------------------------------------------------------
-- push_subscriptions  (one row per device/browser; PRD §4 PushSubscription, NOTIF-4)
-- ---------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  endpoint   text        not null unique,     -- the push service URL (unique per device)
  p256dh     text        not null,
  auth       text        not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- ---------------------------------------------------------------------------
-- notifications_sent  (scheduler idempotency guard; PRD §4, Scheduler)
-- ---------------------------------------------------------------------------
create table if not exists public.notifications_sent (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  type       text        not null check (type in ('reminder','streak_risk')),
  local_date date        not null,
  sent_at    timestamptz not null default now(),
  unique (user_id, type, local_date)
);

-- ---------------------------------------------------------------------------
-- nudges  (one poke from a friend; PRD §4 Nudge, NOTIF-8 rate limiting)
-- ---------------------------------------------------------------------------
create table if not exists public.nudges (
  id         uuid primary key default gen_random_uuid(),
  from_user  uuid        not null references public.profiles(id) on delete cascade,
  to_user    uuid        not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists nudges_pair_day_idx on public.nudges (from_user, to_user, created_at);

-- ---------------------------------------------------------------------------
-- Row-Level Security (NF-7). Owners manage their own rows; the sweep + send-nudge Edge
-- Functions use the service-role key, which bypasses RLS for the cross-user reads they need.
-- ---------------------------------------------------------------------------
alter table public.push_subscriptions enable row level security;
alter table public.notifications_sent enable row level security;
alter table public.nudges             enable row level security;

-- a user manages only their own device subscriptions
drop policy if exists push_subscriptions_all_own on public.push_subscriptions;
create policy push_subscriptions_all_own on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- a user may read their own send-log (informational); writes come from the scheduler (service role)
drop policy if exists notifications_sent_select_own on public.notifications_sent;
create policy notifications_sent_select_own on public.notifications_sent
  for select using (auth.uid() = user_id);

-- a user can see nudges involving them; the send path (insert) is the send-nudge function
drop policy if exists nudges_select_mine on public.nudges;
create policy nudges_select_mine on public.nudges
  for select using (auth.uid() = from_user or auth.uid() = to_user);

-- ---------------------------------------------------------------------------
-- notifications_due() — the Scheduler's selector (PRD Scheduler, NOTIF-6/-7/-10).
-- Returns one row per (user, kind) that should be pushed RIGHT NOW, evaluated in each user's
-- own local time and already de-duplicated against notifications_sent. The sweep still does an
-- insert-guarded send, so concurrent sweeps can't double-send. Pure read — sends nothing.
--
--   reminder    : local time in [reminder_time, 21:30), today not yet perfect, not already sent.
--   streak_risk : local time >= 21:30, streak alive AND no freeze would silently save it
--                 (freezes_available = 0), today not perfect, and no evening nudge sent yet
--                 (deduped with the reminder — max one evening nudge, NOTIF-7).
-- ---------------------------------------------------------------------------
create or replace function public.notifications_due()
returns table (user_id uuid, kind text, local_date date)
language plpgsql
security definer set search_path = public
as $$
begin
  return query
  with u as (
    select p.id,
           (now() at time zone p.timezone)::date              as ld,
           to_char(now() at time zone p.timezone, 'HH24:MI')  as hm,
           p.reminder_time                                    as rt,
           p.current_streak                                   as cs,
           p.freezes_available                                as fz
    from public.profiles p
    where p.notifications_enabled = true
      and exists (select 1 from public.push_subscriptions ps where ps.user_id = p.id)
  ),
  flags as (
    select u.*,
      exists (select 1 from public.day_results dr
              where dr.user_id = u.id and dr.local_date = u.ld and dr.is_perfect)        as perfect,
      exists (select 1 from public.notifications_sent ns
              where ns.user_id = u.id and ns.local_date = u.ld and ns.type = 'reminder') as sent_reminder,
      exists (select 1 from public.notifications_sent ns
              where ns.user_id = u.id and ns.local_date = u.ld and ns.type = 'streak_risk') as sent_risk
    from u
  )
  select f.id, 'reminder'::text, f.ld
    from flags f
    where not f.perfect and not f.sent_reminder
      and f.hm >= f.rt and f.hm < '21:30'
  union all
  select f.id, 'streak_risk'::text, f.ld
    from flags f
    where not f.perfect and f.cs > 0 and f.fz = 0
      and f.hm >= '21:30'
      and not f.sent_reminder and not f.sent_risk;
end;
$$;

-- The selector runs only from the scheduler (service role); no need to grant it to end users.
