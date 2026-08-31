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
  if (!/\/user\/student\//i.test(location.pathname)) return;

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
