import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

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

/**
 * Force black ink on the report header so soft/muted theme colors
 * stay readable on the white PDF page background.
 */
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
 * Session Q&A for PDF: no panel/background — plain black text on white.
 */
async function capturePlainTextBlock(element) {
  const touched = [];
  const all = [element, ...element.querySelectorAll('*')];
  for (const el of all) {
    touched.push({ el, snap: snapshotStyles(el) });
    el.style.background = 'transparent';
    el.style.backgroundColor = 'transparent';
    el.style.border = 'none';
    el.style.borderRadius = '0';
    el.style.boxShadow = 'none';
    el.style.color = '#111111';
  }
  element.style.padding = '0';
  try {
    return await captureBlock(element);
  } finally {
    for (const item of touched) restoreStyles(item.el, item.snap);
  }
}

/**
 * Place a captured block on the PDF, starting a new page when needed.
 * Tall blocks are cropped into page-sized strips (no overlapping/duplication).
 */
async function addBlockPaginated(pdf, block, cursorY, { margin, gap, usableWidth, pageHeight }) {
  const drawW = usableWidth;
  const drawH = (block.height * drawW) / block.width;
  const pageContentHeight = pageHeight - margin * 2;
  // Avoid starting a fragment in a tiny leftover strip (cuts mid-line).
  const minUseful = Math.min(28, pageContentHeight * 0.35);

  if (cursorY > margin && (drawH > pageHeight - margin - cursorY || pageHeight - margin - cursorY < minUseful)) {
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

async function captureJob(job) {
  if (job.type === 'head') return captureHeadBlock(job.el);
  if (job.type === 'plain') return capturePlainTextBlock(job.el);
  return captureBlock(job.el);
}

export async function downloadAnalyticsPdf(element, filename) {
  const header =
    element.querySelector('[data-pdf-block="head"]') ||
    element.querySelector('.analytics-report__head');
  const geoBlocks = [...element.querySelectorAll('[data-pdf-block="geo"]')];
  const cards = [...element.querySelectorAll('[data-pdf-block="card"]')];
  const sessionsHead = element.querySelector('[data-pdf-block="sessions-head"]');
  // Prefer fine-grained session pieces so page breaks fall between Q&As.
  const sessionMetas = [...element.querySelectorAll('[data-pdf-block="session-meta"]')];
  const sessionQas = [...element.querySelectorAll('[data-pdf-block="session-qa"]')];
  const legacySessions = [...element.querySelectorAll('[data-pdf-block="session"]')];

  const jobs = [];
  if (header) jobs.push({ type: 'head', el: header, gap: 5 });
  for (const geo of geoBlocks) jobs.push({ type: 'normal', el: geo, gap: 5 });
  for (const card of cards) jobs.push({ type: 'normal', el: card, gap: 5 });
  if (sessionsHead) jobs.push({ type: 'plain', el: sessionsHead, gap: 6 });

  if (sessionMetas.length || sessionQas.length) {
    // Walk DOM order: meta and qa appear interleaved per session.
    const ordered = [
      ...element.querySelectorAll(
        '[data-pdf-block="session-meta"], [data-pdf-block="session-qa"]'
      ),
    ];
    for (const el of ordered) {
      const kind = el.getAttribute('data-pdf-block');
      jobs.push({
        type: 'plain',
        el,
        gap: kind === 'session-meta' ? 3 : 2.5,
        beforeGap: kind === 'session-meta' ? 4 : 0,
      });
    }
  } else {
    for (const session of legacySessions) {
      jobs.push({ type: 'plain', el: session, gap: 5 });
    }
  }

  if (!jobs.length) {
    throw new Error('Нет блоков для PDF');
  }

  const captured = [];
  for (const job of jobs) {
    const block = await captureJob(job);
    captured.push({ ...block, gap: job.gap ?? 5, beforeGap: job.beforeGap ?? 0 });
  }

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 12;
  const usableWidth = pdf.internal.pageSize.getWidth() - margin * 2;

  let cursorY = margin;
  for (const block of captured) {
    if (block.beforeGap && cursorY > margin) {
      cursorY += block.beforeGap;
      if (cursorY > pageHeight - margin - 20) {
        pdf.addPage();
        cursorY = margin;
      }
    }
    cursorY = await addBlockPaginated(pdf, block, cursorY, {
      margin,
      gap: block.gap,
      usableWidth,
      pageHeight,
    });
  }

  pdf.save(filename);
}
