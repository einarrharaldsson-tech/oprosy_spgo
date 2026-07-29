const KEY = 'oprosy_offline_conduct_log';
const MAX_ITEMS = 200;

function readRaw() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRaw(items) {
  localStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
}

export function appendOfflineLog(message, meta = {}) {
  const items = readRaw();
  items.unshift({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    at: new Date().toISOString(),
    message,
    meta,
  });
  writeRaw(items);
}

export function getOfflineLogItems() {
  return readRaw();
}

export function clearOfflineLog() {
  localStorage.removeItem(KEY);
}
