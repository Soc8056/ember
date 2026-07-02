-- Ember — Milestone 2 schema (Friends + shared streaks)
-- Adds `friendships` + `invites` (PRD §4) and three security-definer RPCs that let a
-- signed-in user act across the friend boundary WITHOUT ever exposing goals/completions:
--   create_invite()          -> a single-use, expiring invite code (FRND-1)
--   accept_invite(code)       -> establishes an accepted friendship immediately (FRND-2)
--   friends_overview()        -> each friend's PUBLIC fields + coarse today status + the
--                                both-perfect date set the client walks into a shared streak
-- Friend reads go exclusively through these definer functions, so table-level RLS keeps
-- profiles/goals/completions owner-private (PRD §5, FRND-4, NF-7). Shared streaks stay a
-- deterministic pure function of the day-log (PRD §3.3, NF-4) — nothing here is load-bearing.

-- ---------------------------------------------------------------------------
-- friendships  (pairwise, symmetric; canonical user_a < user_b keeps pairs unique)
-- ---------------------------------------------------------------------------
create table if not exists public.friendships (
  id                            uuid primary key default gen_random_uuid(),
  user_a                        uuid        not null references public.profiles(id) on delete cascade,
  user_b                        uuid        not null references public.profiles(id) on delete cascade,
  status                        text        not null default 'accepted' check (status in ('pending','accepted')),
  created_at                    timestamptz not null default now(),
  -- shared-streak cache (reconcilable from both users' day_results; NOT source of truth)
  shared_current                integer     not null default 0,
  shared_longest                integer     not null default 0,
  shared_last_both_perfect_date date,
  constraint friendship_pair_order check (user_a < user_b),
  unique (user_a, user_b)
);
create index if not exists friendships_user_a_idx on public.friendships (user_a);
create index if not exists friendships_user_b_idx on public.friendships (user_b);

-- ---------------------------------------------------------------------------
-- invites  (single-use link codes; possession == consent, PRD FRND-2)
-- ---------------------------------------------------------------------------
create table if not exists public.invites (
  id          uuid primary key default gen_random_uuid(),
  inviter_id  uuid        not null references public.profiles(id) on delete cascade,
  code        text        not null unique,          -- url-safe, single-use
  used_by     uuid        references public.profiles(id) on delete set null,
  expires_at  timestamptz not null,                 -- now() + INVITE_TTL_DAYS (§6)
  created_at  timestamptz not null default now()
);
create index if not exists invites_code_idx on public.invites (code);

-- ---------------------------------------------------------------------------
-- Row-Level Security (NF-7). Direct table access stays owner-scoped; everything
-- cross-user runs through the security-definer functions below.
-- ---------------------------------------------------------------------------
alter table public.friendships enable row level security;
alter table public.invites     enable row level security;

-- friendships: either party may see or remove the pair (FRND-3, FRND-5).
-- Inserts happen only inside accept_invite() (definer) — no direct insert policy.
create policy friendships_select_mine on public.friendships
  for select using (auth.uid() = user_a or auth.uid() = user_b);
create policy friendships_delete_mine on public.friendships
  for delete using (auth.uid() = user_a or auth.uid() = user_b);

-- invites: an inviter fully owns their own outstanding invites. Acceptance (by someone
-- who is NOT the inviter) is handled by accept_invite() as definer, so no cross-read policy.
create policy invites_select_own on public.invites
  for select using (auth.uid() = inviter_id);
create policy invites_insert_own on public.invites
  for insert with check (auth.uid() = inviter_id);
create policy invites_delete_own on public.invites
  for delete using (auth.uid() = inviter_id);

-- ---------------------------------------------------------------------------
-- create_invite() — FRND-1. Mints a single-use code owned by the caller, valid for
-- INVITE_TTL_DAYS. Returns the bare code; the client builds the shareable URL.
-- ---------------------------------------------------------------------------
create or replace function public.create_invite()
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  me   uuid := auth.uid();
  code text;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  -- 8 hex chars from a fresh uuid — collision-negligible for a friend group.
  code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  insert into public.invites (inviter_id, code, expires_at)
    values (me, code, now() + interval '7 days');   -- CONFIG.INVITE_TTL_DAYS
  return code;
end;
$$;

-- ---------------------------------------------------------------------------
-- accept_invite(code) — FRND-2. Validates the code (exists, unused, unexpired, not the
-- caller's own), then establishes an ACCEPTED friendship immediately and burns the code.
-- Idempotent if the pair already exists. Raises a coded error otherwise.
-- ---------------------------------------------------------------------------
create or replace function public.accept_invite(p_code text)
returns json
language plpgsql
security definer set search_path = public
as $$
declare
  me  uuid := auth.uid();
  inv public.invites%rowtype;
  ua  uuid;
  ub  uuid;
  fid uuid;
begin
  if me is null then raise exception 'not_authenticated'; end if;

  select * into inv from public.invites where code = p_code;
  if not found                     then raise exception 'invite_not_found'; end if;
  if inv.inviter_id = me           then raise exception 'invite_self';      end if;
  if inv.expires_at < now()        then raise exception 'invite_expired';   end if;
  if inv.used_by is not null
     and inv.used_by <> me         then raise exception 'invite_used';      end if;

  -- canonical ordering keeps (user_a, user_b) unique regardless of who invited whom
  if inv.inviter_id < me then ua := inv.inviter_id; ub := me;
  else                        ua := me;            ub := inv.inviter_id; end if;

  insert into public.friendships (user_a, user_b, status)
    values (ua, ub, 'accepted')
    on conflict (user_a, user_b) do update set status = 'accepted'
    returning id into fid;

  update public.invites set used_by = me where id = inv.id;

  return json_build_object('friendship_id', fid, 'friend_id', inv.inviter_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- friends_overview() — FRND-3/-4/-6/-7. For each accepted friend of the caller returns:
--   * PUBLIC profile fields only (name, avatar, cached personal streak) — never goals.
--   * coarse today status in the FRIEND's own timezone: perfect | inprogress | notstarted.
--   * both_perfect_dates: the dates (since the friendship began) on which BOTH users had a
--     perfect day. The client walks this into a shared streak via streak.js — so the pure
--     deterministic algorithm lives in one place and no raw friend rows ever leave the DB.
-- ---------------------------------------------------------------------------
create or replace function public.friends_overview()
returns table (
  friendship_id       uuid,
  friend_id           uuid,
  display_name        text,
  avatar_emoji        text,
  avatar_color        text,
  current_streak      integer,
  longest_streak      integer,
  today_status        text,
  both_perfect_dates  date[]
)
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'not_authenticated'; end if;

  return query
  with fr as (
    select f.id as friendship_id,
           case when f.user_a = me then f.user_b else f.user_a end as friend_id,
           f.created_at::date as since
    from public.friendships f
    where f.status = 'accepted' and (f.user_a = me or f.user_b = me)
  )
  select
    fr.friendship_id,
    fr.friend_id,
    p.display_name,
    p.avatar_emoji,
    p.avatar_color,
    p.current_streak,
    p.longest_streak,
    coalesce((
      select case
               when dr.is_perfect             then 'perfect'
               when dr.goals_completed > 0    then 'inprogress'
               else 'notstarted'
             end
      from public.day_results dr
      where dr.user_id = fr.friend_id
        and dr.local_date = (now() at time zone p.timezone)::date
    ), 'notstarted') as today_status,
    coalesce((
      select array_agg(a.local_date order by a.local_date)
      from public.day_results a
      join public.day_results b
        on b.user_id = fr.friend_id and b.local_date = a.local_date
      where a.user_id = me
        and a.is_perfect and b.is_perfect
        and a.local_date >= fr.since
    ), '{}'::date[]) as both_perfect_dates
  from fr
  join public.profiles p on p.id = fr.friend_id;
end;
$$;

-- Expose the RPCs to signed-in users (they run as definer, so they can cross the boundary
-- in exactly the controlled ways above — and nowhere else).
grant execute on function public.create_invite()            to authenticated;
grant execute on function public.accept_invite(text)        to authenticated;
grant execute on function public.friends_overview()         to authenticated;
