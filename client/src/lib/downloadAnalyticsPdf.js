import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { ensurePdfFonts, FONT_FAMILY } from './pdfFonts';

const CAPTURE_OPTIONS = {
  scale: 2,
  backgroundColor: '#ffffff',
  useCORS: true,
  logging: false,
};

const STYLE_KEYS = [
  'color',
  'background',
  'backgroundColor',
  'border',
  'borderRadius',
  'boxShadow',
  'padding',
];

function snapshotStyles(el) {
  const snap = {};
  for (const key of STYLE_KEYS) snap[key] = el.style[key];
  return snap;
}

function restoreStyles(el, snap) {
  for (const key of STYLE_KEYS) el.style[key] = snap[key] || '';
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Не удалось подготовить фрагмент PDF'));
    img.src = dataUrl;
  });
}

async function captureBlock(element) {
  const canvas = await html2canvas(element, CAPTURE_OPTIONS);
  return {
    dataUrl: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height,
  };
}

/** Force black ink on themed header before raster capture. */
async function captureHeadBlock(element) {
  const touched = [];
  const targets = [
    element,
    ...element.querySelectorAll(
      '.analytics-report__kicker, .analytics-report__survey, .muted, p, h3'
    ),
  ];
  for (const el of targets) {
    touched.push({ el, snap: snapshotStyles(el) });
    el.style.color = '#111111';
  }
  try {
    return await captureBlock(element);
  } finally {
    for (const item of touched) restoreStyles(item.el, item.snap);
  }
}

/**
 * Place a captured image block on the PDF, cropping tall images into page strips.
 */
async function addBlockPaginated(pdf, block, cursorY, { margin, gap, usableWidth, pageHeight }) {
  const drawW = usableWidth;
  const drawH = (block.height * drawW) / block.width;
  const pageContentHeight = pageHeight - margin * 2;
  const minUseful = Math.min(28, pageContentHeight * 0.35);

  if (
    cursorY > margin &&
    (drawH > pageHeight - margin - cursorY || pageHeight - margin - cursorY < minUseful)
  ) {
    pdf.addPage();
    cursorY = margin;
  }

  if (drawH <= pageHeight - margin - cursorY + 0.05) {
    pdf.addImage(block.dataUrl, 'PNG', margin, cursorY, drawW, drawH, undefined, 'FAST');
    return cursorY + drawH + gap;
  }

  const img = await loadImage(block.dataUrl);
  const pxPerMm = block.width / drawW;
  let srcY = 0;
  let remainingPx = block.height;
  let y = cursorY;

  while (remainingPx > 0.5) {
    const spaceMm = pageHeight - margin - y;
    if (spaceMm < minUseful && y > margin) {
      pdf.addPage();
      y = margin;
      continue;
    }
    const slicePx = Math.min(remainingPx, Math.max(1, spaceMm * pxPerMm));
    const sliceMm = slicePx / pxPerMm;

    const sliceCanvas = document.createElement('canvas');
    sliceCanvas.width = block.width;
    sliceCanvas.height = Math.max(1, Math.round(slicePx));
    const ctx = sliceCanvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
    ctx.drawImage(
      img,
      0,
      srcY,
      block.width,
      slicePx,
      0,
      0,
      block.width,
      sliceCanvas.height
    );

    pdf.addImage(
      sliceCanvas.toDataURL('image/png'),
      'PNG',
      margin,
      y,
      drawW,
      sliceMm,
      undefined,
      'FAST'
    );

    srcY += slicePx;
    remainingPx -= slicePx;

    if (remainingPx > 0.5) {
      pdf.addPage();
      y = margin;
    } else {
      y += sliceMm + gap;
    }
  }

  return y;
}

function ensureSpace(pdf, cursorY, needMm, { margin, pageHeight }) {
  if (cursorY > margin && cursorY + needMm > pageHeight - margin) {
    pdf.addPage();
    return margin;
  }
  return cursorY;
}

function writeWrappedLines(pdf, lines, x, cursorY, lineHeight, opts) {
  let y = cursorY;
  for (const line of lines) {
    y = ensureSpace(pdf, y, lineHeight, opts);
    pdf.text(line, x, y + lineHeight * 0.8);
    y += lineHeight;
  }
  return y;
}

/**
 * Native-text sessions: fast, searchable, clean page breaks between Q&A.
 * @returns next Y cursor
 */
export function appendSessionsText(pdf, sessions, cursorY, layout) {
  const { margin, usableWidth, pageHeight } = layout;
  const opts = { margin, pageHeight };
  let y = cursorY;

  y = ensureSpace(pdf, y, 10, opts);
  if (y > margin) y += 4;

  pdf.setFont(FONT_FAMILY, 'bold');
  pdf.setFontSize(13);
  pdf.setTextColor(17, 17, 17);
  y = ensureSpace(pdf, y, 8, opts);
  pdf.text('Все проведения', margin, y + 5);
  y += 10;

  for (let i = 0; i < sessions.length; i += 1) {
    const session = sessions[i];
    const headParts = [`Проведение #${session.sessionNumber}`];
    if (session.createdAtLabel) headParts.push(session.createdAtLabel);
    const head = headParts.join('  ·  ');

    pdf.setFont(FONT_FAMILY, 'bold');
    pdf.setFontSize(11);
    const headLines = pdf.splitTextToSize(head, usableWidth);
    const headBlockH = headLines.length * 5.5 + (session.geoLabel ? 5 : 0) + 4;
    y = ensureSpace(pdf, y, Math.min(headBlockH, 24), opts);
    if (i > 0) y += 3;

    y = writeWrappedLines(pdf, headLines, margin, y, 5.5, opts);

    if (session.geoLabel) {
      pdf.setFont(FONT_FAMILY, 'normal');
      pdf.setFontSize(9);
      const geoLines = pdf.splitTextToSize(`Геометка: ${session.geoLabel}`, usableWidth);
      y = writeWrappedLines(pdf, geoLines, margin, y, 4.5, opts);
    }

    y += 1.5;

    for (const qa of session.answers || []) {
      pdf.setFont(FONT_FAMILY, 'bold');
      pdf.setFontSize(10);
      const qLines = pdf.splitTextToSize(String(qa.question || ''), usableWidth);

      pdf.setFont(FONT_FAMILY, 'normal');
      pdf.setFontSize(10);
      const aLines = pdf.splitTextToSize(String(qa.answer || '—'), usableWidth);

      const blockH = qLines.length * 5 + aLines.length * 5 + 3;
      y = ensureSpace(pdf, y, Math.min(blockH, 22), opts);

      pdf.setFont(FONT_FAMILY, 'bold');
      pdf.setFontSize(10);
      y = writeWrappedLines(pdf, qLines, margin, y, 5, opts);

      pdf.setFont(FONT_FAMILY, 'normal');
      pdf.setFontSize(10);
      y = writeWrappedLines(pdf, aLines, margin, y, 5, opts);
      y += 2.5;
    }
  }

  return y;
}

/**
 * Build analytics PDF.
 * Visual blocks (header/geo/charts) are captured from the DOM;
 * session answers are written as native text for speed and clean pagination.
 *
 * @param {HTMLElement} element report root
 * @param {string} filename
 * @param {{ sessions?: Array }} [options]
 */
export async function downloadAnalyticsPdf(element, filename, options = {}) {
  const sessions = Array.isArray(options.sessions) ? options.sessions : [];

  const header =
    element.querySelector('[data-pdf-block="head"]') ||
    element.querySelector('.analytics-report__head');
  const geoBlocks = [...element.querySelectorAll('[data-pdf-block="geo"]')];
  const cards = [...element.querySelectorAll('[data-pdf-block="card"]')];

  const jobs = [];
  if (header) jobs.push({ type: 'head', el: header, gap: 5 });
  for (const geo of geoBlocks) jobs.push({ type: 'normal', el: geo, gap: 5 });
  for (const card of cards) jobs.push({ type: 'normal', el: card, gap: 5 });

  if (!jobs.length && !sessions.length) {
    throw new Error('Нет блоков для PDF');
  }

  const captured = [];
  for (const job of jobs) {
    const block =
      job.type === 'head' ? await captureHeadBlock(job.el) : await captureBlock(job.el);
    captured.push({ ...block, gap: job.gap ?? 5 });
  }

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  await ensurePdfFonts(pdf);

  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 12;
  const usableWidth = pdf.internal.pageSize.getWidth() - margin * 2;
  const layout = { margin, usableWidth, pageHeight };

  let cursorY = margin;
  for (const block of captured) {
    cursorY = await addBlockPaginated(pdf, block, cursorY, {
      margin,
      gap: block.gap,
      usableWidth,
      pageHeight,
    });
  }

  if (sessions.length) {
    appendSessionsText(pdf, sessions, cursorY, layout);
  }

  pdf.save(filename);
}
