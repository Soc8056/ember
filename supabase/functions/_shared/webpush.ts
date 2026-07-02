// Shared Web Push sender for the Edge Functions (PRD §10, Resolved #9). Uses the standard
// `web-push` library via Deno's npm compatibility — VAPID keys come from function secrets, and
// the private key NEVER leaves the server (NF-10). If `web-push` ever misbehaves under Deno,
// swap this one file for a Deno-native web-push module (the callers don't change) — see §12.
import webpush from 'npm:web-push@3.6.7';

const VAPID_PUBLIC  = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
// Safari rejects a localhost subject — use a real mailto: or https URL (NF-10).
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:ember@example.com';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

export type Sub = { endpoint: string; p256dh: string; auth: string };

// Send one push. Returns 'ok' | 'gone' (404/410 → the caller prunes it, NOTIF-5) | 'error'.
export async function sendPush(sub: Sub, payload: unknown): Promise<'ok' | 'gone' | 'error'> {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: 3600 },
    );
    return 'ok';
  } catch (err) {
    const code = (err as { statusCode?: number })?.statusCode;
    if (code === 404 || code === 410) return 'gone';   // subscription is dead → prune
    return 'error';
  }
}
