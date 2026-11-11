import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

const CAPTURE_OPTIONS = {
  scale: 2,
  backgroundColor: '#ffffff',
  useCORS: true,
  logging: false,
};

async function captureBlock(element) {
  const canvas = await html2canvas(element, CAPTURE_OPTIONS);
  return {
    dataUrl: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height,
  };
}

/** For geo blocks: hide Leaflet/OSM tiles and show the self-contained SVG schema. */
async function captureGeoBlock(element) {
  const map = element.querySelector('[data-pdf-ignore-map]');
  const schema = element.querySelector('[data-pdf-schema]');
  const prevHidden = schema ? schema.hidden : null;
  if (map) map.setAttribute('data-html2canvas-ignore', 'true');
  if (schema) schema.hidden = false;
  try {
    return await captureBlock(element);
  } finally {
    if (map) map.removeAttribute('data-html2canvas-ignore');
    if (schema && prevHidden != null) schema.hidden = prevHidden;
  }
}

function sizeForPage(block, usableWidth, usableHeight) {
  let drawW = usableWidth;
  let drawH = (block.height * drawW) / block.width;
  if (drawH > usableHeight) {
    const scale = usableHeight / drawH;
    drawW *= scale;
    drawH = usableHeight;
  }
  return { drawW, drawH };
}

export async function downloadAnalyticsPdf(element, filename) {
  const header =
    element.querySelector('[data-pdf-block="head"]') ||
    element.querySelector('.analytics-report__head');
  const geoBlocks = [...element.querySelectorAll('[data-pdf-block="geo"]')];
  const cards = [...element.querySelectorAll('[data-pdf-block="card"]')];
  const blocks = [];
  if (header) blocks.push(await captureBlock(header));
  for (const geo of geoBlocks) {
    blocks.push(await captureGeoBlock(geo));
  }
  for (const card of cards) {
    blocks.push(await captureBlock(card));
  }
  if (!blocks.length) {
    throw new Error('Нет блоков для PDF');
  }

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 12;
  const gap = 5;
  const usableWidth = pageWidth - margin * 2;
  const usableHeight = pageHeight - margin * 2;

  let cursorY = margin;

  for (const block of blocks) {
    const { drawW, drawH } = sizeForPage(block, usableWidth, usableHeight);
    const remaining = pageHeight - margin - cursorY;
    if (cursorY > margin && drawH > remaining) {
      pdf.addPage();
      cursorY = margin;
    }
    pdf.addImage(block.dataUrl, 'PNG', margin, cursorY, drawW, drawH, undefined, 'FAST');
    cursorY += drawH + gap;
  }

  pdf.save(filename);
}
