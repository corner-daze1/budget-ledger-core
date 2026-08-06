import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function loadTabBar(route) {
  let definition;
  const navigations = [];
  const resetCalls = [];
  const currentPage = {
    route: route.replace(/^\//, ''),
    resetHomeLedger() { resetCalls.push('resetHomeLedger'); },
  };
  const moduleObject = { exports: {} };
  vm.runInNewContext(read('miniprogram/custom-tab-bar/index.js'), {
    module: moduleObject,
    exports: moduleObject.exports,
    Component(component) {
      definition = component;
    },
    getCurrentPages: () => [currentPage],
    wx: {
      switchTab({ url, success }) {
        navigations.push(['switchTab', url]);
        if (success) success();
      },
      navigateTo({ url }) {
        navigations.push(['navigateTo', url]);
      },
    },
  });

  const instance = {
    data: {
      ...definition.data,
      items: definition.data.items.map((item) => ({ ...item })),
    },
    setData(patch) {
      this.data = { ...this.data, ...patch };
    },
  };
  Object.assign(instance, definition.methods);
  return { definition, instance, navigations, resetCalls, exports: moduleObject.exports };
}

function filesUnder(relativeDirectory) {
  const directory = path.join(root, relativeDirectory);
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) result.push(...filesUnder(relative));
    else result.push(relative);
  }
  return result;
}

test('app config exposes exactly two tab destinations and keeps bills and entry non-tab', () => {
  const config = JSON.parse(read('miniprogram/app.json'));
  assert.equal(config.tabBar.custom, true);
  assert.deepEqual(config.tabBar.list, [
    { pagePath: 'pages/home/home', text: '账本' },
    { pagePath: 'pages/settings/settings', text: '我的' },
  ]);
  assert.deepEqual(config.pages, [
    'pages/home/home',
    'pages/settings/settings',
    'pages/entry/entry',
    'pages/bills/bills',
  ]);
  assert.equal(config.tabBar.list.some((item) => item.pagePath === 'pages/bills/bills'), false);
  assert.equal(config.tabBar.list.some((item) => item.pagePath === 'pages/entry/entry'), false);
});

test('custom tab bar entry is declared as a native component', () => {
  const config = JSON.parse(read('miniprogram/custom-tab-bar/index.json'));
  assert.equal(config.component, true);
});

test('custom tab bar selected state follows the current route including neutral entry mode', () => {
  const expected = [
    ['/pages/home/home', 'home'],
    ['/pages/settings/settings', 'settings'],
    ['/pages/bills/bills', ''],
    ['/pages/entry/entry', ''],
  ];
  for (const [route, selected] of expected) {
    const { definition, instance } = loadTabBar(route);
    definition.lifetimes.attached.call(instance);
    assert.equal(instance.data.selected, selected, `${route} selected state`);
    definition.pageLifetimes.show.call(instance);
    assert.equal(instance.data.selected, selected, `${route} show state`);
  }
});

test('ledger and mine use switchTab while the central record action uses the ledger source stack', () => {
  const { definition, instance, navigations, resetCalls } = loadTabBar('/pages/home/home');
  definition.methods.onTabTap.call(instance, { currentTarget: { dataset: { index: '0' } } });
  definition.methods.onTabTap.call(instance, { currentTarget: { dataset: { index: '1' } } });
  definition.methods.onEntryTap.call(instance);
  assert.deepEqual(resetCalls, ['resetHomeLedger']);
  assert.deepEqual(navigations, [
    ['switchTab', '/pages/settings/settings'],
    ['navigateTo', '/pages/entry/entry'],
  ]);

  const fromMine = loadTabBar('/pages/settings/settings');
  fromMine.definition.methods.onEntryTap.call(fromMine.instance);
  assert.deepEqual(fromMine.navigations, [
    ['switchTab', '/pages/home/home'],
    ['navigateTo', '/pages/entry/entry'],
  ]);
});

test('custom tab bar template exposes exactly ledger, record and mine', () => {
  const wxml = read('miniprogram/custom-tab-bar/index.wxml');
  assert.equal((wxml.match(/bindtap="onTabTap"/g) || []).length, 2);
  assert.equal((wxml.match(/aria-label="记一笔"/g) || []).length, 1);
  assert.equal((wxml.match(/class="tab-icon/g) || []).length, 3);
  assert.equal((wxml.match(/>账本</g) || []).length, 1);
  assert.equal((wxml.match(/>记一笔</g) || []).length, 1);
  assert.equal((wxml.match(/>我的</g) || []).length, 1);
  assert.match(wxml, /bindtap="onEntryTap"/);
  assert.match(wxml, /tab-icon-ledger/);
  assert.match(wxml, /tab-icon-add/);
  assert.match(wxml, /tab-icon-profile/);
  assert.doesNotMatch(wxml, /tab-icon-bills|tab-icon-settings|首页|账单|管理/);
  assert.doesNotMatch(wxml, /https?:\/\//i);
});

test('custom tab bar reserves safe area and at least 88rpx interaction height', () => {
  const tabBarWxss = read('miniprogram/custom-tab-bar/index.wxss');
  const appWxss = read('miniprogram/app.wxss');
  assert.match(tabBarWxss, /\.tab-bar\s*\{[^}]*position:\s*fixed/s);
  assert.match(tabBarWxss, /height:\s*calc\([^;]*env\(safe-area-inset-bottom\)/s);
  assert.match(tabBarWxss, /padding:[^;]*env\(safe-area-inset-bottom\)/s);
  assert.match(tabBarWxss, /\.tab-item,\s*\.tab-action-wrap\s*\{[^}]*min-height:\s*88rpx/s);
  assert.match(tabBarWxss, /\.tab-action\s*\{[^}]*width:\s*96rpx[^}]*height:\s*96rpx/s);
  assert.match(tabBarWxss, /@media\s*\(max-width:\s*320px\)[\s\S]*\.tab-action\s*\{[^}]*width:\s*88rpx[^}]*height:\s*88rpx/s);
  assert.match(appWxss, /\.page\s*\{[^}]*padding:[^;]*calc\(180rpx\s*\+\s*env\(safe-area-inset-bottom\)\)/s);
  assert.doesNotMatch(tabBarWxss, /url\s*\(/i);
});

test('missing-ledger bills and entry pages route to management with switchTab', () => {
  const expected = [
    'miniprogram/pages/bills/bills.js',
    'miniprogram/pages/entry/entry.js',
  ];
  for (const file of expected) {
    const source = read(file);
    assert.match(source, /if\s*\(!app\.globalData\.state\)\s*\{[\s\S]{0,120}wx\.switchTab\(\{\s*url:\s*['"]\/pages\/settings\/settings['"]/);
    assert.doesNotMatch(source, /wx\.(?:redirectTo|reLaunch|navigateTo)\(\{\s*url:\s*['"]\/pages\/settings\/settings['"]/);
  }
});

test('home bills entry and settings route transitions preserve tab navigation types', () => {
  const home = read('miniprogram/pages/home/home.js');
  assert.match(home, /goBills\(\)\s*\{\s*wx\.navigateTo\(\{\s*url:\s*['"]\/pages\/bills\/bills['"]/s);
  assert.doesNotMatch(home, /goBills\(\)\s*\{\s*wx\.switchTab/);
  assert.doesNotMatch(home, /goEntry|goSettings/);

  const entry = read('miniprogram/pages/entry/entry.js');
  assert.match(entry, /wx\.navigateBack\(\{\s*delta:\s*1\s*\}\)/);
  assert.doesNotMatch(entry, /wx\.switchTab\(\{\s*url:\s*['"]\/pages\/home\/home['"]/);

  const settings = read('miniprogram/pages/settings/settings.js');
  assert.equal((settings.match(/wx\.switchTab\(\{\s*url:/g) || []).length, 4);
  assert.match(settings, /wx\.switchTab\(\{\s*url:\s*['"]\/pages\/home\/home['"]/);
  assert.match(settings, /wx\.switchTab\(\{\s*url:\s*['"]\/pages\/settings\/settings['"]/);
  assert.doesNotMatch(settings, /wx\.(?:redirectTo|reLaunch|navigateTo)\(\{\s*url:\s*['"]\/pages\/(?:home|settings)\//);
});

test('home keeps real budget states and removes duplicate normal record and management CTAs', () => {
  const wxml = read('miniprogram/pages/home/home.wxml');
  for (const token of [
    'model.todayFree',
    'model.fullSingleDayQuota',
    'model.prepaid',
    'model.earliestRecoveryDate',
    'model.needsSettlement',
    'model.showPlanOverdueBanner',
    'model.planPendingItems',
    'ledgerGroups',
    'ledgerTransactionCount',
    'item.transactions',
    'transaction.category',
    'transaction.date',
    'transaction.accountFlow',
    'transaction.amount',
  ]) assert.match(wxml, new RegExp(token.replace('.', '\\.')));
  assert.doesNotMatch(wxml, /bindtap="goEntry"|bindtap="goSettings"/);
  assert.doesNotMatch(wxml, /[＋+]\s*记一笔/);
  assert.doesNotMatch(wxml, /class="[^"]*manage-link/);
  assert.match(wxml, /还没有流水，用底部“记一笔”记下第一笔/);
});

test('shipped Phase10 scope has no legacy retail starter reference', () => {
  const forbiddenReference = ['tdesign', 'miniprogram', 'starter', 'retail'].join('-');
  const scope = [
    ...filesUnder('miniprogram'),
    'docs/PHASE10_TDESIGN_UI_SPEC.md',
    ...filesUnder('tests'),
  ];
  const hits = scope.filter((file) => read(file).toLowerCase().includes(forbiddenReference));
  assert.deepEqual(hits, []);
});
