import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatedOutputs } from './build-miniprogram.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'project.config.json',
  'miniprogram/app.js',
  'miniprogram/app.json',
  'miniprogram/app.wxss',
  'miniprogram/pages/settings/settings.js',
  'miniprogram/pages/settings/settings.wxml',
  'miniprogram/pages/home/home.js',
  'miniprogram/pages/home/home.wxml',
  'miniprogram/pages/entry/entry.js',
  'miniprogram/pages/entry/entry.wxml',
  'miniprogram/pages/bills/bills.js',
  'miniprogram/pages/bills/bills.wxml',
  'miniprogram/lib/application.js',
  'miniprogram/lib/build-manifest.json',
];
const failures = [];

for (const relative of required) if (!fs.existsSync(path.join(root, relative))) failures.push(`missing required file: ${relative}`);
const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
if (!/project\.private\.config\.json/.test(gitignore)) failures.push('project.private.config.json must be ignored');

for (const [relative, expected] of generatedOutputs()) {
  const actualPath = path.join(root, relative);
  if (!fs.existsSync(actualPath) || fs.readFileSync(actualPath, 'utf8') !== expected) failures.push(`generated file is out of sync: ${relative}`);
}

const sourceFiles = ['src/application/app-core.js'];
for (const relative of sourceFiles) {
  const text = fs.readFileSync(path.join(root, relative), 'utf8');
  if (/\b(?:wx|document|window|fetch|XMLHttpRequest|require|process|Buffer)\b|node:fs|https?:\/\//i.test(text)) failures.push(`application source uses a platform or I/O API: ${relative}`);
}

const pageFiles = ['miniprogram/app.js', ...required.filter((item) => item.startsWith('miniprogram/pages/') && item.endsWith('.js'))];
for (const relative of pageFiles) {
  const text = fs.readFileSync(path.join(root, relative), 'utf8');
  if (/\b(?:eval|fetch|XMLHttpRequest)\b|https?:\/\//i.test(text)) failures.push(`page file uses a forbidden dynamic or network API: ${relative}`);
}

const appConfig = fs.existsSync(path.join(root, 'miniprogram/app.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/app.json'), 'utf8')) : {};
if (JSON.stringify(appConfig.pages) !== JSON.stringify(['pages/home/home', 'pages/settings/settings', 'pages/entry/entry', 'pages/bills/bills'])) failures.push('app.json must declare the ledger-first four-page order');

if (failures.length) {
  console.error('MINIPROGRAM CHECK FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('MINIPROGRAM CHECK PASSED: four pages, generated application bundle, and source boundary are valid');
}
