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

/**
 * Draw a captured HTML block scaled to page width.
 * Tall blocks continue on following pages. Returns next Y cursor.
 */
function addBlockPaginated(pdf, block, cursorY, { margin, gap, usableWidth, pageHeight }) {
  const drawW = usableWidth;
  const drawH = (block.height * drawW) / block.width;
  const pageContentHeight = pageHeight - margin * 2;
  const spaceLeft = pageHeight - margin - cursorY;

  if (cursorY > margin && drawH > spaceLeft) {
    pdf.addPage();
    cursorY = margin;
  }

  if (drawH <= pageHeight - margin - cursorY) {
    pdf.addImage(block.dataUrl, 'PNG', margin, cursorY, drawW, drawH, undefined, 'FAST');
    return cursorY + drawH + gap;
  }

  let heightLeft = drawH;
  let y = cursorY;
  pdf.addImage(block.dataUrl, 'PNG', margin, y, drawW, drawH, undefined, 'FAST');
  heightLeft -= pageHeight - margin - cursorY;

  while (heightLeft > 0.5) {
    y = margin - (drawH - heightLeft);
    pdf.addPage();
    pdf.addImage(block.dataUrl, 'PNG', margin, y, drawW, drawH, undefined, 'FAST');
    heightLeft -= pageContentHeight;
  }

  const remainder = ((drawH - (pageHeight - margin - cursorY)) % pageContentHeight + pageContentHeight) %
    pageContentHeight;
  if (remainder < 0.5) {
    pdf.addPage();
    return margin;
  }
  return margin + remainder + gap;
}

export async function downloadAnalyticsPdf(element, filename) {
  const header =
    element.querySelector('[data-pdf-block="head"]') ||
    element.querySelector('.analytics-report__head');
  const geoBlocks = [...element.querySelectorAll('[data-pdf-block="geo"]')];
  const cards = [...element.querySelectorAll('[data-pdf-block="card"]')];
  const sessionsHead = element.querySelector('[data-pdf-block="sessions-head"]');
  const sessions = [...element.querySelectorAll('[data-pdf-block="session"]')];

  const jobs = [];
  if (header) jobs.push({ type: 'normal', el: header });
  for (const geo of geoBlocks) jobs.push({ type: 'geo', el: geo });
  for (const card of cards) jobs.push({ type: 'normal', el: card });
  if (sessionsHead) jobs.push({ type: 'normal', el: sessionsHead });
  for (const session of sessions) jobs.push({ type: 'normal', el: session });

  if (!jobs.length) {
    throw new Error('Нет блоков для PDF');
  }

  const captured = [];
  for (const job of jobs) {
    captured.push(job.type === 'geo' ? await captureGeoBlock(job.el) : await captureBlock(job.el));
  }

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 12;
  const gap = 5;
  const usableWidth = pdf.internal.pageSize.getWidth() - margin * 2;

  let cursorY = margin;
  for (const block of captured) {
    cursorY = addBlockPaginated(pdf, block, cursorY, {
      margin,
      gap,
      usableWidth,
      pageHeight,
    });
  }

  pdf.save(filename);
}
