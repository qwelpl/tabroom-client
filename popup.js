const defaults = {
  mode: 'light',
  accent: '#4f46e5',
  compact: false,
};

const themeMode = document.getElementById('themeMode');
const accentColor = document.getElementById('accentColor');
const compactMode = document.getElementById('compactMode');

function saveSettings() {
  const settings = {
    mode: themeMode.value,
    accent: accentColor.value,
    compact: compactMode.checked,
  };

  chrome.storage.sync.set(settings);
}

function restoreSettings() {
  chrome.storage.sync.get(defaults, (items) => {
    themeMode.value = items.mode || defaults.mode;
    accentColor.value = items.accent || defaults.accent;
    compactMode.checked = Boolean(items.compact);
  });
}

themeMode.addEventListener('change', saveSettings);
accentColor.addEventListener('input', saveSettings);
compactMode.addEventListener('change', saveSettings);

restoreSettings();
