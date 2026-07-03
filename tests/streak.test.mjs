// Streak + day-boundary tests (node --test; zero dependencies).
//
// Timezones are never taken from the machine: every helper under test accepts
// an explicit IANA zone + instant, so these run identically anywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeStreak, isPerfect, buildHistory } from '../src/streak.js';
import { localDate, addDays, prevDay, eachDay } from '../src/dates.js';

const NY = 'America/New_York';
const CHI = 'America/Chicago';

// Mirror the app's write path: a completion is attributed to the user's LOCAL
// calendar date at the moment it happens (store.js localDate), deduped per
// goal+date (the DB's unique(user_id, goal_id, local_date)), and a day is
// perfect when every one of `total` goals has a completion that date.
function dayLogFromCompletions(completions, tz, total) {
  const byDate = new Map();
  for (const c of completions) {
    const d = localDate(tz, new Date(c.at));
    if (!byDate.has(d)) byDate.set(d, new Set());
    byDate.get(d).add(c.goal);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([local_date, goals]) => ({ local_date, is_perfect: isPerfect(goals.size, total) }));
}

// ---------------------------------------------------------------------------
// core streak walk
// ---------------------------------------------------------------------------
test('two consecutive perfect days → streak of 2 (today live)', () => {
  const history = [{ local_date: '2026-07-01', is_perfect: true }]; // yesterday, finalized
  const s = computeStreak(history, true);                           // today just went perfect
  assert.equal(s.current, 2);
  assert.equal(s.state, 'active');
});

test('two finalized perfect days → streak of 2 while today is in progress', () => {
  const history = [
    { local_date: '2026-07-01', is_perfect: true },
    { local_date: '2026-07-02', is_perfect: true },
  ];
  const s = computeStreak(history, false);
  assert.equal(s.current, 2);
  assert.equal(s.state, 'atrisk'); // live streak, today not perfect yet
});

test('same-day double completion does not double-count', () => {
  const tz = NY;
  const completions = [
    { goal: 'g1', at: '2026-07-01T22:00:00-04:00' },
    { goal: 'g1', at: '2026-07-01T23:30:00-04:00' }, // second tap, same goal, same local day
    { goal: 'g1', at: '2026-07-02T09:00:00-04:00' },
  ];
  const log = dayLogFromCompletions(completions, tz, 1);
  assert.equal(log.length, 2); // two days, not three
  const s = computeStreak(log, false);
  assert.equal(s.current, 2);
});

test('a missed day with a freeze available → streak preserved, frozen, not incremented', () => {
  const history = [
    { local_date: '2026-07-01', is_perfect: true },
    { local_date: '2026-07-02', is_perfect: true },
    { local_date: '2026-07-03', is_perfect: false }, // gap — the single freeze absorbs it
  ];
  const s = computeStreak(history, false);
  assert.equal(s.current, 2);
  assert.equal(s.frozen, true);
  assert.equal(s.freezesAvailable, 0);
});

test('a missed day with no freeze left → streak resets', () => {
  const history = [
    { local_date: '2026-07-01', is_perfect: true },
    { local_date: '2026-07-02', is_perfect: false }, // consumes the only freeze
    { local_date: '2026-07-03', is_perfect: true },
    { local_date: '2026-07-04', is_perfect: false }, // no protection → dead
  ];
  const s = computeStreak(history, false);
  assert.equal(s.current, 0);
  assert.equal(s.state, 'zero');
});

// ---------------------------------------------------------------------------
// local-midnight day attribution (the family the shipped bug lives in)
// ---------------------------------------------------------------------------
test('completion just before local midnight lands on that local day (non-UTC zone)', () => {
  // 11:59 PM Wed Jul 1 EDT is 03:59Z *Thursday* — UTC bucketing would get this wrong
  assert.equal(localDate(NY, new Date('2026-07-02T03:59:00Z')), '2026-07-01');
});

test('completion just after local midnight lands on the next local day', () => {
  assert.equal(localDate(NY, new Date('2026-07-02T04:01:00Z')), '2026-07-02');
});

test('perfect days finished at 11:59 PM and the next day 12:01 AM are consecutive → streak 2', () => {
  const completions = [
    { goal: 'g1', at: '2026-07-02T03:59:00Z' }, // Jul 1, 11:59 PM EDT
    { goal: 'g1', at: '2026-07-03T04:01:00Z' }, // Jul 3, 12:01 AM EDT
  ];
  const log = dayLogFromCompletions(completions, NY, 1);
  assert.deepEqual(log.map((d) => d.local_date), ['2026-07-01', '2026-07-03']);
  // Jul 1 ✓, Jul 2 missed (freeze), Jul 3 ✓ — and with no gap the pair below is a clean 2
  const clean = dayLogFromCompletions(
    [{ goal: 'g1', at: '2026-07-02T03:59:00Z' }, { goal: 'g1', at: '2026-07-02T04:01:00Z' }], NY, 1);
  assert.deepEqual(clean.map((d) => d.local_date), ['2026-07-01', '2026-07-02']);
  assert.equal(computeStreak(clean, false).current, 2);
});

// ---------------------------------------------------------------------------
// DST transitions (America/New_York 2026: spring-forward Mar 8, fall-back Nov 1)
// ---------------------------------------------------------------------------
test('DST spring-forward: the 23-hour day still counts and stays consecutive', () => {
  // 1:59 AM EST (UTC-5) and, after the jump, 3:30 AM EDT (UTC-4) — both Mar 8
  assert.equal(localDate(NY, new Date('2026-03-08T06:59:00Z')), '2026-03-08');
  assert.equal(localDate(NY, new Date('2026-03-08T07:30:00Z')), '2026-03-08');
  const log = dayLogFromCompletions([
    { goal: 'g1', at: '2026-03-08T04:30:00Z' }, // Mar 7, 11:30 PM EST
    { goal: 'g1', at: '2026-03-08T07:30:00Z' }, // Mar 8, 3:30 AM EDT (the short day)
  ], NY, 1);
  assert.deepEqual(log.map((d) => d.local_date), ['2026-03-07', '2026-03-08']);
  assert.equal(computeStreak(log, false).current, 2);
  // string calendar arithmetic is immune to the 23h day
  assert.equal(addDays('2026-03-07', 1), '2026-03-08');
  assert.deepEqual(eachDay('2026-03-07', '2026-03-09').length, 3);
});

test('DST fall-back: the repeated 1:30 AM hour maps to one local day, no phantom day', () => {
  // 1:30 AM happens twice on Nov 1 (EDT then EST) — both are still Nov 1
  assert.equal(localDate(NY, new Date('2026-11-01T05:30:00Z')), '2026-11-01');
  assert.equal(localDate(NY, new Date('2026-11-01T06:30:00Z')), '2026-11-01');
  const log = dayLogFromCompletions([
    { goal: 'g1', at: '2026-11-01T03:00:00Z' }, // Oct 31, 11:00 PM EDT
    { goal: 'g1', at: '2026-11-01T06:30:00Z' }, // Nov 1, 1:30 AM EST (the 25h day)
  ], NY, 1);
  assert.deepEqual(log.map((d) => d.local_date), ['2026-10-31', '2026-11-01']);
  assert.equal(computeStreak(log, false).current, 2);
  assert.equal(prevDay('2026-11-01'), '2026-10-31');
});

// ---------------------------------------------------------------------------
// buildHistory (the load-time walk input)
// ---------------------------------------------------------------------------
test('buildHistory gap-fills truly missed days as imperfect and excludes today', () => {
  const rows = [
    { local_date: '2026-07-01', is_perfect: true },
    // Jul 2 has no row at all — must appear as { is_perfect: false }
    { local_date: '2026-07-03', is_perfect: true },
    { local_date: '2026-07-04', is_perfect: true }, // "today" — must be excluded
  ];
  const h = buildHistory(rows, '2026-07-04');
  assert.deepEqual(h, [
    { local_date: '2026-07-01', is_perfect: true },
    { local_date: '2026-07-02', is_perfect: false },
    { local_date: '2026-07-03', is_perfect: true },
  ]);
});

// ---------------------------------------------------------------------------
// regression: the exact production data from the 2026-07-03 incident
// ---------------------------------------------------------------------------
test('prod regression (zarathustra, America/Chicago): two perfect days read as 2', () => {
  // his real day_results rows — note `finalized` was never set by the old code;
  // the walk must not depend on it
  const rows = [
    { local_date: '2026-07-01', is_perfect: true, finalized: false },
    { local_date: '2026-07-02', is_perfect: true, finalized: false },
    { local_date: '2026-07-03', is_perfect: false, finalized: false }, // today, in progress
  ];
  const today = localDate(CHI, new Date('2026-07-03T20:00:00Z')); // 3 PM CDT Jul 3
  assert.equal(today, '2026-07-03');
  const s = computeStreak(buildHistory(rows, today), false);
  assert.equal(s.current, 2);
  assert.equal(s.state, 'atrisk');
  // and finishing today extends it
  assert.equal(computeStreak(buildHistory(rows, today), true).current, 3);
});

test('prod regression (red, America/New_York): streak reads 2 after the optional backfill', () => {
  const rows = [
    { local_date: '2026-07-02', is_perfect: true },
    { local_date: '2026-07-03', is_perfect: true }, // the day the rollover bug dropped
  ];
  const s = computeStreak(buildHistory(rows, '2026-07-04'), false);
  assert.equal(s.current, 2);
  assert.equal(s.longest, 2);
});
