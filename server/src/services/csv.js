/** CSV helpers for Excel-friendly export (UTF-8 BOM, `;` separator). */

export function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (/[;"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows) {
  return rows.map((row) => row.map(csvEscape).join(';')).join('\r\n');
}

/** UTF-8 BOM so Excel on Windows opens Cyrillic correctly */
export function csvWithBom(csvBody) {
  return `\uFEFF${csvBody}`;
}

export function safeFilename(name, fallback = 'opros') {
  const base = String(name || fallback)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 80);
  return base || fallback;
}
