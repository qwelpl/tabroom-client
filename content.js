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

// ===== NOTES + OPPONENT PERFORMANCE =====

// ===== NOTES DATABASE =====

const TR_DB_KEYS = { competitors: 'tr_db_v1_competitors', judges: 'tr_db_v1_judges' };

function dbNormKey(name) { return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'); }

function dbLoad(type, cb) {
  chrome.storage.local.get({ [TR_DB_KEYS[type]]: {} }, d => cb(d[TR_DB_KEYS[type]]));
}

function dbSave(type, data, cb) {
  chrome.storage.local.set({ [TR_DB_KEYS[type]]: data }, cb);
}

function renderDbList(panel, type, filter) {
  dbLoad(type, db => {
    const list = panel.querySelector('.tr-db-list');
    const entries = Object.values(db)
      .filter(e => !filter || e.name.toLowerCase().includes(filter.toLowerCase()))
      .sort((a, b) => (b.updated || 0) - (a.updated || 0));
    if (!entries.length) {
      list.innerHTML = `<div class="tr-db-empty">No ${type} notes yet.</div>`;
      return;
    }
    list.innerHTML = entries.map(e => `
      <div class="tr-db-row" data-key="${dbNormKey(e.name)}" data-type="${type}">
        <div class="tr-db-row-name">${e.name}</div>
        <div class="tr-db-row-preview">${(e.notes || '').slice(0, 80) || '—'}</div>
      </div>
    `).join('');
    list.querySelectorAll('.tr-db-row').forEach(row => {
      row.addEventListener('click', () =>
        openDbEditor(panel, row.dataset.type, row.dataset.key));
    });
  });
}

function openDbEditor(panel, type, key, name) {
  dbLoad(type, db => {
    const entry = db[key] || { name: name || key, notes: '', updated: 0 };
    panel.querySelector('.tr-db-list-view').style.display = 'none';
    const ed = panel.querySelector('.tr-db-editor');
    ed.style.display = '';
    panel.querySelector('.tr-db-ed-name').textContent = entry.name;
    const ta = panel.querySelector('.tr-db-ed-area');
    const st = panel.querySelector('.tr-db-ed-status');
    ta.value = entry.notes;
    st.textContent = '';
    let timer;
    ta.oninput = () => {
      st.textContent = '●';
      clearTimeout(timer);
      timer = setTimeout(() => {
        dbLoad(type, db2 => {
          db2[key] = { ...entry, notes: ta.value, updated: Date.now() };
          dbSave(type, db2, () => {
            st.textContent = '✓';
            setTimeout(() => st.textContent = '', 1500);
          });
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
    <div class="tr-db-list-view">
      <input class="tr-db-search" type="text" placeholder="Search…" />
      <div class="tr-db-list"></div>
    </div>
    <div class="tr-db-editor" style="display:none">
      <div class="tr-db-ed-bar">
        <button class="tr-db-back">← Back</button>
        <span class="tr-db-ed-name"></span>
        <span class="tr-db-ed-status"></span>
      </div>
      <textarea class="tr-db-ed-area" placeholder="Your notes…"></textarea>
    </div>
  `;

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

  // switch tab
  panel.querySelectorAll('.tr-db-tab').forEach(t => {
    const active = t.dataset.type === type;
    t.classList.toggle('active', active);
  });
  panel.querySelector('.tr-db-list-view').style.display = 'none';

  const key = dbNormKey(name);
  dbLoad(type, db => {
    if (!db[key]) db[key] = { name, notes: '', updated: Date.now() };
    dbSave(type, db, () => openDbEditor(panel, type, key, name));
  });
}

function injectDbFab() {
  if (document.querySelector('.tr-db-fab')) return;
  const fab = document.createElement('button');
  fab.className = 'tr-db-fab';
  fab.title = 'Open notes database';
  fab.textContent = '📋';
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
      btn.textContent = '📝';
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
  injectDbFab();
  injectTournamentSummary();
  injectOppNoteButtons();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initExtras, { once: true });
} else {
  initExtras();
}
