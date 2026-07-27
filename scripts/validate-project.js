import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const failures = [];

function filesUnder(relative, extension = '.js') {
  const directory = path.join(root, relative);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(path.join(relative, entry.name), extension);
    return entry.name.endsWith(extension) ? [full] : [];
  });
}

const testFiles = filesUnder('tests');
const testText = testFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
const testCount = (testText.match(/\b(?:test|it)\s*\(/g) || []).length;
if (testCount < 60) failures.push(`tests must contain at least 60 test declarations; found ${testCount}`);
if (/\b(?:skip|todo|only)\s*\(/.test(testText)) failures.push('tests must not use skip, todo, or only');

const specPath = path.join(root, 'docs', 'PRODUCT_SPEC.md');
const spec = fs.existsSync(specPath) ? fs.readFileSync(specPath, 'utf8') : '';
for (const heading of ['预算规则', '周期与起始日', '资金与流水', '数据恢复与导出', '界限']) {
  if (!spec.includes(heading)) failures.push(`PRODUCT_SPEC.md is missing required section: ${heading}`);
}

for (const file of filesUnder('src/domain')) {
  const text = fs.readFileSync(file, 'utf8');
  if (/\b(?:wx|document|window|fetch|XMLHttpRequest|require|process|Buffer)\b|node:fs|https?:\/\//i.test(text)) {
    failures.push(`domain file uses a forbidden platform or I/O API: ${path.relative(root, file)}`);
  }
}

if (failures.length) {
  console.error('PROJECT CHECK FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`PROJECT CHECK PASSED: ${testCount} test declarations, required spec sections present, domain boundary clean`);
}
