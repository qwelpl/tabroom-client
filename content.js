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

function getPageCtx() {
  const p = new URLSearchParams(location.search);
  if (p.has('judge_person_id')) return { type: 'judge', id: p.get('judge_person_id'), label: 'Judge' };
  if (p.has('student_id'))      return { type: 'student', id: p.get('student_id'), label: 'Competitor', tournId: p.get('tourn_id') };
  if (p.has('entry_id'))        return { type: 'entry', id: p.get('entry_id'), label: 'Entry' };

  // student/index.mhtml — extract student_id from links on page
  if (/\/user\/student\//.test(location.pathname)) {
    const link = document.querySelector('a[href*="student_id="]');
    if (link) {
      const id = new URLSearchParams(link.href.split('?')[1]).get('student_id');
      if (id) return { type: 'student', id, label: 'Competitor' };
    }
    // fallback: use pathname as stable key
    return { type: 'student', id: 'me', label: 'Competitor' };
  }

  return null;
}

function injectNotes(ctx) {
  if (document.querySelector('.tr-notes-panel')) return;
  const key = `tr_notes_${ctx.type}_${ctx.id}`;

  const panel = document.createElement('div');
  panel.className = 'tr-notes-panel';
  panel.innerHTML = `
    <div class="tr-notes-bar">
      <span class="tr-notes-label">Notes</span>
      <span class="tr-notes-status"></span>
      <button class="tr-notes-toggle" type="button">hide</button>
    </div>
    <textarea class="tr-notes-area" placeholder="Notes for this ${ctx.label.toLowerCase()}…"></textarea>
  `;

  const ta = panel.querySelector('.tr-notes-area');
  const status = panel.querySelector('.tr-notes-status');
  const toggle = panel.querySelector('.tr-notes-toggle');

  chrome.storage.local.get({ [key]: '' }, d => {
    ta.value = d[key];
  });

  toggle.addEventListener('click', () => {
    const hidden = ta.style.display === 'none';
    ta.style.display = hidden ? '' : 'none';
    toggle.textContent = hidden ? 'hide' : 'show';
  });

  let timer;
  ta.addEventListener('input', () => {
    status.textContent = '●';
    clearTimeout(timer);
    timer = setTimeout(() => {
      chrome.storage.local.set({ [key]: ta.value }, () => {
        status.textContent = '✓';
        setTimeout(() => { status.textContent = ''; }, 1500);
      });
    }, 600);
  });

  const main = document.querySelector('div.main, div.mainfull');
  if (main) main.insertBefore(panel, main.firstChild);
}

function injectTournamentSummary() {
  if (!/\/user\/student\//i.test(location.pathname)) return;

  if (document.querySelector('.tr-summary-panel')) return;

  const tables = [...document.querySelectorAll('table')];
  let totalW = 0, totalL = 0, totalBye = 0;

  tables.forEach(table => {
    const resultsIdx = [...table.querySelectorAll('tr:first-child th, tr:first-child td')]
      .findIndex(th => /result|judge/i.test(th.textContent));

    table.querySelectorAll('tr').forEach(row => {
      const cells = row.querySelectorAll('td');
      if (!cells.length) return;
      const text = (resultsIdx !== -1 ? cells[resultsIdx] : row)?.textContent || '';
      if (/\bBYE\b/i.test(row.textContent)) { totalBye++; return; }
      totalW += (text.match(/\bW\b/g) || []).length;
      totalL += (text.match(/\bL\b/g) || []).length;
    });
  });

  if (totalW + totalL + totalBye === 0) return;

  const panel = document.createElement('div');
  panel.className = 'tr-summary-panel';
  const pct = totalW + totalL > 0 ? Math.round(100 * totalW / (totalW + totalL)) : null;
  panel.innerHTML = `
    <span class="tr-sum-label">Tournament record</span>
    <span class="tr-sum-wins">${totalW}W</span>
    <span class="tr-sum-losses">${totalL}L</span>
    ${totalBye ? `<span class="tr-sum-bye">${totalBye} BYE</span>` : ''}
    ${pct !== null ? `<span class="tr-sum-pct">${pct}% win rate</span>` : ''}
  `;

  const main = document.querySelector('div.main, div.mainfull');
  if (main) main.insertBefore(panel, main.firstChild);
}

function initExtras() {
  const ctx = getPageCtx();
  if (ctx) injectNotes(ctx);
  injectTournamentSummary();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initExtras, { once: true });
} else {
  initExtras();
}
