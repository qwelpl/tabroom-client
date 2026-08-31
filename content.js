function apply(settings) {
  if (document.body) {
    document.body.classList.toggle('tr-compact', Boolean(settings.compact));
  }
}

function swapLogo() {
  const img = document.querySelector('#logo img');
  if (img) {
    img.src = chrome.runtime.getURL('logo-light.jpg');
  }
}

chrome.storage.sync.get({ compact: false }, apply);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.compact !== undefined) {
    apply({ compact: changes.compact.newValue });
  }
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', swapLogo, { once: true });
} else {
  swapLogo();
}
