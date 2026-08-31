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
  const ed = panel.querySelector('.tr-db-editor');
  const st = panel.querySelector('.tr-db-ed-status');
  const nameEl = panel.querySelector('.tr-db-ed-name');
  const ta = panel.querySelector('.tr-db-ed-area');

  // currentKey is mutable — rename updates it so ta.oninput always writes to the right path
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
      <button class="tr-db-close" title="Close">×</button>
    </div>
    <div class="tr-db-sync-info">Syncing as: <span class="tr-db-email-key"></span></div>
    <div class="tr-db-list-view">
      <input class="tr-db-search" type="text" placeholder="Search…" />
      <div class="tr-db-list"></div>
    </div>
    <div class="tr-db-editor" style="display:none">
      <div class="tr-db-ed-bar">
        <button class="tr-db-back">← Back</button>
        <span class="tr-db-ed-name" contenteditable="true" spellcheck="false"></span>
        <span class="tr-db-ed-status"></span>
        <button class="tr-db-delete" title="Delete note">Delete</button>
      </div>
      <textarea class="tr-db-ed-area" placeholder="Your notes…"></textarea>
    </div>
  `;
  const emailKeyEl = panel.querySelector('.tr-db-email-key');
  emailKeyEl.textContent = detectEmail() || 'detecting…';
  getAuth().then(auth => { emailKeyEl.textContent = auth.email; })
           .catch(err => { emailKeyEl.textContent = `Error: ${err.message}`; });

  let currentType = 'competitors';

  panel.querySelectorAll('.tr-db-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      panel.querySelectorAll('.tr-db-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentType = tab.dataset.type;
      panel.querySelector('.tr-db-editor').style.display = 'none';
      panel.querySelector('.tr-db-list-view').style.display = '';
      renderDbList(panel, currentType, panel.querySelector('.tr-db-search').value);
    });
  });

  panel.querySelector('.tr-db-search').addEventListener('input', e =>
    renderDbList(panel, currentType, e.target.value));

  panel.querySelector('.tr-db-back').addEventListener('click', () => {
    panel.querySelector('.tr-db-editor').style.display = 'none';
    panel.querySelector('.tr-db-list-view').style.display = '';
    renderDbList(panel, currentType, panel.querySelector('.tr-db-search').value);
  });

  panel.querySelector('.tr-db-delete').addEventListener('click', () => {
    const key = panel.querySelector('.tr-db-ed-name').dataset.key;
    if (!key) return;
    dbDeleteEntry(currentType, key, () => {
      panel.querySelector('.tr-db-editor').style.display = 'none';
      panel.querySelector('.tr-db-list-view').style.display = '';
      renderDbList(panel, currentType, panel.querySelector('.tr-db-search').value);
    });
  });

  panel.querySelector('.tr-db-close').addEventListener('click', () => {
    panel.style.display = 'none';
    document.querySelector('.tr-db-fab')?.style.removeProperty('display');
  });

  renderDbList(panel, currentType, '');
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

  openDbEditor(panel, type, dbNormKey(name), name);
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

function injectOppNoteButtons() {
  if (!/\/user\/student\//i.test(location.pathname)) return;

  document.querySelectorAll('table').forEach(table => {
    const headers = [...table.querySelectorAll('tr:first-child th, tr:first-child td')];
    const oppIdx = headers.findIndex(th => /^opp/i.test(th.textContent.trim()));
    if (oppIdx === -1) return;

    table.querySelectorAll('tr').forEach(row => {
      const cells = row.querySelectorAll('td');
      if (!cells.length || !cells[oppIdx]) return;
      const cell = cells[oppIdx];
      if (cell.querySelector('.tr-opp-note-btn')) return;
      const name = cell.textContent.trim();
      if (!name || /BYE/i.test(name)) return;

      const btn = document.createElement('button');
      btn.className = 'tr-opp-note-btn';
      btn.title = `Notes for ${name}`;
      btn.textContent = '+';
      btn.addEventListener('click', e => {
        e.stopPropagation();
        openNotesFor('competitors', name);
      });
      cell.appendChild(btn);
    });
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
