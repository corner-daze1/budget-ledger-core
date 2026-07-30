import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);

function read(relativePath) {
  return fs.readFileSync(new URL(relativePath, root), 'utf8');
}

function loadHomePage() {
  const navigations = [];
  const core = {
    todayIso: () => '2026-07-30',
    getHomeModel: () => ({
      todayFree: '¥100.00',
      periodStartDate: '2026-07-01',
      periodEndDate: '2026-07-31',
      fullSingleDayQuota: '¥100.00',
      prepaidCents: 0,
      needsSettlement: false,
      showPlanOverdueBanner: false,
      planOverdueItems: [],
      planExecutionResults: [],
      planReminders: [],
      planDueToday: [],
      planPendingItems: [],
      planExecutionMessage: '',
      settlement: null,
      pendingStartDay: null,
    }),
  };
  let definition;
  vm.runInNewContext(read('miniprogram/pages/home/home.js'), {
    module: { exports: {} },
    exports: {},
    require(request) {
      if (String(request).includes('application.js')) return core;
      throw new Error(`unexpected require: ${request}`);
    },
    Page(page) {
      definition = page;
    },
    getApp: () => ({
      globalData: { state: { ok: true }, storageError: '', planRunSummary: null },
      saveState() {},
    }),
    wx: {
      navigateTo({ url }) { navigations.push(['navigateTo', url]); },
      redirectTo({ url }) { navigations.push(['redirectTo', url]); },
    },
  });
  return { definition, navigations };
}

test('home page keeps real model bindings for free amount period quota and settlement', () => {
  const wxml = read('miniprogram/pages/home/home.wxml');
  for (const token of [
    'model.todayFree',
    '今日可自由花',
    'model.periodStartDate',
    'model.periodEndDate',
    'model.fullSingleDayQuota',
    'model.prepaid',
    'model.earliestRecoveryDate',
    'model.pendingStartDay',
    'model.needsSettlement',
    'model.settlement.periodEndDate',
    'model.settlement.actualBudget',
    'model.settlement.netBudgetSpend',
    'model.settlement.positiveSurplus',
    'model.settlement.grossDebt',
    'model.settlement.rewardOffset',
    'model.settlement.remainingDebt',
  ]) {
    assert.match(wxml, new RegExp(token.replace(/\./g, '\\.')));
  }
});

test('home page exposes six state entry points without demo data', () => {
  const wxml = read('miniprogram/pages/home/home.wxml');
  assert.match(wxml, /wx:if="\{\{error\}\}"/);
  assert.match(wxml, /model\.needsSettlement/);
  assert.match(wxml, /model\.prepaidCents\s*>\s*0/);
  assert.match(wxml, /model\.showPlanOverdueBanner/);
  assert.match(wxml, /model\.planPendingItems\.length/);
  assert.match(wxml, /model\.planReminders/);
  assert.match(wxml, /model\.planDueToday/);
  assert.match(wxml, /model\.planExecutionResults/);
  assert.match(wxml, /暂无计划提醒或待处理项.*设置/);
  assert.doesNotMatch(wxml, /演示数据|示例账单|假数据/);
});

test('home page keeps original navigation and settlement handlers', () => {
  const { definition, navigations } = loadHomePage();
  for (const name of [
    'goEntry',
    'goBills',
    'goSettings',
    'goAssets',
    'settlePeriod',
    'retryPendingPlan',
    'dismissPlanOverdueBanner',
    'onPositiveModeChange',
    'onOverspendModeChange',
  ]) {
    assert.equal(typeof definition[name], 'function', `missing handler ${name}`);
  }
  definition.goEntry();
  definition.goBills();
  definition.goSettings();
  definition.goAssets();
  assert.deepEqual(navigations, [
    ['navigateTo', '/pages/entry/entry'],
    ['navigateTo', '/pages/bills/bills'],
    ['navigateTo', '/pages/settings/settings'],
    ['navigateTo', '/pages/settings/settings'],
  ]);
  const wxml = read('miniprogram/pages/home/home.wxml');
  assert.match(wxml, /bindtap="goEntry"/);
  assert.match(wxml, /bindtap="goBills"/);
  assert.match(wxml, /bindtap="goSettings"/);
  assert.match(wxml, /bindtap="goAssets"/);
  assert.match(wxml, /bindtap="settlePeriod"/);
  assert.match(wxml, /bindtap="retryPendingPlan"/);
  assert.match(wxml, /bindtap="dismissPlanOverdueBanner"/);
});

test('home styles enforce primary tap size and small-screen wrapping', () => {
  const wxss = read('miniprogram/pages/home/home.wxss');
  const app = read('miniprogram/app.wxss');
  const styles = `${app}\n${wxss}`;
  assert.match(styles, /min-height:\s*88rpx/);
  assert.match(wxss, /@media\s*\(max-width:\s*320px\)/);
  assert.match(wxss, /flex-direction:\s*column/);
  assert.match(wxss, /overflow-wrap:\s*anywhere/);
  assert.match(wxss, /\.hero-number\s*\{[^}]*font-size:\s*80rpx/s);
  assert.match(wxss, /@media\s*\(max-width:\s*320px\)\s*\{[^}]*\.hero-number\s*\{[^}]*font-size:\s*64rpx/s);
  assert.match(wxss, /\.pending-input\s*\{[^}]*min-height:\s*88rpx/s);
  assert.match(wxss, /\.asset-button\s*\{[^}]*min-height:\s*88rpx/s);
});

test('home visual hierarchy keeps primary CTA above secondary navigation', () => {
  const wxml = read('miniprogram/pages/home/home.wxml');
  const primaryAt = wxml.indexOf('bindtap="goEntry"');
  const assetsAt = wxml.indexOf('bindtap="goAssets"');
  const billsAt = wxml.indexOf('bindtap="goBills"');
  const settingsAt = wxml.indexOf('bindtap="goSettings"');
  assert.ok(primaryAt > 0);
  assert.ok(primaryAt < assetsAt);
  assert.ok(assetsAt < billsAt);
  assert.ok(billsAt < settingsAt);
  assert.match(wxml, /home-primary-cta/);
  assert.match(wxml, /hero-number/);
  assert.match(wxml, /plan-card-quiet|plan-empty/);
});

test('design system document freezes tokens states and reuse rules', () => {
  const doc = read('docs/PHASE9_DESIGN_SYSTEM.md');
  for (const section of [
    '品牌气质与禁区',
    '颜色',
    '字体层级',
    '间距、圆角、边框、阴影',
    '组件层级',
    '适配与排版规则',
    '首页六种状态',
    '后续三页复用',
  ]) {
    assert.ok(doc.includes(section), `missing section ${section}`);
  }
  for (const token of [
    '#F7F4EF',
    '#282521',
    '#B85C45',
    '#2F302B',
    '88rpx',
    '24rpx',
    '4.5:1',
    '今日可自由花',
    '待结算',
    '预支',
    '320px',
  ]) {
    assert.ok(doc.toLowerCase().includes(token.toLowerCase()), `missing token ${token}`);
  }
  assert.ok(doc.includes('不引入') || doc.includes('禁止') || doc.includes('禁区'));
});
