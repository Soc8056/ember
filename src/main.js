// Bootstrap: mount the app, subscribe renders to store changes, and translate
// delegated DOM events into store actions.
import * as store from './store.js';
import { state, setState } from './store.js';
import { renderApp } from './views.js';

const root = document.getElementById('app');

function render() { root.innerHTML = renderApp(state); }
store.subscribe(render);

// keep "system" theme in sync with the OS
if (typeof matchMedia !== 'undefined') {
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (state.theme === 'system') store.applyTheme();
  });
}

// ---- click actions ---------------------------------------------------------
const clickMap = {
  openToday: () => store.go('today'),
  openFriends: () => store.go('friends'),
  openSettings: () => store.go('settings'),
  openManage: () => store.openSheet('manage'),
  closeSheet: () => store.closeSheet(),
  toggle: (el) => store.toggleGoal(el.dataset.id),
  attachPhoto: (el) => openPhotoPicker(el.dataset.id),
  shareDay: () => store.shareDay(),
  addGoal: () => store.addGoal(),
  askDelete: (el) => store.askDelete(el.dataset.id),
  cancelDelete: () => store.cancelDelete(),
  confirmDelete: () => store.confirmDelete(),
  pickNewEmoji: (el) => setState({ newEmoji: el.dataset.emoji }),
  pickWelcomeEmoji: (el) => setState({ draftEmoji: el.dataset.emoji }),
  sendLink: () => store.sendMagicLink(),
  verifyCode: () => store.verifyCode(),
  haveCode: () => store.goToCodeEntry(),
  backToEmail: () => store.backToEmail(),
  welcomeContinueDemo: () => store.welcomeContinueDemo(),
  saveProfile: () => store.saveProfile(),
  finishWelcome: () => store.finishWelcome(),
  signOut: () => store.signOut(),
  editProfile: () => store.openEditProfile(),
  saveEditProfile: () => store.saveEditProfile(),
  // friends (M2)
  retryToday: () => store.retryToday(),
  retryFriends: () => store.retryFriends(),
  openInvite: () => store.openInvite(),
  copyInvite: () => store.copyInviteLink(),
  copyCode: () => store.copyFriendCode(),
  shareInvite: () => store.shareInviteLink(),
  addFriendByCode: () => store.addFriendByCode(),
  openFriend: (el) => store.openFriend(el.dataset.id),
  nudgeFriend: (el) => store.nudgeFriend(el.dataset.id),
  askRemoveFriend: (el) => store.askRemoveFriend(el.dataset.id),
  cancelRemoveFriend: () => store.cancelRemoveFriend(),
  confirmRemoveFriend: () => store.confirmRemoveFriend(),
  acceptInvite: () => store.acceptPendingInvite(),
  declineInvite: () => store.declineInvite(),
  // notifications (M3)
  toggleReminders: () => store.toggleReminders(),
  enableRemindersWelcome: () => store.enableRemindersThenFinish(),
  openReminderTime: () => store.openReminderTime(),
  pickReminderTime: (el) => store.setReminderTime(el.dataset.time),
};

root.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || !root.contains(el)) return;
  const act = el.dataset.act;
  if (act.startsWith('theme:')) { store.setTheme(act.slice(6)); return; }
  const fn = clickMap[act];
  if (fn) { e.preventDefault(); fn(el); }
});

// ---- text inputs: mutate state silently so re-renders never steal focus -----
root.addEventListener('input', (e) => {
  const el = e.target.closest('[data-field]');
  if (!el) return;
  const field = el.dataset.field;
  if (field === 'email') state.email = el.value;
  else if (field === 'otpCode') state.otpCode = el.value.replace(/\D/g, '').slice(0, 10);
  else if (field === 'friendCode') state.friendCodeInput = el.value.replace(/[^\w-]/g, '').toUpperCase();
  else if (field === 'draftName') state.draftName = el.value;
  else if (field === 'newGoal') state.newGoal = el.value;
  else if (field === 'rename') store.renameGoalLive(el.dataset.id, el.value);
});

// persist a rename when the field loses focus
root.addEventListener('focusout', (e) => {
  const el = e.target.closest('[data-field="rename"]');
  if (el) store.commitRename(el.dataset.id, el.value);
});

// Enter-to-submit on the single-purpose text fields
root.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const el = e.target.closest('[data-field]');
  if (!el) return;
  const f = el.dataset.field;
  if (f === 'email') { e.preventDefault(); store.sendMagicLink(); }
  else if (f === 'otpCode') { e.preventDefault(); store.verifyCode(); }
  else if (f === 'friendCode') { e.preventDefault(); store.addFriendByCode(); }
  else if (f === 'draftName') { e.preventDefault(); store.saveProfile(); }
  else if (f === 'newGoal') { e.preventDefault(); store.addGoal(); }
  else if (f === 'rename') { e.preventDefault(); el.blur(); }
  else if (f === 'draftName' && state.sheet === 'editProfile') { e.preventDefault(); store.saveEditProfile(); }
});

// ---- drag-to-reorder goals in the Manage sheet (GOAL-2) --------------------
let dragId = null;
root.addEventListener('dragstart', (e) => {
  const row = e.target.closest('.manage-row');
  if (!row) return;
  dragId = row.dataset.id;
  e.dataTransfer.effectAllowed = 'move';
});
root.addEventListener('dragover', (e) => {
  if (dragId && e.target.closest('.manage-row')) e.preventDefault();
});
root.addEventListener('drop', (e) => {
  const row = e.target.closest('.manage-row');
  if (dragId && row && row.dataset.id !== dragId) { e.preventDefault(); store.reorderGoals(dragId, row.dataset.id); }
  dragId = null;
});

// ---- photo verification: the picker input lives in index.html (outside #app,
// so re-renders can't destroy it). Aim it at a goal, click it, forward the file.
const photoInput = document.getElementById('photoInput');
let photoGoalId = null;
function openPhotoPicker(goalId) {
  if (!photoInput || !goalId) return;
  photoGoalId = goalId;
  photoInput.value = '';              // same file re-picked still fires change
  photoInput.click();
}
photoInput?.addEventListener('change', () => {
  const file = photoInput.files && photoInput.files[0];
  if (file && photoGoalId) store.attachPhoto(photoGoalId, file);
  photoGoalId = null;
});
// REQUIRE_PHOTO_TO_VERIFY: the store asks us to open the picker mid-toggle
store.setPhotoRequester(openPhotoPicker);

// ---- go ---------------------------------------------------------------------
render();
store.init();

// PWA: register the custom service worker (NF-1/NF-3 + M3 push). Best-effort; no-op if unsupported.
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));

  // messages from the SW: notification deep-link (NOTIF-9) + rotated subscription (NOTIF-5).
  navigator.serviceWorker.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.type === 'navigate' && d.screen) store.go(d.screen);
    else if (d.type === 'resubscribe' && d.subscription) store.handleResubscribe(d.subscription);
  });
}
