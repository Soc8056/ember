// Web-push subscribe flow + iOS gating (PRD §3.4, NOTIF-2/-3/-4/-5). Everything here is
// best-effort: every entry point degrades to a status string instead of throwing, so an
// unsupported browser or a denied permission never breaks the app (NF-5). All the browser
// (navigator/Notification/PushManager) concerns live here; the store decides what to do with
// the result and owns the `notifications_enabled` profile write.
import { ENV } from './config.js';
import * as api from './api.js';

export const pushSupported = () =>
  typeof navigator !== 'undefined' && 'serviceWorker' in navigator &&
  typeof window !== 'undefined' && 'PushManager' in window && 'Notification' in window;

export const isIOS = () =>
  typeof navigator !== 'undefined' &&
  (/iphone|ipad|ipod/i.test(navigator.userAgent) ||
   (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)); // iPadOS masquerades as Mac

// installed to the Home Screen? (iOS push is ONLY available in standalone — NOTIF-3, §12)
export const isStandalone = () =>
  (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
  (typeof navigator !== 'undefined' && navigator.standalone === true);

export const hasVapid = () => Boolean(ENV.VAPID_PUBLIC_KEY);
export const permission = () => (typeof Notification !== 'undefined' ? Notification.permission : 'default');

// VAPID public key (url-safe base64) → the Uint8Array applicationServerKey the API wants.
function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function ready() { return navigator.serviceWorker.ready; }

// Gesture-gated enable (NOTIF-2). MUST be called from a user gesture. Returns a status:
// 'enabled' | 'need-install' | 'denied' | 'unsupported' | 'no-vapid' | 'error'.
export async function enablePush() {
  if (!pushSupported()) return 'unsupported';
  if (isIOS() && !isStandalone()) return 'need-install';     // NOTIF-3
  if (!hasVapid()) return 'no-vapid';
  let perm;
  try { perm = await Notification.requestPermission(); } catch { return 'error'; }
  if (perm !== 'granted') return 'denied';
  try {
    const reg = await ready();
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(ENV.VAPID_PUBLIC_KEY),
    });
    await api.savePushSubscription(sub.toJSON());              // NOTIF-4
    return 'enabled';
  } catch { return 'error'; }
}

export async function disablePush() {
  try {
    const reg = await ready();
    const sub = await reg.pushManager.getSubscription();
    if (sub) { try { await api.deletePushSubscription(sub.endpoint); } catch {} await sub.unsubscribe(); }
  } catch { /* already gone */ }
  return 'disabled';
}

// Re-validate on app open (NOTIF-5 / §12): if the user wants notifications and permission is
// still granted, make sure a fresh subscription is stored — WITHOUT prompting. Best-effort.
export async function revalidate(intended) {
  if (!intended || !pushSupported() || permission() !== 'granted' || !hasVapid()) return;
  try {
    const reg = await ready();
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(ENV.VAPID_PUBLIC_KEY),
    });
    await api.savePushSubscription(sub.toJSON());
  } catch { /* best-effort */ }
}

// Persist a subscription the SW handed over on pushsubscriptionchange (NOTIF-5).
export async function persistResubscription(subJSON) {
  if (!subJSON) return;
  try { await api.savePushSubscription(subJSON); } catch { /* best-effort */ }
}
