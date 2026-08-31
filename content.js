function apply(settings) {
  if (document.body) {
    document.body.classList.toggle('tr-compact', Boolean(settings.compact));
  }
}

chrome.storage.sync.get({ compact: false }, apply);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.compact !== undefined) {
    apply({ compact: changes.compact.newValue });
  }
});
