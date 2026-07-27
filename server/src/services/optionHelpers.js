/** Detect "Другое / Other" choice options that need free-text input. */
export function isOtherOptionText(text) {
  // JS \b is ASCII-only and breaks Cyrillic ("Другое (укажите)" would not match).
  const t = String(text || '')
    .trim()
    .replace(/^\d+\.\s+/, '');
  return /^другое/i.test(t);
}

export function formatOptionAnswer(optionText, textValue) {
  const opt = String(optionText || '').trim();
  const extra = String(textValue || '').trim();
  if (opt && extra) return `${opt}: ${extra}`;
  return opt || extra || '';
}
