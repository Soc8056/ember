// Copy this file to src/env.js and fill in your Supabase project values.
// The anon key is SAFE to expose in the browser — Row-Level Security is what
// actually protects the data (see supabase/migrations/0001_init.sql).
// src/env.js is gitignored so your local values stay out of version control.
window.EMBER_ENV = {
  SUPABASE_URL: 'https://YOUR-PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR-ANON-PUBLIC-KEY',
  // Web-push public (VAPID) key — safe to expose. Generate once with
  //   npx web-push generate-vapid-keys
  // and put the PRIVATE key only in the Edge Function secrets (see README → Notifications).
  // Leave blank to keep the app running with reminders simply turned off.
  VAPID_PUBLIC_KEY: '',
};
