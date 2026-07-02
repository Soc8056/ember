// Timezone-aware local-date helpers (PRD NF-6). A "date" in Ember is always the
// user's LOCAL calendar date (YYYY-MM-DD), derived from their stored IANA timezone.

// The user's local calendar date for a given instant (defaults to now).
export function localDate(timezone, instant = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || undefined,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`; // en-CA gives YYYY-MM-DD
}

export function todayLocal(timezone) {
  return localDate(timezone);
}

// "HH:MM" local time-of-day for the user (used later by reminders; handy for at-risk UI).
export function localTime(timezone, instant = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone || undefined, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(instant);
}

// Calendar arithmetic on YYYY-MM-DD strings. We anchor at UTC noon so ±days never
// slips across a boundary regardless of DST.
function toNoonUTC(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}
function fromDate(dt) {
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export function addDays(dateStr, n) {
  const dt = toNoonUTC(dateStr);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fromDate(dt);
}

export function prevDay(dateStr) { return addDays(dateStr, -1); }

// Compare two YYYY-MM-DD strings: -1 | 0 | 1 (lexical order == chronological order).
export function compareDate(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

// Inclusive list of every date string from start..end. Returns [] if start > end.
export function eachDay(startStr, endStr) {
  if (!startStr || !endStr || compareDate(startStr, endStr) > 0) return [];
  const out = [];
  let cur = startStr;
  while (compareDate(cur, endStr) <= 0) {
    out.push(cur);
    cur = addDays(cur, 1);
    if (out.length > 4000) break; // safety valve (~11 years)
  }
  return out;
}

// A friendly "Wed · Jul 1" label for the Today header, in the user's timezone.
export function todayLabel(timezone, instant = new Date()) {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: timezone || undefined, weekday: 'short' }).format(instant);
  const md = new Intl.DateTimeFormat('en-US', { timeZone: timezone || undefined, month: 'short', day: 'numeric' }).format(instant);
  return `${wd} · ${md}`;
}

// Best-effort IANA timezone detection for first-run (AUTH-3).
export function detectTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
  catch { return 'UTC'; }
}
