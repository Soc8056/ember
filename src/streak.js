// Deterministic personal-streak computation (PRD §3.2, GOAL-10, NF-4).
//
// This is a PURE function of the finalized day-log plus CONFIG — never dependent on a
// scheduled job. It walks the finalized history forward (which is equivalent to the
// backward walk in the spec but also yields the freeze economy in one pass), then lets
// today extend the streak only once today becomes perfect.
//
// `finalizedDays`: array of { local_date, is_perfect }, chronological ASC, gap-filled
//                  (a truly missed day must appear as { is_perfect:false }).
// `todayIsPerfect`: whether today (in progress) is currently a perfect day.

import { CONFIG } from './config.js';
import { prevDay, addDays } from './dates.js';

export function computeStreak(finalizedDays, todayIsPerfect) {
  if (!Array.isArray(finalizedDays)) finalizedDays = [];
  const MAX = CONFIG.STREAK_FREEZE_MAX;
  const REGEN = CONFIG.FREEZE_REGEN_AFTER_PERFECT_DAYS;

  let current = 0;          // consecutive perfect (freeze-protected) days up to the last finalized day
  let longest = 0;
  let freezes = MAX;        // users start with a full charge
  let sinceFreeze = 0;      // perfect days since the last freeze grant/consumption
  let lastWasFrozen = false; // most recent finalized day was saved by a freeze

  for (const day of finalizedDays) {
    if (day.is_perfect) {
      current += 1;
      if (current > longest) longest = current;
      sinceFreeze += 1;
      lastWasFrozen = false;
      if (sinceFreeze >= REGEN && freezes < MAX) {   // regenerate one freeze after a clean run
        freezes += 1;
        sinceFreeze = 0;
      }
    } else if (freezes > 0) {
      freezes -= 1;          // auto-consume a freeze: streak preserved, NOT incremented
      sinceFreeze = 0;
      lastWasFrozen = true;
    } else {
      current = 0;           // no protection left → streak ends at this gap
      sinceFreeze = 0;
      lastWasFrozen = false;
    }
  }

  const display = current + (todayIsPerfect ? 1 : 0);
  if (display > longest) longest = display;

  // UI state (maps to the design's active | atrisk | frozen | zero)
  let state;
  if (display === 0) state = 'zero';
  else if (todayIsPerfect) state = 'active';
  else if (lastWasFrozen) state = 'frozen';
  else state = 'atrisk';       // has a live streak but today isn't perfect yet — don't let it die

  return {
    current: display,
    longest,
    freezesAvailable: freezes,
    perfectDaysSinceFreeze: sinceFreeze,
    frozen: lastWasFrozen,
    state,
  };
}

// Whether a set of completions makes a given day perfect (PRD §3.2 is_perfect).
export function isPerfect(goalsCompleted, goalsTotal) {
  return goalsCompleted >= CONFIG.PERFECT_REQUIRES_MIN_GOALS && goalsCompleted === goalsTotal;
}

// Deterministic PAIRWISE shared streak (PRD §3.3, FRND-6/FRND-7). Also a pure function of
// the day-log: it advances only on dates that are a perfect day for BOTH friends and there
// is NO freeze protection (Resolved Decision #4).
//
// `bothPerfectDates`: the finalized dates (any order) on or after the friendship start where
//                     both users had a perfect day — the server returns exactly this set.
// `today`:            the caller's local date (YYYY-MM-DD).
// `bothPerfectToday`: whether today is currently a perfect day for both friends.
export function computeSharedStreak(bothPerfectDates, today, bothPerfectToday) {
  if (!Array.isArray(bothPerfectDates)) bothPerfectDates = [];
  const finalized = new Set(bothPerfectDates.filter((d) => d < today));

  // current: contiguous run of both-perfect finalized days ending yesterday, then today extends it.
  let finalizedRun = 0;
  for (let d = prevDay(today); finalized.has(d); d = prevDay(d)) {
    finalizedRun += 1;
    if (finalizedRun > 4000) break; // safety valve (~11 years)
  }
  const current = finalizedRun + (bothPerfectToday ? 1 : 0);

  // longest: the longest contiguous run across all both-perfect days (today included if live).
  const all = new Set(finalized);
  if (bothPerfectToday) all.add(today);
  let longest = 0;
  for (const d of all) {
    if (all.has(prevDay(d))) continue;         // only start counting at a run's first day
    let run = 0;
    for (let c = d; all.has(c); c = addDays(c, 1)) { run += 1; if (run > 4000) break; }
    if (run > longest) longest = run;
  }

  // at-risk once there's a live streak but today isn't perfect for both yet — don't let it die.
  const state = current === 0 ? 'zero' : bothPerfectToday ? 'active' : 'atrisk';
  return { current, longest, state };
}
