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
  const header = element.querySelector('[data-pdf-block="head"]') || element.querySelector('.analytics-report__head');
  const cards = [...element.querySelectorAll('[data-pdf-block="card"], .analytics-card')];
  const blocks = [];
  if (header) blocks.push(await captureBlock(header));
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
