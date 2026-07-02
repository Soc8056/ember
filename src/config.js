// Configuration constants (PRD §6). Only the M1-relevant knobs are used yet;
// the notification/friend values are kept so M2/M3 don't re-litigate them.
export const CONFIG = {
  // streak mechanics
  STREAK_FREEZE_MAX: 1,                  // max freezes a user can hold
  FREEZE_REGEN_AFTER_PERFECT_DAYS: 7,    // perfect days to regenerate one freeze
  PERFECT_REQUIRES_MIN_GOALS: 1,         // a perfect day needs >= this many active goals

  // goals
  MAX_GOALS: 20,                         // soft cap on active goals per user

  // friends / invites (M2)
  INVITE_TTL_DAYS: 7,
  NUDGE_RATE_LIMIT: 3,

  // notifications (M3, best-effort)
  REMINDER_DEFAULT_TIME: '20:00',
  STREAK_RISK_WARNING_LOCAL: '21:30',
  SCHED_SWEEP_MINUTES: 15,
  KEEPALIVE_HOURS: 6,
};

// Supabase connection is injected at runtime by env.js (copy env.example.js → env.js).
// The anon key is public by design — Row-Level Security is what protects the data.
export const ENV = (typeof window !== 'undefined' && window.EMBER_ENV) || {};
export const HAS_SUPABASE = Boolean(ENV.SUPABASE_URL && ENV.SUPABASE_ANON_KEY);
