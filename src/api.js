// Thin Supabase data layer for Milestone 1 (auth, profile, goals, completions, day_results).
// All access is owner-scoped by RLS (see supabase/migrations/0001_init.sql).
import { supabase, HAS_SUPABASE } from './supabase.js';

function assert() {
  if (!HAS_SUPABASE) throw new Error('Supabase is not configured — copy src/env.example.js to src/env.js.');
}

// ---- auth (AUTH-1, AUTH-4, AUTH-5) -----------------------------------------
export async function sendMagicLink(email) {
  assert();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin + window.location.pathname },
  });
  if (error) throw error;
}
// Exchange a token_hash carried by the email link for a session. The email
// template links to the app itself (?token_hash={{ .TokenHash }}&type=email),
// so nothing is consumed until this call runs — inbox link-scanners that
// prefetch URLs can no longer burn the one-time token before the real click.
export async function verifyMagicToken(token_hash, type = 'email') {
  assert();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash });
  if (error) throw error;
}
// Exchange the 6-digit code from the same email ({{ .Token }} in the template)
// for a session. This is the escape hatch for the installed PWA: iOS gives the
// Home-Screen app its own storage, so a link opened in Safari can never sign
// the standalone app in — typing the code inside the app can.
export async function verifyEmailCode(email, token) {
  assert();
  const { error } = await supabase.auth.verifyOtp({ type: 'email', email, token });
  if (error) throw error;
}
export async function getSession() {
  if (!HAS_SUPABASE) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}
export function onAuthChange(cb) {
  if (!HAS_SUPABASE) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_e, session) => cb(session));
  return () => data.subscription.unsubscribe();
}
export async function signOut() { assert(); await supabase.auth.signOut(); }

// ---- profile (AUTH-2, AUTH-3) ----------------------------------------------
export async function getProfile() {
  assert();
  const { data, error } = await supabase.from('profiles').select('*').maybeSingle();
  if (error) throw error;
  return data;
}
export async function updateProfile(patch) {
  assert();
  const { data: u } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('profiles').update(patch).eq('id', u.user.id).select().single();
  if (error) throw error;
  return data;
}

// ---- goals (GOAL-1..GOAL-4) ------------------------------------------------
export async function listActiveGoals() {
  assert();
  const { data, error } = await supabase
    .from('goals').select('*').eq('active', true).order('sort_order', { ascending: true });
  if (error) throw error;
  return data;
}
export async function createGoal({ title, emoji, sort_order }) {
  assert();
  const { data: u } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('goals').insert({ user_id: u.user.id, title, emoji, sort_order }).select().single();
  if (error) throw error;
  return data;
}
export async function renameGoal(id, title) {
  assert();
  const { error } = await supabase.from('goals').update({ title }).eq('id', id);
  if (error) throw error;
}
export async function reorderGoals(ordered) {
  assert();
  // persist each goal's new sort_order
  await Promise.all(ordered.map((g, i) =>
    supabase.from('goals').update({ sort_order: i }).eq('id', g.id)));
}
// GOAL-2: "delete" archives so historical completions/day_results survive.
export async function archiveGoal(id) {
  assert();
  const { error } = await supabase
    .from('goals').update({ active: false, archived_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

// ---- completions (GOAL-6) --------------------------------------------------
export async function getCompletions(localDate) {
  assert();
  const { data, error } = await supabase
    .from('completions').select('goal_id').eq('local_date', localDate);
  if (error) throw error;
  return new Set(data.map((r) => r.goal_id));
}
export async function setCompletion(goalId, localDate, completed) {
  assert();
  const { data: u } = await supabase.auth.getUser();
  if (completed) {
    const { error } = await supabase.from('completions')
      .upsert({ user_id: u.user.id, goal_id: goalId, local_date: localDate },
              { onConflict: 'user_id,goal_id,local_date' });
    if (error) throw error;
  } else {
    const { error } = await supabase.from('completions')
      .delete().eq('goal_id', goalId).eq('local_date', localDate);
    if (error) throw error;
  }
}

// ---- streak cache (denormalized on profiles so FRIENDS can read it, FRND-4) -
// Not source of truth (PRD §3.2) — reconcilable from day_results, kept fresh so
// friends_overview() can surface a friend's personal streak without touching the log.
export async function updateStreakCache({ current, longest, freezesAvailable, perfectDaysSinceFreeze }, localDate) {
  assert();
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from('profiles').update({
    current_streak: current,
    longest_streak: longest,
    freezes_available: freezesAvailable,
    perfect_days_since_freeze: perfectDaysSinceFreeze,
    last_evaluated_date: localDate,
  }).eq('id', u.user.id);
  if (error) throw error;
}

// ---- friends + invites (FRND-1..FRND-6) ------------------------------------
// The caller's permanent friend code (minted server-side on first call). Reusable
// forever, across any number of friends — see supabase/migrations/0004_friend_codes.sql.
export async function getFriendCode() {
  assert();
  const { data, error } = await supabase.rpc('my_friend_code');
  if (error) throw error;
  return data; // bare 6-char code
}
// Establish an accepted friendship from someone's friend code (case-insensitive, reusable).
export async function addFriendByCode(code) {
  assert();
  const { data, error } = await supabase.rpc('add_friend_by_code', { p_code: code });
  if (error) throw error;
  return data; // { friendship_id, friend_id }
}
// Legacy single-use invite acceptance — kept so old ?invite= links still resolve.
export async function acceptInvite(code) {
  assert();
  const { data, error } = await supabase.rpc('accept_invite', { p_code: code });
  if (error) throw error;
  return data; // { friendship_id, friend_id }
}
// Each accepted friend's public fields + coarse today status + both-perfect date set.
export async function listFriends() {
  assert();
  const { data, error } = await supabase.rpc('friends_overview');
  if (error) throw error;
  return data || [];
}
// Remove a friendship (deletes it for both parties + drops the shared streak, FRND-5).
export async function removeFriend(friendshipId) {
  assert();
  const { error } = await supabase.from('friendships').delete().eq('id', friendshipId);
  if (error) throw error;
}

// ---- push subscriptions + nudge (M3, NOTIF-4/-8) ---------------------------
// Upsert a device subscription (endpoint is unique → re-subscribes replace cleanly).
export async function savePushSubscription(sub) {
  assert();
  const { data: u } = await supabase.auth.getUser();
  const keys = sub.keys || {};
  const { error } = await supabase.from('push_subscriptions').upsert(
    { user_id: u.user.id, endpoint: sub.endpoint, p256dh: keys.p256dh, auth: keys.auth },
    { onConflict: 'endpoint' });
  if (error) throw error;
}
export async function deletePushSubscription(endpoint) {
  assert();
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
  if (error) throw error;
}
// Send a friend a nudge push via the Edge Function (rate-limited server-side). Returns
// { ok, reason } — a rate-limited nudge comes back ok:false, not an error.
export async function sendNudge(friendId) {
  assert();
  const { data, error } = await supabase.functions.invoke('send-nudge', { body: { to: friendId } });
  if (error) throw error;
  return data;
}

// ---- day_results (streak source data, PRD §3.2) ----------------------------
export async function upsertDayResult(localDate, { goals_total, goals_completed, is_perfect, finalized }) {
  assert();
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from('day_results').upsert(
    { user_id: u.user.id, local_date: localDate, goals_total, goals_completed, is_perfect, finalized: !!finalized },
    { onConflict: 'user_id,local_date' });
  if (error) throw error;
}
export async function listDayResults() {
  assert();
  const { data, error } = await supabase
    .from('day_results').select('local_date,is_perfect,finalized,goals_total,goals_completed')
    .order('local_date', { ascending: true });
  if (error) throw error;
  return data;
}
