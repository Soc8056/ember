# Ember

An installable PWA for a small group of friends to hold each other to their daily goals.
Finish **all** your goals in a day → a "perfect day" that keeps your **streak** alive.

This repo is the **literal-HTML frontend** (no build step, no bundler) with the Supabase
backend wired directly into it, per the plan in `ember-engineering-prd.md`. The design comes
from the `Ember.html` Claude design artifact (preserved as `Ember.artifact.html`); the
production frontend is a faithful vanilla port of that design in `index.html` + `styles.css`
+ `src/*.js`.

## Status — Complete (M1 → M4)

The full product is built across all four milestones. See the milestone history below.

## Milestone 4 (Polish) — what was added

M4 adds the finishing layer on top of M1–M3:
- **Edit profile** — Settings card opens a real sheet (name + emoji picker + Save).
- **Offline banner** — pill on Today and Friends when the device has no network.
- **Friends loading shimmer** — three skeleton rows while the list is fetching.
- **Scoped error states** — Today/Friends each show an inline error + Retry button.
- **Backup workflow** — `.github/workflows/backup.yml` (daily `pg_dump`).
- **Edge-case hardening** — null-guards on both streak functions, `eachDay` short-circuits
  on inverted ranges, invite URL validator rejects malformed codes, DST tested.

### Complete feature matrix

| Area | State |
|------|-------|
| Magic-link auth, goals, personal streak + freeze | ✅ M1 |
| Offline *today* cache + queued write replay | ✅ M1 |
| Light / dark / system theme + `prefers-reduced-motion` | ✅ M1 |
| Invite links + accept flow, friends list, shared streak, remove | ✅ M2 |
| Service worker push / notificationclick / pushsubscriptionchange | ✅ M3 |
| Gesture-gated subscribe + iOS standalone gating (`src/push.js`) | ✅ M3 |
| Settings: reminder time picker + push toggle; welcome "Turn on" CTA | ✅ M3 |
| Scheduler sweep: daily reminder + streak-risk warning (Edge Function) | ✅ M3 (deploy required) |
| Real nudge send (rate-limited) + dead-subscription pruning | ✅ M3 (deploy required) |
| Edit profile name/emoji in Settings | ✅ M4 |
| Offline banner + scoped loading/error/retry states | ✅ M4 |
| Backup workflow + edge-case hardening | ✅ M4 |

## Run it (no build step)

Any static file server works — you just can't `file://` it, because ES modules and the
magic-link redirect need `http://`.

```bash
cd /Users/caleb/Documents/Ideas/Ember
python3 -m http.server 5173
# open http://localhost:5173
```

With no Supabase configured it runs in an in-memory **demo mode** (great for previewing the
UI). To connect the real backend, see below.

## Connect Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Run the migrations in order in the SQL editor (or via the CLI):
   - `supabase/migrations/0001_init.sql` — M1 tables, indexes, RLS policies, new-user trigger.
   - `supabase/migrations/0002_friends.sql` — M2 `friendships` + `invites`, RLS, and the
     `create_invite` / `accept_invite` / `friends_overview` security-definer RPCs.
   - `supabase/migrations/0003_notifications.sql` — M3 `push_subscriptions` /
     `notifications_sent` / `nudges`, RLS, and the `notifications_due()` sweep selector.
3. **Auth → Providers → Email**: enable the Email provider (magic links are on by default).
4. **Auth → URL Configuration** — without this, magic links redirect to the default
   `http://localhost:3000` and sign-in silently dead-ends:
   - Set **Site URL** to `http://localhost:5173` (or wherever you deploy).
   - Add `http://localhost:5173/**` to **Redirect URLs** (the `/**` glob covers
     `/index.html` and query-string variants).
5. **Auth → Emails (templates)** — point the sign-in emails at the app instead of
   Supabase's one-shot `/verify` endpoint. Inbox link-scanners (Gmail, Outlook
   SafeLinks) prefetch `{{ .ConfirmationURL }}` and consume the one-time token, so
   every real click lands on "link expired". Replace the link in **both** the
   *Magic Link* and *Confirm signup* templates with:
   ```html
   <a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email">Sign in to Ember</a>
   ```
   The app exchanges the `token_hash` itself via `verifyOtp` on load, so fetching
   the URL consumes nothing — only running the app does.

   > **Rate limits**: the "too many attempts" error is Supabase's server-side cap on
   > auth emails (built-in SMTP allows only ~2/hour, plus a 60s gap between sends).
   > It is not enforced anywhere in this app. To raise it: **Project Settings → Auth →
   > SMTP** (configure custom SMTP), then **Auth → Rate Limits**.
6. Copy your project URL + anon key into local config:
   ```bash
   cp src/env.example.js src/env.js   # then edit src/env.js
   ```
   `src/env.js` is gitignored. The anon key is public by design — RLS is the real guard.
7. Reload the app and sign in with your email.

## How the streak works (PRD §3.2)

`src/streak.js` is a **pure function** of the day-log: it walks finalized days forward,
incrementing on perfect days, auto-consuming one freeze to cover a single miss (regenerating
after 7 clean days), and letting *today* extend the streak only once it becomes perfect.
Streak correctness never depends on a scheduled job (NF-4).

## How friends & shared streaks work (PRD §3.3)

Invites are **single-use links** (`?invite=<code>`) that expire after 7 days. Opening one
while signed in and confirming establishes an **accepted** friendship immediately —
possession of the link is consent (FRND-2). A signed-out visitor's code is stashed across
the magic-link redirect and consumed after they finish first-run.

A **shared streak** is pairwise and advances only on dates that are a perfect day for *both*
friends; it resets the moment either misses and has **no freeze** (Resolved Decision #4).
`computeSharedStreak` in `src/streak.js` is the pure walk; the server hands it only the set
of dates on which *both* were perfect.

**Privacy (FRND-4, NF-7):** friends never touch each other's tables. All cross-friend reads
go through three `security definer` RPCs (`create_invite`, `accept_invite`,
`friends_overview`) that expose only public fields — display name, avatar, current/longest
personal streak, and a coarse *today status* (perfect / in-progress / not-started). Goal
titles and completions are never selectable by anyone but their owner. The personal-streak
number a friend sees comes from the reconcilable cache on `profiles`, which the client keeps
fresh on each Today load/toggle.

> Note: the invite-acceptance logic is a Postgres `security definer` RPC (`accept_invite`)
> rather than the Edge Function sketched in the PRD module layout — it's a pure DB
> transaction, so this keeps M2 free of any Deno deploy. Edge Functions arrive with M3
> (the scheduler + push sends).

## Notifications (M3) — how it works & how to turn it on

Reminders and nudges are **best-effort web push**. In the app with no push configured,
everything still works — the Settings toggle just reports it's unavailable, and nothing
errors. To actually deliver pushes you deploy a little server-side plumbing:

**What runs where**
- `sw.js` — custom service worker: `push` (shows the notification), `notificationclick`
  (deep-links to Today/Friends via `?go=`), `pushsubscriptionchange` (silently re-subscribes).
- `src/push.js` — gesture-gated subscribe, iOS standalone gating, and re-validate-on-open.
  On iOS, push only exists once Ember is **Added to the Home Screen** — until then the toggle
  shows Home-Screen instructions instead of trying to subscribe (NOTIF-3).
- `supabase/functions/sweep` — every ~15 min, asks `notifications_due()` who's owed a **daily
  reminder** (after their `reminder_time`, day not perfect) or an **evening streak-risk
  warning** (after 21:30, live streak, no freeze to silently save it), then sends + prunes dead
  subs. Idempotent via `notifications_sent`.
- `supabase/functions/send-nudge` — validates friendship + per-friend daily rate limit, then
  pushes "{name} nudged you 👀".

**Deploy steps**
1. Generate VAPID keys once: `npx web-push generate-vapid-keys`.
   - Public key → `VAPID_PUBLIC_KEY` in `src/env.js` (safe to expose).
   - Private key → function secret only (below). Never ships to the browser (NF-10).
2. Deploy the functions: `supabase functions deploy sweep send-nudge`.
3. Set function secrets (`supabase secrets set …`): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
   `VAPID_SUBJECT` (a real `mailto:` — Safari rejects `localhost`), and `SWEEP_SECRET`
   (any random string). `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
   are injected by the platform.
4. Schedule the sweep — **either** run `supabase/cron.sql` (pg_cron → the function, primary)
   **or** enable `.github/workflows/sweep.yml` (fallback `*/15` cron; needs repo secrets
   `EMBER_SWEEP_URL` + `EMBER_SWEEP_SECRET`). `.github/workflows/keepalive.yml` (every 6h)
   keeps the free-tier project from pausing.

Streak correctness never depends on any of this — it's computed from the day-log on read.

## Project layout

```
index.html            # app shell (loads env.js, then src/main.js)
styles.css            # design tokens + keyframes ported from the artifact
manifest.webmanifest  # PWA manifest
sw.js                 # service worker: offline shell (push lands in M3)
src/
  main.js             # bootstrap + delegated event wiring
  views.js            # pure state -> HTML (faithful design port)
  store.js            # state + actions (the controller)
  api.js              # Supabase data layer
  supabase.js         # client (loaded from esm.sh — no bundler)
  config.js           # CONFIG constants (PRD §6)
  dates.js            # timezone-aware local-date helpers
  streak.js           # deterministic personal streak + freeze AND shared-streak walk
  offline.js          # today cache + pending-write queue + captured invite code
  push.js             # web-push subscribe flow + iOS gating (M3)
  env.example.js      # -> copy to env.js with your Supabase creds (+ VAPID public key)
sw.js                 # custom service worker: offline shell + push/notificationclick (M3)
supabase/migrations/
  0001_init.sql       # M1 schema + RLS
  0002_friends.sql    # M2 friendships + invites + RLS + friend RPCs
  0003_notifications.sql # M3 push_subscriptions + notifications_sent + nudges + sweep selector
supabase/functions/   # Deno Edge Functions (M3): sweep, send-nudge, _shared/webpush
supabase/cron.sql     # pg_cron → sweep (primary scheduler; fill in project ref + secret)
.github/workflows/    # sweep.yml (fallback cron) + keepalive.yml (anti-pause) + backup.yml
Ember.artifact.html   # original Claude design artifact (design source of truth)
ember-engineering-prd.md
```
