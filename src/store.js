// App store: central state + the actions that mutate it (the "controller").
// views.js renders from this state; main.js wires DOM events to these actions.
import * as api from './api.js';
import { HAS_SUPABASE } from './supabase.js';
import { CONFIG } from './config.js';
import * as offline from './offline.js';
import * as push from './push.js';
import { computeStreak, computeSharedStreak, isPerfect } from './streak.js';
import * as D from './dates.js';

export const state = {
  ready: false,
  online: offline.isOnline(),
  theme: offline.getTheme(),        // system | light | dark
  resolvedTheme: 'dark',
  hasSupabase: HAS_SUPABASE,

  session: null,
  profile: null,

  screen: 'welcome',                // welcome | today | friends | settings

  localDate: D.todayLocal(D.detectTimezone()),
  todayLabel: D.todayLabel(D.detectTimezone()),
  goals: [],
  completed: new Set(),             // goal_ids completed today
  history: [],                      // gap-filled finalized days (asc) for the streak walk
  streak: { current: 0, longest: 0, freezesAvailable: 1, frozen: false, state: 'zero' },

  // friends (M2)
  friends: [],                      // [{ friendshipId, id, name, emoji, color, status, personal, longest, shared, sharedLongest, sharedState }]
  friendsLoaded: false,
  friendsBusy: false,
  activeFriendId: null,             // friend detail sheet target
  removeTargetId: null,             // remove-friend confirmation target
  inviteLink: null,                 // shareable URL minted for the invite sheet
  inviteBusy: false,
  inviteError: null,
  pendingInviteCode: null,          // an invite awaiting the user's accept confirmation

  // notifications (M3, best-effort)
  notifSupported: false,            // browser can do web push at all
  notifPermission: 'default',       // default | granted | denied
  notifEnabled: false,              // user intent (profiles.notifications_enabled)
  isStandalone: false,              // installed to Home Screen (iOS push needs this)
  needsInstall: false,              // iOS non-standalone → show Add-to-Home-Screen note
  reminderTime: '20:00',            // HH:MM local (profiles.reminder_time)

  // welcome flow
  welcomeStep: 0,                   // 0 email · 1 sent · 2 profile · 3 install
  email: '',
  draftName: '',
  draftEmoji: '🦔',

  // sheets
  sheet: null,                      // manage | confirmDelete | invite | friend | acceptInvite | confirmRemoveFriend | reminderTime | editProfile
  deleteTargetId: null,
  newGoal: '',
  newEmoji: '✨',

  // transient
  celebrating: false,
  celebrateNum: 0,
  toast: null,
  busy: false,
  error: null,
  todayError: null,            // error on Today data load (separate from global error)
  friendsError: null,          // error on Friends load
};

// ---- tiny pub/sub ----------------------------------------------------------
let listeners = [];
export function subscribe(fn) { listeners.push(fn); return () => { listeners = listeners.filter((l) => l !== fn); }; }
export function setState(patch) { Object.assign(state, patch); listeners.forEach((fn) => fn(state)); }

// True only when we have both a configured backend AND a live auth session.
// Falls back to local/demo mode when the test user is active or Supabase isn't set up.
const backend = () => HAS_SUPABASE && !!state.session;

// ---- theme -----------------------------------------------------------------
export function resolveTheme(theme) {
  if (theme === 'light' || theme === 'dark') return theme;
  const prefersLight = typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: light)').matches;
  return prefersLight ? 'light' : 'dark';
}
export function applyTheme() {
  const resolved = resolveTheme(state.theme);
  document.querySelector('.ember-root')?.setAttribute('data-theme', resolved);
  state.resolvedTheme = resolved;
}
export function setTheme(theme) {
  offline.setTheme(theme);
  setState({ theme });
  applyTheme();
}

// ---- toast / celebration ---------------------------------------------------
let toastTimer, celTimer;
export function showToast(msg) {
  setState({ toast: msg });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setState({ toast: null }), 2200);
}
function celebrate(num) {
  setState({ celebrating: true, celebrateNum: num });
  clearTimeout(celTimer);
  celTimer = setTimeout(() => setState({ celebrating: false }), 2500);
}

// ---- boot ------------------------------------------------------------------
let pendingNav = null;              // a ?go= deep-link from a notification, applied once ready

export async function init() {
  applyTheme();
  captureInviteFromUrl();           // stash any ?invite=<code> before auth redirect strips it
  captureGoFromUrl();               // stash any ?go= deep-link from a notification click
  setState({ notifSupported: push.pushSupported(), isStandalone: push.isStandalone(), notifPermission: push.permission(),
             needsInstall: push.isIOS() && !push.isStandalone() });
  window.addEventListener('online', () => { setState({ online: true }); replayPending(); });
  window.addEventListener('offline', () => setState({ online: false }));

  if (!HAS_SUPABASE) { setState({ ready: true, screen: 'welcome', welcomeStep: 0 }); return; }

  api.onAuthChange((session) => {
    const wasSignedIn = !!state.session;
    setState({ session });
    if (session && !wasSignedIn) loadUser();
    if (!session && wasSignedIn) setState({ screen: 'welcome', welcomeStep: 0, profile: null });
  });

  const session = await api.getSession();
  setState({ session });
  if (session) await loadUser();
  else setState({ ready: true, screen: 'welcome', welcomeStep: 0 });
}

// ---- auth + profile --------------------------------------------------------
async function loadUser() {
  try {
    const profile = await api.getProfile();
    if (!profile || !profile.display_name) {
      // authed but first-run profile not completed yet (AUTH-2)
      setState({ profile, ready: true, screen: 'welcome', welcomeStep: 2,
                 draftName: profile?.display_name || '', draftEmoji: profile?.avatar_emoji || '🦔' });
      return;
    }
    setState({ profile, ready: true, screen: 'today',
               notifEnabled: !!profile.notifications_enabled, reminderTime: profile.reminder_time || '20:00' });
    await loadToday();
    push.revalidate(!!profile.notifications_enabled);   // NOTIF-5: keep a live sub without prompting
    maybePromptInvite();
    applyPendingNav();
  } catch (e) { setState({ ready: true, error: e.message }); }
}

export async function sendMagicLink() {
  const email = state.email.trim();
  if (!email) return;
  if (email === 'test@ember.local') { loginAsTestUser(); return; }
  if (!HAS_SUPABASE) { setState({ welcomeStep: 1 }); return; }
  try {
    setState({ busy: true, error: null });
    await api.sendMagicLink(email);
    setState({ busy: false, welcomeStep: 1 });
  } catch (e) { setState({ busy: false, error: magicLinkError(e.message || '') }); }
}

function magicLinkError(msg) {
  if (/rate.limit|too.many/i.test(msg))   return 'Too many attempts — wait a few minutes and try again.';
  if (/invalid.*email|email.*invalid/i.test(msg)) return 'That email address doesn\'t look right.';
  if (/not.*allowed|redirect/i.test(msg)) return 'Sign-in isn\'t enabled for this URL — contact the developer.';
  if (/signup.*disabled/i.test(msg))      return 'New sign-ups are currently disabled.';
  return msg || 'Something went wrong — try again.';
}

function loginAsTestUser() {
  const tz = D.detectTimezone();
  const profile = { display_name: 'You (test)', avatar_emoji: '🔥', timezone: tz, notifications_enabled: false, reminder_time: '20:00' };
  const goals = [
    { id: 't1', title: 'Read', emoji: '📖', sort_order: 0, active: true },
    { id: 't2', title: 'Exercise', emoji: '🏃', sort_order: 1, active: true },
    { id: 't3', title: 'Meditate', emoji: '🧘', sort_order: 2, active: true },
  ];
  const today = D.todayLocal(tz);
  const history = [
    { local_date: D.addDays(today, -3), is_perfect: true },
    { local_date: D.addDays(today, -2), is_perfect: true },
    { local_date: D.addDays(today, -1), is_perfect: true },
  ];
  const streak = computeStreak(history, false);
  setState({
    profile, goals, completed: new Set(), history, streak,
    localDate: today, todayLabel: D.todayLabel(tz),
    friends: DEMO_FRIENDS, friendsLoaded: true,
    notifEnabled: false, reminderTime: '20:00',
    notifSupported: push.pushSupported(), isStandalone: push.isStandalone(), notifPermission: push.permission(),
    screen: 'today', ready: true, welcomeStep: 0,
  });
}

export function welcomeContinueDemo() { setState({ welcomeStep: 2 }); }

export async function saveProfile() {
  const name = state.draftName.trim();
  if (!name) return;
  const tz = D.detectTimezone();
  if (!backend()) { setState({ welcomeStep: 3, profile: { display_name: name, avatar_emoji: state.draftEmoji, timezone: tz } }); return; }
  try {
    setState({ busy: true, error: null });
    const profile = await api.updateProfile({ display_name: name, avatar_emoji: state.draftEmoji, timezone: tz });
    setState({ busy: false, profile, welcomeStep: 3 });
  } catch (e) { setState({ busy: false, error: e.message }); }
}

export async function finishWelcome() {
  setState({ screen: 'today', welcomeStep: 0 });
  if (HAS_SUPABASE) await loadToday();
  maybePromptInvite();
  applyPendingNav();
}

export async function signOut() {
  if (HAS_SUPABASE) await api.signOut();
  if (state.profile) offline.clearTodayCache(state.session?.user?.id || 'demo');
  setState({ session: null, profile: null, goals: [], completed: new Set(), screen: 'welcome', welcomeStep: 0, sheet: null,
             friends: [], friendsLoaded: false, activeFriendId: null, inviteLink: null, pendingInviteCode: null,
             notifEnabled: false, needsInstall: false });
}

export function openEditProfile() {
  setState({ sheet: 'editProfile', draftName: state.profile?.display_name || '', draftEmoji: state.profile?.avatar_emoji || '🦔', error: null });
}
export async function saveEditProfile() {
  const name = state.draftName.trim();
  if (!name) return;
  if (!backend()) {
    setState({ profile: { ...state.profile, display_name: name, avatar_emoji: state.draftEmoji }, sheet: null });
    showToast('Profile updated');
    return;
  }
  try {
    setState({ busy: true, error: null });
    const profile = await api.updateProfile({ display_name: name, avatar_emoji: state.draftEmoji });
    setState({ busy: false, profile, sheet: null });
    showToast('Profile updated');
  } catch (e) { setState({ busy: false, error: e.message }); }
}

// ---- today data ------------------------------------------------------------
export async function loadToday() {
  const tz = state.profile?.timezone || D.detectTimezone();
  const localDate = D.todayLocal(tz);
  const userId = state.session?.user?.id || 'demo';

  // 1) instant paint from cache (NF-3)
  const cache = offline.getTodayCache(userId);
  if (cache && cache.date === localDate) {
    setState({ localDate, todayLabel: D.todayLabel(tz), goals: cache.goals || [],
               completed: new Set(cache.completions || []), streak: cache.streak || state.streak });
  } else {
    setState({ localDate, todayLabel: D.todayLabel(tz) });
  }
  if (!backend() || !state.online) return;

  // 2) refresh from the source of truth
  try {
    const [goals, completed] = await Promise.all([api.listActiveGoals(), api.getCompletions(localDate)]);
    setState({ goals, completed, todayError: null });
    await refreshStreak();
    persistCache();
    persistStreakCache();       // keep the profile cache friends read (FRND-4) fresh
  } catch (e) { setState({ todayError: e.message }); }
}

export function retryToday() { setState({ todayError: null }); loadToday(); }

// Denormalize the just-computed streak onto profiles so friends_overview() can surface it
// (PRD §3.2 cache). Best-effort — the cache is always reconcilable from the day-log.
async function persistStreakCache() {
  if (!backend() || !state.online) return;
  try {
    await api.updateStreakCache({
      current: state.streak.current,
      longest: state.streak.longest,
      freezesAvailable: state.streak.freezesAvailable,
      perfectDaysSinceFreeze: state.streak.perfectDaysSinceFreeze,
    }, state.localDate);
  } catch { /* non-load-bearing */ }
}

async function refreshStreak() {
  // Build the gap-filled finalized history (everything before today), then let today extend it.
  const tz = state.profile?.timezone || D.detectTimezone();
  const today = D.todayLocal(tz);
  let history = [];
  try {
    const rows = await api.listDayResults();
    const perfectByDate = new Map(rows.filter((r) => r.local_date < today).map((r) => [r.local_date, r.is_perfect]));
    if (perfectByDate.size) {
      const start = [...perfectByDate.keys()].sort()[0];
      history = D.eachDay(start, D.prevDay(today)).map((d) => ({ local_date: d, is_perfect: perfectByDate.get(d) === true }));
    }
  } catch { /* offline / no history yet */ }
  state.history = history;
  recomputeStreak();
}

function recomputeStreak() {
  const todayPerfect = isPerfect(state.completed.size, state.goals.length);
  const streak = computeStreak(state.history, todayPerfect);
  setState({ streak });
}

function persistCache() {
  const userId = state.session?.user?.id || 'demo';
  offline.setTodayCache(userId, {
    date: state.localDate,
    goals: state.goals,
    completions: [...state.completed],
    streak: state.streak,
  });
}

// ---- goal check-off (GOAL-6, GOAL-8) ---------------------------------------
export async function toggleGoal(goalId) {
  const wasAllDone = state.goals.length > 0 && state.completed.size === state.goals.length;
  const completed = new Set(state.completed);
  const nowChecked = !completed.has(goalId);
  if (nowChecked) completed.add(goalId); else completed.delete(goalId);
  setState({ completed });                       // optimistic
  recomputeStreak();

  const nowAllDone = state.goals.length > 0 && completed.size === state.goals.length;
  if (nowAllDone && !wasAllDone) celebrate(state.streak.current);

  await persistCompletion(goalId, nowChecked);
  persistCache();
  persistStreakCache();
}

async function persistCompletion(goalId, checked) {
  if (!backend()) return;
  const entry = { goal_id: goalId, local_date: state.localDate, completed: checked, ts: Date.now() };
  if (!state.online) { offline.queuePendingWrite(entry); return; }
  try {
    await api.setCompletion(goalId, state.localDate, checked);
    await syncTodayResult();
  } catch (e) { offline.queuePendingWrite(entry); }
}

// keep today's day_result row in step with live completions (finalized:false)
async function syncTodayResult() {
  if (!backend()) return;
  const total = state.goals.length;
  const done = state.completed.size;
  await api.upsertDayResult(state.localDate, {
    goals_total: total, goals_completed: done, is_perfect: isPerfect(done, total), finalized: false,
  });
}

async function replayPending() {
  if (!backend()) return;
  const queue = offline.getPendingWrites();
  if (!queue.length) return;
  for (const e of queue) {
    try { await api.setCompletion(e.goal_id, e.local_date, e.completed); } catch { return; /* stay queued */ }
  }
  offline.clearPendingWrites();
  await loadToday();
}

// ---- goal management (GOAL-1..GOAL-4) --------------------------------------
export async function addGoal() {
  const title = state.newGoal.trim();
  if (!title) return;
  if (state.goals.length >= CONFIG.MAX_GOALS) { showToast(`Up to ${CONFIG.MAX_GOALS} goals — keep it small 🌱`); return; }
  const emoji = state.newEmoji;
  const sort_order = state.goals.length;
  if (!backend()) {
    const g = { id: 'local-' + Date.now(), title, emoji, sort_order, active: true };
    setState({ goals: [...state.goals, g], newGoal: '', newEmoji: '✨' });
    recomputeStreak(); return;
  }
  try {
    const g = await api.createGoal({ title, emoji, sort_order });
    setState({ goals: [...state.goals, g], newGoal: '', newEmoji: '✨' });
    recomputeStreak(); persistCache();
    await syncTodayResult();   // goal count changed → today's perfect flag may flip (friend status)
    persistStreakCache();
  } catch (e) { setState({ error: e.message }); }
}

// live rename (no re-render, so the input keeps focus); persisted on blur via commitRename
export function renameGoalLive(id, title) {
  const g = state.goals.find((x) => x.id === id);
  if (g) g.title = title;
}
export async function commitRename(id, title) {
  const t = title.trim();
  if (!t) return;
  const g = state.goals.find((x) => x.id === id);
  if (g) g.title = t;
  if (backend()) { try { await api.renameGoal(id, t); persistCache(); } catch (e) { setState({ error: e.message }); } }
}

export function askDelete(id) { setState({ sheet: 'confirmDelete', deleteTargetId: id }); }
export function cancelDelete() { setState({ sheet: 'manage', deleteTargetId: null }); }
export async function confirmDelete() {
  const id = state.deleteTargetId;
  const goals = state.goals.filter((g) => g.id !== id);
  const completed = new Set([...state.completed].filter((c) => c !== id));
  setState({ goals, completed, sheet: 'manage', deleteTargetId: null });
  recomputeStreak(); persistCache();
  if (backend() && !String(id).startsWith('local-')) {
    try { await api.archiveGoal(id); await syncTodayResult(); persistStreakCache(); }
    catch (e) { setState({ error: e.message }); }
  }
}

export async function reorderGoals(fromId, toId) {
  if (fromId === toId) return;
  const goals = [...state.goals];
  const from = goals.findIndex((g) => g.id === fromId);
  const to = goals.findIndex((g) => g.id === toId);
  if (from < 0 || to < 0) return;
  const [moved] = goals.splice(from, 1);
  goals.splice(to, 0, moved);
  goals.forEach((g, i) => { g.sort_order = i; });
  setState({ goals });
  if (backend()) { try { await api.reorderGoals(goals); persistCache(); } catch (e) { setState({ error: e.message }); } }
}

// ---- navigation / sheets ---------------------------------------------------
export function go(screen) {
  setState({ screen, sheet: null, error: null });
  if (screen === 'friends') loadFriends();
}
export function openSheet(sheet) { setState({ sheet }); }
export function closeSheet() {
  const patch = { sheet: null };
  if (state.sheet === 'invite') patch.inviteLink = null;   // mint a fresh code next open
  setState(patch);
}

// ---- friends (FRND-3..FRND-6) ----------------------------------------------
// Demo seed (no backend) so the Friends UI is fully previewable — mirrors the design artifact.
const DEMO_FRIENDS = [
  { friendshipId: 'd-maya', id: 'maya', name: 'Maya', emoji: '🦊', color: '#E0762B', status: 'perfect',    personal: 21, longest: 21, shared: 8, sharedLongest: 8, sharedState: 'active' },
  { friendshipId: 'd-theo', id: 'theo', name: 'Theo', emoji: '🐢', color: '#4F8A6B', status: 'inprogress', personal: 9,  longest: 14, shared: 3, sharedLongest: 5, sharedState: 'atrisk' },
  { friendshipId: 'd-ivy',  id: 'ivy',  name: 'Ivy',  emoji: '🌿', color: '#3E6B99', status: 'notstarted', personal: 4,  longest: 12, shared: 0, sharedLongest: 2, sharedState: 'zero'   },
];

export async function loadFriends() {
  if (!backend()) { setState({ friends: DEMO_FRIENDS, friendsLoaded: true }); return; }
  if (!state.online) { setState({ friendsLoaded: true }); return; }
  try {
    setState({ friendsBusy: true });
    const rows = await api.listFriends();
    const today = state.localDate;
    const myTodayPerfect = isPerfect(state.completed.size, state.goals.length);
    const friends = rows.map((r) => {
      const bothToday = myTodayPerfect && r.today_status === 'perfect';
      const shared = computeSharedStreak(r.both_perfect_dates || [], today, bothToday);
      return {
        friendshipId: r.friendship_id,
        id: r.friend_id,
        name: r.display_name || 'Friend',
        emoji: r.avatar_emoji || '🙂',
        color: r.avatar_color || '#3E6B99',
        status: r.today_status,               // perfect | inprogress | notstarted
        personal: r.current_streak || 0,
        longest: r.longest_streak || 0,
        shared: shared.current,
        sharedLongest: shared.longest,
        sharedState: shared.state,            // active | atrisk | zero
      };
    });
    setState({ friends, friendsLoaded: true, friendsBusy: false, friendsError: null });
  } catch (e) { setState({ friendsBusy: false, friendsLoaded: true, friendsError: e.message }); }
}

export function retryFriends() { setState({ friendsError: null, friendsLoaded: false }); loadFriends(); }

// ---- invites (FRND-1, FRND-2) ----------------------------------------------
function buildInviteUrl(code) {
  return `${window.location.origin}${window.location.pathname}?invite=${code}`;
}

export async function openInvite() {
  setState({ sheet: 'invite', inviteLink: null, inviteError: null });
  if (!backend()) { setState({ inviteLink: buildInviteUrl('demo-warm') }); return; }
  try {
    setState({ inviteBusy: true });
    const code = await api.createInvite();
    setState({ inviteBusy: false, inviteLink: buildInviteUrl(code) });
  } catch (e) { setState({ inviteBusy: false, inviteError: e.message }); }
}

export async function copyInviteLink() {
  const link = state.inviteLink;
  if (!link) return;
  try { await navigator.clipboard.writeText(link); } catch { /* fall through to the toast anyway */ }
  showToast('Invite link copied ✓');
}

export async function shareInviteLink() {
  const link = state.inviteLink;
  if (!link) return;
  if (navigator.share) {
    try { await navigator.share({ title: 'Ember', text: 'Keep a daily streak with me on Ember 🔥', url: link }); }
    catch { /* user cancelled the share sheet */ }
    return;
  }
  copyInviteLink();
}

// URL-borne invite: stash the code before the magic-link redirect drops the query string.
function captureInviteFromUrl() {
  try {
    const code = new URLSearchParams(window.location.search).get('invite');
    // reject empty / obviously invalid codes (must be 4–64 url-safe chars)
    if (!code || !/^[\w-]{4,64}$/.test(code)) return;
    offline.setPendingInvite(code);
    window.history.replaceState({}, '', window.location.pathname); // don't re-trigger on refresh
  } catch { /* no URL API / blocked */ }
}

// Once signed in with a completed profile, surface any stashed invite for confirmation (FRND-2).
function maybePromptInvite() {
  const code = offline.getPendingInvite();
  if (!code) return;
  setState({ pendingInviteCode: code, sheet: 'acceptInvite', screen: 'friends' });
  loadFriends();   // populate the screen behind the confirmation sheet
}

export function declineInvite() {
  offline.clearPendingInvite();
  setState({ sheet: null, pendingInviteCode: null });
}

export async function acceptPendingInvite() {
  const code = state.pendingInviteCode;
  if (!code) { setState({ sheet: null }); return; }
  offline.clearPendingInvite();
  if (!backend()) {
    const demo = { friendshipId: "demo-new", id: "demo-new", name: "New friend", emoji: "🐤", color: "#3E6B99",
                   status: "notstarted", personal: 0, longest: 0, shared: 0, sharedLongest: 0, sharedState: "zero" };
    setState({ friends: [...state.friends, demo], pendingInviteCode: null, sheet: null, screen: 'friends', friendsLoaded: true });
    showToast("You're now friends 🔥");
    return;
  }
  try {
    setState({ busy: true });
    await api.acceptInvite(code);
    setState({ busy: false, pendingInviteCode: null, sheet: null, screen: 'friends' });
    showToast("You're now friends 🔥");
    await loadFriends();
  } catch (e) {
    setState({ busy: false, pendingInviteCode: null, sheet: null });
    showToast(inviteErrorMessage(e.message || ''));
  }
}

function inviteErrorMessage(msg) {
  if (/self/.test(msg))      return "That's your own invite link 🙂";
  if (/expired/.test(msg))   return 'That invite has expired';
  if (/used/.test(msg))      return 'That invite was already used';
  if (/not_found/.test(msg)) return "That invite link isn't valid";
  return "Couldn't accept that invite";
}

// ---- friend detail + nudge + remove (FRND-5) -------------------------------
export function openFriend(id) { setState({ sheet: 'friend', activeFriendId: id }); }

// Nudge sends a single push to the friend (NOTIF-8), rate-limited server-side. Best-effort:
// push failures never surface (NF-5); only an over-the-limit result changes the message.
export async function nudgeFriend(id) {
  const f = state.friends.find((x) => x.id === id);
  const name = f?.name || 'Your friend';
  if (!backend()) { showToast(`${name} got a nudge 👀`); return; }
  try {
    const res = await api.sendNudge(id);
    if (res && res.ok === false && res.reason === 'rate_limited') { showToast(`That's enough nudges for ${name} today 🙂`); return; }
  } catch { /* swallow: the nudge is best-effort */ }
  showToast(`${name} got a nudge 👀`);
}

export function askRemoveFriend(id) { setState({ sheet: 'confirmRemoveFriend', removeTargetId: id }); }
export function cancelRemoveFriend() { setState({ sheet: 'friend' }); }
export async function confirmRemoveFriend() {
  const id = state.removeTargetId;
  const f = state.friends.find((x) => x.id === id);
  const friends = state.friends.filter((x) => x.id !== id);
  setState({ friends, sheet: null, removeTargetId: null, activeFriendId: null });
  showToast(`${f?.name || 'Friend'} removed`);
  if (backend() && f?.friendshipId && !String(f.friendshipId).startsWith('d-')) {
    try { await api.removeFriend(f.friendshipId); } catch (e) { setState({ error: e.message }); }
  }
}

// ---- notifications (M3, best-effort — NOTIF-2/-3/-6/-7/-8) ------------------
// Enable is always called from a user gesture (NOTIF-2). iOS gating + failures are surfaced
// only as a gentle toast — never an error, never a broken state (NF-5).
export async function enableReminders() {
  if (!backend()) { setState({ notifEnabled: true, notifPermission: 'granted' }); showToast('Reminders on (demo) 🔔'); return true; }
  if (push.isIOS() && !push.isStandalone()) { setState({ needsInstall: true }); showToast('Add Ember to your Home Screen to enable reminders'); return false; }
  const status = await push.enablePush();
  if (status === 'enabled') {
    try { const p = await api.updateProfile({ notifications_enabled: true }); setState({ profile: p }); } catch { /* cache is intent-only */ }
    setState({ notifEnabled: true, notifPermission: 'granted', needsInstall: false });
    showToast('Reminders on 🔔');
    return true;
  }
  setState({ notifPermission: push.permission() });
  showToast(reminderStatusMessage(status));
  return false;
}

export async function disableReminders() {
  setState({ notifEnabled: false });
  if (!backend()) { showToast('Reminders off'); return; }
  await push.disablePush();
  try { const p = await api.updateProfile({ notifications_enabled: false }); setState({ profile: p }); } catch { /* best-effort */ }
  showToast('Reminders off');
}

export function toggleReminders() { return state.notifEnabled ? disableReminders() : enableReminders(); }

// welcome step 3 CTA: turn on reminders (gesture) then continue into the app either way.
export async function enableRemindersThenFinish() {
  await enableReminders();
  await finishWelcome();
}

function reminderStatusMessage(status) {
  switch (status) {
    case 'need-install': return 'Add Ember to your Home Screen to enable reminders';
    case 'denied':       return 'Notifications are blocked in your browser settings';
    case 'unsupported':  return "This browser can't do reminders — that's OK";
    case 'no-vapid':     return "Reminders aren't set up on this server yet";
    default:             return "Couldn't turn on reminders";
  }
}

export function openReminderTime() { setState({ sheet: 'reminderTime' }); }
export async function setReminderTime(hhmm) {
  setState({ reminderTime: hhmm, sheet: null });
  if (!backend()) { showToast('Reminder time updated'); return; }
  try { const p = await api.updateProfile({ reminder_time: hhmm }); setState({ profile: p }); }
  catch (e) { setState({ error: e.message }); }
}

// the SW handed us a rotated subscription (pushsubscriptionchange) — persist it (NOTIF-5).
export function handleResubscribe(subJSON) { push.persistResubscription(subJSON); }

// ---- notification deep-link (?go= / SW message → NOTIF-9) -------------------
function captureGoFromUrl() {
  try {
    const go = new URLSearchParams(window.location.search).get('go');
    if (!go) return;
    pendingNav = go === 'friends' ? 'friends' : 'today';
    const url = window.location.pathname + window.location.search.replace(/([?&])go=[^&]*/, '$1').replace(/[?&]$/, '');
    window.history.replaceState({}, '', url || window.location.pathname);
  } catch { /* no URL API */ }
}
function applyPendingNav() {
  if (!pendingNav || state.screen === 'welcome') return;
  const screen = pendingNav; pendingNav = null;
  if (state.sheet === 'acceptInvite') return;   // an invite prompt takes precedence
  go(screen);
}
