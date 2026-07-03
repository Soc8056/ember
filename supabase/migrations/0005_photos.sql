-- Ember — 0005: photo verification (M5) + day_results repair
--
-- 1) completions.photo_path — one optional photo per completed goal per day,
--    stored in the private `photos` storage bucket at userId/localDate/goalId.jpg.
-- 2) Storage bucket + owner-scoped RLS (photos are as private as goal titles, NF-7).
-- 3) One-time repair: recompute day_results from completions. Before this release,
--    completions replayed from the offline queue never updated day_results, so a
--    day could hold all its completions yet stay is_perfect=false forever and the
--    streak walk would see a gap.

-- ---------------------------------------------------------------------------
-- 1) photo on the completion row
-- ---------------------------------------------------------------------------
alter table public.completions add column if not exists photo_path text;

-- ---------------------------------------------------------------------------
-- 2) private storage bucket, owner-scoped by the first path segment (= user id)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

drop policy if exists photos_select_own on storage.objects;
drop policy if exists photos_insert_own on storage.objects;
drop policy if exists photos_update_own on storage.objects;
drop policy if exists photos_delete_own on storage.objects;

create policy photos_select_own on storage.objects for select
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy photos_insert_own on storage.objects for insert
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy photos_update_own on storage.objects for update
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy photos_delete_own on storage.objects for delete
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- 3) repair day_results from completions (idempotent; safe to re-run).
--    goals_total for a date = goals whose active window (created_at .. archived_at,
--    evaluated in the owner's timezone) covers that local date. `finalized` is
--    left untouched — the streak walk derives finality from local_date < today.
-- ---------------------------------------------------------------------------
with counts as (
  select user_id, local_date, count(*)::int as done
  from public.completions
  group by user_id, local_date
),
totals as (
  select c.user_id, c.local_date,
    (select count(*)::int
       from public.goals g
      where g.user_id = c.user_id
        and (g.created_at at time zone p.timezone)::date <= c.local_date
        and (g.archived_at is null or (g.archived_at at time zone p.timezone)::date > c.local_date)
    ) as total
  from (select distinct user_id, local_date from public.completions) c
  join public.profiles p on p.id = c.user_id
)
insert into public.day_results (user_id, local_date, goals_total, goals_completed, is_perfect, finalized)
select t.user_id, t.local_date, t.total, c.done,
       (c.done >= 1 and c.done = t.total), false
from totals t
join counts c using (user_id, local_date)
on conflict (user_id, local_date) do update
  set goals_total     = excluded.goals_total,
      goals_completed = excluded.goals_completed,
      is_perfect      = excluded.is_perfect;
