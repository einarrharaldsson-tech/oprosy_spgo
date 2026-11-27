/**
 * Local smoke test for the municipal problematika XLSX builder.
 * Usage: node scripts/test-analytics-xlsx.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import ExcelJS from '../client/node_modules/exceljs/excel.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = '/opt/cursor/artifacts/SPGO-problematika-test.xlsx';

let source = fs.readFileSync(path.join(ROOT, 'client/src/lib/downloadAnalyticsXlsx.js'), 'utf8');
source = source
  .replace(
    "import ExcelJS from 'exceljs';",
    `import ExcelJS from '${ROOT}/client/node_modules/exceljs/excel.js';`
  )
  .replace(
    "import { isOtherOptionText } from './options';",
    `import { isOtherOptionText } from '${ROOT}/client/src/lib/options.js';`
  )
  .replace(
    "import { isChoiceQuestion } from './surveyAnalytics';",
    `import { isChoiceQuestion } from '${ROOT}/client/src/lib/surveyAnalytics.js';`
  );

const tmp = '/tmp/downloadAnalyticsXlsx.node.mjs';
fs.writeFileSync(tmp, source);

globalThis.document = {
  createElement: () => ({ click() {}, remove() {} }),
  body: { appendChild() {} },
};
globalThis.URL = {
  createObjectURL(blob) {
    globalThis.__lastBlob = blob;
    return 'blob:test';
  },
  revokeObjectURL() {},
};
globalThis.Blob = class Blob {
  constructor(parts, opts) {
    this.parts = parts;
    this.type = opts?.type;
  }
  async arrayBuffer() {
    const part = this.parts[0];
    if (part instanceof ArrayBuffer) return part;
    if (ArrayBuffer.isView(part)) {
      return part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength);
    }
    return part;
  }
};

const { downloadAnalyticsXlsx, analyticsXlsxFilename } = await import(
  pathToFileURL(tmp).href
);

const survey = {
  title: 'Опросник по проблематике — ноябрь 2026',
  questions: [
    {
      id: 1,
      text: 'Пол',
      answerType: 'select',
      options: [
        { id: 11, text: 'Мужской' },
        { id: 12, text: 'Женский' },
      ],
    },
    {
      id: 2,
      text: 'Что Вас не устраивает в сфере здравоохранения?',
      answerType: 'checkbox',
      allowMultiple: true,
      options: [
        { id: 21, text: 'Большие очереди, долго ждать приема' },
        { id: 22, text: 'Другое (укажите)' },
        { id: 23, text: 'Затрудняюсь ответить' },
      ],
    },
  ],
};

const items = [
  {
    answers: [
      { questionId: 1, optionId: 11, optionText: 'Мужской' },
      {
        questionId: 2,
        optionId: 21,
        optionText: 'Большие очереди, долго ждать приема',
      },
      {
        questionId: 2,
        optionId: 22,
        optionText: 'Другое (укажите)',
        textValue: 'Нет узких специалистов',
      },
    ],
  },
  {
    answers: [
      { questionId: 1, optionId: 12, optionText: 'Женский' },
      {
        questionId: 2,
        optionId: 22,
        optionText: 'Другое (укажите)',
        textValue: 'Далеко ехать в поликлинику',
      },
    ],
  },
];

const filename = analyticsXlsxFilename('СПГО', survey.title);
await downloadAnalyticsXlsx({ survey, items, district: 'СПГО', filename });
const buf = Buffer.from(await globalThis.__lastBlob.arrayBuffer());
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, buf);

const wb = new ExcelJS.Workbook();
await wb.xlsx.load(buf);
const ws = wb.getWorksheet('Лист1');

console.log(
  JSON.stringify(
    {
      ok: true,
      filename,
      out: OUT,
      bytes: buf.length,
      a1: ws.getCell(1, 1).value,
      b2: ws.getCell(2, 2).value,
      b3: ws.getCell(3, 2).value,
    },
    null,
    2
  )
);
