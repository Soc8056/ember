// Photo verification (M5): client-side compression, and the shareable day card.
// Storage lives in the Supabase `photos` bucket (see api.js + migration 0005);
// this module is pure browser image plumbing with no data-layer knowledge.
import { CONFIG } from './config.js';

// Decode any user-supplied image. createImageBitmap is the fast path; the
// <img> fallback covers formats the platform can display but not decode via
// the bitmap API (e.g. HEIC straight off an iPhone camera roll).
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file); } catch { /* fall through */ }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable image')); };
    img.src = url;
  });
}

// Downscale to ≤ PHOTO_MAX_DIMENSION on the long edge and re-encode as JPEG —
// a camera shot lands around 100–300 KB instead of multiple MB.
export async function compressImage(file) {
  const src = await decode(file);
  const w0 = src.width || src.naturalWidth, h0 = src.height || src.naturalHeight;
  const scale = Math.min(1, CONFIG.PHOTO_MAX_DIMENSION / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(src, 0, 0, w, h);
  src.close?.();
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', CONFIG.PHOTO_JPEG_QUALITY));
  if (!blob) throw new Error('could not encode image');
  return blob;
}

// ---- share card --------------------------------------------------------------
// 1080×1350 (4:5 — survives every messaging app) PNG: photo on top when there is
// one, then flame + streak + the day's checklist. Drawn with system fonts so it
// needs no assets.
const CARD_W = 1080, CARD_H = 1350;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawFlame(ctx, cx, cy, s, color) {
  // the app's flame path (viewBox 0 0 64 76), scaled + centered
  ctx.save();
  ctx.translate(cx - 32 * s, cy - 38 * s);
  ctx.scale(s, s);
  ctx.beginPath();
  ctx.moveTo(32, 4);
  ctx.bezierCurveTo(43, 20, 56, 26, 50, 44);
  ctx.bezierCurveTo(46, 57, 38, 66, 32, 66);
  ctx.bezierCurveTo(26, 66, 15, 59, 12, 45);
  ctx.bezierCurveTo(8, 27, 22, 22, 26, 10);
  ctx.bezierCurveTo(27, 18, 30, 22, 34, 25);
  ctx.bezierCurveTo(30, 18, 31, 10, 32, 4);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

async function loadCardPhoto(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';          // signed Supabase URLs serve CORS-open
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);      // card still renders without the photo
    img.src = url;
  });
}

export async function renderShareCard({ dateLabel, streak, name, goals, completedIds, photoUrl }) {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W; canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#161210';
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  let y = 90;
  const photo = photoUrl ? await loadCardPhoto(photoUrl) : null;
  if (photo) {
    // cover-crop into a rounded frame across the top
    const fw = CARD_W - 120, fh = 620, fx = 60, fy = 60;
    const scale = Math.max(fw / photo.width, fh / photo.height);
    const dw = photo.width * scale, dh = photo.height * scale;
    ctx.save();
    roundRect(ctx, fx, fy, fw, fh, 44);
    ctx.clip();
    ctx.drawImage(photo, fx + (fw - dw) / 2, fy + (fh - dh) / 2, dw, dh);
    ctx.restore();
    y = fy + fh + 78;
  }

  // flame + streak count
  drawFlame(ctx, CARD_W / 2, y + 40, 1.6, '#F5620A');
  y += 130;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#F5EFE7';
  ctx.font = '600 120px Georgia, serif';
  ctx.fillText(String(streak), CARD_W / 2, y + 100);
  y += 132;
  ctx.fillStyle = '#B8AB9C';
  ctx.font = '500 34px -apple-system, system-ui, sans-serif';
  ctx.fillText(`day streak · ${dateLabel}`, CARD_W / 2, y + 30);
  y += 92;

  // checklist (completed goals only — that's the brag)
  ctx.textAlign = 'left';
  const done = goals.filter((g) => completedIds.has(g.id));
  for (const g of done.slice(0, 7)) {
    roundRect(ctx, 90, y, CARD_W - 180, 84, 26);
    ctx.fillStyle = '#221C18';
    ctx.fill();
    ctx.font = '40px -apple-system, system-ui, sans-serif';
    ctx.fillText(g.emoji || '✨', 120, y + 56);
    ctx.fillStyle = '#F5EFE7';
    ctx.font = '600 34px -apple-system, system-ui, sans-serif';
    ctx.fillText(g.title.length > 30 ? g.title.slice(0, 29) + '…' : g.title, 190, y + 54);
    ctx.fillStyle = '#7BA886';
    ctx.font = '600 40px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('✓', CARD_W - 124, y + 56);
    ctx.textAlign = 'left';
    y += 100;
  }

  // footer
  ctx.fillStyle = '#7A6F63';
  ctx.font = '500 28px -apple-system, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${name ? name + ' · ' : ''}Ember 🔥`, CARD_W / 2, CARD_H - 56);

  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('could not render card');
  return blob;
}

// Hand the card to the native share sheet (Web Share API Level 2); fall back to
// a plain download where files can't be shared (desktop Firefox, etc.).
export async function shareCard(blob) {
  const file = new File([blob], 'ember-day.png', { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Ember' }); return 'shared'; }
    catch { return 'cancelled'; }        // user closed the sheet — not an error
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ember-day.png';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return 'downloaded';
}
