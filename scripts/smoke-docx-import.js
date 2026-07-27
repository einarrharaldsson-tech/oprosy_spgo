import fs from 'fs';
import path from 'path';
import { parseDocxSurvey } from '../server/src/services/docxImport.js';

const root = process.cwd();
const docx = fs.readdirSync(root).find((f) => f.endsWith('.docx'));
if (!docx) {
  console.error('NO_DOCX in', root);
  process.exit(1);
}
const buf = fs.readFileSync(path.join(root, docx));
const r = await parseDocxSurvey(buf);
console.log('FILE', docx);
console.log('TITLE', r.title);
console.log('DESC_LEN', (r.description || '').length);
console.log('Q_COUNT', r.questions.length);
console.log('WARN_COUNT', r.warnings.length);
for (const q of r.questions) {
  const optn = (q.options || []).length;
  console.log(
    String(q.sourceNumber).padStart(2),
    q.answerType.padEnd(8),
    `multi=${String(!!q.allowMultiple).padEnd(5)}`,
    `opts=${String(optn).padStart(2)}`,
    q.text.slice(0, 70)
  );
}
console.log('---WARNINGS---');
r.warnings.slice(0, 40).forEach((w) => console.log('-', w));
