/** API base, e.g. /api or /oprosy/api */
export function getApiBase() {
  const base = import.meta.env.BASE_URL || '/';
  return `${base}api`.replace(/\/{2,}/g, '/');
}
