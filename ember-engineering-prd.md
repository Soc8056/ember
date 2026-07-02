> **For Claude Code:** This PRD is the single source of truth. Implement in milestone order — each milestone is a self-contained, runnable unit. Do not invent scope beyond what's specified; the Out of Scope list is binding. If a section is ambiguous, raise it as a question rather than silently deciding. The Resolved Decisions table captures *why* things are the way they are — consult it before proposing changes to settled design choices. The design layer ships as a separate Design PRD → Claude Design HTML; wire this behavior into that HTML, don't redesign.

# Ember — Product Requirements Document

**Version:** 1.0  
**Last Updated:** July 1, 2026  
**Status:** Draft

> **Name is a placeholder.** "Ember" refers to the streak-flame metaphor. Rename globally if desired. (No relation to the Ember.js framework — this app is React + Vite.)

---

## 1. Overview

Ember is an installable web app (PWA) for a small group of friends to hold each other accountable to their daily goals. Each person sets a handful of recurring daily goals. Completing **all** of them in a day is a "perfect day," which extends a personal **streak**. Friends can also build a **shared streak** with each other — a pairwise streak that only advances on days when *both* people hit a perfect day. Best-effort push notifications remind people before the day ends and let friends nudge each other.

The core loop is deliberately small: open the app, check off your goals, keep your flame alive, don't let your friend down. It is not a productivity suite. The entire point is the emotional pull of a streak you share with people you know — loss aversion, applied to friendship. There are no points, levels, badges, categories, or analytics; the streak is the only progression.

The app is free with no subscriptions, tiers, or payments — it exists to be shared with friends, not sold. Correctness of streaks is guaranteed by deterministic computation from the completion log; notifications are a best-effort enhancement layered on top and are explicitly non-load-bearing.

**Platform:** Installable PWA, mobile-first. **Target environment:** Modern evergreen browsers; iOS Safari 16.4+ (push requires Add-to-Home-Screen install — see §3.4 and §12), Chrome/Firefox/Edge on Android and desktop. **Persistence:** Supabase (Postgres) as source of truth; a small amount of client cache (IndexedDB/localStorage) for offline read of *today*. **Global visual constraints:** light + dark (system preference); see the Design PRD.

---

## 2. Glossary

| Term | Definition |
|------|-----------|
| Goal | A recurring daily habit a user commits to (e.g., "Read 20 min"). Applies every day while active. |
| Completion | A record that a user completed a specific goal on a specific local date. |
| Perfect day | A local date on which a user completed **all** of their active goals, with at least 1 active goal. |
| Personal streak | Count of consecutive local dates that are perfect days (freeze-protected) for a single user. |
| Streak freeze | A one-charge protection that is auto-consumed to preserve a personal streak on a single non-perfect day. Regenerates after a run of perfect days. |
| Shared streak | A pairwise streak between two accepted friends; advances only on dates that are a perfect day for **both**. No freeze protection in v1. |
| Friendship | A pairwise, accepted, symmetric relationship between two users. |
| Nudge | A one-tap "poke" that sends a friend a single push notification. No free text. |
| Day rollover | The boundary at the user's **local midnight** after which "today" becomes "yesterday." |
| DayResult | A per-user, per-date snapshot: goals total, goals completed, whether it was perfect, whether a freeze was used. Source data for streak computation. |
| Push subscription | A browser Web Push subscription object (endpoint + keys) stored per device to deliver notifications. |
| PWA install | Adding the app to the Home Screen (required on iOS before push is even available). |
| VAPID | Voluntary Application Server Identification — the key pair used to authenticate the server that sends web push. |

---

## 3. Feature Requirements

### 3.1 Authentication & Profile

#### Description
Low-friction real accounts so streaks and friend relationships persist across devices. Passwordless email (magic link). Minimal profile: a display name and an avatar identity (emoji + color, no photo uploads).

#### Requirements

| ID | Requirement | Status |
|----|-------------|--------|
| AUTH-1 | Users sign in via Supabase Auth passwordless email (magic link). No passwords. | ⏳ Not implemented |
| AUTH-2 | On first sign-in, the user sets a `display_name` (required, 1–24 chars) and picks an avatar `emoji` + `color` from a fixed palette. | ⏳ Not implemented |
| AUTH-3 | The user's IANA `timezone` is auto-detected on first sign-in (`Intl.DateTimeFactory().resolvedOptions().timeZone`) and stored; editable in Settings. | ⏳ Not implemented |
| AUTH-4 | A signed-in session persists across app launches until the user signs out. | ⏳ Not implemented |
| AUTH-5 | Sign out clears the local session and any cached data. | ⏳ Not implemented |
| AUTH-6 | Row-Level Security restricts each user to reading/writing only their own rows, plus read access to a friend's public streak/status fields per §3.3. | ⏳ Not implemented |

### 3.2 Goals & Personal Streak

#### Description
The solo core loop. Users manage a short list of recurring daily goals, check them off each day, and maintain a personal streak that advances on perfect days and is protected by a single auto-consumed freeze.

#### Requirements

| ID | Requirement | Status |
|----|-------------|--------|
| GOAL-1 | A user can create a goal with a `title` (1–60 chars) and optional `emoji`. | ⏳ Not implemented |
| GOAL-2 | A user can rename, reorder (`sort_order`), and delete/archive their goals. Deleting a goal does not delete historical completions. | ⏳ Not implemented |
| GOAL-3 | Goals are recurring **daily**. Every active goal applies to every local date while active. (No scheduling, no per-weekday goals — see Out of Scope.) | ⏳ Not implemented |
| GOAL-4 | A soft cap of `MAX_GOALS` active goals per user is enforced with a friendly message when exceeded. | ⏳ Not implemented |
| GOAL-5 | On the Today view, each active goal renders as a checkable item reflecting whether it is completed for the current local date. | ⏳ Not implemented |
| GOAL-6 | Tapping a goal toggles its Completion for the current local date (create/delete a Completion row). Toggling is idempotent and reversible until day rollover. | ⏳ Not implemented |
| GOAL-7 | The Today view shows perfect-day progress as `completed / total` active goals. | ⏳ Not implemented |
| GOAL-8 | Completing the **last** remaining goal marks the day perfect and triggers the perfect-day success state (visual celebration handled in the Design PRD). | ⏳ Not implemented |
| GOAL-9 | The personal streak count is displayed prominently on Today at all times, including its at-risk and frozen states. | ⏳ Not implemented |
| GOAL-10 | Streak value is computed deterministically from the DayResult/Completion log per the Streak Algorithm below — never dependent on any scheduled job. | ⏳ Not implemented |

#### Streak Algorithm (personal)

Streaks are a **pure function of the completion log plus CONFIG**, evaluated on read. A cache (`current_streak`, `longest_streak`, `freezes_available`, `last_evaluated_date`) may denormalize this for performance but is always reconcilable from the log.

Definitions, all in the user's local timezone:
- `is_perfect(date)` = `goals_completed(date) >= 1` AND `goals_completed(date) == active_goals_applicable(date)`.
- `active_goals_applicable(date)` = goals not archived as of that date. For the current day, this is the set of currently active goals. Historical days use the DayResult snapshot (`goals_total`) captured at rollover so later goal edits don't rewrite history.

Evaluation, walking backward from the most recent finalized day:
1. Today is **in progress** and never breaks a streak; it only *extends* it once it becomes perfect.
2. For each finalized past day from most-recent backward:
   - If `is_perfect(day)` → streak continues; increment.
   - Else if a freeze is available at that point → consume one freeze (`freeze_used = true` on that DayResult), streak is **preserved but not incremented**, continue walking.
   - Else → streak ends here (reset to 0 from this gap forward).
3. `longest_streak` = max personal streak ever observed.

Freeze economy:
- A user holds at most `STREAK_FREEZE_MAX` (=1) freeze.
- One freeze regenerates after `FREEZE_REGEN_AFTER_PERFECT_DAYS` (=7) consecutive perfect days since the last freeze grant/consumption.
- Freezes are **auto-consumed** — never a manual action, never surfaced as a button. They are surfaced only as a state ("streak frozen — you missed yesterday but your flame's safe").

DayResult finalization:
- A DayResult is created/updated live as completions change during the current day.
- It is **finalized** at local day rollover. Finalization can happen lazily on the next read after rollover (preferred — no cron dependency) or opportunistically by the scheduler; both paths produce identical results because finalization is deterministic.

### 3.3 Friends & Shared Streaks

#### Description
Pairwise friendships established by an invite link/code. A friends list shows each friend's public streak and today status. Each accepted friendship carries a **shared streak** that advances only when both friends have a perfect day.

#### Requirements

| ID | Requirement | Status |
|----|-------------|--------|
| FRND-1 | A user can generate a shareable invite (a URL containing a single-use `invite_code`) to send to a friend out-of-band (iMessage, etc.). | ⏳ Not implemented |
| FRND-2 | Opening a valid invite URL while signed in creates a pending friendship; the inviter sees it as pending until… actually accept is mutual: opening a valid invite and confirming establishes an **accepted** friendship immediately (invite possession = consent). Invite codes are single-use and expire after `INVITE_TTL_DAYS`. | ⏳ Not implemented |
| FRND-3 | The Friends view lists all accepted friends with: avatar, display name, their current personal streak, a today-status indicator (perfect / in-progress / not-started), and the pairwise shared-streak count. | ⏳ Not implemented |
| FRND-4 | A friend may see another friend's **public** fields only: display name, avatar, current personal streak, longest streak, and a coarse today status (done / not done). Individual goal titles and completions are **private** and never exposed. | ⏳ Not implemented |
| FRND-5 | A user can remove a friend; removal deletes the friendship and its shared streak for both parties. | ⏳ Not implemented |
| FRND-6 | The shared streak for a friendship is computed deterministically: it advances on each date that is a perfect day for **both** users, and resets to 0 on any date that is not a perfect day for both. No freeze applies to shared streaks in v1. | ⏳ Not implemented |
| FRND-7 | The Friends view (or a friend detail) shows a shared-streak at-risk state when today is not yet a perfect day for one or both friends and local midnight is near. | ⏳ Not implemented |

#### Shared Streak Algorithm

For friendship (A, B), evaluated on read, per date in the **overlap of both users' finalized history since the friendship began**:
- `both_perfect(date)` = `is_perfect_A(date)` AND `is_perfect_B(date)`.
- Walking backward from the most recent finalized day since friendship start: while `both_perfect(day)`, increment; on the first day that is not both-perfect, stop.
- Today extends the shared streak only once both users' today becomes perfect.
- Timezone edge: a "date" is each user's own local date; a shared day counts when both users have a perfect day for their respective local date labeled the same calendar date. (Friends in different timezones is rare in this audience; this rule is simple and good-enough — flagged in §12.)

### 3.4 Notifications (best-effort)

#### Description
Web Push reminders and friend nudges. Explicitly **best-effort**: the app is fully functional without them (see Milestones — the product is complete through M2). On iOS, push requires the PWA to be installed to the Home Screen; the app must handle this gracefully and never break when push is unavailable.

#### Requirements

| ID | Requirement | Status |
|----|-------------|--------|
| NOTIF-1 | The app registers a service worker that handles `push`, `notificationclick`, and `pushsubscriptionchange` events. | ⏳ Not implemented |
| NOTIF-2 | Enabling notifications is triggered **only** from an explicit user gesture (a "Turn on reminders" tap), never on page load. | ⏳ Not implemented |
| NOTIF-3 | On iOS, if the app is not running in standalone (installed) mode, the notification-enable UI is replaced with Add-to-Home-Screen instructions; the app does not attempt to subscribe. | ⏳ Not implemented |
| NOTIF-4 | On subscribe, the push subscription (endpoint + keys) is stored server-side, associated with the user, supporting multiple devices per user. | ⏳ Not implemented |
| NOTIF-5 | The service worker's `pushsubscriptionchange` handler re-subscribes and updates the stored subscription; dead/expired subscriptions returned by the push service (HTTP 404/410) are pruned server-side. | ⏳ Not implemented |
| NOTIF-6 | **Daily reminder:** at the user's `reminder_time` (default `20:00` local), if today is not yet a perfect day, send one reminder push. | ⏳ Not implemented |
| NOTIF-7 | **Streak-risk warning:** at `STREAK_RISK_WARNING_LOCAL` (default `21:30` local), if the user's personal streak is > 0 and today is not yet perfect and no freeze would fully protect it silently, send one warning push. Deduplicated with NOTIF-6 (max one evening nudge). | ⏳ Not implemented |
| NOTIF-8 | **Nudge:** a user can tap to nudge a friend, sending that friend a single push ("{name} nudged you 👀"). Rate-limited to `NUDGE_RATE_LIMIT` per friend per day. | ⏳ Not implemented |
| NOTIF-9 | Notification payloads deep-link into the app (Today for reminders/warnings; Friends for nudges) via `notificationclick`. | ⏳ Not implemented |
| NOTIF-10 | All scheduled sends run from a server-side scheduler that sweeps frequently (see Scheduler) and honors each user's local time; a missed sweep must never affect streak correctness. | ⏳ Not implemented |

#### Scheduler

A scheduled job runs every `SCHED_SWEEP_MINUTES` (=15). On each sweep it selects users whose local time currently falls in a reminder/warning window and who meet the send condition, then sends via Web Push (`web-push` with VAPID). Idempotency: a `notifications_sent` guard (user_id + type + local_date) prevents duplicate sends within a day.

Primary implementation: Supabase `pg_cron` triggering a Supabase Edge Function that performs the sweep and sends. Documented fallback if Deno/web-push compatibility is a problem: a GitHub Actions cron (`*/15 * * * *`) hitting a protected sweep endpoint (the maintainer already runs GitHub Actions crons — see §12). A separate `*/6 hours` keep-alive ping prevents free-tier project pausing (§12).

---

## 4. Data Model

```typescript
// All timestamps are UTC (timestamptz). "date" fields are the user's LOCAL calendar date.

type UUID = string;

interface User {
  id: UUID;                 // == Supabase auth.users.id
  email: string;
  display_name: string;     // 1–24 chars
  avatar_emoji: string;     // from fixed palette
  avatar_color: string;     // hex, from fixed palette
  timezone: string;         // IANA, e.g. "America/Chicago"
  reminder_time: string;    // "HH:MM" local, default "20:00"
  notifications_enabled: boolean; // user intent; actual delivery still best-effort
  // streak cache (reconcilable from DayResult; not source of truth)
  current_streak: number;
  longest_streak: number;
  freezes_available: number;   // 0..STREAK_FREEZE_MAX
  perfect_days_since_freeze: number;
  last_evaluated_date: string | null; // local date the cache was last reconciled to
  created_at: string;
}

interface Goal {
  id: UUID;
  user_id: UUID;
  title: string;            // 1–60 chars
  emoji: string | null;
  sort_order: number;
  active: boolean;          // false == archived
  created_at: string;
  archived_at: string | null;
}

interface Completion {
  id: UUID;
  user_id: UUID;
  goal_id: UUID;
  local_date: string;       // "YYYY-MM-DD" in user's tz at time of completion
  completed_at: string;     // UTC
  // UNIQUE(user_id, goal_id, local_date)
}

interface DayResult {
  id: UUID;
  user_id: UUID;
  local_date: string;       // "YYYY-MM-DD"
  goals_total: number;      // active goals applicable that date (snapshotted at finalize)
  goals_completed: number;
  is_perfect: boolean;
  freeze_used: boolean;
  finalized: boolean;       // true once past rollover
  // UNIQUE(user_id, local_date)
}

type FriendshipStatus = "pending" | "accepted";

interface Friendship {
  id: UUID;
  user_a: UUID;             // canonical: user_a < user_b by UUID to keep pairs unique
  user_b: UUID;
  status: FriendshipStatus; // v1 goes straight to "accepted" on invite acceptance
  created_at: string;
  // shared streak cache (reconcilable)
  shared_current: number;
  shared_longest: number;
  shared_last_both_perfect_date: string | null;
  // UNIQUE(user_a, user_b)
}

interface Invite {
  id: UUID;
  inviter_id: UUID;
  code: string;             // url-safe, single-use
  used_by: UUID | null;
  expires_at: string;       // now + INVITE_TTL_DAYS
  created_at: string;
}

interface PushSubscription {
  id: UUID;
  user_id: UUID;
  endpoint: string;         // UNIQUE
  p256dh: string;
  auth: string;
  created_at: string;
}

interface NotificationSent {  // idempotency guard for the scheduler
  id: UUID;
  user_id: UUID;
  type: "reminder" | "streak_risk";
  local_date: string;
  sent_at: string;
  // UNIQUE(user_id, type, local_date)
}

interface Nudge {
  id: UUID;
  from_user: UUID;
  to_user: UUID;
  created_at: string;       // used for daily rate limiting
}
```

---

## 5. Persistence Schema

**Primary store: Supabase Postgres.** Tables map 1:1 to the interfaces in §4. Notes:
- `Completion`: `UNIQUE(user_id, goal_id, local_date)`; index on `(user_id, local_date)`.
- `DayResult`: `UNIQUE(user_id, local_date)`; index on `(user_id, local_date DESC)` for backward streak walks.
- `Friendship`: enforce `user_a < user_b`; `UNIQUE(user_a, user_b)`.
- `Invite.code`: unique, indexed.
- `PushSubscription.endpoint`: unique.
- `NotificationSent`: `UNIQUE(user_id, type, local_date)`.
- **RLS** on every table: a user can select/insert/update/delete only rows where they are the owner; a limited policy exposes a friend's *public* User columns (display_name, avatar_*, current_streak, longest_streak) and a coarse today-status view. Goals and Completions are never selectable by anyone but the owner.

**Client cache (offline read of today only):** IndexedDB or localStorage holds a snapshot of today's goals + completion states + current streak so the Today screen renders offline; writes made offline are queued and replayed on reconnect (last-write-wins on the `(user, goal, date)` unique key). Nothing security-sensitive is cached.

| Key (localStorage) | Value | Purpose | Written when |
|---|---|---|---|
| `ember.today.<userId>` | `{ date, goals[], completions[], streak }` | Offline render of Today | On each Today load / toggle |
| `ember.theme` | `"system" \| "light" \| "dark"` | Theme preference | On theme change |
| `ember.pendingWrites` | `Completion toggle queue` | Offline write replay | On offline toggle |

---

## 6. Configuration Constants

```javascript
const CONFIG = {
  // streak mechanics
  STREAK_FREEZE_MAX: 1,                  // max freezes a user can hold
  FREEZE_REGEN_AFTER_PERFECT_DAYS: 7,    // perfect days to regenerate one freeze
  PERFECT_REQUIRES_MIN_GOALS: 1,         // a perfect day needs >= this many active goals

  // goals
  MAX_GOALS: 20,                         // soft cap on active goals per user

  // friends / invites
  INVITE_TTL_DAYS: 7,                    // invite code lifetime
  NUDGE_RATE_LIMIT: 3,                   // max nudges to one friend per day

  // notifications (best-effort)
  REMINDER_DEFAULT_TIME: "20:00",        // local
  STREAK_RISK_WARNING_LOCAL: "21:30",    // local
  SCHED_SWEEP_MINUTES: 15,               // scheduler sweep granularity
  KEEPALIVE_HOURS: 6,                    // free-tier anti-pause ping cadence
};
```

---

## 7. Non-Functional Requirements

| ID | Requirement | Status |
|----|-------------|--------|
| NF-1 | Installable PWA: valid web app manifest (`display: standalone`), maskable + standard icons (192/512), apple-touch-icon (180), served over HTTPS. | ⏳ Not implemented |
| NF-2 | Mobile-first, responsive down to 360px width; usable one-handed; primary tap targets ≥ 44px. | ⏳ Not implemented |
| NF-3 | Today screen renders from cache in < 1s on a warm load and works offline for viewing + toggling today's goals. | ⏳ Not implemented |
| NF-4 | Streak computation is deterministic and independent of any scheduled job; identical results whether finalized lazily or by the scheduler. | ⏳ Not implemented |
| NF-5 | Notifications are best-effort: no user-facing error if push is unsupported/denied; the app degrades to an in-app-only experience. | ⏳ Not implemented |
| NF-6 | All timezone/date logic uses the user's stored IANA timezone; correct across DST transitions and local-midnight rollovers. | ⏳ Not implemented |
| NF-7 | RLS prevents any user from reading another user's goals or completions; only public streak/status fields are shared. | ⏳ Not implemented |
| NF-8 | Light + dark themes, both meeting WCAG AA contrast; respects `prefers-reduced-motion`. | ⏳ Not implemented |
| NF-9 | Runs within Supabase free-tier limits for a small group; a keep-alive job prevents project pausing and a scheduled export provides backup (see §12). | ⏳ Not implemented |
| NF-10 | Secrets (VAPID private key, Supabase service key) live in server-side env only; the VAPID subject uses a real `mailto:`/https URL (Safari rejects localhost subjects). | ⏳ Not implemented |

---

## 8. Out of Scope (v1)

- No native iOS/Android app; no App Store / Play Store distribution.
- No one-off or dated tasks — goals are **recurring daily only**. No per-weekday scheduling, no "3x/week" targets.
- No categories, areas, tags, or folders for goals.
- No points, coins, XP, levels, badges, or achievements — the streak is the **only** progression.
- No leaderboards, global challenges, or public/stranger cohorts.
- No group (3+) shared streaks — shared streaks are **pairwise only**.
- No in-app chat or free-text messaging — the only social action is a **nudge** (a poke).
- No analytics, heatmaps, calendars, or detailed statistics beyond current + longest streak.
- No photo/proof/verification of completions — honor system.
- No goal reminders per-goal (reminders are a single daily nudge, not per-habit).
- No monetization, subscriptions, tiers, or payments of any kind.
- No web-tab push on iOS (impossible — requires Home Screen install); no guarantee of push delivery anywhere (best-effort only).
- No admin panel, no content moderation (trusted friend group).

---

## 9. Resolved Decisions

| # | Question | Resolution |
|---|----------|------------|
| 1 | Strict all-or-nothing perfect day, or partial credit? | All-or-nothing (matches the ask), softened by **one auto-consumed streak freeze** regenerating after 7 perfect days — research shows a forgiveness mechanic raises retention and cuts anxiety without diluting loss aversion. |
| 2 | Are goals recurring habits or one-off tasks? | **Recurring daily habits.** Cleanest streak model and matches "things I get done every day." One-off tasks are out of scope. |
| 3 | Shared streak: visibility-only, or a real mutual streak? | **Real pairwise mutual streak** — advances only when both friends have a perfect day, breaks if either misses. The "don't let them down" pressure is the point. Group streaks are out of scope. |
| 4 | Does a freeze protect the shared streak? | **No.** Personal freeze protects the personal streak only; shared streaks are unprotected in v1 to keep the mechanic simple and the stakes real. |
| 5 | Can streak correctness depend on the notification cron? | **No.** Streaks are computed deterministically from the completion log on read; the scheduler only sends pushes. A missed sweep never corrupts a streak — essential given notifications are best-effort. |
| 6 | Platform: PWA or native? | **PWA.** Matches "just send my friends a link" and free/no-store distribution; the tradeoff (iOS Add-to-Home-Screen required for push) is handled explicitly and push is best-effort. |
| 7 | Auth model for a friend group? | **Passwordless magic-link email.** Lowest-friction *real* auth — needed because streaks and friend graphs must persist across devices. |
| 8 | How private are goals? | Goal titles and completions are **private**; friends see only display name, avatar, current/longest streak, and coarse done/not-done today status. |
| 9 | Push provider? | **Standard Web Push + VAPID via the `web-push` library.** VAPID now works across Chrome/Firefox/Edge/Safari; no FCM/GCM or Apple push cert needed for web push. |
| 10 | Notification scope for v1? | Three types only: daily reminder, evening streak-risk warning (deduped to one evening nudge), and friend nudge. Everything else deferred. |

---

## 10. Architecture & Stack

- **Frontend:** React + TypeScript + Vite. Tailwind CSS (design tokens map from the Design PRD). `vite-plugin-pwa` for the manifest + a **custom service worker** (needed for push, not just precaching — inject the push/notificationclick/pushsubscriptionchange handlers). Routing: React Router (hash or history), routes: `/welcome`, `/` (Today), `/friends`, `/friends/:id`, `/settings`.
- **Backend:** Supabase — Postgres (source of truth), Auth (magic link), Row-Level Security, Edge Functions (Deno) for the scheduler sweep + push sends + invite acceptance logic. Realtime is optional (nice for live friend status) but **not required** for v1; polling on Friends load is acceptable.
- **Push:** `web-push` (VAPID). VAPID keys generated once, private key in server env. Subscriptions stored in `push_subscriptions`. If `web-push` proves awkward under Deno Edge Functions, use a Deno-compatible web-push implementation or the GitHub Actions Node fallback (§12).
- **Scheduling:** `pg_cron` → Edge Function sweep every 15 min (primary); GitHub Actions cron → protected sweep endpoint (fallback). Separate keep-alive ping every 6h.
- **Hosting:** Static PWA build on Vercel or Cloudflare Pages (either; both free). Supabase for all backend.
- **Package manager:** pnpm. **Language:** TypeScript throughout (including Edge Functions).

### Module Layout

```
ember/
├─ public/
│  ├─ manifest.webmanifest
│  ├─ icons/            # 192, 512, maskable, apple-touch-icon-180, favicons
├─ src/
│  ├─ main.tsx
│  ├─ app/
│  │  ├─ routes.tsx
│  │  └─ providers.tsx        # auth/session, theme, query client
│  ├─ screens/
│  │  ├─ Welcome.tsx          # sign-in + install + enable-notifications
│  │  ├─ Today.tsx            # goals + personal streak (the core screen)
│  │  ├─ Friends.tsx          # friend list + invite + nudge
│  │  ├─ FriendDetail.tsx     # pairwise shared streak (may be a sheet)
│  │  └─ Settings.tsx
│  ├─ components/             # GoalCheckItem, StreakBadge, FriendRow, PerfectDayCelebration, Sheet, TabBar…
│  ├─ lib/
│  │  ├─ supabase.ts
│  │  ├─ streak.ts            # pure streak + shared-streak computation (§3.2/§3.3)
│  │  ├─ dates.ts             # tz-aware local-date + rollover helpers
│  │  ├─ push.ts              # subscribe flow, iOS standalone gating
│  │  └─ offline.ts           # today cache + pending-write replay
│  └─ sw.ts                   # custom service worker: push, notificationclick, pushsubscriptionchange
├─ supabase/
│  ├─ migrations/             # schema + RLS policies
│  └─ functions/
│     ├─ sweep/               # scheduler: reminders + streak-risk
│     ├─ send-nudge/
│     └─ accept-invite/
└─ .github/workflows/
   ├─ sweep.yml               # fallback cron (*/15)
   ├─ keepalive.yml           # anti-pause ping (every 6h)
   └─ backup.yml              # scheduled DB export (§12)
```

---

## 11. Milestones

| # | Scope | Includes |
|---|---|---|
| M0 | Foundation | Vite + React + TS + Tailwind scaffold; PWA manifest + icons; Supabase project + migrations; magic-link auth + first-run profile (name/emoji/color/timezone); routing + empty Today shell + bottom tab bar. **Runnable: can sign in and land on an empty Today.** |
| M1 | Goals + personal streak | Create/rename/reorder/delete goals; Today check-off with local-date completions; perfect-day detection; deterministic streak + freeze algorithm (`lib/streak.ts`); streak display with at-risk/frozen states; offline today cache. **The solo product fully works — no friends, no notifications.** |
| M2 | Friends + shared streaks | Invite link/code + accept flow (`accept-invite`); Friends list with public streak + today status; pairwise shared-streak computation; remove friend. **The full social product works with zero notifications.** |
| M3 | Notifications (best-effort) | Custom service worker (push/notificationclick/pushsubscriptionchange); gesture-gated subscribe with iOS standalone gating + Add-to-Home-Screen instructions; VAPID + `push_subscriptions`; scheduler sweep (reminder + streak-risk) via Edge Function + `pg_cron`; nudge send; dead-subscription pruning. |
| M4 | Polish | Empty/loading/error/offline states; perfect-day celebration; light/dark; reduced-motion; keep-alive + backup workflows; end-to-end QA on timezone/rollover/DST and friend-invite edge cases. |

Each milestone produces a running app. The product is **complete and usable through M2**; M3 (notifications) is an enhancement that must never regress M0–M2.

---

## 12. Open Questions / Risks

1. **iOS PWA push subscription staleness.** iOS web-push subscriptions can go inactive after ~1–2 weeks of app inactivity, silently killing reminders. Mitigation: `pushsubscriptionchange` re-subscribe + re-validate on app open + prune 404/410 endpoints. Accept as a known best-effort limitation; never let it affect streaks.
2. **Supabase free-tier project pausing.** Free projects pause after ~1 week of inactivity, and there are no automatic backups. Mitigation: a 6-hourly keep-alive ping and a scheduled DB export (GitHub Actions + object storage). For a *daily* app the pause rarely triggers, but the keep-alive removes the risk entirely.
3. **Deno/`web-push` compatibility in Edge Functions.** If `web-push` doesn't run cleanly under Deno, switch to a Deno-native web-push module or the GitHub Actions Node cron fallback hitting a protected sweep endpoint.
4. **Per-user-local-time scheduling granularity.** A 15-min sweep means reminders land within ~15 min of the target time — acceptable for this use case. Edge Function invocation volume is trivially within the free 500k/mo.
5. **Cross-timezone shared streaks.** The pairwise shared-streak "same calendar date" rule is simple and good-enough for a friend group that's mostly co-located; genuinely cross-timezone pairs could see off-by-one edge behavior. Flagged as acceptable for v1; revisit only if it bites.
6. **Shared-streak fairness/blame.** Break-on-either-miss is intentionally high-pressure and could cause friction. It's a single tunable rule (§3.3); if it feels punishing in practice, consider a shared freeze in a later version.
7. **Name.** "Ember" is a placeholder (and coincides with the Ember.js framework name, though unrelated here). Confirm or replace before launch.
