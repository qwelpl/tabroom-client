const compact = document.getElementById('compact');

chrome.storage.sync.get({ compact: false }, (items) => {
  compact.checked = Boolean(items.compact);
});

compact.addEventListener('change', () => {
  chrome.storage.sync.set({ compact: compact.checked });
});
