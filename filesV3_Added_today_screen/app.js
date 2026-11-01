'use strict';
/* Weekwise: vanilla JS school planner. All data lives in localStorage. */
const KEY = 'weekwise.v1', DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday'], MAX = 11;
const $ = s => document.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const str = (v, n = 500) => typeof v === 'string' ? v.slice(0, n) : '';
const ymd = d => { const z = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()); };
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isTime = v => typeof v === 'string' && /^\d{2}:\d{2}$/.test(v);
const whenLabel = d => { const n = daysUntil(d); return n < 0 ? Math.abs(n) + (n === -1 ? ' day' : ' days') + ' overdue' : n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : 'In ' + n + ' days'; };
const daysUntil = d => Math.round((new Date(d + 'T00:00') - new Date(ymd(new Date()) + 'T00:00')) / 864e5);

/* ---------- Safe DOM builder: text is always inserted as text, never HTML ---------- */
function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const k in props) {
    if (k === 'class') e.className = props[k];
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), props[k]);
    else if (k in e) e[k] = props[k];
    else e.setAttribute(k, props[k]);
  }
  kids.flat().forEach(c => { if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c)); });
  return e;
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.style.display = 'block';
  clearTimeout(toast.id); toast.id = setTimeout(() => t.style.display = 'none', 3500);
}

/* ---------- IndexedDB mirror: lets the service worker see assignments (it cannot read localStorage) ---------- */
function idb(mode, fn) {
  return new Promise(res => { try {
    const q = indexedDB.open('weekwise', 1);
    q.onupgradeneeded = () => q.result.createObjectStore('kv');
    q.onsuccess = () => { const tx = q.result.transaction('kv', mode); const r = fn(tx.objectStore('kv')); tx.oncomplete = () => res(r && r.result); tx.onerror = tx.onabort = () => res(); };
    q.onerror = () => res();
  } catch (e) { res(); } });
}
function mirror() { idb('readwrite', s => s.put({ settings: S.settings, notified: S.notified, assignments: S.assignments.map(a => ({ id: a.id, title: a.title, subject: a.subject, due: a.due, done: a.done })) }, 'snap')); }
// Best effort only: Chrome on Android may run this check now and then for an installed app. The browser decides when.
async function registerBg() { try { const r = await navigator.serviceWorker.ready; if (r.periodicSync && S.settings.notify) await r.periodicSync.register('weekwise-check', { minInterval: 12 * 3600 * 1000 }); } catch (e) { /* not supported or not allowed */ } }

/* ---------- Data: defaults, cleaning (handles missing/malformed data), saving ---------- */
function blank() {
  return { app: 'weekwise', version: 1,
    timetable: DAYS.map(() => ({ count: 6, lessons: Array.from({ length: MAX }, () => ({ subject: '', start: '', end: '', room: '', blank: false })) })),
    assignments: [], tests: [], settings: { notify: false, satOn: false, satTime: '08:00' }, notified: {} };
}
function normalize(raw) {
  const d = blank();
  if (!raw || typeof raw !== 'object') return d;
  DAYS.forEach((_, i) => {
    const src = raw.timetable && raw.timetable[i];
    if (!src || typeof src !== 'object') return;
    const c = parseInt(src.count, 10);
    if (c >= 0 && c <= MAX) d.timetable[i].count = c;
    for (let j = 0; j < MAX; j++) {
      const l = Array.isArray(src.lessons) && src.lessons[j];
      if (l && typeof l === 'object') d.timetable[i].lessons[j] = { subject: str(l.subject, 100), start: isTime(l.start) ? l.start : '', end: isTime(l.end) ? l.end : '', room: str(l.room, 50), blank: !!l.blank };
    }
  });
  if (Array.isArray(raw.assignments)) d.assignments = raw.assignments.filter(a => a && str(a.title).trim()).map(a => ({
    id: str(a.id, 40) || uid(), title: str(a.title, 200), subject: str(a.subject, 100), due: isDate(a.due) ? a.due : '',
    notes: str(a.notes, 2000), done: !!a.done, created: Number(a.created) || Date.now() }));
  if (Array.isArray(raw.tests)) d.tests = raw.tests.filter(t => t && str(t.name).trim()).map(t => ({
    id: str(t.id, 40) || uid(), name: str(t.name, 200), subject: str(t.subject, 100), date: isDate(t.date) ? t.date : '',
    topics: (Array.isArray(t.topics) ? t.topics : []).filter(p => p && str(p.text).trim()).map(p => ({ id: str(p.id, 40) || uid(), text: str(p.text, 200), done: !!p.done })) }));
  const s = raw.settings || {};
  d.settings = { notify: !!s.notify, satOn: !!s.satOn, satTime: isTime(s.satTime) ? s.satTime : '08:00' };
  if (raw.notified && typeof raw.notified === 'object') for (const k in raw.notified) if (raw.notified[k] === true) d.notified[k] = true;
  return d;
}
function load() { try { return normalize(JSON.parse(localStorage.getItem(KEY))); } catch (e) { return blank(); } }
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('Could not save. Browser storage may be full or blocked.'); } mirror(); }
let S = load();
const ui = { edit: false, tab: 'timetable', day: 0, asEdit: null, teEdit: null };
{ const g = new Date().getDay(); ui.day = g <= 4 ? g : 0; } // Sun=0..Thu=4; weekend starts on Sunday

/* ---------- Navigation ---------- */
const RENDER = { today: renderToday, timetable: renderTimetable, assignments: renderAssignments, tests: renderTests, settings: renderSettings };
function showTab(t) {
  ui.tab = t;
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  Object.keys(RENDER).forEach(k => { $('#' + k).hidden = k !== t; });
  RENDER[t]();
}
document.querySelectorAll('nav button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

/* ---------- Timetable ---------- */
function renderTimetable() {
  $('#ttDays').replaceChildren(...DAYS.map((n, i) => h('button', { class: 'chip' + (i === ui.day ? ' on' : ''), 'aria-label': n, onclick: () => { ui.day = i; renderTimetable(); } }, n.slice(0, 3))));
  $('#ttDayName').textContent = DAYS[ui.day];
  const eb = $('#ttEdit'); eb.textContent = ui.edit ? 'Done' : 'Edit'; eb.onclick = () => { ui.edit = !ui.edit; renderTimetable(); };
  const day = S.timetable[ui.day], sel = $('#ttCount');
  $('#ttCountWrap').hidden = !ui.edit;
  sel.replaceChildren(...Array.from({ length: MAX + 1 }, (_, n) => h('option', { value: n, selected: n === day.count }, String(n))));
  sel.onchange = () => { day.count = parseInt(sel.value, 10); save(); renderTimetable(); };
  const t = new Date(), hm = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
  const rows = day.lessons.slice(0, day.count).map((l, i) => ui.edit ? editRow(l, i) : viewRow(l, i, ui.day === t.getDay() && l.start && l.end && hm >= l.start && hm < l.end));
  $('#ttList').replaceChildren(...(rows.length ? rows : [h('p', { class: 'empty' }, 'No lessons on this day. Tap Edit to add some.')]));
}
// Read-only lesson card. A blank lesson is just a quiet gap that keeps its place in the day.
function viewRow(l, i, live, day = ui.day) {
  if (l.blank) return h('div', { class: 'gap', 'aria-label': 'Lesson ' + (i + 1) + ' is blank' }, h('span', {}, String(i + 1)));
  const time = [l.start, l.end].filter(Boolean).join(' \u2013 ');
  return h('button', { class: 'les' + (live ? ' now' : ''), onclick: () => { ui.day = day; ui.edit = true; showTab('timetable'); } },
    h('span', { class: 'n' }, String(i + 1)),
    h('span', { class: 'lb' }, h('span', { class: 'name' + (l.subject ? '' : ' mute') }, l.subject || 'Not set'),
      h('span', { class: 'meta' }, time && h('span', { class: 'time' }, time), l.room && h('span', { class: 'room' }, l.room))),
    live && h('span', { class: 'badge ok' }, 'Now'));
}
// Editable lesson row. Typing saves immediately without re-rendering, so focus is kept.
function editRow(l, i) {
  const set = (k, e) => { l[k] = e.target.value; save(); };
  const flip = v => () => { l.blank = v; save(); renderTimetable(); };
  const n = h('span', { class: 'n' }, String(i + 1));
  if (l.blank) return h('div', { class: 'erow isblank' }, n, h('span', { class: 'mute' }, 'Blank space'), h('button', { class: 'small', onclick: flip(false) }, 'Fill in'));
  const f = (label, type, k, max) => h('label', { class: 'f' }, label, h('input', Object.assign({ type, value: l[k], oninput: e => set(k, e) }, max ? { maxLength: max } : {})));
  return h('div', { class: 'erow' }, n,
    h('input', { type: 'text', value: l.subject, maxLength: 100, placeholder: 'Subject', 'aria-label': 'Subject, lesson ' + (i + 1), oninput: e => set('subject', e) }),
    h('button', { class: 'small', onclick: flip(true) }, 'Make blank'),
    h('div', { class: 'efields' }, f('Start', 'time', 'start'), f('End', 'time', 'end'), f('Room', 'text', 'room', 50)));
}

/* ---------- Today: lessons, urgent assignments, next test ---------- */
function renderToday() {
  const now = new Date(), g = now.getDay(), school = g <= 4, d = school ? g : 0; // weekend shows Sunday
  const hm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  const day = S.timetable[d], lessons = day.lessons.slice(0, day.count), byDate = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const due = S.assignments.filter(a => !a.done && a.due && daysUntil(a.due) <= 1).sort((a, b) => byDate(a.due, b.due));
  const test = S.tests.filter(t => t.date && daysUntil(t.date) >= 0).sort((a, b) => byDate(a.date, b.date))[0];
  const sec = t => h('h3', { class: 'sec' }, t);
  const out = [sec(school ? 'Today\u2019s lessons' : 'Weekend. Sunday\u2019s lessons')];
  out.push(...(lessons.length ? lessons.map((l, i) => viewRow(l, i, school && l.start && l.end && hm >= l.start && hm < l.end, d)) : [h('p', { class: 'empty' }, 'No lessons set for this day.')]));
  out.push(sec('Due today and tomorrow'));
  out.push(...(due.length ? due.map(a => { const st = asStatus(a);
    return h('div', { class: 'item ' + st }, h('div', { class: 'head' },
      h('input', { type: 'checkbox', 'aria-label': 'Mark completed', onchange: e => { a.done = e.target.checked; save(); renderToday(); } }),
      h('div', {}, h('div', { class: 't' }, a.title, h('span', { class: 'badge ' + (st === 'overdue' ? 'bad' : st === 'today' ? 'warn' : 'soon') }, whenLabel(a.due))), a.subject && h('div', { class: 'meta' }, a.subject)))); })
    : [h('p', { class: 'empty' }, 'Nothing due today or tomorrow.')]));
  out.push(sec('Next test'));
  if (test) { const done = test.topics.filter(p => p.done).length;
    out.push(h('div', { class: 'item soon' }, h('div', { class: 't' }, test.name, h('span', { class: 'badge soon' }, whenLabel(test.date))),
      h('div', { class: 'meta' }, [test.subject, test.date].filter(Boolean).join('  |  ')),
      test.topics.length ? [h('div', { class: 'meta' }, done + '/' + test.topics.length + ' topics completed'), h('progress', { max: test.topics.length, value: done })] : null,
      h('div', { class: 'acts' }, h('button', { class: 'small', onclick: () => showTab('tests') }, 'Open tests'))));
  } else out.push(h('p', { class: 'empty' }, 'No upcoming tests.'));
  $('#today').replaceChildren(...out);
}

/* ---------- Assignments ---------- */
function asStatus(a) {
  if (a.done || !a.due) return '';
  const n = daysUntil(a.due); return n < 0 ? 'overdue' : n === 0 ? 'today' : '';
}
function renderAssignments() {
  const f = $('#asFilter').value, srt = $('#asSort').value;
  let list = S.assignments.filter(a => f === 'all' || (f === 'done') === a.done);
  list.sort((a, b) => srt === 'created' ? b.created - a.created : ((a.due || '9999') < (b.due || '9999') ? -1 : (a.due || '9999') > (b.due || '9999') ? 1 : a.created - b.created));
  $('#asList').replaceChildren(...(list.length ? list.map(a => {
    const st = asStatus(a);
    return h('div', { class: 'item ' + (a.done ? 'done ' : '') + st },
      h('div', { class: 'head' },
        h('input', { type: 'checkbox', checked: a.done, 'aria-label': 'Completed', onchange: e => { a.done = e.target.checked; save(); renderAssignments(); } }),
        h('div', {}, h('div', { class: 't' }, a.title,
          a.due && !a.done && h('span', { class: 'badge ' + (st === 'overdue' ? 'bad' : st === 'today' ? 'warn' : daysUntil(a.due) <= 3 ? 'soon' : '') }, whenLabel(a.due))),
          h('div', { class: 'meta' }, [a.subject, a.due && 'Due ' + a.due].filter(Boolean).join('  |  ') || 'No subject or due date'))),
      a.notes && h('div', { class: 'notes' }, a.notes),
      h('div', { class: 'acts' }, h('button', { class: 'small', onclick: () => editAssignment(a.id) }, 'Edit'),
        h('button', { class: 'small danger', onclick: () => { if (confirm('Delete "' + a.title + '"?')) { S.assignments = S.assignments.filter(x => x.id !== a.id); if (ui.asEdit === a.id) resetAsForm(); save(); renderAssignments(); } } }, 'Delete')));
  }) : [h('p', { class: 'empty' }, 'No assignments here. Add one above.')]));
}
function resetAsForm() { ui.asEdit = null; $('#asBox').open = false; $('#asForm').reset(); $('#asFormTitle').textContent = 'New assignment'; $('#asSave').textContent = 'Add assignment'; $('#asCancel').hidden = true; }
function editAssignment(id) {
  const a = S.assignments.find(x => x.id === id); if (!a) return;
  ui.asEdit = id; $('#asTitle').value = a.title; $('#asSubject').value = a.subject; $('#asDue').value = a.due; $('#asNotes').value = a.notes;
  $('#asFormTitle').textContent = 'Edit assignment'; $('#asSave').textContent = 'Save changes'; $('#asCancel').hidden = false;
  $('#asBox').open = true; $('#asForm').scrollIntoView({ behavior: 'smooth' }); $('#asTitle').focus();
}
$('#asForm').addEventListener('submit', e => {
  e.preventDefault();
  const title = $('#asTitle').value.trim(); if (!title) return toast('Enter a title.');
  const data = { title, subject: $('#asSubject').value.trim(), due: $('#asDue').value, notes: $('#asNotes').value.trim() };
  const ex = S.assignments.find(x => x.id === ui.asEdit);
  if (ex) Object.assign(ex, data); else S.assignments.push({ id: uid(), done: false, created: Date.now(), ...data });
  save(); resetAsForm(); renderAssignments(); toast(ex ? 'Changes saved' : 'Assignment added');
});
$('#asCancel').onclick = resetAsForm;
$('#asFilter').onchange = $('#asSort').onchange = renderAssignments;

/* ---------- Tests ---------- */
function renderTests() {
  const list = [...S.tests].sort((a, b) => (a.date || '9999') < (b.date || '9999') ? -1 : (a.date || '9999') > (b.date || '9999') ? 1 : 0);
  $('#teList').replaceChildren(...(list.length ? list.map(t => {
    const done = t.topics.filter(p => p.done).length, n = t.date ? daysUntil(t.date) : null;
    const when = n === null ? '' : n < 0 ? 'Past' : n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : 'In ' + n + ' days';
    const cls = n === null ? '' : n < 0 ? '' : n <= 7 ? 'soon' : '';
    return h('div', { class: 'item ' + cls },
      h('div', {}, h('div', { class: 't' }, t.name, when && h('span', { class: 'badge ' + (n < 0 ? '' : n <= 7 ? 'warn' : '') }, when)),
        h('div', { class: 'meta' }, [t.subject, t.date].filter(Boolean).join('  |  ') || 'No subject or date')),
      t.topics.length ? [h('div', { class: 'meta' }, done + '/' + t.topics.length + ' topics completed'), h('progress', { max: t.topics.length, value: done }),
        h('div', { class: 'topics' }, t.topics.map(p => h('label', {}, h('input', { type: 'checkbox', checked: p.done, onchange: e => { p.done = e.target.checked; save(); renderTests(); } }), h('span', { class: p.done ? 'd' : '' }, p.text))))]
        : h('div', { class: 'meta' }, 'No study topics yet. Edit this test to add some.'),
      h('div', { class: 'acts' }, h('button', { class: 'small', onclick: () => editTest(t.id) }, 'Edit'),
        h('button', { class: 'small danger', onclick: () => { if (confirm('Delete "' + t.name + '" and its topics?')) { S.tests = S.tests.filter(x => x.id !== t.id); if (ui.teEdit === t.id) resetTeForm(); save(); renderTests(); } } }, 'Delete')));
  }) : [h('p', { class: 'empty' }, 'No tests yet. Add one above.')]));
}
function resetTeForm() { ui.teEdit = null; $('#teBox').open = false; $('#teForm').reset(); $('#teFormTitle').textContent = 'New test'; $('#teSave').textContent = 'Add test'; $('#teCancel').hidden = true; }
function editTest(id) {
  const t = S.tests.find(x => x.id === id); if (!t) return;
  ui.teEdit = id; $('#teName').value = t.name; $('#teSubject').value = t.subject; $('#teDate').value = t.date; $('#teTopics').value = t.topics.map(p => p.text).join('\n');
  $('#teFormTitle').textContent = 'Edit test'; $('#teSave').textContent = 'Save changes'; $('#teCancel').hidden = false;
  $('#teBox').open = true; $('#teForm').scrollIntoView({ behavior: 'smooth' }); $('#teName').focus();
}
$('#teForm').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('#teName').value.trim(); if (!name) return toast('Enter a test name.');
  const lines = $('#teTopics').value.split('\n').map(s => s.trim()).filter(Boolean);
  const ex = S.tests.find(x => x.id === ui.teEdit), old = ex ? [...ex.topics] : [];
  // Reuse an existing topic (keeps its done status) when the text is unchanged
  const topics = lines.map(text => { const i = old.findIndex(p => p.text === text); return i >= 0 ? old.splice(i, 1)[0] : { id: uid(), text: text.slice(0, 200), done: false }; });
  const data = { name, subject: $('#teSubject').value.trim(), date: $('#teDate').value, topics };
  if (ex) Object.assign(ex, data); else S.tests.push({ id: uid(), ...data });
  save(); resetTeForm(); renderTests(); toast(ex ? 'Changes saved' : 'Test added');
});
$('#teCancel').onclick = resetTeForm;

/* ---------- Notifications (only work while the app is open) ---------- */
let swReg = null;
function notify(title, body, tag) {
  try { if (swReg && swReg.showNotification) swReg.showNotification(title, { body, tag, icon: 'icon-192.png' }); else new Notification(title, { body, tag }); } catch (e) { /* ignore */ }
}
async function checkReminders() {
  if (!S.settings.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
  const swn = await idb('readonly', s => s.get('swn')); if (swn) Object.assign(S.notified, swn); // alerts the background check already sent
  const now = new Date(), today = ymd(now);
  for (const k in S.notified) if (!k.startsWith(today)) delete S.notified[k]; // forget old days
  let changed = false;
  S.assignments.filter(a => !a.done && a.due === today && !S.notified[today + ':' + a.id]).forEach(a => {
    notify('Due today: ' + a.title, a.subject || 'Assignment', 'as-' + a.id); S.notified[today + ':' + a.id] = true; changed = true; });
  const hm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  const open = S.assignments.filter(a => !a.done).length;
  if (S.settings.satOn && now.getDay() === 6 && hm >= S.settings.satTime && open && !S.notified[today + ':sat']) {
    notify('Weekwise', open + ' unfinished assignment' + (open > 1 ? 's' : '') + ' before Sunday', 'sat'); S.notified[today + ':sat'] = true; changed = true; }
  if (changed) save();
}

/* ---------- Settings, backup ---------- */
function renderSettings() {
  const ok = 'Notification' in window, p = ok ? Notification.permission : 'unsupported';
  $('#notifyStatus').textContent = !ok ? 'This browser does not support notifications.' : p === 'denied' ? 'Notifications are blocked in your browser settings.' : S.settings.notify && p === 'granted' ? 'Notifications are on (while the app is open).' : 'Notifications are off.';
  $('#bgStatus').textContent = 'periodicSync' in ServiceWorkerRegistration.prototype ? 'Background checks: when Weekwise is installed, Chrome on Android may check for due assignments a few times a day. The browser decides when, so timing is not guaranteed.' : 'Background checks are not supported in this browser, so reminders only appear while Weekwise is open.';
  $('#satOn').checked = S.settings.satOn; $('#satTime').value = S.settings.satTime;
}
$('#notifyOn').onclick = async () => {
  if (!('Notification' in window)) return toast('Notifications are not supported here.');
  const p = await Notification.requestPermission();
  S.settings.notify = p === 'granted'; save(); renderSettings(); checkReminders(); registerBg();
  if (p !== 'granted') toast('Permission was not granted.');
};
$('#notifyOff').onclick = () => { S.settings.notify = false; save(); renderSettings(); };
$('#satOn').onchange = e => { S.settings.satOn = e.target.checked; save(); };
$('#satTime').onchange = e => { if (isTime(e.target.value)) { S.settings.satTime = e.target.value; save(); } };
$('#exportBtn').onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' }));
  const a = h('a', { href: url, download: 'weekwise-backup-' + ymd(new Date()) + '.json' }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Backup downloaded');
};
$('#importBtn').onclick = () => $('#importFile').click();
$('#importFile').onchange = e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  const r = new FileReader();
  r.onerror = () => toast('Could not read that file.');
  r.onload = () => {
    let raw; try { raw = JSON.parse(r.result); } catch (err) { return toast('Import failed: not valid JSON. Your data was not changed.'); }
    if (!raw || raw.app !== 'weekwise' || !Array.isArray(raw.timetable) || !Array.isArray(raw.assignments) || !Array.isArray(raw.tests)) return toast('Import failed: not a Weekwise backup. Your data was not changed.');
    if (!confirm('Replace ALL current data with this backup? This cannot be undone.')) return;
    S = normalize(raw); save(); resetAsForm(); resetTeForm(); showTab(ui.tab); toast('Backup imported');
  };
  r.readAsText(file);
};
$('#eraseBtn').onclick = () => {
  if (!confirm('Erase ALL Weekwise data on this device? This cannot be undone.')) return;
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  S = blank(); save(); resetAsForm(); resetTeForm(); showTab(ui.tab); toast('All data erased');
};

/* ---------- Install + service worker ---------- */
let deferred = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; $('#installBtn').hidden = false; });
$('#installBtn').onclick = async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; $('#installBtn').hidden = true; };
(function registerSW() {
  const el = $('#swStatus');
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) { el.textContent = 'Offline mode and installing need the app to be opened from an https:// address (or localhost), not from a file.'; return; }
  navigator.serviceWorker.register('sw.js').then(r => { swReg = r; el.textContent = 'Offline mode is ready after the first load.'; })
    .catch(() => { el.textContent = 'Offline mode could not start. The app still works while online.'; });
})();

/* ---------- Start ---------- */
$('#todayLabel').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
showTab('today'); mirror(); registerBg(); checkReminders(); setInterval(checkReminders, 60000);
