import manropeRegularUrl from '../assets/fonts/Manrope-Regular.ttf?url';
import manropeSemiBoldUrl from '../assets/fonts/Manrope-SemiBold.ttf?url';

const FONT_FAMILY = 'Manrope';

let fontBinaryCache = null;

function arrayBufferToBinaryString(buffer) {
  const bytes = new Uint8Array(buffer);
  let out = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return out;
}

async function fetchFontBinary(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Не удалось загрузить шрифт PDF (${res.status})`);
  }
  return arrayBufferToBinaryString(await res.arrayBuffer());
}

async function loadFontBinaries() {
  if (fontBinaryCache) return fontBinaryCache;
  const [regular, semibold] = await Promise.all([
    fetchFontBinary(manropeRegularUrl),
    fetchFontBinary(manropeSemiBoldUrl),
  ]);
  fontBinaryCache = { regular, semibold };
  return fontBinaryCache;
}

/** Register Manrope (with Cyrillic) on a jsPDF instance. Cached after first fetch. */
export async function ensurePdfFonts(pdf) {
  const fonts = await loadFontBinaries();
  pdf.addFileToVFS('Manrope-Regular.ttf', fonts.regular);
  pdf.addFileToVFS('Manrope-SemiBold.ttf', fonts.semibold);
  pdf.addFont('Manrope-Regular.ttf', FONT_FAMILY, 'normal');
  pdf.addFont('Manrope-SemiBold.ttf', FONT_FAMILY, 'bold');
  pdf.setFont(FONT_FAMILY, 'normal');
  return FONT_FAMILY;
}

export { FONT_FAMILY };
