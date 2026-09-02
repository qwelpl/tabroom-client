const THEMES = ['warm', 'cool', 'indigo'];

function apply(settings) {
  if (!document.body) return;
  THEMES.forEach(t => document.body.classList.remove(`tr-${t}`));
  const theme = THEMES.includes(settings.theme) ? settings.theme : 'cool';
  document.body.classList.add(`tr-${theme}`);
  document.body.classList.toggle('tr-compact', Boolean(settings.compact));
}

function swapLogo() {
  const img = document.querySelector('#logo img');
  if (img) img.src = chrome.runtime.getURL('logo-light.jpg');
}

chrome.storage.sync.get({ compact: false, theme: 'cool' }, apply);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (changes.compact !== undefined || changes.theme !== undefined) {
    chrome.storage.sync.get({ compact: false, theme: 'cool' }, apply);
  }
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', swapLogo, { once: true });
} else {
  swapLogo();
}

function highlightWinningRows() {
  if (!/\/user\/student\//i.test(location.pathname) && !/\/user\/student\/index/i.test(location.pathname)) return;

  document.querySelectorAll('table').forEach(table => {
    const headers = [...table.querySelectorAll('thead th, thead td, tr:first-child th, tr:first-child td')];

    // Strategy 1: separate W and L columns
    let wIdx = -1, lIdx = -1;
    headers.forEach((th, i) => {
      const t = th.textContent.trim().toLowerCase();
      if (wIdx === -1 && (t === 'w' || t === 'wins' || t === 'win')) wIdx = i;
      if (lIdx === -1 && (t === 'l' || t === 'losses' || t === 'loss')) lIdx = i;
    });

    // Strategy 2: W/L inline in "Judges & Results" or last cell
    const resultsIdx = headers.findIndex(th =>
      /result|judge/i.test(th.textContent)
    );

    table.querySelectorAll('tr').forEach(row => {
      const cells = row.querySelectorAll('td');
      if (!cells.length) return; // skip header rows (th-only)

      let w = 0, l = 0;

      if (wIdx !== -1 && lIdx !== -1) {
        w = parseFloat(cells[wIdx]?.textContent.trim()) || 0;
        l = parseFloat(cells[lIdx]?.textContent.trim()) || 0;
      } else {
        const target = (resultsIdx !== -1 ? cells[resultsIdx] : null) ?? row;
        const text = target.textContent;
        w = (text.match(/\bW\b/g) || []).length;
        l = (text.match(/\bL\b/g) || []).length;
      }

      const text = row.textContent;
      const isBye = /\bBYE\b/i.test(text);

      row.classList.remove('tr-win-row', 'tr-loss-row', 'tr-bye-row');
      if (isBye) row.classList.add('tr-bye-row');
      else if (w > 0 && w > l) row.classList.add('tr-win-row');
      else if (l > 0 && l > w) row.classList.add('tr-loss-row');
    });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', highlightWinningRows, { once: true });
} else {
  highlightWinningRows();
}

// ===== NOTES DATABASE =====
// Firebase Realtime Database + Email/Password Auth (REST, no SDK)
// Password is derived from the Tabroom email — same email on any device
// produces the same Firebase account, enabling cross-device sync.
//
// Required Firebase setup:
//   1. Authentication → Sign-in method → Email/Password → Enable
//   2. Realtime Database → Rules:
//      { "rules": { "$uid": { ".read": "auth != null && auth.uid === $uid",
//                             ".write": "auth != null && auth.uid === $uid" } } }
//   3. Replace FB_API_KEY with your Web API Key (Project Settings → General)
// Data path: /{uid}/competitors/{noteKey}, /{uid}/judges/{noteKey}

const FB_DB = 'https://tabroom-client-default-rtdb.firebaseio.com';
const FB_API_KEY = 'AIzaSyAYyuRx4SVQLpyYGhAuCN_UT1QpMmMzxd0';
const FB_APP_VER = 'tr-notes-v1'; // bump to force new accounts if needed

function dbNormKey(name) { return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'); }

let _detectedEmail = null;
function detectEmail() {
  if (_detectedEmail) return _detectedEmail;
  const candidates = [
    ...document.querySelectorAll('a[href*="user/home.mhtml"]'),
    document.querySelector('#mobile_email'),
  ].filter(Boolean);
  for (const el of candidates) {
    const m = el.textContent.trim().match(/[\w.+\-]+@[\w.\-]+\.[a-z]{2,}/i);
    if (m) { _detectedEmail = m[0].toLowerCase(); return _detectedEmail; }
  }
  const m = document.querySelector('#toprow, #headerarch')
    ?.textContent.match(/[\w.+\-]+@[\w.\-]+\.[a-z]{2,}/i);
  if (m) { _detectedEmail = m[0].toLowerCase(); return _detectedEmail; }
  return null;
}

function derivePassword(email) {
  // Deterministic per-email password. Same email → same Firebase account on any device.
  return btoa(`${FB_APP_VER}::${email}`).replace(/[^a-zA-Z0-9]/g, '').substring(0, 24);
}

let _auth = null; // { token, uid, email, expiry, refresh }

async function getAuth() {
  if (_auth && Date.now() < _auth.expiry - 60_000) return _auth;

  // Try refreshing stored token
  const { tr_fb_auth: stored } = await chrome.storage.local.get('tr_fb_auth');
  if (stored?.refresh && stored?.uid) {
    try {
      const r = await fetch(
        `https://securetoken.googleapis.com/v1/token?key=${FB_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: stored.refresh })
        }
      );
      if (r.ok) {
        const d = await r.json();
        _auth = { token: d.id_token, uid: stored.uid, email: stored.email,
                  expiry: Date.now() + Number(d.expires_in) * 1000, refresh: d.refresh_token };
        await chrome.storage.local.set({ tr_fb_auth: { ..._auth } });
        return _auth;
      }
    } catch (_) {}
  }

  const email = detectEmail();
  if (!email) throw new Error('Not signed in to Tabroom — cannot sync notes');

  const password = derivePassword(email);

  // Try sign-in
  let r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FB_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true })
    }
  );

  // Account doesn't exist yet — create it
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    if (err?.error?.message === 'EMAIL_NOT_FOUND' || err?.error?.message === 'INVALID_LOGIN_CREDENTIALS') {
      r = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FB_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, returnSecureToken: true })
        }
      );
    }
  }

  const d = await r.json();
  if (!r.ok || d.error) throw new Error(d?.error?.message || `Auth HTTP ${r.status}`);

  _auth = {
    token: d.idToken,
    uid: d.localId,
    email,
    expiry: Date.now() + Number(d.expiresIn) * 1000,
    refresh: d.refreshToken
  };
  await chrome.storage.local.set({ tr_fb_auth: { ..._auth } });
  return _auth;
}

async function fbUrl(type, key) {
  const auth = await getAuth();
  const base = `${FB_DB}/${auth.uid}/${type}`;
  return (key ? `${base}/${key}.json` : `${base}.json`) + `?auth=${auth.token}`;
}

function loadPrefs(cb) {
  getAuth()
    .then(auth => fetch(`${FB_DB}/${auth.uid}/prefs.json?auth=${auth.token}`))
    .then(r => r.json().catch(() => null))
    .then(data => cb(data && typeof data === 'object' ? data : null))
    .catch(() => cb(null));
}

function savePrefs(prefs) {
  getAuth()
    .then(auth => fetch(`${FB_DB}/${auth.uid}/prefs.json?auth=${auth.token}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prefs)
    }))
    .catch(() => {});
}

function migrateOldNotes() {
  chrome.storage.sync.get(null, all => {
    const migrants = { competitors: {}, judges: {} };
    const keysToRemove = [];
    for (const [k, v] of Object.entries(all)) {
      if (k.startsWith('tr_nc_') && v?.name) {
        migrants.competitors[k.split('_').slice(3).join('_')] = v;
        keysToRemove.push(k);
      } else if (k.startsWith('tr_nj_') && v?.name) {
        migrants.judges[k.split('_').slice(3).join('_')] = v;
        keysToRemove.push(k);
      }
    }
    let pending = 0;
    for (const [type, db] of Object.entries(migrants)) {
      for (const [key, val] of Object.entries(db)) {
        pending++;
        dbSetEntry(type, key, val, () => { if (--pending === 0) chrome.storage.sync.remove(keysToRemove); });
      }
    }
  });

  chrome.storage.local.get({ tr_db_v1_competitors: {}, tr_db_v1_judges: {} }, old => {
    const types = { competitors: old.tr_db_v1_competitors, judges: old.tr_db_v1_judges };
    let pending = 0;
    for (const [type, db] of Object.entries(types)) {
      for (const [key, val] of Object.entries(db)) {
        if (!val?.name) continue;
        pending++;
        dbSetEntry(type, key, val, () => {
          if (--pending === 0) chrome.storage.local.remove(['tr_db_v1_competitors', 'tr_db_v1_judges']);
        });
      }
    }
  });
}

function dbLoad(type, cb) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  fbUrl(type)
    .then(url => fetch(url, { signal: controller.signal }))
    .then(async r => {
      clearTimeout(timeout);
      if (!r.ok && r.status !== 404) {
        const body = await r.json().catch(() => null);
        cb({}, body?.error || `HTTP ${r.status}`);
        return;
      }
      const data = await r.json().catch(() => null);
      cb(data && typeof data === 'object' ? data : {}, null);
    })
    .catch(err => {
      clearTimeout(timeout);
      cb({}, err.name === 'AbortError' ? 'Request timed out' : (err.message || 'Network error'));
    });
}

function dbSetEntry(type, key, value, cb) {
  fbUrl(type, key)
    .then(url => fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value)
    }))
    .then(async r => {
      if (!r.ok) {
        const body = await r.json().catch(() => null);
        cb?.(false, body?.error || `HTTP ${r.status}`);
        return;
      }
      cb?.(true, null);
    })
    .catch(err => cb?.(false, err.message || 'Network error'));
}

function dbDeleteEntry(type, key, cb) {
  fbUrl(type, key)
    .then(url => fetch(url, { method: 'DELETE' }))
    .then(r => cb?.(r.ok, r.ok ? null : `HTTP ${r.status}`))
    .catch(err => cb?.(false, err.message || 'Network error'));
}

// ===== GROUP SYNC =====
// Data path: /groups/{code}/{type}/{noteKey}/{uid} = { name, notes, updated, authorEmail }
// Members:   /groups/{code}/members/{uid} = { email, joinedAt }

let _panelMode = 'personal';
let _panelGroupCode = null;
let _panelType = 'competitors';

async function groupFbUrl(...segments) {
  const auth = await getAuth();
  return `${FB_DB}/groups/${segments.join('/')}.json?auth=${auth.token}`;
}

async function groupCreate() {
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  await groupJoin(code);
  return code;
}

async function groupJoin(code) {
  const auth = await getAuth();
  const url = await groupFbUrl(code, 'members', auth.uid);
  const r = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: auth.email, joinedAt: Date.now() })
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d?.error || `HTTP ${r.status}`);
  }
  _panelGroupCode = code;
  await chrome.storage.local.set({ tr_group: { code } });
}

async function groupLeave() {
  if (!_panelGroupCode) return;
  const auth = await getAuth();
  const url = await groupFbUrl(_panelGroupCode, 'members', auth.uid);
  await fetch(url, { method: 'DELETE' }).catch(() => {});
  _panelGroupCode = null;
  await chrome.storage.local.remove('tr_group');
}

function groupLoadNotes(code, type, cb) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  groupFbUrl(code, type)
    .then(url => fetch(url, { signal: controller.signal }))
    .then(async r => {
      clearTimeout(timeout);
      if (!r.ok && r.status !== 404) {
        const body = await r.json().catch(() => null);
        cb({}, body?.error || `HTTP ${r.status}`);
        return;
      }
      const data = await r.json().catch(() => null);
      cb(data && typeof data === 'object' ? data : {}, null);
    })
    .catch(err => {
      clearTimeout(timeout);
      cb({}, err.name === 'AbortError' ? 'Request timed out' : (err.message || 'Network error'));
    });
}

function groupSetNote(code, type, key, uid, value, cb) {
  groupFbUrl(code, type, key, uid)
    .then(url => fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value)
    }))
    .then(async r => {
      if (!r.ok) {
        const body = await r.json().catch(() => null);
        cb?.(false, body?.error || `HTTP ${r.status}`);
        return;
      }
      cb?.(true, null);
    })
    .catch(err => cb?.(false, err.message || 'Network error'));
}

function groupDeleteNote(code, type, key, uid, cb) {
  groupFbUrl(code, type, key, uid)
    .then(url => fetch(url, { method: 'DELETE' }))
    .then(r => cb?.(r.ok, r.ok ? null : `HTTP ${r.status}`))
    .catch(err => cb?.(false, err.message || 'Network error'));
}

function renderGroupList(panel, type, filter, code) {
  const list = panel.querySelector('.tr-db-list');
  list.innerHTML = `<div class="tr-db-empty">Loading…</div>`;
  Promise.all([getAuth(), new Promise(res => groupLoadNotes(code, type, (db, err) => res([db, err])))])
    .then(([auth, [db, err]]) => {
      if (err) { list.innerHTML = `<div class="tr-db-error">Group error: ${err}</div>`; return; }
      const teams = [];
      for (const [noteKey, members] of Object.entries(db)) {
        if (!members || typeof members !== 'object') continue;
        const entries = Object.entries(members)
          .filter(([, e]) => e?.name)
          .map(([uid, e]) => ({ uid, isMine: uid === auth.uid, ...e }));
        if (!entries.length) continue;
        const displayName = entries[0].name;
        if (filter && !displayName.toLowerCase().includes(filter.toLowerCase())) continue;
        teams.push({ noteKey, displayName, entries });
      }
      teams.sort((a, b) => a.displayName.localeCompare(b.displayName));
      if (!teams.length) { list.innerHTML = `<div class="tr-db-empty">No group ${type} notes yet.</div>`; return; }

      function renderTeams() {
        list.innerHTML = teams.map(t => `
          <div class="tr-db-row tr-db-team-row" data-key="${t.noteKey}">
            <div class="tr-db-row-name">${t.displayName}</div>
            <div class="tr-db-row-preview">${t.entries.length} note${t.entries.length === 1 ? '' : 's'}</div>
          </div>
        `).join('');
        list.querySelectorAll('.tr-db-team-row').forEach(row => {
          row.addEventListener('click', () => {
            const team = teams.find(t => t.noteKey === row.dataset.key);
            if (team) renderMembers(team);
          });
        });
      }

      function renderMembers(team) {
        list.innerHTML = `
          <div class="tr-db-row tr-db-back-row">← Back</div>
          ${team.entries.map(e => `
            <div class="tr-db-row" data-key="${team.noteKey}" data-uid="${e.uid}" data-mine="${e.isMine}">
              <div class="tr-db-row-name">${e.isMine ? 'You' : (e.authorEmail || e.uid)}</div>
              <div class="tr-db-row-preview">${(e.notes || '').slice(0, 80) || '—'}</div>
            </div>
          `).join('')}
        `;
        list.querySelector('.tr-db-back-row').addEventListener('click', renderTeams);
        list.querySelectorAll('.tr-db-row:not(.tr-db-back-row)').forEach(row => {
          row.addEventListener('click', () =>
            openGroupEditor(panel, type, row.dataset.key, row.dataset.uid, code, row.dataset.mine === 'true', team.displayName));
        });
      }

      renderTeams();
    })
    .catch(err => { list.innerHTML = `<div class="tr-db-error">Auth error: ${err.message}</div>`; });
}

function openGroupEditor(panel, type, key, uid, code, editable, name) {
  if (editable) savePrefs({ mode: 'group', type, groupCode: code, lastKey: key, lastName: name || key, lastUid: uid });
  const ed = panel.querySelector('.tr-db-editor');
  const st = panel.querySelector('.tr-db-ed-status');
  const nameEl = panel.querySelector('.tr-db-ed-name');
  const ta = panel.querySelector('.tr-db-ed-area');
  const deleteBtn = panel.querySelector('.tr-db-delete');

  let currentKey = key;
  panel.querySelector('.tr-db-list-view').style.display = 'none';
  ed.style.display = '';
  nameEl.contentEditable = editable ? 'true' : 'false';
  nameEl.textContent = name || key;
  nameEl.dataset.key = key;
  ta.value = '';
  ta.disabled = true;
  deleteBtn.style.display = editable ? '' : 'none';
  st.textContent = 'Loading…';
  st.style.color = '';

  getAuth().then(auth => groupFbUrl(code, type, key, uid).then(url => ({ url, auth })))
    .then(({ url, auth }) => fetch(url))
    .then(async r => {
      const data = await r.json().catch(() => null);
      const entry = (data && typeof data === 'object') ? data : { name: name || key, notes: '', updated: 0 };
      ta.disabled = !editable;
      st.textContent = editable ? '' : '(read-only)';
      if (entry.name === key && name) entry.name = name;
      nameEl.textContent = entry.name || name || key;
      ta.value = entry.notes || '';
      if (!editable) return;

      function doRename() {
        const newName = nameEl.textContent.trim();
        if (!newName || newName === entry.name) return;
        const oldKey = currentKey;
        const newKey = dbNormKey(newName);
        entry.name = newName;
        getAuth().then(auth => {
          groupSetNote(code, type, newKey, uid, { ...entry, updated: Date.now(), authorEmail: auth.email }, (ok, saveErr) => {
            if (!ok) { st.textContent = `Rename failed: ${saveErr}`; st.style.color = '#c0392b'; setTimeout(() => { st.textContent = ''; st.style.color = ''; }, 3000); return; }
            if (newKey !== oldKey) groupDeleteNote(code, type, oldKey, uid, () => {});
            currentKey = newKey;
            nameEl.dataset.key = newKey;
            st.textContent = '✓ Renamed';
            setTimeout(() => { st.textContent = ''; }, 1500);
          });
        });
      }
      nameEl.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); } if (e.key === 'Escape') { nameEl.textContent = entry.name; nameEl.blur(); } };
      nameEl.onblur = doRename;

      let timer;
      ta.oninput = () => {
        st.textContent = '●'; st.style.color = '';
        clearTimeout(timer);
        timer = setTimeout(() => {
          getAuth().then(auth => {
            groupSetNote(code, type, currentKey, uid, { ...entry, notes: ta.value, updated: Date.now(), authorEmail: auth.email }, (ok, saveErr) => {
              st.textContent = ok ? '✓' : `Save failed: ${saveErr}`;
              st.style.color = ok ? '' : '#c0392b';
              setTimeout(() => { st.textContent = ''; st.style.color = ''; }, 3000);
            });
          });
        }, 600);
      };

      deleteBtn.onclick = () => {
        groupDeleteNote(code, type, currentKey, uid, () => {
          ed.style.display = 'none';
          panel.querySelector('.tr-db-list-view').style.display = '';
          renderGroupList(panel, type, panel.querySelector('.tr-db-search').value, code);
        });
      };
    })
    .catch(err => {
      ta.disabled = false;
      st.textContent = `Error: ${err.message}`;
      st.style.color = '#c0392b';
    });
}

function renderDbList(panel, type, filter) {
  const list = panel.querySelector('.tr-db-list');
  list.innerHTML = `<div class="tr-db-empty">Loading…</div>`;
  dbLoad(type, (db, err) => {
    if (err) {
      const hint = (err.includes('Permission') || err.includes('401') || err.includes('403'))
        ? ' — Firebase rules blocking access'
        : err.includes('timed out') ? ' — Firebase unreachable' : '';
      list.innerHTML = `<div class="tr-db-error">Sync error: ${err}${hint}</div>`;
      return;
    }
    const entries = Object.values(db)
      .filter(e => !filter || e.name.toLowerCase().includes(filter.toLowerCase()))
      .sort((a, b) => (b.updated || 0) - (a.updated || 0));
    if (!entries.length) {
      list.innerHTML = `<div class="tr-db-empty">No ${type} notes yet.</div>`;
      return;
    }
    list.innerHTML = entries.map(e => `
      <div class="tr-db-row" data-key="${dbNormKey(e.name)}" data-name="${e.name}" data-type="${type}">
        <div class="tr-db-row-name">${e.name}</div>
        <div class="tr-db-row-preview">${(e.notes || '').slice(0, 80) || '—'}</div>
      </div>
    `).join('');
    list.querySelectorAll('.tr-db-row').forEach(row => {
      row.addEventListener('click', () =>
        openDbEditor(panel, row.dataset.type, row.dataset.key, row.dataset.name));
    });
  });
}

function openDbEditor(panel, type, key, name) {
  savePrefs({ mode: _panelMode, type, groupCode: _panelGroupCode || null, lastKey: key, lastName: name || key, lastUid: null });
  const ed = panel.querySelector('.tr-db-editor');
  const st = panel.querySelector('.tr-db-ed-status');
  const nameEl = panel.querySelector('.tr-db-ed-name');
  const ta = panel.querySelector('.tr-db-ed-area');

  let currentKey = key;

  panel.querySelector('.tr-db-list-view').style.display = 'none';
  ed.style.display = '';
  nameEl.textContent = name || key;
  nameEl.dataset.key = key;
  ta.value = '';
  ta.disabled = true;
  st.textContent = 'Loading…';
  st.style.color = '';

  dbLoad(type, (db, err) => {
    ta.disabled = false;
    if (err) {
      st.textContent = `Load error: ${err}`;
      st.style.color = '#c0392b';
      return;
    }
    st.textContent = '';
    const entry = db[currentKey] || { name: name || currentKey, notes: '', updated: 0 };
    if (entry.name === currentKey && name) entry.name = name;
    nameEl.textContent = entry.name;
    ta.value = entry.notes || '';

    // Rename on blur or Enter
    function doRename() {
      const newName = nameEl.textContent.trim();
      if (!newName || newName === entry.name) return;
      const oldKey = currentKey;
      const newKey = dbNormKey(newName);
      entry.name = newName;
      const payload = { ...entry, updated: Date.now() };
      dbSetEntry(type, newKey, payload, (ok, saveErr) => {
        if (!ok) {
          st.textContent = `Rename failed: ${saveErr}`;
          st.style.color = '#c0392b';
          setTimeout(() => { st.textContent = ''; st.style.color = ''; }, 3000);
          return;
        }
        if (newKey !== oldKey) dbDeleteEntry(type, oldKey, () => {});
        currentKey = newKey;
        nameEl.dataset.key = newKey;
        st.textContent = '✓ Renamed';
        setTimeout(() => { st.textContent = ''; }, 1500);
      });
    }

    nameEl.onkeydown = e => {
      if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
      if (e.key === 'Escape') { nameEl.textContent = entry.name; nameEl.blur(); }
    };
    nameEl.onblur = doRename;

    // Save notes
    let timer;
    ta.oninput = () => {
      st.textContent = '●';
      st.style.color = '';
      clearTimeout(timer);
      timer = setTimeout(() => {
        dbSetEntry(type, currentKey, { ...entry, notes: ta.value, updated: Date.now() }, (ok, saveErr) => {
          if (ok) {
            st.textContent = '✓';
            st.style.color = '';
          } else {
            st.textContent = `Save failed: ${saveErr}`;
            st.style.color = '#c0392b';
          }
          setTimeout(() => { st.textContent = ''; st.style.color = ''; }, 3000);
        });
      }, 600);
    };
  });
}

let _dbPanel = null;

function getOrCreateDbPanel() {
  if (_dbPanel && document.body.contains(_dbPanel)) return _dbPanel;

  const panel = document.createElement('div');
  panel.className = 'tr-db-panel';
  panel.innerHTML = `
    <div class="tr-db-header">
      <div class="tr-db-tabs">
        <button class="tr-db-tab active" data-type="competitors">Competitors</button>
        <button class="tr-db-tab" data-type="judges">Judges</button>
      </div>
      <div class="tr-db-mode-toggle">
        <button class="tr-db-mode active" data-mode="personal">Mine</button>
        <button class="tr-db-mode" data-mode="group">Group</button>
      </div>
      <button class="tr-db-close" title="Close">×</button>
    </div>
    <div class="tr-db-group-bar" style="display:none">
      <div class="tr-db-group-no-group">
        <input class="tr-db-group-input" placeholder="Enter code…" maxlength="10" />
        <button class="tr-db-group-join-btn">Join</button>
        <button class="tr-db-group-create-btn">New</button>
      </div>
      <div class="tr-db-group-has-group" style="display:none">
        Code: <strong class="tr-db-group-code-display"></strong>
        <button class="tr-db-group-copy-btn" title="Copy code">Copy</button>
        <button class="tr-db-group-leave-btn">Leave</button>
      </div>
    </div>
    <div class="tr-db-list-view">
      <input class="tr-db-search" type="text" placeholder="Search…" />
      <div class="tr-db-list"></div>
    </div>
    <div class="tr-db-editor" style="display:none">
      <div class="tr-db-ed-bar">
        <button class="tr-db-back">← Back</button>
        <span class="tr-db-ed-name" contenteditable="true" spellcheck="false"></span>
        <button class="tr-db-delete" title="Delete note">Delete</button>
      </div>
      <div class="tr-db-ed-status"></div>
      <textarea class="tr-db-ed-area" placeholder="Your notes…"></textarea>
    </div>
  `;

  getAuth().catch(() => {});

  let currentType = 'competitors';

  function rerender() {
    panel.querySelector('.tr-db-editor').style.display = 'none';
    panel.querySelector('.tr-db-list-view').style.display = '';
    const filter = panel.querySelector('.tr-db-search').value;
    if (_panelMode === 'group' && _panelGroupCode) {
      renderGroupList(panel, currentType, filter, _panelGroupCode);
    } else if (_panelMode === 'group') {
      panel.querySelector('.tr-db-list').innerHTML = `<div class="tr-db-empty">Join or create a group above.</div>`;
    } else {
      renderDbList(panel, currentType, filter);
    }
  }

  function updateGroupBar() {
    const bar = panel.querySelector('.tr-db-group-bar');
    const noGroup = panel.querySelector('.tr-db-group-no-group');
    const hasGroup = panel.querySelector('.tr-db-group-has-group');
    if (_panelMode === 'group') {
      bar.style.display = '';
      if (_panelGroupCode) {
        noGroup.style.display = 'none';
        hasGroup.style.display = '';
        panel.querySelector('.tr-db-group-code-display').textContent = _panelGroupCode;
      } else {
        noGroup.style.display = '';
        hasGroup.style.display = 'none';
      }
    } else {
      bar.style.display = 'none';
    }
  }

  function saveState() {
    savePrefs({ mode: _panelMode, type: _panelType, groupCode: _panelGroupCode || null, lastKey: null, lastName: null, lastUid: null });
  }

  // Mode toggle
  panel.querySelectorAll('.tr-db-mode').forEach(btn => {
    btn.addEventListener('click', () => {
      panel.querySelectorAll('.tr-db-mode').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _panelMode = btn.dataset.mode;
      updateGroupBar();
      updateNoteButtons();
      saveState();
      rerender();
    });
  });

  // Group join
  panel.querySelector('.tr-db-group-join-btn').addEventListener('click', () => {
    const code = panel.querySelector('.tr-db-group-input').value.trim().toUpperCase();
    if (!code) return;
    const st = panel.querySelector('.tr-db-list');
    st.innerHTML = `<div class="tr-db-empty">Joining…</div>`;
    groupJoin(code)
      .then(() => { updateGroupBar(); saveState(); rerender(); })
      .catch(err => { st.innerHTML = `<div class="tr-db-error">Join failed: ${err.message}</div>`; });
  });

  // Group create
  panel.querySelector('.tr-db-group-create-btn').addEventListener('click', () => {
    const st = panel.querySelector('.tr-db-list');
    st.innerHTML = `<div class="tr-db-empty">Creating…</div>`;
    groupCreate()
      .then(() => { updateGroupBar(); saveState(); rerender(); })
      .catch(err => { st.innerHTML = `<div class="tr-db-error">Create failed: ${err.message}</div>`; });
  });

  // Group copy code
  panel.querySelector('.tr-db-group-copy-btn').addEventListener('click', () => {
    if (_panelGroupCode) navigator.clipboard.writeText(_panelGroupCode).catch(() => {});
  });

  // Group leave
  panel.querySelector('.tr-db-group-leave-btn').addEventListener('click', () => {
    groupLeave().then(() => { updateGroupBar(); saveState(); rerender(); });
  });

  // Tabs
  panel.querySelectorAll('.tr-db-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      panel.querySelectorAll('.tr-db-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentType = tab.dataset.type;
      _panelType = currentType;
      saveState();
      rerender();
    });
  });

  panel.querySelector('.tr-db-search').addEventListener('input', rerender);

  panel.querySelector('.tr-db-back').addEventListener('click', () => { saveState(); rerender(); });

  panel.querySelector('.tr-db-delete').addEventListener('click', () => {
    const key = panel.querySelector('.tr-db-ed-name').dataset.key;
    if (!key) return;
    dbDeleteEntry(currentType, key, rerender);
  });

  panel.querySelector('.tr-db-close').addEventListener('click', () => {
    panel.style.display = 'none';
    document.querySelector('.tr-db-fab')?.style.removeProperty('display');
  });

  loadPrefs(prefs => {
    if (prefs) {
      if (prefs.groupCode) _panelGroupCode = prefs.groupCode;
      if (prefs.mode) {
        _panelMode = prefs.mode;
        panel.querySelectorAll('.tr-db-mode').forEach(b => b.classList.toggle('active', b.dataset.mode === _panelMode));
        updateNoteButtons();
      }
      if (prefs.type) {
        currentType = prefs.type;
        _panelType = prefs.type;
        panel.querySelectorAll('.tr-db-tab').forEach(t => t.classList.toggle('active', t.dataset.type === currentType));
      }
    }
    updateGroupBar();
    if (prefs?.lastKey) {
      if (_panelMode === 'group' && _panelGroupCode && prefs.lastUid) {
        getAuth().then(auth => openGroupEditor(panel, currentType, prefs.lastKey, prefs.lastUid, _panelGroupCode, prefs.lastUid === auth.uid, prefs.lastName));
      } else if (_panelMode !== 'group') {
        openDbEditor(panel, currentType, prefs.lastKey, prefs.lastName);
      } else {
        rerender();
      }
    } else {
      rerender();
    }
  });
  document.body.appendChild(panel);
  _dbPanel = panel;
  return panel;
}

function openNotesFor(type, name) {
  const panel = getOrCreateDbPanel();
  panel.style.display = '';
  document.querySelector('.tr-db-fab')?.style.setProperty('display', 'none');

  panel.querySelectorAll('.tr-db-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.type === type);
  });

  const key = dbNormKey(name);
  if (_panelMode === 'group' && _panelGroupCode) {
    getAuth().then(auth => openGroupEditor(panel, type, key, auth.uid, _panelGroupCode, true, name));
  } else {
    openDbEditor(panel, type, key, name);
  }
}

function injectDbFab() {
  if (document.querySelector('.tr-db-fab')) return;
  const fab = document.createElement('button');
  fab.className = 'tr-db-fab';
  fab.title = 'Open notes database';
  fab.textContent = 'Notes';
  fab.addEventListener('click', () => {
    const panel = getOrCreateDbPanel();
    const visible = panel.style.display !== 'none';
    panel.style.display = visible ? 'none' : '';
    if (!visible) {
      renderDbList(panel, panel.querySelector('.tr-db-tab.active').dataset.type,
        panel.querySelector('.tr-db-search').value);
    }
  });
  document.body.appendChild(fab);
}

function updateNoteButtonLabel(btn) {
  btn.textContent = '+';
  btn.classList.toggle('tr-opp-note-btn--group', _panelMode === 'group');
}

function updateNoteButtons() {
  document.querySelectorAll('.tr-opp-note-btn').forEach(updateNoteButtonLabel);
}

function injectOppNoteButtons() {
  if (!/\/user\/student\//i.test(location.pathname)) return;

  document.querySelectorAll('table').forEach(table => {
    const headers = [...table.querySelectorAll('tr:first-child th, tr:first-child td')];

    const injectCol = (colIdx, noteType) => {
      if (colIdx === -1) return;
      table.querySelectorAll('tr').forEach(row => {
        const cells = row.querySelectorAll('td');
        if (!cells.length || !cells[colIdx]) return;
        const cell = cells[colIdx];
        if (cell.querySelector('.tr-opp-note-btn')) return;
        const name = cell.textContent.trim();
        if (!name || /BYE/i.test(name)) return;

        const btn = document.createElement('button');
        btn.className = 'tr-opp-note-btn';
        btn.dataset.noteType = noteType;
        btn.title = `Notes for ${name}`;
        updateNoteButtonLabel(btn);
        btn.addEventListener('click', e => {
          e.stopPropagation();
          openNotesFor(noteType, name);
        });
        cell.appendChild(btn);
      });
    };

    injectCol(headers.findIndex(th => /^opp/i.test(th.textContent.trim())), 'competitors');
    injectCol(headers.findIndex(th => /^judge/i.test(th.textContent.trim())), 'judges');
  });
}

// ===== TOURNAMENT SUMMARY (count by round, not ballot) =====

function injectTournamentSummary() {
  if (!/\/user\/student\//i.test(location.pathname)) return;
  if (document.querySelector('.tr-summary-panel')) return;

  const tables = [...document.querySelectorAll('table')];
  let roundW = 0, roundL = 0, totalBye = 0;

  tables.forEach(table => {
    const headers = [...table.querySelectorAll('tr:first-child th, tr:first-child td')];
    const resultsIdx = headers.findIndex(th => /result|judge/i.test(th.textContent));

    table.querySelectorAll('tr').forEach(row => {
      const cells = row.querySelectorAll('td');
      if (!cells.length) return;
      if (/\bBYE\b/i.test(row.textContent)) { totalBye++; return; }
      const target = (resultsIdx !== -1 ? cells[resultsIdx] : null) ?? row;
      const text = target?.textContent || '';
      const w = (text.match(/\bW\b/g) || []).length;
      const l = (text.match(/\bL\b/g) || []).length;
      if (w > l) roundW++;
      else if (l > w) roundL++;
    });
  });

  if (roundW + roundL + totalBye === 0) return;

  const panel = document.createElement('div');
  panel.className = 'tr-summary-panel';
  const pct = roundW + roundL > 0 ? Math.round(100 * roundW / (roundW + roundL)) : null;
  panel.innerHTML = `
    <span class="tr-sum-label">Tournament record</span>
    <span class="tr-sum-wins">${roundW}W</span>
    <span class="tr-sum-losses">${roundL}L</span>
    ${totalBye ? `<span class="tr-sum-bye">${totalBye} BYE</span>` : ''}
    ${pct !== null ? `<span class="tr-sum-pct">${pct}% win rate</span>` : ''}
  `;

  const main = document.querySelector('div.main, div.mainfull');
  if (main) main.insertBefore(panel, main.firstChild);
}

function initExtras() {
  migrateOldNotes();
  injectDbFab();
  injectTournamentSummary();
  injectOppNoteButtons();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initExtras, { once: true });
} else {
  initExtras();
}
