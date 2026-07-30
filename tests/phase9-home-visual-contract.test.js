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

/** WCAG 2.x relative luminance for sRGB hex (#rgb or #rrggbb). */
function relativeLuminance(hex) {
  const raw = String(hex).trim().replace(/^#/, '');
  const full = raw.length === 3
    ? raw.split('').map((c) => c + c).join('')
    : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`invalid hex color: ${hex}`);
  }
  const channels = [0, 2, 4].map((i) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground, background) {
  const l1 = relativeLuminance(foreground);
  const l2 = relativeLuminance(background);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Extract first matching color hex for a CSS property from a rule block. */
function firstColorInRule(wxss, selectorRegex, property) {
  const re = new RegExp(
    `${selectorRegex.source}\\s*\\{([^}]*)\\}`,
    selectorRegex.flags.includes('i') ? 'is' : 's',
  );
  const m = wxss.match(re);
  assert.ok(m, `missing rule for ${selectorRegex}`);
  const propRe = new RegExp(`${property}\\s*:\\s*(#[0-9a-fA-F]{3,8})`, 'i');
  const pm = m[1].match(propRe);
  assert.ok(pm, `missing ${property} in ${selectorRegex}`);
  return pm[1];
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
    '#B45842',
    '#796D63',
    '#2F302B',
    '#C7BDB1',
    '88rpx',
    '24rpx',
    '4.5:1',
    '今日可自由花',
    '待结算',
    '预支',
    '320px',
    '局部覆盖',
  ]) {
    assert.ok(doc.toLowerCase().includes(token.toLowerCase()), `missing token ${token}`);
  }
  assert.ok(doc.includes('不引入') || doc.includes('禁止') || doc.includes('禁区'));
});

test('home weak text and primary button meet WCAG contrast ≥4.5 on shipped tokens', () => {
  const wxss = read('miniprogram/pages/home/home.wxss');
  const weak = firstColorInRule(wxss, /\.home-page\s+\.eyebrow/, 'color');
  const weakHint = firstColorInRule(wxss, /\.home-page\s+\.hint/, 'color');
  const weakEmpty = firstColorInRule(wxss, /\.plan-empty/, 'color');
  const primaryBg = firstColorInRule(wxss, /\.home-page\s+\.primary-button/, 'background');
  const primaryFg = firstColorInRule(wxss, /\.home-page\s+\.primary-button/, 'color');
  const heroCaption = firstColorInRule(wxss, /\.hero-caption/, 'color');

  assert.match(weak, /#796d63/i);
  assert.match(weakHint, /#796d63/i);
  assert.match(weakEmpty, /#796d63/i);
  assert.match(primaryBg, /#b45842/i);
  assert.match(primaryFg, /#fffdfa/i);
  assert.match(heroCaption, /#c7bdb1/i);

  const pageBg = '#F7F4EF';
  const cardBg = '#FFFDFA';
  const cWeakPage = contrastRatio(weak, pageBg);
  const cWeakCard = contrastRatio(weak, cardBg);
  const cPrimary = contrastRatio(primaryFg, primaryBg);

  assert.ok(cWeakPage >= 4.5, `weak on page bg contrast ${cWeakPage}`);
  assert.ok(cWeakCard >= 4.5, `weak on card bg contrast ${cWeakCard}`);
  assert.ok(cPrimary >= 4.5, `primary text contrast ${cPrimary}`);
  // ratios must be computed, not hard-coded constants equal to themselves
  assert.notEqual(cWeakPage, 4.5);
  assert.notEqual(cWeakCard, 4.5);
  assert.notEqual(cPrimary, 4.5);
});

test('home WXSS declares no font-size below 24rpx', () => {
  const wxss = read('miniprogram/pages/home/home.wxss');
  const sizes = [...wxss.matchAll(/font-size\s*:\s*([\d.]+)rpx/gi)].map((m) => Number(m[1]));
  assert.ok(sizes.length > 0, 'expected font-size declarations');
  for (const size of sizes) {
    assert.ok(size >= 24, `font-size ${size}rpx is below 24rpx`);
  }
  assert.match(wxss, /\.card-kicker\s*\{[^}]*font-size:\s*24rpx/s);
});

test('home layout sinks actions with auto margin and keeps 320px scroll contract', () => {
  const wxss = read('miniprogram/pages/home/home.wxss');
  const app = read('miniprogram/app.wxss');
  assert.match(wxss, /\.home-page\s*\{[^}]*display:\s*flex/s);
  assert.match(wxss, /\.home-page\s*\{[^}]*flex-direction:\s*column/s);
  assert.match(wxss, /\.home-actions\s*\{[^}]*margin-top:\s*auto/s);
  assert.match(wxss, /\.home-page::after\s*\{[^}]*flex:\s*1/s);
  assert.match(wxss, /\.home-actions\s*\{[^}]*order:\s*2/s);
  assert.doesNotMatch(wxss, /position:\s*(fixed|sticky)/i);
  assert.match(wxss, /@media\s*\(max-width:\s*320px\)/);
  assert.match(wxss, /flex-direction:\s*column/);
  assert.match(app, /env\(safe-area-inset-bottom\)/);
  assert.match(app, /overflow-x:\s*hidden/);
  // 320px must not permanently pin actions with auto if that fights scroll; allow override
  assert.match(
    wxss,
    /@media\s*\(max-width:\s*320px\)\s*\{[\s\S]*?\.home-actions\s*\{[^}]*margin-top:\s*16rpx/s,
  );
});

test('home plan styles use component-safe class selectors', () => {
  const wxml = read('miniprogram/pages/home/home.wxml');
  const wxss = read('miniprogram/pages/home/home.wxss');
  assert.ok(
    (wxml.match(/class="plan-line-value"/g) || []).length >= 4,
    'all plan status values need an explicit class',
  );
  assert.match(wxss, /\.plan-line-value\s*\{/);
  assert.match(wxss, /\.plan-line\.due\s+\.plan-line-value\s*\{/);
  assert.doesNotMatch(wxss, /\.(?:plan|settlement)-line\s+text\b/);
});
