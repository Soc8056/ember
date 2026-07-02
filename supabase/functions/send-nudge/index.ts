// Friend nudge (PRD NOTIF-8). Browser-invoked with the caller's JWT. Validates that the two
// users are accepted friends, enforces the per-friend daily rate limit, records the nudge, then
// pushes "{name} nudged you 👀" to the friend's devices. Reads the friend's subscriptions with
// the service-role key (they're RLS-private to the owner) — the JWT only proves who's asking.
// Returns { ok, reason } — a rate-limited nudge is ok:false (not an error) so the UI stays calm.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { sendPush } from '../_shared/webpush.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const NUDGE_RATE_LIMIT = 3;   // CONFIG.NUDGE_RATE_LIMIT — per friend per day

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ ok: false, reason: 'unauthenticated' }, 401);

  // identify the caller from their JWT
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } }, auth: { persistSession: false },
  });
  const { data: who } = await asUser.auth.getUser();
  const meId = who?.user?.id;
  if (!meId) return json({ ok: false, reason: 'unauthenticated' }, 401);

  let to: string | undefined;
  try { ({ to } = await req.json()); } catch { /* fallthrough */ }
  if (!to || to === meId) return json({ ok: false, reason: 'bad_request' }, 400);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // accepted friendship? (canonical user_a < user_b)
  const [ua, ub] = meId < to ? [meId, to] : [to, meId];
  const { data: fr } = await db.from('friendships').select('id')
    .eq('user_a', ua).eq('user_b', ub).eq('status', 'accepted').maybeSingle();
  if (!fr) return json({ ok: false, reason: 'not_friends' }, 403);

  // rate limit: at most NUDGE_RATE_LIMIT to this friend in the last 24h
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await db.from('nudges').select('id', { count: 'exact', head: true })
    .eq('from_user', meId).eq('to_user', to).gte('created_at', since);
  if ((count ?? 0) >= NUDGE_RATE_LIMIT) return json({ ok: false, reason: 'rate_limited' });

  await db.from('nudges').insert({ from_user: meId, to_user: to });

  const { data: meProfile } = await db.from('profiles').select('display_name').eq('id', meId).maybeSingle();
  const name = meProfile?.display_name ?? 'A friend';

  const { data: subs } = await db.from('push_subscriptions').select('endpoint,p256dh,auth').eq('user_id', to);
  let sent = 0, pruned = 0;
  for (const sub of subs ?? []) {
    const res = await sendPush(sub, {
      title: `${name} nudged you 👀`, body: 'Keep your streak alive together.',
      tag: 'ember-nudge', screen: 'friends', url: './?go=friends',
    });
    if (res === 'ok') sent++;
    else if (res === 'gone') { await db.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); pruned++; }
  }

  return json({ ok: true, sent, pruned });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });
}
