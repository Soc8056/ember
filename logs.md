# Ember — engineering log

## 2026-07-03 — Streak loss root-caused & fixed; photo verification shipped

### The bug: "two perfect days in a row read as 1"

**What it was NOT.** The suspected UTC-bucketing bug doesn't exist: completions were
already stored under the user's **local** calendar date (`completions.local_date`,
derived from the profile's IANA timezone via `Intl.DateTimeFormat`), and all streak
math already compares `YYYY-MM-DD` strings (DST-safe). Verified against production:
zarathustra's 11:26–11:58 PM CDT completions landed on the correct local day.

**What it was: the app never rolls over to a new day inside a long-lived session.**
`state.localDate` was derived exactly once, in `loadToday()`, which only ran at page
load. No `visibilitychange`/`focus` listener, no midnight timer. An installed PWA
resumes from memory for days without reloading, so on day N+1 the app still showed
day N — its date label, its checked goals, its streak. Taps wrote to day N's
`local_date` (no-op upserts); day N+1 recorded **nothing**. On the next real reload
the missing day gap-filled as imperfect, the single freeze silently absorbed it, and
the streak displayed 1 (frozen) instead of 2.

Classification: not a compute-on-load bug, not a persist bug — both were correct.
It's a **capture-time day-attribution bug**: the inputs written for the new day were
wrong (or absent), so every later recomputation faithfully returned the wrong answer.

Production evidence (read-only, service key): red's profile `last_evaluated_date`
was stuck at `2026-07-02` with no Jul 3 rows despite claimed use — the fingerprint
of a resident PWA that never re-derived "today". zarathustra's two days were fully
recorded and his streak cache correctly read 2 after a fresh load.

**Secondary hole (same symptom family):** the streak walk reads only `day_results`,
but the offline queue replay (`replayPending`) wrote completions **without** ever
updating `day_results` — a day completed offline kept `is_perfect: false` forever.

### The fix

- `src/store.js` — `ensureToday()`: re-derives the local date and reloads Today when
  it changed. Triggered on `visibilitychange` → visible, `window` focus, and a 60 s
  interval while visible. `toggleGoal()` also calls it first, so a tap can never
  write against a stale date (the tap is dropped and the fresh day repaints — the
  events above make this a rare last line of defense). `loadToday()` now clears the
  previous day's checkmarks/photos whenever the date it derives differs from the
  cached one.
- `src/store.js` — `replayPending()` now upserts `day_results` for every replayed
  date (`goals_total` approximated by the current active-goal count — exact for the
  common overnight case).
- `src/streak.js` — the history assembly was extracted from the store into a pure
  `buildHistory(rows, today)` so it's unit-testable.
- `sw.js` — shell version bumped (v9) so installed PWAs fetch the fixed modules.

### Migration / data repair

- **No storage-format change was needed** — dates were already local. Migration
  `0005_photos.sql` includes an idempotent repair that recomputes `day_results`
  from `completions` (counts per user/date; `goals_total` from each goal's
  `created_at`/`archived_at` window evaluated in the owner's timezone), healing any
  offline-replay damage. Hand-traced against all current prod rows: it's a no-op on
  healthy data (zarathustra 3/3 ✓, 4/4 ✓; red 1/1 ✓).
- **zarathustra**: both perfect days were on disk; streak already reads 2. Nothing to fix.
- **red**: Jul 3 was never written by the buggy client and cannot be reconstructed.
  `supabase/repair/2026-07-03-optional-backfill-red.sql` is an **optional, manual**
  backfill to credit it — run only after red confirms they actually finished Jul 3
  (their only recorded completion is 12:51 AM EDT Jul 2, so their "first day" may
  itself have been a post-midnight tap that calendar-correctly landed on Jul 2).
- ⚠️ Migrations are applied manually in the SQL editor — **0004 and now 0005 are both
  pending**.

### Photo verification (M5)

- One optional photo per completed goal per day. Client-side compression
  (`src/photos.js`: ≤1280 px long edge, JPEG q0.8 → ~100–300 KB) then upload to the
  **private** `photos` Supabase Storage bucket (`userId/localDate/goalId.jpg`,
  owner-scoped RLS — no new blob infrastructure; Supabase Storage is the blob store).
  The path is denormalized onto `completions.photo_path`; reads use signed URLs.
- Today screen: camera chip on checked rows (thumbnail once attached; tap to retake),
  and a **Share my day** button that canvas-renders a 1080×1350 card (streak, date,
  completed checklist, first photo) and hands it to the native share sheet via the
  Web Share API, falling back to a PNG download.
- `REQUIRE_PHOTO_TO_VERIFY` in `src/config.js`, **default false** — photos never gate
  completion unless flipped on (then tapping an unchecked goal opens the camera and
  the photo completes it). Recommendation: leave off; friction kills a 5-task daily
  habit and the share card provides the social verification.
- Unchecking a goal discards that day's photo (row deleted; storage cleanup
  best-effort). Punted: uploading photos captured while offline (photo needs
  connectivity; the checkmark itself still queues fine).

### Tests

`npm test` (`node --test`, zero deps) — `tests/streak.test.mjs`, 13 passing:
consecutive perfect days = 2 (live and finalized), same-day double-completion
no-double-count, gap with/without freeze, near-midnight attribution in
America/New_York (explicit zones — machine-independent), DST spring-forward
(23 h day) and fall-back (25 h day, no phantom day), `buildHistory` gap-fill,
and regressions replaying the exact prod rows from this incident.
