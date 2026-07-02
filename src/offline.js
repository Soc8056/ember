// Offline read of *today* + queued writes (PRD §5, NF-3). Nothing security-sensitive
// is cached here — just enough for the Today screen to render instantly and offline.

const K_THEME = 'ember.theme';
const K_PENDING = 'ember.pendingWrites';
const K_INVITE = 'ember.pendingInvite';
const todayKey = (userId) => `ember.today.${userId}`;

function read(key, fallback) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
  catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode / quota */ }
}

// theme preference: "system" | "light" | "dark"
export function getTheme() { return read(K_THEME, 'system'); }
export function setTheme(theme) { write(K_THEME, theme); }

// today snapshot: { date, goals, completions, streak }
export function getTodayCache(userId) { return read(todayKey(userId), null); }
export function setTodayCache(userId, snapshot) { write(todayKey(userId), snapshot); }
export function clearTodayCache(userId) { try { localStorage.removeItem(todayKey(userId)); } catch {} }

// pending completion toggles, replayed on reconnect (last-write-wins per goal+date).
export function getPendingWrites() { return read(K_PENDING, []); }
export function queuePendingWrite(entry) {
  const q = getPendingWrites().filter(
    (e) => !(e.goal_id === entry.goal_id && e.local_date === entry.local_date),
  );
  q.push(entry); // { goal_id, local_date, completed, ts }
  write(K_PENDING, q);
}
export function clearPendingWrites() { write(K_PENDING, []); }

// a friend-invite code captured from the URL, held across the magic-link redirect (M2).
export function getPendingInvite() { return read(K_INVITE, null); }
export function setPendingInvite(code) { write(K_INVITE, code); }
export function clearPendingInvite() { try { localStorage.removeItem(K_INVITE); } catch {} }

export function isOnline() { return typeof navigator === 'undefined' ? true : navigator.onLine; }
