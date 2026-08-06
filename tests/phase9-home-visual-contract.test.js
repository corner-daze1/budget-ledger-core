import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);

function read(relativePath) {
  return fs.readFileSync(new URL(relativePath, root), 'utf8');
}

function relativeLuminance(hex) {
  const raw = String(hex).trim().replace(/^#/, '');
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`invalid hex: ${hex}`);
  const channels = [0, 2, 4].map((i) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(fg, bg) {
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

function firstColor(wxss, selectorSource, property) {
  const re = new RegExp(`${selectorSource}\\s*\\{([^}]*)\\}`, 's');
  const m = wxss.match(re);
  assert.ok(m, `missing rule ${selectorSource}`);
  const pm = m[1].match(new RegExp(`${property}\\s*:\\s*(#[0-9a-fA-F]{3,8})`, 'i'));
  assert.ok(pm, `missing ${property} in ${selectorSource}`);
  return pm[1];
}

function loadHomePage(listRecentTransactionsImpl) {
  const navigations = [];
  const listCalls = [];
  const core = {
    todayIso: () => '2026-08-03',
    getHomeModel: () => ({
      todayFree: '¥100.00',
      todayFreeCents: 10000,
      fullSingleDayQuota: '¥50.00',
      fullSingleDayQuotaCents: 5000,
      prepaid: '¥0.00',
      prepaidCents: 0,
      earliestRecoveryDate: null,
      periodStartDate: '2026-08-01',
      periodEndDate: '2026-08-31',
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
    listRecentTransactions: (state) => {
      listCalls.push(state);
      if (typeof listRecentTransactionsImpl === 'function') return listRecentTransactionsImpl(state);
      return [
        {
          id: 't1',
          kind: 'controlled_expense',
          typeLabel: '可控支出',
          date: '2026-08-02',
          amount: '¥12.00',
          amountCents: 1200,
          categoryLevel1: '餐饮',
          categoryLevel2: '早餐',
          category: '餐饮 · 早餐',
          account: '现金',
          accountFlow: '现金',
          budgetType: '可控',
        },
      ];
    },
  };
  let definition;
  const moduleObj = { exports: {} };
  vm.runInNewContext(read('miniprogram/pages/home/home.js'), {
    module: moduleObj,
    exports: moduleObj.exports,
    require(request) {
      if (String(request).includes('application.js')) return core;
      throw new Error(`unexpected require: ${request}`);
    },
    Page(page) {
      definition = page;
    },
    getApp: () => ({
      globalData: {
        state: { accounts: [], transactions: [] },
        storageError: '',
        planRunSummary: null,
      },
      saveState() {},
    }),
    wx: {
      navigateTo({ url }) { navigations.push(['navigateTo', url]); },
      redirectTo({ url }) { navigations.push(['redirectTo', url]); },
      switchTab({ url }) { navigations.push(['switchTab', url]); },
    },
  });
  return { definition, navigations, listCalls, core, helpers: moduleObj.exports };
}

function mediaBlock(wxss) {
  const m = wxss.match(/@media\s*\(\s*max-width:\s*320px\s*\)\s*\{([\s\S]*)\}\s*$/);
  assert.ok(m, 'missing @media (max-width: 320px) block');
  return m[1];
}

function minHeightRpx(wxss, selector) {
  const re = new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`, 's');
  const m = wxss.match(re);
  assert.ok(m, `missing .${selector}`);
  const hm = m[1].match(/min-height\s*:\s*([\d.]+)rpx/i);
  assert.ok(hm, `.${selector} missing min-height rpx`);
  return Number(hm[1]);
}

test('home binds real free amount quota prepaid recovery and scale fields', () => {
  const wxml = read('miniprogram/pages/home/home.wxml');
  for (const token of [
    'model.todayFree',
    '今日可自由花',
    'model.fullSingleDayQuota',
    'model.prepaid',
    'model.earliestRecoveryDate',
    'model.prepaidCents',
    '已预支未来额度',
    '恢复至每日',
  ]) {
    assert.match(wxml, new RegExp(token.replace(/\./g, '\\.')));
  }
  assert.doesNotMatch(wxml, /YONGDU|TODAY/);
  assert.doesNotMatch(wxml, /月预算百分比|预算进度条百分比/);
});

test('home.js loads all ledger rows through core.listRecentTransactions without a five-row cap', () => {
  const js = read('miniprogram/pages/home/home.js');
  assert.match(js, /listRecentTransactions/);
  assert.doesNotMatch(js, /listRecentBills/);
  assert.doesNotMatch(js, /\.slice\s*\(\s*0\s*,\s*5\s*\)|slice\(0,\s*5\)/);
  const { definition, listCalls } = loadHomePage();
  definition.setData = function setData(patch) {
    this.data = { ...this.data, ...patch };
  };
  definition.data = definition.data || {};
  definition.onShow();
  assert.equal(listCalls.length, 1);
  assert.ok(Array.isArray(definition.data.ledgerGroups));
  assert.equal(definition.data.ledgerTransactionCount, 1);
});

test('home covers settlement prepaid plan pending error and bills-empty states', () => {
  const wxml = read('miniprogram/pages/home/home.wxml');
  assert.match(wxml, /model\.needsSettlement/);
  assert.match(wxml, /model\.prepaidCents\s*>\s*0/);
  assert.match(wxml, /model\.showPlanOverdueBanner/);
  assert.match(wxml, /model\.planPendingItems\.length/);
  assert.match(wxml, /model\.planReminders|model\.planDueToday|model\.planExecutionResults/);
  assert.match(wxml, /wx:if="\{\{error\}\}"/);
  assert.match(wxml, /还没有流水，用底部“记一笔”记下第一笔/);
  assert.match(wxml, /ledgerGroups\.length/);
  assert.match(wxml, /ledgerTransactionCount/);
  // plan block only when events exist — not a permanent empty-plan card
  assert.doesNotMatch(wxml, /class="[^"]*plan-card[^"]*"[\s\S]{0,40}暂无计划提醒/);
});

test('home keeps settlement pending overdue and bills navigation handlers', () => {
  const { definition, navigations } = loadHomePage();
  for (const name of [
    'goBills',
    'settlePeriod',
    'retryPendingPlan',
    'dismissPlanOverdueBanner',
    'onPositiveModeChange',
    'onOverspendModeChange',
  ]) {
    assert.equal(typeof definition[name], 'function', `missing ${name}`);
  }
  definition.goBills();
  assert.deepEqual(navigations, [
    ['navigateTo', '/pages/bills/bills'],
  ]);
  const wxml = read('miniprogram/pages/home/home.wxml');
  assert.match(wxml, /bindtap="goBills"/);
  assert.doesNotMatch(wxml, /bindtap="goEntry"|bindtap="goSettings"/);
  assert.match(wxml, /bindtap="settlePeriod"/);
  assert.match(wxml, /bindtap="retryPendingPlan"/);
  assert.match(wxml, /bindtap="dismissPlanOverdueBanner"/);
  assert.doesNotMatch(wxml, /＋\s*记一笔|＋记一笔/);
  assert.match(wxml, /全部/);
  assert.doesNotMatch(wxml, /资产中心/);
  assert.doesNotMatch(wxml, /bindtap="goAssets"/);
});

test('home layout order is header budget bills then conditional alerts', () => {
  const wxml = read('miniprogram/pages/home/home.wxml');
  const header = wxml.indexOf('home-header');
  const budget = wxml.indexOf('budget-card');
  const bills = wxml.indexOf('ledger-sheet');
  const plan = wxml.indexOf('plan-section');
  assert.ok(header >= 0 && budget > header);
  assert.ok(bills > budget);
  assert.ok(plan > bills);
  assert.doesNotMatch(wxml, /bindtap="goSettings"|class="[^"]*manage-link/);
});

test('home styles freeze warm sample tokens tap size and 320 rules', () => {
  const wxss = read('miniprogram/pages/home/home.wxss');
  const app = read('miniprogram/app.wxss');
  for (const token of ['#F6F5F0', '#FFFFFF', '#202521', '#5F665F', '#3E725E', '#E8F0EB', '#B85A4A', '#E5E7E2']) {
    assert.match(wxss, new RegExp(token, 'i'));
  }
  assert.match(wxss, /min-height:\s*88rpx/);
  assert.match(wxss, /@media\s*\(max-width:\s*320px\)/);
  assert.match(wxss, /overflow-wrap:\s*anywhere|word-break/);
  assert.doesNotMatch(wxss, /position:\s*(fixed|sticky)/i);
  assert.doesNotMatch(wxss, /url\s*\(/i);
  assert.match(app, /env\(safe-area-inset-bottom\)/);
  const sizes = [...wxss.matchAll(/font-size\s*:\s*([\d.]+)rpx/gi)].map((m) => Number(m[1]));
  assert.ok(sizes.length > 0);
  for (const size of sizes) assert.ok(size >= 24, `font-size ${size}rpx < 24`);
});

test('home body and primary colors meet WCAG contrast ≥4.5 on shipped hex', () => {
  const wxss = read('miniprogram/pages/home/home.wxss');
  const pageBg = firstColor(wxss, '\\.home-page', 'background');
  const body = firstColor(wxss, '\\.home-page', 'color');
  const secondary = firstColor(wxss, '\\.home-secondary-text', 'color');
  const primaryBg = firstColor(wxss, '\\.home-primary-cta', 'background');
  const primaryFg = firstColor(wxss, '\\.home-primary-cta', 'color');
  assert.match(pageBg, /#f6f5f0/i);
  assert.match(body, /#202521/i);
  assert.match(secondary, /#5f665f/i);
  assert.match(primaryBg, /#3e725e/i);
  assert.match(primaryFg, /#ffffff/i);
  const cBody = contrastRatio(body, pageBg);
  const cSecondary = contrastRatio(secondary, pageBg);
  const cPrimary = contrastRatio(primaryFg, primaryBg);
  assert.ok(cBody >= 4.5, `body contrast ${cBody}`);
  assert.ok(cSecondary >= 4.5, `secondary contrast ${cSecondary}`);
  assert.ok(cPrimary >= 4.5, `primary contrast ${cPrimary}`);
  assert.notEqual(cBody, 4.5);
  assert.notEqual(cSecondary, 4.5);
  assert.notEqual(cPrimary, 4.5);
});

test('design system documents warm sample structure and bans', () => {
  const doc = read('docs/PHASE9_DESIGN_SYSTEM.md');
  for (const token of [
    '#F7F3EA',
    '#FFFDFA',
    '#22231F',
    '#756B63',
    '#D8F15A',
    '#5F7055',
    '#A94D3B',
    '今日可自由花',
    '记一笔',
    '最近账单',
    '预算刻度',
    '预支',
  ]) {
    assert.ok(doc.toLowerCase().includes(token.toLowerCase()), `missing ${token}`);
  }
  assert.ok(doc.includes('不要黑色金融主卡') || doc.includes('禁止') || doc.includes('禁区'));
  assert.match(doc, /YONGDU|英文装饰眉题/);
});

test('home bill rows bind real category date account amount fields', () => {
  const wxml = read('miniprogram/pages/home/home.wxml');
  assert.match(wxml, /wx:for="\{\{ledgerGroups\}\}"/);
  assert.match(wxml, /item\.transactions/);
  assert.match(wxml, /transaction\.category/);
  assert.match(wxml, /transaction\.date/);
  assert.match(wxml, /transaction\.accountFlow/);
  assert.match(wxml, /transaction\.amount/);
  assert.match(wxml, /还没有流水，用底部“记一笔”记下第一笔/);
});

test('home scale is status expression not a fake month percent bar', () => {
  const js = read('miniprogram/pages/home/home.js');
  const wxml = read('miniprogram/pages/home/home.wxml');
  assert.match(js, /buildScale|fillPercent/);
  assert.match(wxml, /scale\.fillPercent|scale-fill/);
  assert.match(wxml, /单日基准/);
  assert.doesNotMatch(wxml, /月预算已用|月度进度百分比/);
  assert.doesNotMatch(js, /monthlyBudgetPercent|monthBudgetPercent/);
});

test('home.wxml has no hidden empty-plan contract anchors or source tokens', () => {
  const wxml = read('miniprogram/pages/home/home.wxml');
  assert.doesNotMatch(wxml, /暂无计划提醒或待处理项/);
  assert.doesNotMatch(wxml, /阶段契约锚点/);
  assert.doesNotMatch(wxml, /源码保留/);
  // ban CSS/attribute hide tricks; allow legitimate aria-hidden decorative markers
  assert.doesNotMatch(wxml, /(?<!aria-)hidden\s*=\s*["']true["']/i);
  assert.doesNotMatch(wxml, /display\s*:\s*none/i);
  assert.doesNotMatch(wxml, /visibility\s*:\s*hidden/i);
  // no permanently-visible empty plan card copy
  assert.doesNotMatch(wxml, /wx:else[\s\S]{0,80}暂无计划/);
  assert.doesNotMatch(wxml, /class="[^"]*plan-card[^"]*"[\s\S]{0,120}暂无计划/);
});

test('hasPlanEvents is false for overdue-only or pending-only; true only for generic summary fields', () => {
  const { helpers } = loadHomePage();
  assert.equal(typeof helpers.hasPlanEvents, 'function', 'home.js must export hasPlanEvents for contract tests');

  const base = {
    showPlanOverdueBanner: false,
    planOverdueItems: [],
    planExecutionResults: [],
    planReminders: [],
    planDueToday: [],
    planPendingItems: [],
    planExecutionMessage: '',
  };

  assert.equal(helpers.hasPlanEvents(null), false);
  assert.equal(helpers.hasPlanEvents(base), false);

  assert.equal(helpers.hasPlanEvents({
    ...base,
    showPlanOverdueBanner: true,
    planOverdueItems: [{ occurrenceKey: 'x' }],
  }), false, 'overdue banner alone must not open generic plan card');

  assert.equal(helpers.hasPlanEvents({
    ...base,
    planPendingItems: [{ id: 'p1', planName: '房租' }],
  }), false, 'pending items alone must not open generic plan card');

  assert.equal(helpers.hasPlanEvents({
    ...base,
    planExecutionResults: [{ occurrenceKey: 'o1', planName: '水电', dueDate: '2026-08-01' }],
  }), true);

  assert.equal(helpers.hasPlanEvents({
    ...base,
    planReminders: [{ planId: 'r1', planName: '信用卡', message: '提前1天' }],
  }), true);

  assert.equal(helpers.hasPlanEvents({
    ...base,
    planDueToday: [{ planId: 'd1', planName: '保险' }],
  }), true);

  assert.equal(helpers.hasPlanEvents({
    ...base,
    planExecutionMessage: '已自动处理 1 项计划',
  }), true);

  // combination: overdue + pending still false for generic card
  assert.equal(helpers.hasPlanEvents({
    ...base,
    showPlanOverdueBanner: true,
    planPendingItems: [{ id: 'p2' }],
  }), false);
});

test('formatBillCategory filters null/undefined and falls back to 未分类', () => {
  const { helpers } = loadHomePage();
  assert.equal(typeof helpers.formatBillCategory, 'function', 'home.js must export formatBillCategory');

  assert.equal(helpers.formatBillCategory({ categoryLevel1: '餐饮', categoryLevel2: '早餐' }), '餐饮 · 早餐');
  assert.equal(helpers.formatBillCategory({ categoryLevel1: '利息', categoryLevel2: null }), '利息');
  assert.equal(helpers.formatBillCategory({ categoryLevel1: '利息', categoryLevel2: undefined }), '利息');
  assert.equal(helpers.formatBillCategory({ categoryLevel1: '利息', categoryLevel2: 'null' }), '利息');
  assert.equal(helpers.formatBillCategory({ categoryLevel1: '利息', categoryLevel2: 'undefined' }), '利息');
  assert.equal(helpers.formatBillCategory({ categoryLevel1: null, categoryLevel2: null }), '未分类');
  assert.equal(helpers.formatBillCategory({ categoryLevel1: '', categoryLevel2: '' }), '未分类');
  assert.equal(helpers.formatBillCategory({ categoryLevel1: 'null', categoryLevel2: 'undefined' }), '未分类');
  assert.equal(helpers.formatBillCategory({ categoryLevel1: '  ', categoryLevel2: null }), '未分类');
  assert.equal(helpers.formatBillCategory({ categoryLevel1: null, categoryLevel2: '还款' }), '还款');
  assert.equal(helpers.formatBillCategory({}), '未分类');
  assert.equal(helpers.formatBillCategory(null), '未分类');

  const labels = [
    helpers.formatBillCategory({ categoryLevel1: '利息', categoryLevel2: null }),
    helpers.formatBillCategory({ categoryLevel1: undefined, categoryLevel2: undefined }),
    helpers.formatBillCategory({ categoryLevel1: 'A', categoryLevel2: 'null' }),
  ];
  for (const label of labels) {
    assert.doesNotMatch(label, /\bnull\b/i);
    assert.doesNotMatch(label, /\bundefined\b/i);
  }
});

test('home onShow uses formatBillCategory from categoryLevel1/2 not string replace theater', () => {
  const js = read('miniprogram/pages/home/home.js');
  assert.match(js, /formatBillCategory/);
  assert.match(js, /categoryLevel1|categoryLevel2/);
  // ban pure string-replace of " · null" as the only sanitizer
  assert.doesNotMatch(js, /replace\s*\(\s*\/\\s\*·\\s\*null/);

  const { definition } = loadHomePage(() => [
    {
      id: 'bad',
      kind: 'fixed_expense',
      typeLabel: '利息支付',
      date: '2026-08-01',
      amount: '¥1.00',
      amountCents: 100,
      categoryLevel1: '利息',
      categoryLevel2: null,
      category: '利息 · null',
      account: '现金',
      accountFlow: '现金',
      budgetType: '固定',
    },
  ]);
  definition.setData = function setData(patch) {
    this.data = { ...this.data, ...patch };
  };
  definition.data = definition.data || {};
  definition.onShow();
  assert.equal(definition.data.ledgerGroups[0].transactions[0].category, '利息');
  assert.doesNotMatch(definition.data.ledgerGroups[0].transactions[0].category, /null|undefined/i);
});

test('320px keeps header row and bill row horizontal; bill list action ≥88rpx', () => {
  const wxss = read('miniprogram/pages/home/home.wxss');
  const media = mediaBlock(wxss);

  // header row must not become column inside 320 media
  assert.doesNotMatch(media, /\.home-header-row[\s\S]{0,120}flex-direction\s*:\s*column/i);
  // do not list home-header-row in a shared column group
  const columnGroup = media.match(/([^{}]+)\{\s*flex-direction\s*:\s*column/gi) || [];
  for (const group of columnGroup) {
    assert.doesNotMatch(group, /home-header-row/);
  }

  // all-link must not be width:100% in 320 media
  assert.doesNotMatch(media, /\.all-link[\s\S]{0,80}width\s*:\s*100%/i);
  const widthGroup = media.match(/([^{}]+)\{\s*width\s*:\s*100%/gi) || [];
  for (const group of widthGroup) {
    assert.doesNotMatch(group, /all-link/);
  }

  // bill main shrinks; amount does not
  assert.match(wxss, /\.bill-main\s*\{[^}]*flex(?:-shrink)?\s*:\s*(?:1|0?\.\d+)/s);
  assert.match(wxss, /\.bill-amount\s*\{[^}]*flex-shrink\s*:\s*0/s);

  // bill-row must not be forced to column at 320
  assert.doesNotMatch(media, /\.bill-row[\s\S]{0,80}flex-direction\s*:\s*column/i);
  for (const group of columnGroup) {
    assert.doesNotMatch(group, /(?:^|[\s,])\.?bill-row(?:[\s,]|$)/);
  }

  assert.ok(minHeightRpx(wxss, 'all-link') >= 88, 'all-link min-height must be ≥88rpx');
});
