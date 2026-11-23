import ExcelJS from 'exceljs';
import { isOtherOptionText } from './options';
import { isChoiceQuestion } from './surveyAnalytics';

export const DISTRICT_CODE = 'СПГО';

const thin = { style: 'thin', color: { argb: 'FF000000' } };
const thinBorder = { top: thin, left: thin, bottom: thin, right: thin };

function font(opts = {}) {
  return { name: 'Calibri', size: 11, ...opts };
}

function applyBorder(cell) {
  cell.border = thinBorder;
}

function styleTitle(cell) {
  cell.font = font({ bold: true, size: 11 });
  cell.alignment = { horizontal: 'center', vertical: 'center', wrapText: true };
  applyBorder(cell);
}

function styleHeader(cell) {
  cell.font = font({ size: 11 });
  cell.alignment = { horizontal: 'center', vertical: 'center', wrapText: true };
  applyBorder(cell);
}

function styleOption(cell) {
  cell.font = font({ size: 10 });
  cell.alignment = { horizontal: 'left', vertical: 'center', wrapText: true };
  applyBorder(cell);
}

function styleTotal(cell) {
  cell.font = font({ bold: true, size: 11 });
  cell.alignment = { horizontal: 'left', vertical: 'center', wrapText: true };
  applyBorder(cell);
}

function styleCount(cell, bold = false) {
  cell.font = font({ bold, size: 11 });
  cell.alignment = { horizontal: 'center', vertical: 'center', wrapText: true };
  applyBorder(cell);
  cell.numFmt = '0';
}

function stylePercent(cell, bold = false) {
  cell.font = font({ bold, size: 11 });
  cell.alignment = { horizontal: 'center', vertical: 'center', wrapText: true };
  applyBorder(cell);
  // Same rounding as analytics charts: one decimal place + % sign.
  cell.numFmt = '0.0"%"';
}

/** Same rounding as SurveyAnalytics charts (share of sessions). */
function roundPercent(count, total) {
  if (!total) return 0;
  return Math.round((count / total) * 1000) / 10;
}

/** e.g. 4кв26 for November 2026 */
export function quarterLabel(date = new Date()) {
  const q = Math.floor(date.getMonth() / 3) + 1;
  const yy = String(date.getFullYear()).slice(-2);
  return `${q}кв${yy}`;
}

export function analyticsXlsxFilename(district = DISTRICT_CODE, date = new Date()) {
  return `${district} - проблематика в ${quarterLabel(date)}.xlsx`;
}

/**
 * Frequency rows for one choice question: every survey option (incl. zeros),
 * plus any unexpected options that appeared in answers.
 */
function buildFrequencyRows(question, items) {
  const buckets = new Map();
  for (const option of question.options || []) {
    const label = String(option.text || 'Вариант').trim() || 'Вариант';
    buckets.set(option.id, {
      id: option.id,
      label,
      count: 0,
      otherTexts: [],
      isOther: isOtherOptionText(label),
    });
  }

  let unanswered = 0;
  for (const item of items) {
    const answers = (item.answers || []).filter(
      (answer) => answer.questionId === question.id && answer.optionId
    );
    if (!answers.length) {
      unanswered += 1;
      continue;
    }
    const seen = new Set();
    for (const answer of answers) {
      if (seen.has(answer.optionId)) continue;
      seen.add(answer.optionId);
      let bucket = buckets.get(answer.optionId);
      if (!bucket) {
        const label = String(answer.optionText || 'Вариант').trim() || 'Вариант';
        bucket = {
          id: answer.optionId,
          label,
          count: 0,
          otherTexts: [],
          isOther: isOtherOptionText(label),
        };
        buckets.set(answer.optionId, bucket);
      }
      bucket.count += 1;
      const extra = String(answer.textValue || '').trim();
      if (extra) bucket.otherTexts.push(extra);
    }
  }

  const rows = [...buckets.values()];
  if (unanswered > 0) {
    rows.push({
      id: 'unanswered',
      label: 'Без ответа',
      count: unanswered,
      otherTexts: [],
      isOther: false,
    });
  }
  return rows;
}

function writeMunicipalityBlock(ws, startRow, district, total) {
  let r = startRow;
  ws.mergeCells(r, 1, r, 2);
  styleTitle(ws.getCell(r, 1));
  ws.getCell(r, 1).value = 'МУНИЦИПАЛИТЕТ';
  applyBorder(ws.getCell(r, 2));
  r += 1;

  // Column header = district name; next row is the respondent count.
  styleHeader(ws.getCell(r, 1));
  ws.getCell(r, 1).value = '';
  styleHeader(ws.getCell(r, 2));
  ws.getCell(r, 2).value = district;
  r += 1;

  styleHeader(ws.getCell(r, 1));
  ws.getCell(r, 1).value = 'Число опрошенных';
  styleCount(ws.getCell(r, 2), true);
  ws.getCell(r, 2).value = total;
  r += 1;

  styleOption(ws.getCell(r, 1));
  ws.getCell(r, 1).value = district;
  styleCount(ws.getCell(r, 2));
  ws.getCell(r, 2).value = total;
  const dataRow = r;
  r += 1;

  styleTotal(ws.getCell(r, 1));
  ws.getCell(r, 1).value = 'Всего';
  styleCount(ws.getCell(r, 2), true);
  ws.getCell(r, 2).value = { formula: `B${dataRow}` };
  r += 1;

  return r + 2; // blank gap like the template
}

function writeQuestionBlock(ws, startRow, questionText, district, rows, totalRespondents) {
  let r = startRow;
  ws.mergeCells(r, 1, r, 2);
  styleTitle(ws.getCell(r, 1));
  ws.getCell(r, 1).value = questionText;
  applyBorder(ws.getCell(r, 2));
  r += 1;

  // District as column header.
  styleHeader(ws.getCell(r, 1));
  ws.getCell(r, 1).value = '';
  styleHeader(ws.getCell(r, 2));
  ws.getCell(r, 2).value = district;
  r += 1;

  // «Число опрошенных» must be the numeric headcount, not the district name.
  styleHeader(ws.getCell(r, 1));
  ws.getCell(r, 1).value = 'Число опрошенных';
  styleCount(ws.getCell(r, 2), true);
  ws.getCell(r, 2).value = totalRespondents;
  r += 1;

  const firstData = r;
  for (const row of rows) {
    styleOption(ws.getCell(r, 1));
    ws.getCell(r, 1).value = row.label;
    styleCount(ws.getCell(r, 2));
    ws.getCell(r, 2).value = row.count;
    r += 1;
  }
  const lastData = r - 1;

  styleTotal(ws.getCell(r, 1));
  ws.getCell(r, 1).value = 'Всего';
  styleCount(ws.getCell(r, 2), true);
  if (lastData >= firstData) {
    ws.getCell(r, 2).value = { formula: `SUM(B${firstData}:B${lastData})` };
  } else {
    ws.getCell(r, 2).value = 0;
  }
  r += 1;

  const otherRows = rows.filter((row) => row.isOther);
  const otherCount = otherRows.reduce((sum, row) => sum + (row.count || 0), 0);
  const otherTexts = otherRows.flatMap((row) => row.otherTexts || []);
  if (otherCount > 0 || otherTexts.length) {
    r += 2;
    ws.mergeCells(r, 1, r, 2);
    styleTitle(ws.getCell(r, 1));
    ws.getCell(r, 1).value = `${questionText} - другое`;
    applyBorder(ws.getCell(r, 2));
    r += 1;

    styleHeader(ws.getCell(r, 1));
    ws.getCell(r, 1).value = '';
    styleHeader(ws.getCell(r, 2));
    ws.getCell(r, 2).value = district;
    r += 1;

    // Same % as in analytics charts: share of sessions who chose «Другое».
    styleHeader(ws.getCell(r, 1));
    ws.getCell(r, 1).value = '% ответа другое';
    stylePercent(ws.getCell(r, 2), true);
    ws.getCell(r, 2).value = roundPercent(otherCount, totalRespondents);
    r += 1;

    for (const text of otherTexts) {
      styleOption(ws.getCell(r, 1));
      ws.getCell(r, 1).value = text;
      styleCount(ws.getCell(r, 2));
      ws.getCell(r, 2).value = '';
      r += 1;
    }
  }

  return r + 2;
}

/**
 * Build and download the municipal «проблематика» XLSX report
 * (layout matches the official template; district column = СПГО).
 */
export async function downloadAnalyticsXlsx({ survey, items, district = DISTRICT_CODE, filename }) {
  const total = items?.length || 0;
  if (!total) throw new Error('Нет данных для Excel-отчёта');

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Опросы СПГО';
  workbook.created = new Date();
  const ws = workbook.addWorksheet('Лист1', {
    properties: { defaultRowHeight: 18 },
    views: [{ state: 'normal', showGridLines: true }],
  });

  ws.getColumn(1).width = 65;
  ws.getColumn(2).width = 22;
  ws.getColumn(3).width = 13;
  ws.getColumn(4).width = 32;

  let row = 1;
  row = writeMunicipalityBlock(ws, row, district, total);

  const questions = (survey?.questions || []).filter(isChoiceQuestion);
  for (const question of questions) {
    const rows = buildFrequencyRows(question, items);
    row = writeQuestionBlock(
      ws,
      row,
      String(question.text || '').trim() || 'Вопрос',
      district,
      rows,
      total
    );
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || analyticsXlsxFilename(district);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
