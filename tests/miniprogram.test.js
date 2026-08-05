import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatedOutputs } from '../scripts/build-miniprogram.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('project config points the mini program root at miniprogram', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
  assert.equal(config.miniprogramRoot, 'miniprogram/');
});
test('app config preserves the required four page order alongside the ledger and mine tabs', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/app.json'), 'utf8'));
  assert.deepEqual(config.pages, ['pages/home/home', 'pages/settings/settings', 'pages/entry/entry', 'pages/bills/bills']);
  assert.deepEqual(config.tabBar.list.map((item) => item.pagePath), [
    'pages/home/home',
    'pages/settings/settings',
  ]);
  assert.deepEqual(config.tabBar.list.map((item) => item.text), ['账本', '我的']);
});
test('initialized users start on ledger while first use switches to mine', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/app.json'), 'utf8'));
  assert.equal(config.pages[0], 'pages/home/home');
  const home = fs.readFileSync(path.join(root, 'miniprogram/pages/home/home.js'), 'utf8');
  assert.match(home, /if\s*\(!app\.globalData\.state\)\s*\{[\s\S]{0,120}wx\.switchTab\(\{\s*url:\s*['"]\/pages\/settings\/settings['"]/);
});
test('mini program application bundle is generated from the application source', () => {
  const expected = generatedOutputs().get('miniprogram/lib/application.js');
  const actual = fs.readFileSync(path.join(root, 'miniprogram/lib/application.js'), 'utf8');
  assert.equal(actual, expected);
});
test('mini program build manifest records the application source hash', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/lib/build-manifest.json'), 'utf8'));
  assert.ok(manifest.sources['src/application/app-core.js']);
});
test('settings page contains the first-use budget form', () => {
  const wxml = fs.readFileSync(path.join(root, 'miniprogram/pages/settings/settings.wxml'), 'utf8');
  assert.match(wxml, /月度可控预算/);
  assert.match(wxml, /周期起始日/);
  assert.match(wxml, /初始资产账户/);
});
test('home page binds the real today free amount model', () => {
  const wxml = fs.readFileSync(path.join(root, 'miniprogram/pages/home/home.wxml'), 'utf8');
  assert.match(wxml, /今日可自由花/);
  assert.match(wxml, /model\.todayFree/);
});
test('entry page contains account category note and budget switch controls', () => {
  const wxml = fs.readFileSync(path.join(root, 'miniprogram/pages/entry/entry.wxml'), 'utf8');
  assert.match(wxml, /账户/);
  assert.match(wxml, /一级分类/);
  assert.match(wxml, /二级分类/);
  assert.match(wxml, /计入可控预算/);
});
test('entry page contains the local previous similar bill panel', () => assert.match(fs.readFileSync(path.join(root, 'miniprogram/pages/entry/entry.wxml'), 'utf8'), /上一笔同类/));
test('bills page contains controlled fixed date category account and amount fields', () => {
  const wxml = fs.readFileSync(path.join(root, 'miniprogram/pages/bills/bills.wxml'), 'utf8');
  assert.match(wxml, /item\.budgetType/);
  assert.match(wxml, /item\.category/);
  assert.match(wxml, /item\.account/);
  assert.match(wxml, /item\.date/);
  assert.match(wxml, /item\.amount/);
});
test('private developer config is ignored by the repository rules', () => assert.match(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), /project\.private\.config\.json/));
