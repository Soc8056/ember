// Scheduler sweep (PRD Scheduler, NOTIF-6/-7/-10). Invoked every ~15 min by pg_cron (primary)
// or the GitHub Actions fallback, both passing the shared `x-sweep-secret`. It asks the DB who
// is due right now (notifications_due(), all local-time logic lives there), then for each due
// send it: (1) claims an idempotency row so concurrent sweeps can't double-send, (2) pushes to
// every device, (3) prunes dead subscriptions. A missed sweep never touches streak state (NF-4).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { sendPush } from '../_shared/webpush.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SWEEP_SECRET = Deno.env.get('SWEEP_SECRET') ?? '';

const COPY: Record<string, { title: string; body: string; tag: string }> = {
  reminder:    { title: 'Keep your flame going 🔥', body: 'Your day isn’t perfect yet — check off what’s left.', tag: 'ember-reminder' },
  streak_risk: { title: 'Your streak’s at risk ⏳',  body: 'A few hours left to keep tonight’s streak alive.',   tag: 'ember-risk' },
};

Deno.serve(async (req) => {
  if (!SWEEP_SECRET || req.headers.get('x-sweep-secret') !== SWEEP_SECRET) {
    return json({ ok: false, reason: 'forbidden' }, 403);
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const { data: due, error } = await db.rpc('notifications_due');
  if (error) return json({ ok: false, error: error.message }, 500);

  let sent = 0, pruned = 0, claimed = 0;
  for (const row of due ?? []) {
    // idempotency: only proceed if WE create the (user, type, local_date) guard row
    const ins = await db.from('notifications_sent')
      .insert({ user_id: row.user_id, type: row.kind, local_date: row.local_date })
      .select('id');
    if (ins.error || !ins.data?.length) continue;   // unique violation → another sweep got it
    claimed++;

    const { data: subs } = await db.from('push_subscriptions')
      .select('endpoint,p256dh,auth').eq('user_id', row.user_id);
    const copy = COPY[row.kind];
    for (const sub of subs ?? []) {
      const res = await sendPush(sub, { ...copy, screen: 'today', url: './?go=today' });
      if (res === 'ok') sent++;
      else if (res === 'gone') { await db.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); pruned++; }
    }
  }

  return json({ ok: true, due: due?.length ?? 0, claimed, sent, pruned });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
