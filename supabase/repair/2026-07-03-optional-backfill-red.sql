-- OPTIONAL one-off backfill — run ONLY if red confirms they actually finished
-- their goal on Fri Jul 3 2026 and the fixed app didn't record it in time.
--
-- Why it might be missing: before the rollover fix (see logs.md), red's installed
-- PWA resumed from memory still showing Jul 2 — their goal appeared already
-- checked, so nothing was ever written for Jul 3 (their profile's
-- last_evaluated_date was stuck at 2026-07-02 when this was diagnosed).
--
-- NOTE: it is also possible red's "two days" were both Jul 2 by the calendar —
-- their only recorded completion is 12:51 AM EDT Jul 2, i.e. "Wednesday night"
-- landing on Thursday's date, correctly. Ask before running this.

insert into public.completions (user_id, goal_id, local_date)
values ('9378bb79-2c9a-4d0d-bc10-6d0166c1bbf3',   -- red
        '6af22d63-3de4-40cc-a27a-882c19e2696e',   -- their goal
        '2026-07-03')
on conflict (user_id, goal_id, local_date) do nothing;

insert into public.day_results (user_id, local_date, goals_total, goals_completed, is_perfect, finalized)
values ('9378bb79-2c9a-4d0d-bc10-6d0166c1bbf3', '2026-07-03', 1, 1, true, false)
on conflict (user_id, local_date) do update
  set goals_total = 1, goals_completed = 1, is_perfect = true;

-- red's profile streak cache self-heals on their next app open (loadToday →
-- persistStreakCache); no need to touch profiles here.
