import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import regularUrl from '../assets/fonts/Manrope-Regular.ttf?url';
import semiboldUrl from '../assets/fonts/Manrope-SemiBold.ttf?url';
import { readSessionsFromReport, writeSessions } from './pdfSessionText.js';

async function fontBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Не удалось загрузить шрифт отчёта');
  const bytes = new Uint8Array(await res.arrayBuffer());
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

async function registerReportFonts(pdf) {
  const [regular, semibold] = await Promise.all([fontBase64(regularUrl), fontBase64(semiboldUrl)]);
  pdf.addFileToVFS('Manrope-Regular.ttf', regular);
  pdf.addFont('Manrope-Regular.ttf', 'Manrope', 'normal');
  pdf.addFileToVFS('Manrope-SemiBold.ttf', semibold);
  pdf.addFont('Manrope-SemiBold.ttf', 'Manrope', 'bold');
  pdf.setFont('Manrope', 'normal');
}

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

/** Capture the geo block with an OpenStreetMap basemap. Fall back to the SVG schema. */
async function captureGeoBlock(element) {
  const map = element.querySelector('[data-pdf-map]');
  const schema = element.querySelector('[data-pdf-schema]');
  const prevHidden = schema ? schema.hidden : null;
  let overlay = null;
  let points = [];
  try {
    points = JSON.parse(map?.getAttribute('data-points') || '[]');
  } catch {
    points = [];
  }

  let useSchema = !map || !points.length;
  if (!useSchema) {
    try {
      const { renderOsmBasemap } = await import('./osmBasemap.js');
      const cssWidth = map.clientWidth || 640;
      const cssHeight = map.clientHeight || 300;
      const dataUrl = await renderOsmBasemap(points, cssWidth, cssHeight);
      overlay = document.createElement('img');
      overlay.src = dataUrl;
      overlay.alt = 'Карта мест проведения';
      overlay.className = 'geo-map geo-map--analytics';
      overlay.style.height = `${cssHeight}px`;
      overlay.style.objectFit = 'cover';
      map.insertAdjacentElement('afterend', overlay);
      if (overlay.decode) await overlay.decode();
      if (schema) schema.hidden = true;
    } catch {
      overlay?.remove();
      overlay = null;
      useSchema = true;
    }
  }

  if (map) map.setAttribute('data-html2canvas-ignore', 'true');
  if (useSchema && schema) schema.hidden = false;
  try {
    return await captureBlock(element);
  } finally {
    overlay?.remove();
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
  const sessionModel = readSessionsFromReport(element);

  const jobs = [];
  if (header) jobs.push({ type: 'normal', el: header });
  for (const geo of geoBlocks) jobs.push({ type: 'geo', el: geo });
  for (const card of cards) jobs.push({ type: 'normal', el: card });

  if (!jobs.length && !sessionModel.sessions.length) {
    throw new Error('Нет блоков для PDF');
  }

  const captured = [];
  for (const job of jobs) {
    captured.push(job.type === 'geo' ? await captureGeoBlock(job.el) : await captureBlock(job.el));
  }

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  await registerReportFonts(pdf);
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

  writeSessions(pdf, sessionModel, cursorY, { margin, pageHeight, usableWidth });

  pdf.save(filename);
}
