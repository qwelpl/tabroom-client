const defaults = {
  mode: 'light',
  accent: '#0d6b89',
  compact: false,
};

function readSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(defaults, (settings) => {
      resolve({
        mode: settings.mode === 'dark' ? 'dark' : 'light',
        accent: settings.accent || defaults.accent,
        compact: Boolean(settings.compact),
      });
    });
  });
}

function applySettings(settings) {
  const root = document.documentElement;
  const dark = settings.mode === 'dark';

  root.style.setProperty('--theme-accent', settings.accent);
  root.style.setProperty('--theme-accent-soft', `${settings.accent}1a`);
  document.body.classList.toggle('tabroom-theme-dark', dark);
  document.body.classList.toggle('tabroom-theme-compact', settings.compact);
}

async function init() {
  if (!document.body) return;

  applySettings(await readSettings());
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (changes.mode || changes.accent || changes.compact) {
      readSettings().then(applySettings);
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
