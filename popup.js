const compact = document.getElementById('compact');
const themeRadios = document.querySelectorAll('input[name="theme"]');

chrome.storage.sync.get({ compact: false, theme: 'cool' }, (items) => {
  compact.checked = Boolean(items.compact);
  const radio = document.querySelector(`input[value="${items.theme}"]`);
  if (radio) radio.checked = true;
});

compact.addEventListener('change', () => {
  chrome.storage.sync.set({ compact: compact.checked });
});

themeRadios.forEach(r => {
  r.addEventListener('change', () => {
    chrome.storage.sync.set({ theme: r.value });
  });
});
