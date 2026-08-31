const defaults = {
  mode: 'light',
  accent: '#0d6b89',
  compact: false,
};

const styleId = 'tabroom-theme-style';
const rootId = 'tabroom-theme-root';

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(defaults, (items) => {
      resolve({
        mode: items.mode || defaults.mode,
        accent: items.accent || defaults.accent,
        compact: Boolean(items.compact),
      });
    });
  });
}

function ensureVariables() {
  if (!document.getElementById(rootId)) {
    const root = document.createElement('div');
    root.id = rootId;
    root.setAttribute('aria-hidden', 'true');
    document.body.appendChild(root);
  }
}

function applyTheme(settings) {
  const accent = settings.accent || defaults.accent;
  const isCompact = settings.compact;
  const isDark = settings.mode === 'dark';

  const colors = isDark
    ? {
        bg: '#0f172a',
        surface: '#111827',
        surfaceAlt: '#1f2937',
        panel: '#0b1220',
        text: '#e5e7eb',
        muted: '#9ca3af',
        border: '#374151',
        link: '#93c5fd',
        shadow: 'rgba(15, 23, 42, 0.35)',
      }
    : {
        bg: '#f5f7fb',
        surface: '#ffffff',
        surfaceAlt: '#eef3ff',
        panel: '#f8fafc',
        text: '#1f2937',
        muted: '#6b7280',
        border: '#dfe5ee',
        link: '#2547d7',
        shadow: 'rgba(15, 23, 42, 0.08)',
      };

  document.documentElement.style.setProperty('--tabroom-bg', colors.bg);
  document.documentElement.style.setProperty('--tabroom-surface', colors.surface);
  document.documentElement.style.setProperty('--tabroom-surface-alt', colors.surfaceAlt);
  document.documentElement.style.setProperty('--tabroom-panel', colors.panel);
  document.documentElement.style.setProperty('--tabroom-text', colors.text);
  document.documentElement.style.setProperty('--tabroom-muted', colors.muted);
  document.documentElement.style.setProperty('--tabroom-border', colors.border);
  document.documentElement.style.setProperty('--tabroom-link', colors.link);
  document.documentElement.style.setProperty('--tabroom-shadow', colors.shadow);
  document.documentElement.style.setProperty('--tabroom-accent', accent);
  document.documentElement.style.setProperty('--tabroom-accent-soft', `${accent}1a`);
  document.documentElement.style.setProperty('--tabroom-compact', isCompact ? '0.92' : '1');

  document.body.classList.toggle('tabroom-theme-dark', isDark);
  document.body.classList.toggle('tabroom-theme-compact', isCompact);
  document.body.dataset.tabroomTheme = settings.mode;
}

function injectThemeStyles() {
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    :root {
      --tabroom-bg: #f5f7fb;
      --tabroom-surface: #ffffff;
      --tabroom-surface-alt: #eef3ff;
      --tabroom-panel: #f8fafc;
      --tabroom-text: #1f2937;
      --tabroom-muted: #6b7280;
      --tabroom-border: #dfe5ee;
      --tabroom-link: #2547d7;
      --tabroom-shadow: rgba(15, 23, 42, 0.08);
      --tabroom-accent: #4f46e5;
      --tabroom-accent-soft: rgba(79, 70, 229, 0.12);
      --tabroom-compact: 1;
    }

    body {
      background: var(--tabroom-bg) !important;
      color: var(--tabroom-text) !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
    }

    body,
    body * {
      box-sizing: border-box;
    }

    a,
    a:visited {
      color: var(--tabroom-link) !important;
    }

    table,
    th,
    td,
    tr,
    thead,
    tbody,
    tfoot,
    input,
    select,
    textarea,
    button,
    .button,
    .btn,
    .card,
    .panel,
    .box,
    .content,
    .main,
    .page,
    .section,
    .row,
    .col,
    .column,
    .sidebar {
      border-color: var(--tabroom-border) !important;
    }

    table {
      border-collapse: separate !important;
      border-spacing: 0 !important;
      background: var(--tabroom-surface) !important;
      border-radius: 14px !important;
      overflow: hidden !important;
      box-shadow: 0 8px 20px var(--tabroom-shadow) !important;
    }

    th,
    td {
      background: transparent !important;
      color: var(--tabroom-text) !important;
      padding: 12px 14px !important;
      border-bottom: 1px solid var(--tabroom-border) !important;
    }

    thead th {
      background: var(--tabroom-panel) !important;
      color: var(--tabroom-text) !important;
      font-weight: 700 !important;
      letter-spacing: 0.01em;
    }

    tbody tr:hover {
      background: var(--tabroom-surface-alt) !important;
    }

    input,
    select,
    textarea,
    button,
    .button,
    .btn {
      background: var(--tabroom-surface) !important;
      color: var(--tabroom-text) !important;
      border: 1px solid var(--tabroom-border) !important;
      border-radius: 10px !important;
      box-shadow: 0 1px 1px rgba(15, 23, 42, 0.02) !important;
      transition: border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease !important;
    }

    button,
    .button,
    .btn {
      background: linear-gradient(180deg, var(--tabroom-surface), var(--tabroom-panel)) !important;
      border-color: var(--tabroom-border) !important;
      font-weight: 600 !important;
    }

    button:hover,
    .button:hover,
    .btn:hover {
      border-color: var(--tabroom-accent) !important;
      box-shadow: 0 0 0 4px var(--tabroom-accent-soft) !important;
    }

    .card,
    .panel,
    .box,
    .section,
    .content,
    .page,
    .main,
    .sidebar,
    .row,
    .col,
    .column {
      background: var(--tabroom-surface) !important;
      color: var(--tabroom-text) !important;
      border: 1px solid var(--tabroom-border) !important;
      border-radius: 16px !important;
      box-shadow: 0 8px 24px var(--tabroom-shadow) !important;
    }

    .tabroom-theme-compact {
      --tabroom-compact: 0.92;
    }

    .tabroom-theme-compact table th,
    .tabroom-theme-compact table td,
    .tabroom-theme-compact .card,
    .tabroom-theme-compact .panel,
    .tabroom-theme-compact .box,
    .tabroom-theme-compact .section,
    .tabroom-theme-compact .content,
    .tabroom-theme-compact .page,
    .tabroom-theme-compact .main,
    .tabroom-theme-compact .sidebar {
      transform: scale(var(--tabroom-compact));
      transform-origin: top left;
    }
  `;
  document.head.appendChild(style);
}

async function init() {
  if (!document.body) return;

  ensureVariables();
  injectThemeStyles();

  const settings = await getSettings();
  applyTheme(settings);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (changes.mode || changes.accent || changes.compact) {
      getSettings().then(applyTheme);
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
