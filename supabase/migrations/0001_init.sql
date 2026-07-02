-- Ember — Milestone 1 schema (Goals + personal streak)
-- Maps 1:1 to the interfaces in PRD §4. Friends/notifications tables arrive in M2/M3.
-- Source of truth: Postgres. Streaks are a pure function of the completion/day_result log (PRD §3.2, NF-4).

-- ---------------------------------------------------------------------------
-- profiles  (PRD `User`; keyed to auth.users so streaks/graph persist per AUTH-4)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id                        uuid primary key references auth.users(id) on delete cascade,
  email                     text,
  display_name              text,                                   -- 1..24, set on first run (AUTH-2)
  avatar_emoji              text        not null default '🦔',
  avatar_color              text        not null default '#3E6B99',
  timezone                  text        not null default 'UTC',     -- IANA (AUTH-3)
  reminder_time             text        not null default '20:00',   -- HH:MM local
  notifications_enabled     boolean     not null default false,
  -- streak cache (reconcilable from day_results; NOT source of truth, PRD §3.2)
  current_streak            integer     not null default 0,
  longest_streak            integer     not null default 0,
  freezes_available         integer     not null default 1,
  perfect_days_since_freeze integer     not null default 0,
  last_evaluated_date       date,
  created_at                timestamptz not null default now(),
  constraint display_name_len check (display_name is null or char_length(display_name) between 1 and 24)
);

-- ---------------------------------------------------------------------------
-- goals  (recurring daily; GOAL-1..GOAL-4)
-- ---------------------------------------------------------------------------
create table if not exists public.goals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid        not null references public.profiles(id) on delete cascade,
  title       text        not null,
  emoji       text,
  sort_order  integer     not null default 0,
  active      boolean     not null default true,   -- false == archived; keeps historical completions (GOAL-2)
  created_at  timestamptz not null default now(),
  archived_at timestamptz,
  constraint goal_title_len check (char_length(title) between 1 and 60)
);
create index if not exists goals_user_active_idx on public.goals (user_id, active, sort_order);

-- ---------------------------------------------------------------------------
-- completions  (one per goal per local date; GOAL-6)
-- ---------------------------------------------------------------------------
create table if not exists public.completions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid        not null references public.profiles(id) on delete cascade,
  goal_id      uuid        not null references public.goals(id) on delete cascade,
  local_date   date        not null,                 -- user's LOCAL calendar date at completion
  completed_at timestamptz not null default now(),
  unique (user_id, goal_id, local_date)
);
create index if not exists completions_user_date_idx on public.completions (user_id, local_date);

-- ---------------------------------------------------------------------------
-- day_results  (per-user/-date snapshot; source data for streak walk, PRD §3.2)
-- ---------------------------------------------------------------------------
create table if not exists public.day_results (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid        not null references public.profiles(id) on delete cascade,
  local_date      date        not null,
  goals_total     integer     not null default 0,     -- active goals applicable that date (snapshot at finalize)
  goals_completed integer     not null default 0,
  is_perfect      boolean     not null default false,
  freeze_used     boolean     not null default false,
  finalized       boolean     not null default false, -- true once past local rollover
  unique (user_id, local_date)
);
create index if not exists day_results_user_date_desc_idx on public.day_results (user_id, local_date desc);

-- ---------------------------------------------------------------------------
-- Row-Level Security  (NF-7: a user touches only their own rows)
-- ---------------------------------------------------------------------------
alter table public.profiles    enable row level security;
alter table public.goals       enable row level security;
alter table public.completions enable row level security;
alter table public.day_results enable row level security;

-- profiles: owner-only in M1 (friend public-field policy is added in M2)
create policy profiles_select_own on public.profiles for select using (auth.uid() = id);
create policy profiles_insert_own on public.profiles for insert with check (auth.uid() = id);
create policy profiles_update_own on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- goals / completions / day_results: full CRUD only for the owner
create policy goals_all_own       on public.goals       for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy completions_all_own on public.completions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy day_results_all_own on public.day_results for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- New-user hook: create a profile row on sign-up (AUTH-2 completes it later)
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
