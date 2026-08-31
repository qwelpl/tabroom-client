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
    const headers = [...(table.querySelectorAll('thead th, thead td, tr:first-child th, tr:first-child td'))];
    if (!headers.length) return;

    let wIdx = -1, lIdx = -1;
    headers.forEach((th, i) => {
      const t = th.textContent.trim().toLowerCase();
      if (wIdx === -1 && (t === 'w' || t === 'wins' || t === 'win')) wIdx = i;
      if (lIdx === -1 && (t === 'l' || t === 'losses' || t === 'loss')) lIdx = i;
    });
    if (wIdx === -1 || lIdx === -1) return;

    table.querySelectorAll('tbody tr').forEach(row => {
      const cells = row.querySelectorAll('td');
      const w = parseFloat(cells[wIdx]?.textContent.trim());
      const l = parseFloat(cells[lIdx]?.textContent.trim());
      if (!isNaN(w) && !isNaN(l) && w > l) row.classList.add('tr-win-row');
    });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', highlightWinningRows, { once: true });
} else {
  highlightWinningRows();
}
