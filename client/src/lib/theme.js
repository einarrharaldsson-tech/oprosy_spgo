const STORAGE_KEY = 'oprosy.theme';

export function getStoredTheme() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    /* ignore */
  }
  // Если сохранённого нет — подстраиваемся под системную тему
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
}

/**
 * Применяет тему до первого рендера React (вызывается в main.jsx),
 * чтобы избежать «мигания» светлой темы при загрузке.
 */
export function initTheme() {
  const theme = getStoredTheme();
  document.documentElement.setAttribute('data-theme', theme);
  return theme;
}