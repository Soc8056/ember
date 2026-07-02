-- Ember — Friend codes (replaces single-use invite links as the primary add-friend path)
--
-- The M2 invites were single-use + 7-day expiry, and the accept flow required the
-- ?invite= code to survive a localStorage round-trip through sign-in — which dies in
-- in-app browsers (iMessage/Instagram webviews have storage separate from Safari).
-- This migration gives every user ONE permanent, reusable 6-character code:
--   * shareable as a link (?invite=<code>) that never expires and works for any
--     number of friends, and
--   * short enough to just text someone, who types it into the app directly —
--     no URL round-trip, so the webview problem disappears.
--
--   my_friend_code()            -> the caller's code, minted on first call
--   add_friend_by_code(code)    -> establishes an accepted friendship (reusable)
--
-- The legacy invites table + create_invite/accept_invite RPCs stay for any old
-- links still in flight; the client falls back to accept_invite when a code
-- doesn't match a friend code.

-- ---------------------------------------------------------------------------
-- profiles.friend_code — permanent, unique, uppercase; NULL until first requested
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists friend_code text unique;

-- 6 chars from an unambiguous alphabet (no 0/O, 1/I/L) — 31^6 ≈ 890M combinations,
-- collision-negligible at this app's scale; my_friend_code() retries on the off chance.
create or replace function public.gen_friend_code()
returns text
language sql
volatile
as $$
  select string_agg(substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', (floor(random() * 31) + 1)::int, 1), '')
  from generate_series(1, 6);
$$;

-- ---------------------------------------------------------------------------
-- my_friend_code() — returns the caller's permanent code, minting it on first use.
-- ---------------------------------------------------------------------------
create or replace function public.my_friend_code()
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  me    uuid := auth.uid();
  code  text;
  tries int  := 0;
begin
  if me is null then raise exception 'not_authenticated'; end if;

  select friend_code into code from public.profiles where id = me;
  if code is not null then return code; end if;

  loop
    code := public.gen_friend_code();
    begin
      update public.profiles set friend_code = code where id = me;
      return code;
    exception when unique_violation then
      tries := tries + 1;
      if tries > 5 then raise; end if;
    end;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- add_friend_by_code(code) — reusable accept_invite. Case/whitespace-insensitive,
-- never expires, never burns. Idempotent if the pair already exists.
-- ---------------------------------------------------------------------------
create or replace function public.add_friend_by_code(p_code text)
returns json
language plpgsql
security definer set search_path = public
as $$
declare
  me     uuid := auth.uid();
  target uuid;
  ua     uuid;
  ub     uuid;
  fid    uuid;
begin
  if me is null then raise exception 'not_authenticated'; end if;

  select id into target from public.profiles
    where friend_code = upper(trim(p_code));
  if not found      then raise exception 'code_not_found'; end if;
  if target = me    then raise exception 'code_self';      end if;

  -- canonical ordering keeps (user_a, user_b) unique regardless of direction
  if target < me then ua := target; ub := me;
  else                ua := me;     ub := target; end if;

  insert into public.friendships (user_a, user_b, status)
    values (ua, ub, 'accepted')
    on conflict (user_a, user_b) do update set status = 'accepted'
    returning id into fid;

  return json_build_object('friendship_id', fid, 'friend_id', target);
end;
$$;

grant execute on function public.my_friend_code()          to authenticated;
grant execute on function public.add_friend_by_code(text)  to authenticated;
-- gen_friend_code is internal; no grant needed (definer functions call it as owner).
