// Pure views: state -> HTML string. Ported faithfully from the Ember.html design artifact
// (the `{{ }}` bindings become template literals; `onclick="{{h}}"` becomes data-act="h").
// main.js turns clicks/inputs on these into store actions.
import { CONFIG } from './config.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// shared flame gradient so url(#flameGrad) resolves on every screen
const FLAME_DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <linearGradient id="flameGrad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="var(--ember)"/><stop offset="1" stop-color="var(--ember-deep)"/>
  </linearGradient></defs></svg>`;

const flame = (w, h, fill = 'url(#flameGrad)', checkOpacity = null) => `
  <svg width="${w}" height="${h}" viewBox="0 0 64 76" style="display:block;">
    <path d="M32 4 C 43 20, 56 26, 50 44 C 46 57, 38 66, 32 66 C 26 66, 15 59, 12 45 C 8 27, 22 22, 26 10 C 27 18, 30 22, 34 25 C 30 18, 31 10, 32 4 Z" fill="${fill}"/>
    ${checkOpacity !== null ? `<path d="M24 42 l6 6 l11 -13" fill="none" stroke="var(--bg)" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round" opacity="${checkOpacity}"/>` : ''}
  </svg>`;

const SCREEN_PAD = 'padding: calc(env(safe-area-inset-top) + 26px) 20px 120px; min-height:100%;';

// Offline pill — shown on any screen when the device has no network.
const offlineBanner = `<div style="display:flex; align-items:center; gap:8px; margin:0 0 14px; padding:10px 14px; border-radius:14px; background:color-mix(in srgb, var(--warning) 14%, var(--surface)); border:1px solid color-mix(in srgb, var(--warning) 30%, transparent);">
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1l22 22"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.56 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><path d="M12 20h.01"/></svg>
  <span style="font-size:13px; font-weight:500; color:var(--warning);">Offline — showing cached data</span>
</div>`;

// Error banner with optional retry action.
const errorBanner = (msg, retryAct) => `<div style="display:flex; align-items:center; gap:10px; margin:0 0 14px; padding:12px 14px; border-radius:14px; background:color-mix(in srgb, var(--error) 10%, var(--surface)); border:1px solid color-mix(in srgb, var(--error) 24%, transparent);">
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--error)" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
  <span style="flex:1; font-size:13px; font-weight:500; color:var(--error);">${esc(msg)}</span>
  ${retryAct ? `<button data-act="${retryAct}" style="padding:6px 12px; border:none; border-radius:999px; background:var(--error); color:#fff; font-family:inherit; font-size:12px; font-weight:600; cursor:pointer;">Retry</button>` : ''}
</div>`;

// Shimmer skeleton row used as a loading placeholder.
const shimmerRow = `<div style="height:68px; border-radius:20px; background:linear-gradient(90deg,var(--sunken) 0%,var(--surface) 50%,var(--sunken) 100%); background-size:260px 100%; animation:shimmer 1.4s infinite;"></div>`;

// ---------------------------------------------------------------------------
// TODAY
// ---------------------------------------------------------------------------
function renderToday(s) {
  const done = s.completed.size;
  const total = s.goals.length;
  const hasGoals = total > 0;
  const allDone = hasGoals && done === total;

  // streak hero
  const st = s.streak.state;
  let streakNum = s.streak.current;
  let streakLabel = 'day streak', labelColor = 'var(--ink-soft)';
  let fill = 'url(#flameGrad)', checkOp = 1, heroStyle = 'position:relative;';
  if (allDone) { streakLabel = 'Perfect day 🔥'; labelColor = 'var(--ember)'; heroStyle = 'position:relative; filter:drop-shadow(0 0 22px rgba(245,98,10,.32));'; }
  else if (st === 'atrisk') { streakLabel = 'Keep it alive — finish today'; labelColor = 'var(--warning)'; fill = 'var(--warning)'; heroStyle = 'position:relative; animation:warnPulse 2.4s ease-in-out infinite;'; }
  else if (st === 'frozen') { streakLabel = "Frozen — your flame's safe ❄️"; labelColor = 'var(--info)'; fill = 'var(--info)'; checkOp = 0; }
  else if (st === 'zero') { streakNum = 0; streakLabel = 'Start a streak today'; fill = 'var(--hairline)'; checkOp = 0; }

  // progress ring
  const r = 22, circ = 2 * Math.PI * r;
  const pct = total ? done / total : 0;
  const ringOffset = circ * (1 - pct);
  let ringHeadline = `${done} of ${total} done`, ringSub = 'One tap each — you’re close.';
  if (allDone) { ringHeadline = 'Perfect day 🔥'; ringSub = 'Every goal checked. Nice.'; }
  else if (done === 0) { ringHeadline = 'Fresh start'; ringSub = 'Check off your first goal.'; }

  const rowBase = 'width:100%; display:flex; align-items:center; gap:14px; padding:12px 14px; border-radius:20px; border:1px solid; font-family:inherit; text-align:left; cursor:pointer; transition:background .2s, border-color .2s;';
  const goalRow = (g) => {
    const checked = s.completed.has(g.id);
    const rowStyle = checked
      ? rowBase + 'background:color-mix(in srgb, var(--sage) 12%, var(--surface)); border-color:color-mix(in srgb, var(--sage) 34%, transparent); box-shadow:none; animation:emberSpring .32s ease;'
      : rowBase + 'background:var(--sunken); border-color:transparent; box-shadow:var(--shadow-sm);';
    const titleStyle = checked
      ? 'flex:1; min-width:0; font-size:16px; font-weight:500; color:var(--ink-soft);'
      : 'flex:1; min-width:0; font-size:16px; font-weight:600; color:var(--ink);';
    const emojiBg = checked ? 'color-mix(in srgb, var(--sage) 16%, transparent)' : 'var(--surface)';
    const mark = checked
      ? `<span style="position:relative; width:30px; height:30px; border-radius:999px; background:var(--sage); display:flex; align-items:center; justify-content:center; flex-shrink:0; overflow:hidden;">
           <span style="position:absolute; inset:0; background:var(--sage); transform-origin:left; animation:sweepIn .28s ease-out;"></span>
           <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--surface)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" style="position:relative; z-index:1;"><path d="M20 6 9 17l-5-5"/></svg>
         </span>`
      : `<span style="width:30px; height:30px; border-radius:999px; border:2px solid var(--hairline); flex-shrink:0;"></span>`;
    // photo proof chip (M5): only on checked rows — thumbnail when attached,
    // dashed camera otherwise. Inner data-act wins over the row's toggle.
    const photo = s.photos && s.photos.get(g.id);
    const busy = s.photoBusyId === g.id;
    const photoChip = !checked ? '' : photo
      ? `<img data-act="attachPhoto" data-id="${esc(g.id)}" src="${esc(photo.url)}" alt="Photo proof — tap to retake" style="width:34px; height:34px; border-radius:10px; object-fit:cover; flex-shrink:0; border:1.5px solid color-mix(in srgb, var(--sage) 45%, transparent); cursor:pointer;">`
      : `<span data-act="attachPhoto" data-id="${esc(g.id)}" role="button" aria-label="Add a photo" style="width:34px; height:34px; border-radius:10px; border:1.5px dashed var(--hairline); display:flex; align-items:center; justify-content:center; flex-shrink:0; cursor:pointer;${busy ? ' opacity:.4;' : ''}">
           <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--ink-soft)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
         </span>`;
    return `<button data-act="toggle" data-id="${esc(g.id)}" style="${rowStyle}">
      <span style="width:44px; height:44px; border-radius:14px; background:${emojiBg}; display:flex; align-items:center; justify-content:center; font-size:22px; flex-shrink:0;">${esc(g.emoji || '✨')}</span>
      <span style="${titleStyle}">${esc(g.title)}</span>
      ${photoChip}
      ${mark}
    </button>`;
  };

  const header = `
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
      <div>
        <div style="font-size:11px; font-weight:600; letter-spacing:.14em; text-transform:uppercase; color:var(--ink-soft);">${esc(s.todayLabel)}</div>
        <h1 style="margin:2px 0 0; font-family:'Fraunces',Georgia,serif; font-weight:500; font-size:24px; line-height:30px; color:var(--ink);">Today</h1>
      </div>
      <button data-act="openSettings" style="width:40px; height:40px; border:none; border-radius:999px; background:var(--surface); box-shadow:var(--shadow-sm); display:flex; align-items:center; justify-content:center; color:var(--ink); cursor:pointer;">
        <span style="width:28px; height:28px; border-radius:999px; background:color-mix(in srgb, var(--info) 22%, var(--surface)); display:flex; align-items:center; justify-content:center; font-size:15px;">${esc(s.profile?.avatar_emoji || '🦔')}</span>
      </button>
    </div>`;

  const hero = `
    <div style="display:flex; flex-direction:column; align-items:center; text-align:center; padding:22px 0 10px;">
      <div style="${heroStyle}">${flame(88, 104, fill, checkOp)}</div>
      <div style="margin-top:2px; font-family:'Fraunces',Georgia,serif; font-weight:600; font-size:56px; line-height:60px; color:var(--ink); font-variant-numeric:tabular-nums;">${streakNum}</div>
      <div style="margin-top:2px; font-size:13px; font-weight:500; color:${labelColor};">${streakLabel}</div>
    </div>`;

  const goalsSection = hasGoals ? `
    <div style="display:flex; align-items:center; gap:14px; background:var(--surface); border-radius:20px; padding:14px 16px; box-shadow:var(--shadow-sm); margin:12px 4px 22px;">
      <div style="position:relative; width:52px; height:52px; flex-shrink:0;">
        <svg width="52" height="52" viewBox="0 0 52 52" style="transform:rotate(-90deg);">
          <circle cx="26" cy="26" r="22" fill="none" stroke="var(--sunken)" stroke-width="6"/>
          <circle cx="26" cy="26" r="22" fill="none" stroke="url(#flameGrad)" stroke-width="6" stroke-linecap="round" stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${ringOffset.toFixed(1)}" style="transition:stroke-dashoffset .4s cubic-bezier(.34,1.56,.64,1);"/>
        </svg>
        <div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:600; color:var(--ink); font-variant-numeric:tabular-nums;">${done}/${total}</div>
      </div>
      <div style="flex:1; min-width:0;">
        <div style="font-size:15px; font-weight:600; color:var(--ink);">${ringHeadline}</div>
        <div style="font-size:13px; line-height:18px; color:var(--ink-soft); margin-top:1px;">${ringSub}</div>
      </div>
    </div>
    <div style="display:flex; flex-direction:column; gap:12px;">${s.goals.map(goalRow).join('')}</div>
    ${done > 0 ? `<button data-act="shareDay" style="margin:16px 2px 0; width:100%; display:flex; align-items:center; justify-content:center; gap:9px; padding:13px 14px; border:1px solid var(--hairline); border-radius:16px; background:var(--surface); color:var(--ink); font-family:inherit; font-size:14px; font-weight:600; cursor:pointer; box-shadow:var(--shadow-sm);${s.shareBusy ? ' opacity:.5; pointer-events:none;' : ''}">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
      ${s.shareBusy ? 'Making your card…' : 'Share my day'}
    </button>` : ''}
    <button data-act="openManage" style="margin:14px 2px 0; width:100%; display:flex; align-items:center; gap:10px; padding:12px 14px; border:none; background:transparent; color:var(--ink-soft); font-family:inherit; font-size:15px; font-weight:500; cursor:pointer;">
      <span style="width:30px; height:30px; border-radius:999px; border:1.5px dashed var(--hairline); display:flex; align-items:center; justify-content:center;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M5 12h14M12 5v14"/></svg>
      </span>Add a goal
    </button>` : `
    <div style="display:flex; flex-direction:column; align-items:center; text-align:center; padding:26px 24px;">
      <svg width="132" height="132" viewBox="0 0 132 132" fill="none" style="margin-bottom:6px;">
        <circle cx="66" cy="72" r="34" fill="var(--sunken)"/>
        <path d="M66 52 c7 9 15 12 12 24 -2 8 -7 13 -12 13 -5 0 -12 -5 -14 -13 -3 -12 8 -14 10 -22 1 5 3 7 5 9 -2 -5 -2 -9 -1 -11Z" fill="none" stroke="var(--ink-soft)" stroke-width="2.4" stroke-linejoin="round" opacity=".55"/>
        <circle cx="42" cy="42" r="2.4" fill="var(--ember)" opacity=".7"/>
        <circle cx="92" cy="50" r="1.8" fill="var(--ember)" opacity=".5"/>
        <circle cx="98" cy="82" r="2.2" fill="var(--sage)" opacity=".6"/>
      </svg>
      <h2 style="margin:8px 0 4px; font-family:'Fraunces',Georgia,serif; font-weight:500; font-size:21px; color:var(--ink);">A flame waiting to catch</h2>
      <p style="margin:0 0 18px; font-size:15px; line-height:22px; color:var(--ink-soft); max-width:250px;">Add a couple of small daily goals. Finish them all to keep your flame going.</p>
      <button data-act="openManage" style="border:none; border-radius:999px; padding:13px 22px; background:var(--ink); color:var(--bg); font-family:inherit; font-size:15px; font-weight:600; cursor:pointer; box-shadow:var(--shadow-sm);">Add your first goal</button>
    </div>`;

  const topBanners = [
    (!s.online ? offlineBanner : ''),
    (s.todayError ? errorBanner(s.todayError, 'retryToday') : ''),
  ].join('');

  return `<div style="${SCREEN_PAD}">${header}${topBanners}${hero}${goalsSection}</div>`;
}

// "20:00" → "8:00 PM" for display; falls back to the raw value if unparseable.
function fmtTime(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  if (!m) return hhmm || '—';
  let h = +m[1]; const min = m[2];
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${min} ${ap}`;
}

// Reminders group (M3): daily-reminder time + the push toggle, gated for iOS/unsupported.
function renderReminders(s) {
  const chevron = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ink-soft)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`;

  const timeRow = `<button data-act="openReminderTime" style="width:100%; display:flex; align-items:center; gap:12px; padding:15px 16px; border:none; border-bottom:1px solid var(--hairline); background:transparent; font-family:inherit; cursor:pointer;">
      <span style="flex:1; text-align:left; font-size:15px; font-weight:500; color:var(--ink);">Daily reminder</span>
      <span style="font-size:15px; font-weight:600; color:var(--ember);">${fmtTime(s.reminderTime)}</span>
      ${chevron}
    </button>`;

  // push row: either the toggle, the iOS Home-Screen note, or a graceful "unsupported" note.
  let pushRow;
  if (!s.notifSupported) {
    pushRow = `<div style="display:flex; align-items:center; gap:12px; padding:15px 16px;">
        <span style="flex:1;">
          <span style="display:block; font-size:15px; font-weight:500; color:var(--ink);">Push notifications</span>
          <span style="display:block; font-size:12px; line-height:16px; color:var(--ink-soft); margin-top:2px;">This browser can’t send reminders — the app works fine without them.</span>
        </span>
      </div>`;
  } else {
    const on = s.notifEnabled;
    const track = `position:relative;width:48px;height:28px;border-radius:999px;cursor:pointer;border:none;flex-shrink:0;transition:background .2s;background:${on ? 'var(--sage)' : 'var(--hairline)'};`;
    const knob = `position:absolute;top:3px;${on ? 'left:23px' : 'left:3px'};width:22px;height:22px;border-radius:999px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:left .2s ease;`;
    const note = s.needsInstall
      ? 'On iOS, add Ember to your Home Screen to enable these.'
      : 'A gentle evening nudge if your day isn’t perfect yet.';
    pushRow = `<div style="display:flex; align-items:center; gap:12px; padding:15px 16px;">
        <span style="flex:1;">
          <span style="display:block; font-size:15px; font-weight:500; color:var(--ink);">Push notifications</span>
          <span style="display:block; font-size:12px; line-height:16px; color:var(--ink-soft); margin-top:2px;">${note}</span>
        </span>
        <button data-act="toggleReminders" aria-label="Toggle notifications" style="${track}"><span style="${knob}"></span></button>
      </div>`;
  }

  return `<div style="background:var(--surface); border:1px solid var(--hairline); border-radius:20px; overflow:hidden; box-shadow:var(--shadow-sm); margin-bottom:22px;">${timeRow}${pushRow}</div>`;
}

// ---------------------------------------------------------------------------
// SETTINGS
// ---------------------------------------------------------------------------
function renderSettings(s) {
  const themeSeg = (val, label) => {
    const active = s.theme === val;
    const style = 'flex:1;border:none;border-radius:11px;padding:9px 4px;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;' +
      (active ? 'background:var(--surface);color:var(--ink);box-shadow:var(--shadow-sm);' : 'background:transparent;color:var(--ink-soft);');
    return `<button data-act="theme:${val}" style="${style}">${label}</button>`;
  };
  return `<div style="${SCREEN_PAD}">
    <h1 style="margin:0 0 18px; font-family:'Fraunces',Georgia,serif; font-weight:500; font-size:24px; line-height:30px; color:var(--ink);">Settings</h1>
    ${s.error ? errorBanner(s.error, '') : ''}
    <button data-act="editProfile" style="width:100%; text-align:left; display:flex; align-items:center; gap:14px; background:var(--surface); border:1px solid var(--hairline); border-radius:20px; padding:14px; box-shadow:var(--shadow-sm); margin-bottom:22px; cursor:pointer; font-family:inherit;">
      <span style="width:52px; height:52px; border-radius:999px; background:color-mix(in srgb, var(--info) 24%, var(--surface)); display:flex; align-items:center; justify-content:center; font-size:26px;">${esc(s.profile?.avatar_emoji || '🦔')}</span>
      <span style="flex:1; min-width:0;">
        <span style="display:block; font-size:17px; font-weight:600; color:var(--ink);">${esc(s.profile?.display_name || 'You')}</span>
        <span style="display:block; font-size:13px; color:var(--ink-soft);">Tap to edit name &amp; emoji</span>
      </span>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--ink-soft)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
    </button>

    <div style="font-size:11px; font-weight:600; letter-spacing:.12em; text-transform:uppercase; color:var(--ink-soft); margin:0 4px 8px;">Reminders</div>
    ${renderReminders(s)}

    <div style="font-size:11px; font-weight:600; letter-spacing:.12em; text-transform:uppercase; color:var(--ink-soft); margin:0 4px 8px;">Appearance</div>
    <div style="background:var(--sunken); border-radius:14px; padding:4px; display:flex; gap:4px; margin-bottom:22px;">
      ${themeSeg('system', 'System')}${themeSeg('light', 'Light')}${themeSeg('dark', 'Dark')}
    </div>

    <div style="font-size:11px; font-weight:600; letter-spacing:.12em; text-transform:uppercase; color:var(--ink-soft); margin:0 4px 8px;">Account</div>
    <div style="background:var(--surface); border:1px solid var(--hairline); border-radius:20px; overflow:hidden; box-shadow:var(--shadow-sm);">
      <button data-act="signOut" style="width:100%; display:flex; align-items:center; gap:12px; padding:15px 16px; border:none; background:transparent; font-family:inherit; cursor:pointer;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--error)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>
        <span style="font-size:15px; font-weight:600; color:var(--error);">Sign out</span>
      </button>
    </div>
    <div style="text-align:center; margin-top:24px; font-size:12px; color:var(--ink-soft);">Ember · v1.0</div>
  </div>`;
}

// ---------------------------------------------------------------------------
// FRIENDS (M2) — friend list, shared streaks, invite + nudge
// ---------------------------------------------------------------------------
// coarse today-status → { dot color, label } (FRND-4; goal titles stay private)
const FRIEND_STATUS = {
  perfect:    { c: 'var(--sage)',     l: 'Perfect today' },
  inprogress: { c: 'var(--ember)',    l: 'In progress' },
  notstarted: { c: 'var(--ink-soft)', l: 'Not started yet' },
};

// small ember flame for the shared-streak pill
const pillFlame = `<svg width="12" height="12" viewBox="0 0 64 76" style="margin-top:-1px;"><path d="M32 4 C 43 20, 56 26, 50 44 C 46 57, 38 66, 32 66 C 26 66, 15 59, 12 45 C 8 27, 22 22, 26 10 C 27 18, 30 22, 34 25 C 30 18, 31 10, 32 4 Z" fill="var(--ember)"/></svg>`;

const nudgeIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M11 8.5V5a1.5 1.5 0 0 1 3 0v4"/><path d="M14 9V4a1.5 1.5 0 0 1 3 0v6"/><path d="M17 9.5V6a1.5 1.5 0 0 1 3 0v7a7 7 0 0 1-7 7h-1.5a5 5 0 0 1-4.2-2.3L4 13.5a1.6 1.6 0 0 1 2.7-1.7L8 13.5V7a1.5 1.5 0 0 1 3 0v2.5"/></svg>`;

function friendRow(f) {
  const st = FRIEND_STATUS[f.status] || FRIEND_STATUS.notstarted;
  const avatar = `width:48px;height:48px;border-radius:999px;background:color-mix(in srgb, ${esc(f.color)} 34%, var(--surface));display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0;`;
  const sharedLabel = f.shared > 0 ? `${f.shared} 🔥` : 'New';
  return `<button data-act="openFriend" data-id="${esc(f.id)}" style="width:100%; display:flex; align-items:center; gap:12px; padding:12px 14px; border:1px solid var(--hairline); border-radius:20px; background:var(--surface); box-shadow:var(--shadow-sm); font-family:inherit; text-align:left; cursor:pointer;">
      <span style="position:relative;">
        <span style="${avatar}">${esc(f.emoji)}</span>
        <span style="position:absolute; bottom:-1px; right:-1px; width:15px; height:15px; border-radius:999px; background:${st.c}; border:2.5px solid var(--surface);"></span>
      </span>
      <span style="flex:1; min-width:0;">
        <span style="display:block; font-size:16px; font-weight:600; color:var(--ink);">${esc(f.name)}</span>
        <span style="display:block; font-size:13px; color:var(--ink-soft); margin-top:1px;">${st.l} · ${f.personal}🔥</span>
      </span>
      <span style="display:flex; flex-direction:column; align-items:flex-end; gap:6px;">
        <span style="display:inline-flex; align-items:center; gap:4px; padding:4px 9px; border-radius:999px; background:color-mix(in srgb, var(--ember) 14%, transparent); font-size:12px; font-weight:600; color:var(--ember);">${pillFlame}${sharedLabel}</span>
      </span>
      <span data-act="nudgeFriend" data-id="${esc(f.id)}" role="button" aria-label="Nudge ${esc(f.name)}" style="width:38px; height:38px; border-radius:999px; background:var(--sunken); display:flex; align-items:center; justify-content:center; color:var(--ink); flex-shrink:0;">${nudgeIcon}</span>
    </button>`;
}

function renderFriends(s) {
  const inviteBtn = `<button data-act="openInvite" style="width:40px; height:40px; border:none; border-radius:999px; background:var(--surface); box-shadow:var(--shadow-sm); display:flex; align-items:center; justify-content:center; color:var(--ink); cursor:pointer;">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>
    </button>`;
  const header = `<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:18px;">
      <h1 style="margin:0; font-family:'Fraunces',Georgia,serif; font-weight:500; font-size:24px; line-height:30px; color:var(--ink);">Friends</h1>
      ${inviteBtn}
    </div>`;

  const topBanners = [
    (!s.online ? offlineBanner : ''),
    (s.friendsError ? errorBanner(s.friendsError, 'retryFriends') : ''),
  ].join('');

  let body;
  if (s.friendsBusy && !s.friendsLoaded) {
    body = `<div style="display:flex; flex-direction:column; gap:12px;">${shimmerRow}${shimmerRow}${shimmerRow}</div>`;
  } else if (s.friends.length) {
    body = `<div style="display:flex; flex-direction:column; gap:12px;">${s.friends.map(friendRow).join('')}</div>
      <button data-act="openInvite" style="margin-top:16px; width:100%; display:flex; align-items:center; justify-content:center; gap:8px; padding:14px; border:none; border-radius:999px; background:var(--sunken); color:var(--ink); font-family:inherit; font-size:15px; font-weight:600; cursor:pointer;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
        Invite a friend
      </button>`;
  } else {
    body = `<div style="display:flex; flex-direction:column; align-items:center; text-align:center; padding:40px 24px;">
        <svg width="150" height="120" viewBox="0 0 150 120" fill="none" style="margin-bottom:8px;">
          <path d="M52 74 c5 -7 3 -13 -1 -18 -2 8 -8 7 -9 15 -1 7 4 12 9 12 3 0 6 -2 7 -6 -3 1 -6 0 -6 -3Z" fill="none" stroke="var(--ember)" stroke-width="2.4" stroke-linejoin="round"/>
          <path d="M98 74 c-5 -7 -3 -13 1 -18 2 8 8 7 9 15 1 7 -4 12 -9 12 -3 0 -6 -2 -7 -6 3 1 6 0 6 -3Z" fill="none" stroke="var(--sage)" stroke-width="2.4" stroke-linejoin="round"/>
          <path d="M64 60 q11 -8 22 0" stroke="var(--hairline)" stroke-width="2.2" stroke-dasharray="3 5" stroke-linecap="round" fill="none"/>
          <circle cx="75" cy="52" r="2.4" fill="var(--ember)" opacity=".7"/>
        </svg>
        <h2 style="margin:8px 0 4px; font-family:'Fraunces',Georgia,serif; font-weight:500; font-size:21px; color:var(--ink);">Better with a friend or two</h2>
        <p style="margin:0 0 18px; font-size:15px; line-height:22px; color:var(--ink-soft); max-width:250px;">Share a private link. When they join, you’ll build a shared streak together.</p>
        <button data-act="openInvite" style="border:none; border-radius:999px; padding:13px 22px; background:var(--ink); color:var(--bg); font-family:inherit; font-size:15px; font-weight:600; cursor:pointer; box-shadow:var(--shadow-sm);">Invite your first friend</button>
      </div>`;
  }

  return `<div style="${SCREEN_PAD}">${header}${topBanners}${body}</div>`;
}

// ---------------------------------------------------------------------------
// WELCOME / FIRST-RUN
// ---------------------------------------------------------------------------
function renderWelcome(s) {
  const wEmojis = ['🦔', '🦊', '🐢', '🐤', '🦉', '🐙', '🌵', '🍄', '⭐', '🌙', '🔥', '🫧'];
  const step0 = `
    <div style="flex:1; display:flex; flex-direction:column;">
      <div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center;">
        <div style="filter:drop-shadow(0 0 26px rgba(245,98,10,.32)); margin-bottom:22px;">${flame(92, 110, 'url(#flameGrad)', 1)}</div>
        <h1 style="margin:0 0 8px; font-family:'Fraunces',Georgia,serif; font-weight:600; font-size:38px; line-height:42px; color:var(--ink);">Ember</h1>
        <p style="margin:0; font-size:16px; line-height:24px; color:var(--ink-soft); max-width:260px;">Keep the flame going, together. A small daily ritual with a couple of close friends.</p>
      </div>
      <div style="display:flex; flex-direction:column; gap:12px; padding-top:20px;">
        <input data-field="email" value="${esc(s.email)}" placeholder="you@email.com" inputmode="email" type="email" autocomplete="email" style="width:100%; padding:15px 16px; border-radius:14px; border:1px solid var(--hairline); background:var(--surface); color:var(--ink); font-family:inherit; font-size:16px; outline:none;">
        <button data-act="sendLink" ${s.busy ? 'disabled' : ''} style="width:100%; padding:15px; border:none; border-radius:999px; background:var(--ink); color:var(--bg); font-family:inherit; font-size:16px; font-weight:600; cursor:pointer; box-shadow:var(--shadow-sm);">${s.busy ? 'Sending…' : 'Send me a link'}</button>
        <p style="margin:2px 0 0; text-align:center; font-size:12px; color:var(--ink-soft);">No passwords. We’ll email you a magic link and a code.</p>
        ${s.hasSupabase ? `<button data-act="haveCode" style="border:none; background:transparent; padding:4px; color:var(--ink-soft); font-family:inherit; font-size:13px; font-weight:500; cursor:pointer; text-decoration:underline; text-underline-offset:3px;">Already got a code? Enter it</button>` : ''}
        ${s.error ? errorBanner(s.error, '') : ''}
      </div>
    </div>`;

  const step1 = `
    <div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center;">
      <span style="width:76px; height:76px; border-radius:999px; background:color-mix(in srgb, var(--sage) 18%, transparent); display:flex; align-items:center; justify-content:center; margin-bottom:20px;">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--sage)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>
      </span>
      <h1 style="margin:0 0 8px; font-family:'Fraunces',Georgia,serif; font-weight:500; font-size:26px; color:var(--ink);">Check your email</h1>
      <p style="margin:0 0 10px; font-size:15px; line-height:22px; color:var(--ink-soft); max-width:250px;">We sent a sign-in link to <span style="color:var(--ink); font-weight:600;">${esc(s.email)}</span>. Tap it — or type the code from the same email below.</p>
      <p style="margin:0 0 22px; font-size:13px; color:var(--ink-soft);">Don't see it? Check your spam folder.<br>Asked more than once? Only the newest email works.</p>
      ${s.hasSupabase ? `
      <div style="width:100%; max-width:280px; display:flex; flex-direction:column; gap:10px;">
        <input data-field="otpCode" value="${esc(s.otpCode)}" placeholder="12345678" inputmode="numeric" autocomplete="one-time-code" maxlength="10" style="width:100%; padding:14px 16px; border-radius:14px; border:1px solid var(--hairline); background:var(--surface); color:var(--ink); font-family:inherit; font-size:20px; letter-spacing:6px; text-align:center; outline:none; font-variant-numeric:tabular-nums;">
        <button data-act="verifyCode" ${s.busy ? 'disabled' : ''} style="width:100%; padding:14px; border:none; border-radius:999px; background:var(--ink); color:var(--bg); font-family:inherit; font-size:15px; font-weight:600; cursor:pointer; box-shadow:var(--shadow-sm);">${s.busy ? 'Checking…' : 'Sign in with code'}</button>
        <button data-act="backToEmail" style="padding:8px; border:none; background:transparent; color:var(--ink-soft); font-family:inherit; font-size:13px; font-weight:500; cursor:pointer;">Use a different email</button>
        ${s.error ? errorBanner(s.error, '') : ''}
      </div>` : `<button data-act="welcomeContinueDemo" style="padding:13px 22px; border:none; border-radius:999px; background:var(--sunken); color:var(--ink); font-family:inherit; font-size:15px; font-weight:600; cursor:pointer;">Continue (demo)</button>`}
    </div>`;

  const emojiCell = (em) => {
    const active = s.draftEmoji === em;
    return `<button data-act="pickWelcomeEmoji" data-emoji="${esc(em)}" style="width:100%;aspect-ratio:1;border:2px solid ${active ? 'var(--ember)' : 'transparent'};border-radius:14px;background:var(--sunken);display:flex;align-items:center;justify-content:center;font-size:22px;cursor:pointer;">${em}</button>`;
  };
  const step2 = `
    <div style="flex:1; display:flex; flex-direction:column;">
      <div style="text-align:center; margin-bottom:22px;">
        <h1 style="margin:0 0 6px; font-family:'Fraunces',Georgia,serif; font-weight:500; font-size:26px; color:var(--ink);">Say hello</h1>
        <p style="margin:0; font-size:15px; color:var(--ink-soft);">Pick a name and a face your friends will see.</p>
      </div>
      <div style="display:flex; justify-content:center; margin-bottom:18px;">
        <span style="width:88px; height:88px; border-radius:999px; background:color-mix(in srgb, var(--info) 24%, var(--surface)); display:flex; align-items:center; justify-content:center; font-size:44px;">${esc(s.draftEmoji)}</span>
      </div>
      <input data-field="draftName" value="${esc(s.draftName)}" placeholder="Your name" maxlength="24" style="width:100%; padding:14px 16px; border-radius:14px; border:1px solid var(--hairline); background:var(--surface); color:var(--ink); font-family:inherit; font-size:16px; outline:none; text-align:center; margin-bottom:18px;">
      <div style="display:grid; grid-template-columns:repeat(6,1fr); gap:8px; margin-bottom:auto;">${wEmojis.map(emojiCell).join('')}</div>
      <button data-act="saveProfile" ${s.busy ? 'disabled' : ''} style="margin-top:20px; width:100%; padding:15px; border:none; border-radius:999px; background:var(--ink); color:var(--bg); font-family:inherit; font-size:16px; font-weight:600; cursor:pointer; box-shadow:var(--shadow-sm);">${s.busy ? 'Saving…' : 'Continue'}</button>
    </div>`;

  const step3 = `
    <div style="flex:1; display:flex; flex-direction:column;">
      <div style="text-align:center; margin-bottom:22px;">
        <h1 style="margin:0 0 6px; font-family:'Fraunces',Georgia,serif; font-weight:500; font-size:26px; color:var(--ink);">Add Ember to your Home Screen</h1>
        <p style="margin:0; font-size:15px; line-height:22px; color:var(--ink-soft);">So it opens like an app — and can nudge you when it’s time.</p>
      </div>
      <div style="background:var(--surface); border:1px solid var(--hairline); border-radius:20px; padding:6px 4px; box-shadow:var(--shadow-sm); margin-bottom:20px;">
        <div style="display:flex; align-items:center; gap:12px; padding:12px 14px; border-bottom:1px solid var(--hairline);">
          <span style="width:30px; height:30px; border-radius:999px; background:var(--sunken); display:flex; align-items:center; justify-content:center; color:var(--ember); font-weight:600;">1</span>
          <span style="flex:1; font-size:14px; color:var(--ink);">Tap <span style="font-weight:600;">Share</span> in Safari</span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--info)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>
        </div>
        <div style="display:flex; align-items:center; gap:12px; padding:12px 14px;">
          <span style="width:30px; height:30px; border-radius:999px; background:var(--sunken); display:flex; align-items:center; justify-content:center; color:var(--ember); font-weight:600;">2</span>
          <span style="flex:1; font-size:14px; color:var(--ink);">Choose <span style="font-weight:600;">Add to Home Screen</span></span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--info)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/></svg>
        </div>
      </div>
      <button data-act="enableRemindersWelcome" style="width:100%; padding:15px; border:none; border-radius:999px; background:linear-gradient(180deg, var(--ember), var(--ember-deep)); color:#fff; font-family:inherit; font-size:16px; font-weight:600; cursor:pointer; box-shadow:0 0 24px rgba(245,98,10,.3); margin-bottom:10px;">Turn on reminders</button>
      <button data-act="finishWelcome" style="width:100%; padding:12px; border:none; background:transparent; color:var(--ink-soft); font-family:inherit; font-size:15px; font-weight:500; cursor:pointer;">Maybe later</button>
    </div>`;

  const step = [step0, step1, step2, step3][s.welcomeStep] || step0;
  return `<div style="padding: calc(env(safe-area-inset-top) + 40px) 28px calc(env(safe-area-inset-bottom) + 28px); min-height:100%; display:flex; flex-direction:column;">${step}</div>`;
}

// ---------------------------------------------------------------------------
// TAB BAR
// ---------------------------------------------------------------------------
function renderTabBar(s) {
  const tab = (screen, act, label, icon) => {
    const active = s.screen === screen;
    const style = `position:relative; flex:1; display:flex; flex-direction:column; align-items:center; gap:3px; padding:8px 4px; border:none; background:transparent; border-radius:16px; cursor:pointer; font-family:inherit; color:${active ? 'var(--ink)' : 'var(--ink-soft)'};`;
    const dot = active ? `<span style="width:5px; height:5px; border-radius:999px; background:var(--ember); position:absolute; top:6px; right:calc(50% - 20px);"></span>` : '';
    return `<button data-act="${act}" style="${style}">${icon}<span style="font-size:11px; font-weight:600;">${label}</span>${dot}</button>`;
  };
  const today = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5"/><path d="M9.5 21v-6h5v6"/></svg>`;
  const friends = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M16 5.2a3.2 3.2 0 0 1 0 6"/><path d="M17.5 14.4A5.5 5.5 0 0 1 20.5 20"/></svg>`;
  const settings = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 13.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.1-2.8l-.1-.1A2 2 0 1 1 5 2.4l.1.1a1.6 1.6 0 0 0 1.8.3H7a1.6 1.6 0 0 0 1-1.5V1a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V7a1.6 1.6 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1Z"/></svg>`;
  return `<div style="position:absolute; left:0; right:0; bottom:0; z-index:15; padding:8px 24px calc(18px + env(safe-area-inset-bottom)); background:linear-gradient(0deg, var(--bg) 62%, transparent); backdrop-filter:blur(6px);">
    <div style="display:flex; align-items:stretch; justify-content:space-around; background:var(--surface); border:1px solid var(--hairline); border-radius:22px; padding:8px 6px; box-shadow:var(--shadow-md);">
      ${tab('today', 'openToday', 'Today', today)}
      ${tab('friends', 'openFriends', 'Friends', friends)}
      ${tab('settings', 'openSettings', 'Settings', settings)}
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// SHEETS (manage goals, confirm delete)
// ---------------------------------------------------------------------------
function renderSheets(s) {
  if (!s.sheet) return '';
  let inner = '';
  if (s.sheet === 'manage') {
    const goalPalette = ['✨', '🏃', '📖', '🧘', '💧', '🍎', '😴', '✍️', '🌱', '☎️', '🎸', '🧹'];
    const grip = `<span data-grip style="color:var(--ink-soft); cursor:grab; display:flex; flex-shrink:0;"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg></span>`;
    const editRow = (g) => `<div class="manage-row" draggable="true" data-id="${esc(g.id)}" style="display:flex; align-items:center; gap:10px; padding:8px 10px; border-radius:16px; background:var(--sunken);">
      ${grip}
      <span style="width:38px; height:38px; border-radius:12px; background:var(--surface); display:flex; align-items:center; justify-content:center; font-size:19px; flex-shrink:0;">${esc(g.emoji || '✨')}</span>
      <input data-field="rename" data-id="${esc(g.id)}" value="${esc(g.title)}" maxlength="60" style="flex:1; min-width:0; border:none; background:transparent; color:var(--ink); font-family:inherit; font-size:15px; font-weight:600; outline:none;">
      <button data-act="askDelete" data-id="${esc(g.id)}" aria-label="Delete goal" style="width:34px; height:34px; border:none; border-radius:999px; background:transparent; color:var(--ink-soft); cursor:pointer; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
      </button>
    </div>`;
    const emojiPick = (em) => `<button data-act="pickNewEmoji" data-emoji="${esc(em)}" style="width:38px;height:38px;flex-shrink:0;border:2px solid ${s.newEmoji === em ? 'var(--ember)' : 'transparent'};border-radius:12px;background:var(--sunken);display:flex;align-items:center;justify-content:center;font-size:19px;cursor:pointer;">${em}</button>`;
    inner = `<div style="position:absolute; left:0; right:0; bottom:0; max-height:86%; background:var(--surface); border-radius:24px 24px 0 0; box-shadow:0 -8px 30px rgba(0,0,0,.3); display:flex; flex-direction:column; animation:sheetUp .3s cubic-bezier(.32,.72,0,1);">
      <div style="display:flex; justify-content:center; padding:10px 0 4px;"><span style="width:36px; height:4px; border-radius:999px; background:var(--hairline);"></span></div>
      <div style="display:flex; align-items:center; justify-content:space-between; padding:6px 18px 12px;">
        <h2 style="margin:0; font-family:'Fraunces',Georgia,serif; font-weight:500; font-size:20px; color:var(--ink);">Manage goals</h2>
        <button data-act="closeSheet" style="width:32px; height:32px; border:none; border-radius:999px; background:var(--sunken); color:var(--ink); cursor:pointer; display:flex; align-items:center; justify-content:center;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div id="manage-list" class="app-scroll" style="overflow-y:auto; padding:0 18px 8px; display:flex; flex-direction:column; gap:10px;">${s.goals.map(editRow).join('') || `<p style="text-align:center; color:var(--ink-soft); font-size:14px; padding:8px 0;">No goals yet — add your first below.</p>`}</div>
      <div style="padding:12px 18px calc(18px + env(safe-area-inset-bottom)); border-top:1px solid var(--hairline);">
        <div class="app-scroll" style="display:flex; gap:8px; overflow-x:auto; padding-bottom:10px;">${goalPalette.map(emojiPick).join('')}</div>
        <div style="display:flex; gap:8px;">
          <input data-field="newGoal" value="${esc(s.newGoal)}" placeholder="New goal, e.g. Stretch" maxlength="60" style="flex:1; padding:12px 14px; border-radius:14px; border:1px solid var(--hairline); background:var(--bg); color:var(--ink); font-family:inherit; font-size:15px; outline:none;">
          <button data-act="addGoal" style="padding:0 18px; border:none; border-radius:14px; background:var(--ink); color:var(--bg); font-family:inherit; font-size:15px; font-weight:600; cursor:pointer;">Add</button>
        </div>
      </div>
    </div>`;
  } else if (s.sheet === 'confirmDelete') {
    const target = s.goals.find((g) => g.id === s.deleteTargetId);
    inner = `<div style="position:absolute; left:0; right:0; bottom:0; background:var(--surface); border-radius:24px 24px 0 0; box-shadow:0 -8px 30px rgba(0,0,0,.3); padding:22px 24px calc(24px + env(safe-area-inset-bottom)); text-align:center; animation:sheetUp .28s cubic-bezier(.32,.72,0,1);">
      <span style="width:56px; height:56px; border-radius:999px; background:color-mix(in srgb, var(--error) 16%, transparent); display:inline-flex; align-items:center; justify-content:center; margin-bottom:12px;">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--error)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
      </span>
      <h2 style="margin:0 0 6px; font-family:'Fraunces',Georgia,serif; font-weight:500; font-size:20px; color:var(--ink);">Delete "${esc(target?.title || 'this goal')}"?</h2>
      <p style="margin:0 0 20px; font-size:15px; color:var(--ink-soft);">It’ll be gone from your daily list.</p>
      <div style="display:flex; gap:10px;">
        <button data-act="cancelDelete" style="flex:1; padding:14px; border:1px solid var(--hairline); border-radius:999px; background:transparent; color:var(--ink); font-family:inherit; font-size:15px; font-weight:600; cursor:pointer;">Keep it</button>
        <button data-act="confirmDelete" style="flex:1; padding:14px; border:none; border-radius:999px; background:var(--error); color:#fff; font-family:inherit; font-size:15px; font-weight:600; cursor:pointer;">Delete</button>
      </div>
    </div>`;
  } else if (s.sheet === 'invite') {
    inner = renderInviteSheet(s);
  } else if (s.sheet === 'friend') {
    inner = renderFriendSheet(s);
  } else if (s.sheet === 'acceptInvite') {
    inner = renderAcceptInviteSheet(s);
  } else if (s.sheet === 'confirmRemoveFriend') {
    inner = renderRemoveFriendSheet(s);
  } else if (s.sheet === 'reminderTime') {
    inner = renderReminderTimeSheet(s);
  } else if (s.sheet === 'editProfile') {
    inner = renderEditProfileSheet(s);
  }
  // the accept-invite scrim declines rather than silently dismissing the pending code
  const scrimAct = s.sheet === 'acceptInvite' ? 'declineInvite' : 'closeSheet';
  return `<div style="position:absolute; inset:0; z-index:30;">
    <div data-act="${scrimAct}" style="position:absolute; inset:0; background:rgba(0,0,0,.42); animation:scrimIn .2s ease-out;"></div>
    ${inner}
  </div>`;
}

// ---- INVITE (FRND-1): your permanent friend code + add-by-code ---------------
function renderInviteSheet(s) {
  const copyIcon = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>`;
  const shareIcon = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>`;
  const codeText = s.myFriendCode
    ? esc(s.myFriendCode)
    : (s.inviteBusy ? '· · · · · ·' : '——————');
  return `<div style="position:absolute; left:0; right:0; bottom:0; background:var(--surface); border-radius:24px 24px 0 0; box-shadow:0 -8px 30px rgba(0,0,0,.3); padding-bottom:calc(24px + env(safe-area-inset-bottom)); animation:sheetUp .3s cubic-bezier(.32,.72,0,1);">
      <div style="display:flex; justify-content:center; padding:10px 0 4px;"><span style="width:36px; height:4px; border-radius:999px; background:var(--hairline);"></span></div>
      <div style="padding:8px 24px 0; text-align:center;">
        <div style="filter:drop-shadow(0 0 20px rgba(245,98,10,.28)); display:flex; justify-content:center; margin-bottom:8px;">${flame(48, 58)}</div>
        <h2 style="margin:0 0 6px; font-family:'Fraunces',Georgia,serif; font-weight:500; font-size:22px; color:var(--ink);">Add friends</h2>
        <p style="margin:0 0 14px; font-size:14px; line-height:21px; color:var(--ink-soft);">This is your code — it never changes, and any number of friends can use it.</p>
        <button data-act="copyCode" style="width:100%; border:1px dashed var(--hairline); border-radius:16px; background:var(--bg); padding:14px; margin-bottom:10px; cursor:pointer; font-family:'Fraunces',Georgia,serif;">
          <span style="display:block; font-size:32px; letter-spacing:10px; font-weight:600; color:var(--ink); font-variant-numeric:tabular-nums; text-indent:10px;">${codeText}</span>
          <span style="display:flex; align-items:center; justify-content:center; gap:6px; margin-top:4px; font-family:'Inter',system-ui,sans-serif; font-size:12px; font-weight:600; color:var(--ink-soft);">${copyIcon}Tap to copy</span>
        </button>
        <button data-act="shareInvite" style="width:100%; padding:13px; border:none; border-radius:999px; background:var(--sunken); color:var(--ink); font-family:inherit; font-size:15px; font-weight:600; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px;">${shareIcon}Share as a link</button>
        <div style="display:flex; align-items:center; gap:12px; margin:16px 0 12px;">
          <span style="flex:1; height:1px; background:var(--hairline);"></span>
          <span style="font-size:12px; font-weight:600; color:var(--ink-soft); text-transform:uppercase; letter-spacing:.06em;">Got a friend's code?</span>
          <span style="flex:1; height:1px; background:var(--hairline);"></span>
        </div>
        <div style="display:flex; gap:8px;">
          <input data-field="friendCode" value="${esc(s.friendCodeInput)}" placeholder="ABC123" maxlength="8" autocapitalize="characters" autocomplete="off" spellcheck="false" style="flex:1; min-width:0; padding:12px 14px; border-radius:14px; border:1px solid var(--hairline); background:var(--bg); color:var(--ink); font-family:inherit; font-size:17px; font-weight:600; letter-spacing:4px; text-transform:uppercase; text-align:center; outline:none;">
          <button data-act="addFriendByCode" ${s.busy ? 'disabled' : ''} style="padding:12px 20px; border:none; border-radius:14px; background:var(--ink); color:var(--bg); font-family:inherit; font-size:15px; font-weight:600; cursor:pointer;">${s.busy ? '…' : 'Add'}</button>
        </div>
        ${s.inviteError ? `<p style="margin:10px 0 0; font-size:13px; color:var(--error);">${esc(s.inviteError)}</p>` : ''}
      </div>
    </div>`;
}

// ---- FRIEND DETAIL (FRND-3, FRND-6, FRND-7): the pairwise shared streak ------
function renderFriendSheet(s) {
  const af = s.friends.find((f) => f.id === s.activeFriendId) || s.friends[0];
  if (!af) return '';
  const fst = FRIEND_STATUS[af.status] || FRIEND_STATUS.notstarted;

  // my own coarse today status for the "You" card
  const myDone = s.completed.size, myTotal = s.goals.length;
  const you = myTotal > 0 && myDone === myTotal ? FRIEND_STATUS.perfect
            : myDone > 0 ? FRIEND_STATUS.inprogress : FRIEND_STATUS.notstarted;

  const atRisk = af.sharedState === 'atrisk';
  const flameFill = atRisk ? 'var(--warning)' : 'url(#flameGrad)';
  const flameStyle = atRisk ? 'animation:warnPulse 2.2s ease-in-out infinite;' : 'filter:drop-shadow(0 0 22px rgba(245,98,10,.4));';
  const sharedLine = atRisk ? 'Don’t break it — you’re both close'
                    : af.shared > 0 ? 'day shared streak' : 'Start a streak together';
  const sharedLineColor = atRisk ? 'var(--warning)' : 'var(--ink-soft)';

  const meEmoji = esc(s.profile?.avatar_emoji || '🦔');
  const meAvatar = `width:56px; height:56px; border-radius:999px; background:color-mix(in srgb, var(--info) 24%, var(--surface)); display:flex; align-items:center; justify-content:center; font-size:28px;`;
  const afAvatar = `width:76px;height:76px;border-radius:999px;background:color-mix(in srgb, ${esc(af.color)} 40%, var(--surface));display:flex;align-items:center;justify-content:center;font-size:38px;flex-shrink:0;`;

  return `<div style="position:absolute; left:0; right:0; bottom:0; background:var(--surface); border-radius:24px 24px 0 0; box-shadow:0 -8px 30px rgba(0,0,0,.3); padding-bottom:calc(24px + env(safe-area-inset-bottom)); animation:sheetUp .3s cubic-bezier(.32,.72,0,1);">
      <div style="display:flex; align-items:center; justify-content:space-between; padding:14px 18px 0;">
        <span style="width:32px;"></span>
        <span style="width:36px; height:4px; border-radius:999px; background:var(--hairline);"></span>
        <button data-act="askRemoveFriend" data-id="${esc(af.id)}" aria-label="Friend options" style="width:32px; height:32px; border:none; border-radius:999px; background:var(--sunken); color:var(--ink-soft); cursor:pointer; display:flex; align-items:center; justify-content:center;"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg></button>
      </div>
      <div style="padding:8px 24px 0; text-align:center;">
        <div style="display:flex; align-items:center; justify-content:center; gap:8px; margin-bottom:6px;">
          <span style="${meAvatar}">${meEmoji}</span>
          <div style="${flameStyle}"><svg width="72" height="86" viewBox="0 0 64 76"><path d="M32 4 C 43 20, 56 26, 50 44 C 46 57, 38 66, 32 66 C 26 66, 15 59, 12 45 C 8 27, 22 22, 26 10 C 27 18, 30 22, 34 25 C 30 18, 31 10, 32 4 Z" fill="${flameFill}"/></svg></div>
          <span style="${afAvatar}">${esc(af.emoji)}</span>
        </div>
        <div style="font-family:'Fraunces',Georgia,serif; font-weight:600; font-size:44px; line-height:46px; color:var(--ink); font-variant-numeric:tabular-nums;">${af.shared}</div>
        <div style="font-size:14px; font-weight:500; color:${sharedLineColor}; margin-top:2px;">${sharedLine}</div>

        <div style="display:flex; gap:10px; margin:20px 0 16px;">
          <div style="flex:1; background:var(--sunken); border-radius:16px; padding:12px;">
            <div style="font-size:13px; color:var(--ink-soft);">You</div>
            <div style="font-size:14px; font-weight:600; color:${you.c}; margin-top:2px;">${you.l}</div>
          </div>
          <div style="flex:1; background:var(--sunken); border-radius:16px; padding:12px;">
            <div style="font-size:13px; color:var(--ink-soft);">${esc(af.name)}</div>
            <div style="font-size:14px; font-weight:600; color:${fst.c}; margin-top:2px;">${fst.l}</div>
          </div>
        </div>

        <button data-act="nudgeFriend" data-id="${esc(af.id)}" style="width:100%; padding:15px; border:none; border-radius:999px; background:linear-gradient(180deg, var(--ember), var(--ember-deep)); color:#fff; font-family:inherit; font-size:16px; font-weight:600; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:0 0 22px rgba(245,98,10,.28);">${nudgeIcon}Nudge ${esc(af.name)}</button>
      </div>
    </div>`;
}

// ---- ACCEPT INVITE (FRND-2): possession == consent, confirm to join ---------
function renderAcceptInviteSheet(s) {
  return `<div style="position:absolute; left:0; right:0; bottom:0; background:var(--surface); border-radius:24px 24px 0 0; box-shadow:0 -8px 30px rgba(0,0,0,.3); padding:10px 24px calc(24px + env(safe-area-inset-bottom)); text-align:center; animation:sheetUp .3s cubic-bezier(.32,.72,0,1);">
      <div style="display:flex; justify-content:center; padding:0 0 6px;"><span style="width:36px; height:4px; border-radius:999px; background:var(--hairline);"></span></div>
      <div style="filter:drop-shadow(0 0 20px rgba(245,98,10,.28)); display:flex; justify-content:center; margin:6px 0 8px;">${flame(60, 72)}</div>
      <h2 style="margin:0 0 6px; font-family:'Fraunces',Georgia,serif; font-weight:500; font-size:22px; color:var(--ink);">Join forces?</h2>
      <p style="margin:0 0 20px; font-size:15px; line-height:22px; color:var(--ink-soft); max-width:280px; margin-inline:auto;">Accept this invite to become friends and start a shared streak — it grows on the days you’re <em>both</em> perfect.</p>
      <div style="display:flex; gap:10px;">
        <button data-act="declineInvite" style="flex:1; padding:14px; border:1px solid var(--hairline); border-radius:999px; background:transparent; color:var(--ink); font-family:inherit; font-size:15px; font-weight:600; cursor:pointer;">Not now</button>
        <button data-act="acceptInvite" ${s.busy ? 'disabled' : ''} style="flex:1; padding:14px; border:none; border-radius:999px; background:var(--ink); color:var(--bg); font-family:inherit; font-size:15px; font-weight:600; cursor:pointer;">${s.busy ? 'Joining…' : 'Accept'}</button>
      </div>
    </div>`;
}

// ---- EDIT PROFILE (AUTH-2 revisited): name + emoji picker in a sheet --------
function renderEditProfileSheet(s) {
  const wEmojis = ['🦔', '🦊', '🐢', '🐤', '🦉', '🐙', '🌵', '🍄', '⭐', '🌙', '🔥', '🫧'];
  const emojiCell = (em) => {
    const active = s.draftEmoji === em;
    return `<button data-act="pickWelcomeEmoji" data-emoji="${esc(em)}" style="width:100%;aspect-ratio:1;border:2px solid ${active ? 'var(--ember)' : 'transparent'};border-radius:14px;background:var(--sunken);display:flex;align-items:center;justify-content:center;font-size:22px;cursor:pointer;">${em}</button>`;
  };
  return `<div style="position:absolute; left:0; right:0; bottom:0; max-height:90%; background:var(--surface); border-radius:24px 24px 0 0; box-shadow:0 -8px 30px rgba(0,0,0,.3); display:flex; flex-direction:column; animation:sheetUp .3s cubic-bezier(.32,.72,0,1);">
      <div style="display:flex; justify-content:center; padding:10px 0 4px;"><span style="width:36px; height:4px; border-radius:999px; background:var(--hairline);"></span></div>
      <div style="display:flex; align-items:center; justify-content:space-between; padding:6px 18px 12px;">
        <h2 style="margin:0; font-family:'Fraunces',Georgia,serif; font-weight:500; font-size:20px; color:var(--ink);">Edit profile</h2>
        <button data-act="closeSheet" style="width:32px; height:32px; border:none; border-radius:999px; background:var(--sunken); color:var(--ink); cursor:pointer; display:flex; align-items:center; justify-content:center;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
      </div>
      <div class="app-scroll" style="overflow-y:auto; padding:0 18px 0; display:flex; flex-direction:column; align-items:center;">
        <span style="width:88px; height:88px; border-radius:999px; background:color-mix(in srgb, var(--info) 24%, var(--surface)); display:flex; align-items:center; justify-content:center; font-size:44px; margin-bottom:18px;">${esc(s.draftEmoji)}</span>
        <input data-field="draftName" value="${esc(s.draftName)}" placeholder="Your name" maxlength="24" style="width:100%; padding:14px 16px; border-radius:14px; border:1px solid var(--hairline); background:var(--bg); color:var(--ink); font-family:inherit; font-size:16px; outline:none; text-align:center; margin-bottom:18px;">
        <div style="display:grid; grid-template-columns:repeat(6,1fr); gap:8px; width:100%; margin-bottom:18px;">${wEmojis.map(emojiCell).join('')}</div>
        ${s.error ? `<p style="margin:0 0 12px; font-size:13px; color:var(--error); text-align:center;">${esc(s.error)}</p>` : ''}
      </div>
      <div style="padding:12px 18px calc(18px + env(safe-area-inset-bottom)); border-top:1px solid var(--hairline);">
        <button data-act="saveEditProfile" ${s.busy ? 'disabled' : ''} style="width:100%; padding:14px; border:none; border-radius:999px; background:var(--ink); color:var(--bg); font-family:inherit; font-size:15px; font-weight:600; cursor:pointer;">${s.busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>`;
}

// ---- REMINDER TIME (NOTIF-6): pick the daily-reminder hour ------------------
function renderReminderTimeSheet(s) {
  const times = ['18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00', '21:30'];
  const row = (t) => {
    const active = s.reminderTime === t;
    return `<button data-act="pickReminderTime" data-time="${t}" style="width:100%; display:flex; align-items:center; justify-content:space-between; padding:14px 16px; border:none; border-radius:14px; background:${active ? 'color-mix(in srgb, var(--ember) 12%, var(--sunken))' : 'var(--sunken)'}; color:var(--ink); font-family:inherit; font-size:15px; font-weight:${active ? '600' : '500'}; cursor:pointer;">
        <span>${fmtTime(t)}</span>
        ${active ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ember)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>` : ''}
      </button>`;
  };
  return `<div style="position:absolute; left:0; right:0; bottom:0; max-height:80%; background:var(--surface); border-radius:24px 24px 0 0; box-shadow:0 -8px 30px rgba(0,0,0,.3); display:flex; flex-direction:column; animation:sheetUp .3s cubic-bezier(.32,.72,0,1);">
      <div style="display:flex; justify-content:center; padding:10px 0 4px;"><span style="width:36px; height:4px; border-radius:999px; background:var(--hairline);"></span></div>
      <div style="display:flex; align-items:center; justify-content:space-between; padding:6px 18px 12px;">
        <h2 style="margin:0; font-family:'Fraunces',Georgia,serif; font-weight:500; font-size:20px; color:var(--ink);">Daily reminder</h2>
        <button data-act="closeSheet" style="width:32px; height:32px; border:none; border-radius:999px; background:var(--sunken); color:var(--ink); cursor:pointer; display:flex; align-items:center; justify-content:center;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
      </div>
      <div class="app-scroll" style="overflow-y:auto; padding:0 18px calc(18px + env(safe-area-inset-bottom)); display:flex; flex-direction:column; gap:8px;">${times.map(row).join('')}</div>
    </div>`;
}

// ---- REMOVE FRIEND (FRND-5) -------------------------------------------------
function renderRemoveFriendSheet(s) {
  const f = s.friends.find((x) => x.id === s.removeTargetId);
  return `<div style="position:absolute; left:0; right:0; bottom:0; background:var(--surface); border-radius:24px 24px 0 0; box-shadow:0 -8px 30px rgba(0,0,0,.3); padding:22px 24px calc(24px + env(safe-area-inset-bottom)); text-align:center; animation:sheetUp .28s cubic-bezier(.32,.72,0,1);">
      <span style="width:56px; height:56px; border-radius:999px; background:color-mix(in srgb, var(--error) 16%, transparent); display:inline-flex; align-items:center; justify-content:center; margin-bottom:12px;">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--error)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m17 8 5 5M22 8l-5 5"/></svg>
      </span>
      <h2 style="margin:0 0 6px; font-family:'Fraunces',Georgia,serif; font-weight:500; font-size:20px; color:var(--ink);">Remove ${esc(f?.name || 'this friend')}?</h2>
      <p style="margin:0 0 20px; font-size:15px; color:var(--ink-soft);">Your shared streak will be lost for both of you.</p>
      <div style="display:flex; gap:10px;">
        <button data-act="cancelRemoveFriend" style="flex:1; padding:14px; border:1px solid var(--hairline); border-radius:999px; background:transparent; color:var(--ink); font-family:inherit; font-size:15px; font-weight:600; cursor:pointer;">Keep</button>
        <button data-act="confirmRemoveFriend" style="flex:1; padding:14px; border:none; border-radius:999px; background:var(--error); color:#fff; font-family:inherit; font-size:15px; font-weight:600; cursor:pointer;">Remove</button>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// CELEBRATION + TOAST
// ---------------------------------------------------------------------------
function renderCelebration(s) {
  if (!s.celebrating) return '';
  const sparks = Array.from({ length: 11 }, (_, i) => {
    const ang = (i / 11) * Math.PI * 2 + 0.3;
    const dist = 66 + (i % 3) * 16;
    return `<span style="position:absolute; left:50%; top:42%; width:${6 + (i % 3)}px; height:${6 + (i % 3)}px; border-radius:999px; background:${i % 4 === 0 ? 'var(--warning)' : 'var(--ember)'}; --tx:${(Math.cos(ang) * dist).toFixed(1)}px; --ty:${(Math.sin(ang) * dist).toFixed(1)}px; animation:sparkFly ${600 + (i % 4) * 70}ms ease-out forwards; pointer-events:none;"></span>`;
  }).join('');
  return `<div style="position:absolute; inset:0; z-index:40; display:flex; flex-direction:column; align-items:center; justify-content:center; background:color-mix(in srgb, var(--bg) 84%, transparent); backdrop-filter:blur(3px); animation:scrimIn .2s ease-out;">
    <div style="position:relative; display:flex; flex-direction:column; align-items:center; animation:popIn .35s cubic-bezier(.34,1.56,.64,1);">
      <div style="position:relative;">${sparks}<div style="animation:flameFlare .5s cubic-bezier(.34,1.56,.64,1); filter:drop-shadow(0 0 30px rgba(245,98,10,.55));">${flame(118, 140, 'url(#flameGrad)', 1)}</div></div>
      <div style="overflow:hidden; margin-top:4px;"><div style="font-family:'Fraunces',Georgia,serif; font-weight:600; font-size:64px; line-height:66px; color:var(--ink); font-variant-numeric:tabular-nums; animation:rollUp .4s cubic-bezier(.34,1.56,.64,1);">${s.celebrateNum}</div></div>
      <div style="margin-top:6px; font-family:'Fraunces',Georgia,serif; font-weight:500; font-size:22px; color:var(--ink); animation:fadeUp .35s ease-out .1s both;">Perfect day 🔥</div>
      <div style="margin-top:4px; font-size:14px; color:var(--ink-soft); animation:fadeUp .35s ease-out .16s both;">Your flame's a little brighter today.</div>
    </div>
  </div>`;
}

function renderToast(s) {
  if (!s.toast) return '';
  return `<div style="position:absolute; left:50%; bottom:104px; z-index:45; transform:translateX(-50%); background:var(--ink); color:var(--bg); font-size:14px; font-weight:500; padding:11px 18px; border-radius:999px; box-shadow:var(--shadow-md); white-space:nowrap; animation:toastIn 2.2s ease-out forwards;">${esc(s.toast)}</div>`;
}

// ---------------------------------------------------------------------------
export function renderApp(s) {
  if (!s.ready) {
    return `${FLAME_DEFS}<div class="boot">${flame(64, 76, 'url(#flameGrad)', 1)}<span>Lighting the ember…</span></div>`;
  }
  let screen = '';
  if (s.screen === 'welcome') screen = renderWelcome(s);
  else if (s.screen === 'today') screen = renderToday(s);
  else if (s.screen === 'friends') screen = renderFriends(s);
  else if (s.screen === 'settings') screen = renderSettings(s);

  const showTabBar = s.screen !== 'welcome';
  return `${FLAME_DEFS}
    <div class="app-scroll">${screen}</div>
    ${showTabBar ? renderTabBar(s) : ''}
    ${renderSheets(s)}
    ${renderCelebration(s)}
    ${renderToast(s)}`;
}
