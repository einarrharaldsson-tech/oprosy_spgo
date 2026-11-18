/**
 * Local smoke/benchmark: native-text PDF sessions (no html2canvas).
 * Usage: node scripts/test-pdf-sessions-text.mjs [sessionCount]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { jsPDF } from '../client/node_modules/jspdf/dist/jspdf.es.min.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FONT_REG = path.join(ROOT, 'client/src/assets/fonts/Manrope-Regular.ttf');
const FONT_BOLD = path.join(ROOT, 'client/src/assets/fonts/Manrope-SemiBold.ttf');
const OUT_DIR = '/opt/cursor/artifacts';

const FONT_FAMILY = 'Manrope';
const sessionCount = Math.max(1, Number(process.argv[2] || 130));
const questionsPerSession = 15;

function toBinaryString(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return s;
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

function appendSessionsText(pdf, sessions, cursorY, layout) {
  const { margin, usableWidth, pageHeight } = layout;
  const opts = { margin, pageHeight };
  let y = cursorY;

  pdf.setFont(FONT_FAMILY, 'bold');
  pdf.setFontSize(13);
  pdf.setTextColor(17, 17, 17);
  y = ensureSpace(pdf, y, 8, opts);
  pdf.text('Все проведения', margin, y + 5);
  y += 10;

  for (let i = 0; i < sessions.length; i += 1) {
    const session = sessions[i];
    const head = `Проведение #${session.sessionNumber}  ·  ${session.createdAtLabel}`;
    pdf.setFont(FONT_FAMILY, 'bold');
    pdf.setFontSize(11);
    const headLines = pdf.splitTextToSize(head, usableWidth);
    y = ensureSpace(pdf, y, Math.min(headLines.length * 5.5 + 10, 24), opts);
    if (i > 0) y += 3;
    y = writeWrappedLines(pdf, headLines, margin, y, 5.5, opts);

    if (session.geoLabel) {
      pdf.setFont(FONT_FAMILY, 'normal');
      pdf.setFontSize(9);
      const geoLines = pdf.splitTextToSize(`Геометка: ${session.geoLabel}`, usableWidth);
      y = writeWrappedLines(pdf, geoLines, margin, y, 4.5, opts);
    }
    y += 1.5;

    for (const qa of session.answers) {
      pdf.setFont(FONT_FAMILY, 'bold');
      pdf.setFontSize(10);
      const qLines = pdf.splitTextToSize(qa.question, usableWidth);
      pdf.setFont(FONT_FAMILY, 'normal');
      const aLines = pdf.splitTextToSize(qa.answer, usableWidth);
      const blockH = qLines.length * 5 + aLines.length * 5 + 3;
      y = ensureSpace(pdf, y, Math.min(blockH, 22), opts);
      pdf.setFont(FONT_FAMILY, 'bold');
      y = writeWrappedLines(pdf, qLines, margin, y, 5, opts);
      pdf.setFont(FONT_FAMILY, 'normal');
      y = writeWrappedLines(pdf, aLines, margin, y, 5, opts);
      y += 2.5;
    }
  }
  return y;
}

function buildSessions(n) {
  const questions = Array.from({ length: questionsPerSession }, (_, i) => ({
    question: `Вопрос ${i + 1}. Как Вы оцениваете ситуацию в муниципалитете по теме №${i + 1}?`,
    answer:
      i % 3 === 0
        ? 'Да, такие мероприятия необходимы'
        : i % 3 === 1
          ? 'Телеграм-каналы, Телевидение'
          : 'Денег хватает на еду, одежду и товары длительного пользования, но не можем позволить себе покупку автомобиля, дачи, квартиры',
  }));
  return Array.from({ length: n }, (_, i) => ({
    sessionNumber: i + 1,
    createdAtLabel: '18.11.2026, 15:55:49',
    geoLabel: `${(56.3 + (i % 50) * 0.001).toFixed(5)}, ${(38.1 + (i % 40) * 0.001).toFixed(5)}`,
    answers: questions,
  }));
}

const t0 = performance.now();
const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
pdf.addFileToVFS('Manrope-Regular.ttf', toBinaryString(fs.readFileSync(FONT_REG)));
pdf.addFileToVFS('Manrope-SemiBold.ttf', toBinaryString(fs.readFileSync(FONT_BOLD)));
pdf.addFont('Manrope-Regular.ttf', FONT_FAMILY, 'normal');
pdf.addFont('Manrope-SemiBold.ttf', FONT_FAMILY, 'bold');

pdf.setFont(FONT_FAMILY, 'bold');
pdf.setFontSize(11);
pdf.setTextColor(17, 17, 17);
pdf.text('ОТЧЁТ ПО ОПРОСУ', 12, 16);
pdf.setFontSize(14);
pdf.text('Опросник по проблематике — ноябрь 2026 (локальный тест)', 12, 24);
pdf.setFont(FONT_FAMILY, 'normal');
pdf.setFontSize(10);
pdf.text(`Проведений: ${sessionCount} · текстовый режим PDF`, 12, 31);

const sessions = buildSessions(sessionCount);
const layout = {
  margin: 12,
  usableWidth: pdf.internal.pageSize.getWidth() - 24,
  pageHeight: pdf.internal.pageSize.getHeight(),
};
appendSessionsText(pdf, sessions, 36, layout);

fs.mkdirSync(OUT_DIR, { recursive: true });
const outPath = path.join(OUT_DIR, `pdf-sessions-text-${sessionCount}.pdf`);
const buf = Buffer.from(pdf.output('arraybuffer'));
fs.writeFileSync(outPath, buf);
const ms = performance.now() - t0;

console.log(
  JSON.stringify(
    {
      ok: true,
      sessions: sessionCount,
      questionsPerSession,
      qaBlocks: sessionCount * questionsPerSession,
      pages: pdf.getNumberOfPages(),
      bytes: buf.length,
      ms: Math.round(ms),
      outPath,
    },
    null,
    2
  )
);
