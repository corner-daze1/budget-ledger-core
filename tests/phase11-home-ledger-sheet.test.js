import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as realCore from '../src/application/app-core.js';
import {
  createLedger,
  recordBorrowing,
  recordCreditCardRepayment,
  recordExpense,
  recordFixedExpense,
  recordIncome,
  recordInvestmentTrade,
  recordLoanInterestAccrual,
  recordLoanPrincipalRepayment,
  recordRefund,
  recordTransfer,
} from '../src/domain/ledger.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function loadHomePage(state = null) {
  let definition;
  const app = {
    globalData: {
      state,
      storageError: '',
      planRunSummary: null,
      homeResetRequested: false,
    },
  };
  const navigations = [];
  const moduleObject = { exports: {} };
  vm.runInNewContext(read('miniprogram/pages/home/home.js'), {
    module: moduleObject,
    exports: moduleObject.exports,
    require(request) {
      if (String(request).includes('application.js')) return realCore;
      throw new Error(`unexpected require: ${request}`);
    },
    Page(page) {
      definition = page;
    },
    getApp: () => app,
    wx: {
      navigateTo({ url }) { navigations.push(['navigateTo', url]); },
      switchTab({ url }) { navigations.push(['switchTab', url]); },
    },
  });
  const instance = {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) {
      this.data = { ...this.data, ...patch };
    },
  };
  for (const [name, handler] of Object.entries(definition)) {
    if (typeof handler === 'function') instance[name] = (...args) => handler.call(instance, ...args);
  }
  return { definition, instance, app, navigations, helpers: moduleObject.exports };
}

function richState() {
  let state = createLedger({
    defaultBudgetCents: 300000,
    accounts: [
      { id: 'cash', name: '现金', type: 'cash', balanceCents: 100000 },
      { id: 'bank', name: '储蓄卡', type: 'bank', balanceCents: 50000 },
      { id: 'card', name: '信用卡', type: 'credit_card', balanceCents: 0 },
      { id: 'loan', name: '借贷', type: 'loan', balanceCents: 0 },
      { id: 'fund', name: '投资', type: 'investment', balanceCents: 0, costBasisCents: 0 },
    ],
    budgetPeriods: [{ id: 'p1', startDate: '2026-08-01', endDate: '2026-08-31', baseBudgetCents: 300000 }],
  });
  state = recordExpense(state, {
    id: 'expense-cash', date: '2026-08-03', accountId: 'cash', amountCents: 1000, budgetPeriodId: 'p1',
    categoryLevel1: '餐饮', categoryLevel2: '早餐',
  });
  state = recordFixedExpense(state, {
    id: 'fixed-cash', date: '2026-08-03', accountId: 'cash', amountCents: 500, categoryLevel1: '居住', categoryLevel2: '水电燃气',
  });
  state = recordIncome(state, { id: 'income', date: '2026-08-03', accountId: 'cash', amountCents: 2000, categoryLevel2: '工资' });
  state = recordTransfer(state, { id: 'transfer', date: '2026-08-02', fromAccountId: 'cash', toAccountId: 'bank', amountCents: 1000 });
  state = recordBorrowing(state, { id: 'borrow', date: '2026-08-02', cashAccountId: 'cash', loanAccountId: 'loan', amountCents: 3000 });
  state = recordLoanPrincipalRepayment(state, { id: 'loan-repay', date: '2026-08-02', cashAccountId: 'cash', loanAccountId: 'loan', amountCents: 500 });
  state = recordLoanInterestAccrual(state, { id: 'loan-interest', date: '2026-08-02', loanAccountId: 'loan', amountCents: 100 });
  state = recordInvestmentTrade(state, { id: 'investment-buy', date: '2026-08-01', side: 'buy', cashAccountId: 'cash', investmentAccountId: 'fund', amountCents: 1000 });
  state = recordInvestmentTrade(state, { id: 'investment-sell', date: '2026-08-01', side: 'sell', cashAccountId: 'cash', investmentAccountId: 'fund', amountCents: 200 });
  state = recordExpense(state, {
    id: 'expense-card', date: '2026-08-01', accountId: 'card', amountCents: 700, budgetPeriodId: 'p1',
    categoryLevel1: '购物', categoryLevel2: '数码',
  });
  state = recordCreditCardRepayment(state, { id: 'card-repay', date: '2026-08-01', fromAccountId: 'cash', creditCardAccountId: 'card', amountCents: 300 });
  state = recordRefund(state, { id: 'refund', date: '2026-08-03', originalTransactionId: 'expense-cash', amountCents: 400 });
  return state;
}

function initializedState() {
  return realCore.initializeState({
    monthlyBudgetYuan: '3000',
    nowDate: '2026-08-03',
    accounts: [{ id: 'cash', name: '现金', type: 'cash', balanceYuan: '1000' }],
  });
}

test('首页契约只允许预算概览态和全屏账本态两个停靠状态', () => {
  const js = read('miniprogram/pages/home/home.js');
  const wxml = read('miniprogram/pages/home/home.wxml');
  assert.match(js, /ledgerMode/);
  assert.match(js, /overview/);
  assert.match(js, /expanded/);
  assert.match(wxml, /ledgerMode/);
  assert.match(wxml, /scroll-view/);
  assert.match(wxml, /scroll-y="\{\{ledgerScrollEnabled\}\}"/);
  assert.doesNotMatch(js, /translateY|partial|intermediate/i);
});

test('首页从真实 listRecentTransactions 读取全部流水而不是截断最近五笔', () => {
  const js = read('miniprogram/pages/home/home.js');
  assert.match(js, /listRecentTransactions/);
  assert.doesNotMatch(js, /listRecentBills/);
  assert.doesNotMatch(js, /slice\s*\(\s*0\s*,\s*5\s*\)/);
  const { helpers } = loadHomePage();
  assert.equal(typeof helpers.buildLedgerGroups, 'function');
});

test('真实流水按日期倒序分组并保留同日现有倒序', () => {
  const { helpers } = loadHomePage();
  const rows = realCore.listRecentTransactions(richState());
  const groups = helpers.buildLedgerGroups(rows);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(groups.map((group) => group.date))), ['2026-08-03', '2026-08-02', '2026-08-01']);
  for (const group of groups) {
    const expected = rows.filter((row) => row.date === group.date).map((row) => row.id);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(group.transactions.map((row) => row.id))), expected);
  }
  assert.equal(groups.flatMap((group) => group.transactions).length, rows.length);
});

test('日汇总分开计算支出和收入并排除转账还款借贷投资', () => {
  const { helpers } = loadHomePage();
  const impact = helpers.transactionImpact;
  const normalizedImpact = (item) => JSON.parse(JSON.stringify(impact(item)));
  assert.deepStrictEqual(normalizedImpact({ kind: 'controlled_expense', amountCents: 100 }), { expenseCents: 100, incomeCents: 0 });
  assert.deepStrictEqual(normalizedImpact({ kind: 'fixed_expense', amountCents: 200 }), { expenseCents: 200, incomeCents: 0 });
  assert.deepStrictEqual(normalizedImpact({ kind: 'income', amountCents: 300 }), { expenseCents: 0, incomeCents: 300 });
  assert.deepStrictEqual(normalizedImpact({ kind: 'refund', amountCents: 400 }), { expenseCents: -400, incomeCents: 0 });
  for (const kind of ['transfer', 'credit_card_repayment', 'borrowing', 'loan_principal_repayment', 'investment_buy', 'investment_sell', 'investment_valuation']) {
    assert.deepStrictEqual(normalizedImpact({ kind, amountCents: 999 }), { expenseCents: 0, incomeCents: 0 }, kind);
  }
  const groups = helpers.buildLedgerGroups(realCore.listRecentTransactions(richState()));
  const day = groups.find((group) => group.date === '2026-08-02');
  assert.equal(day.expenseCents, 100);
  assert.equal(day.incomeCents, 0);
  assert.equal(day.expenseText, '¥1.00');
  assert.equal(day.incomeText, '¥0.00');
});

test('账本分组展示长分类、长金额和每一笔流水详情', () => {
  const { helpers } = loadHomePage();
  const groups = helpers.buildLedgerGroups([{
    id: 'long', date: '2026-08-04', amountCents: 123456789, amount: '¥1234567.89',
    category: '超长分类名称超长分类名称', typeLabel: '可控支出', accountFlow: '现金', note: '长备注', kind: 'controlled_expense',
  }]);
  assert.equal(groups[0].transactions[0].category, '超长分类名称超长分类名称');
  assert.equal(groups[0].transactions[0].amount, '¥1234567.89');
  assert.equal(groups[0].transactions[0].note, '长备注');
});

test('概览账单面板使用可用空间固定停靠高度而不按流水数量增长', () => {
  const wxml = read('miniprogram/pages/home/home.wxml');
  const wxss = read('miniprogram/pages/home/home.wxss');
  assert.match(wxml, /ledger-sheet-\{\{ledgerMode\}\}/);
  assert.match(wxss, /\.ledger-sheet-overview\s*\{[^}]*height:\s*calc\(100vh[^}]*\}/s);
  assert.match(wxss, /\.ledger-sheet-overview\s*\{[^}]*overflow:\s*hidden/s);
  assert.doesNotMatch(wxml, /recentBills\.slice|wx:for[\s\S]{0,100}slice/);
  assert.doesNotMatch(jsText(), /slice\s*\(\s*0\s*,\s*[35]\s*\)/);
});

test('同一账本列表连续用于概览和展开，不复制两套流水循环', () => {
  const wxml = read('miniprogram/pages/home/home.wxml');
  assert.equal((wxml.match(/wx:for="\{\{ledgerGroups\}\}"/g) || []).length, 1);
  assert.match(wxml, /item\.transactions/);
  assert.match(wxml, /item\.expenseText/);
  assert.match(wxml, /item\.incomeText/);
});

test('概览上推切换全屏账本，短滑和取消不进入中间态', () => {
  const { definition, instance } = loadHomePage();
  assert.equal(instance.data.ledgerMode, 'overview');
  definition.onLedgerTouchStart.call(instance, { touches: [{ pageY: 500, pageX: 100 }] });
  definition.onLedgerTouchEnd.call(instance, { changedTouches: [{ pageY: 470, pageX: 100 }] });
  assert.equal(instance.data.ledgerMode, 'overview');
  definition.onLedgerTouchStart.call(instance, { touches: [{ pageY: 500, pageX: 100 }] });
  definition.onLedgerTouchCancel.call(instance);
  assert.equal(instance.data.ledgerMode, 'overview');
  definition.onLedgerTouchStart.call(instance, { touches: [{ pageY: 500, pageX: 100 }] });
  definition.onLedgerTouchEnd.call(instance, { changedTouches: [{ pageY: 400, pageX: 100 }] });
  assert.equal(instance.data.ledgerMode, 'expanded');
  assert.equal(instance.data.ledgerScrollEnabled, true);
});

test('展开账本只有在列表顶部下拉才恢复概览态', () => {
  const { definition, instance } = loadHomePage();
  definition.enterLedger.call(instance);
  instance.data.ledgerScrollTop = 24;
  definition.onLedgerTouchStart.call(instance, { touches: [{ pageY: 200, pageX: 100 }] });
  definition.onLedgerTouchEnd.call(instance, { changedTouches: [{ pageY: 300, pageX: 100 }] });
  assert.equal(instance.data.ledgerMode, 'expanded');
  instance.data.ledgerScrollTop = 0;
  definition.onLedgerTouchStart.call(instance, { touches: [{ pageY: 200, pageX: 100 }] });
  definition.onLedgerTouchEnd.call(instance, { changedTouches: [{ pageY: 300, pageX: 100 }] });
  assert.equal(instance.data.ledgerMode, 'overview');
  assert.equal(instance.data.ledgerScrollEnabled, false);
});

test('展开态滚动只更新 scrollTop，不改变两个停靠状态', () => {
  const { definition, instance } = loadHomePage();
  definition.enterLedger.call(instance);
  definition.onLedgerScroll.call(instance, { detail: { scrollTop: 188 } });
  assert.equal(instance.data.ledgerScrollTop, 188);
  assert.equal(instance.data.ledgerMode, 'expanded');
});

test('分析返回和切换我的再回来不误清理账本停靠状态', () => {
  const { definition, instance, app } = loadHomePage(initializedState());
  definition.enterLedger.call(instance);
  instance.data.ledgerScrollTop = 240;
  definition.onShow.call(instance);
  assert.equal(instance.data.ledgerMode, 'expanded');
  assert.equal(instance.data.ledgerScrollTop, 240);
  assert.equal(app.globalData.homeResetRequested, false);
});

test('记账成功通过一次性首页重置信号回到概览态', () => {
  const entry = read('miniprogram/pages/entry/entry.js');
  const home = read('miniprogram/pages/home/home.js');
  assert.match(entry, /globalData\.homeResetRequested\s*=\s*true/);
  assert.match(home, /homeResetRequested/);
  assert.match(home, /homeResetRequested\s*=\s*false/);
});

test('重复点击当前账本 Tab 调用首页公开重置而不是制造新的业务状态', () => {
  const tab = read('miniprogram/custom-tab-bar/index.js');
  assert.match(tab, /resetHomeLedger/);
  assert.doesNotMatch(tab, /globalData\.(?:state|ledger|transactions)/);
});

test('展开态顶部固定账本和分析入口，底部导航仍由全局组件承担', () => {
  const wxml = read('miniprogram/pages/home/home.wxml');
  const wxss = read('miniprogram/pages/home/home.wxss');
  assert.match(wxml, /ledger-expanded-header/);
  assert.match(wxml, />账本</);
  assert.match(wxml, /bindtap="goBills"/);
  assert.match(wxml, />分析</);
  assert.match(wxss, /\.ledger-expanded-header\s*\{[^}]*flex-shrink:\s*0/s);
  assert.doesNotMatch(wxml, /tab-bar/);
});

test('首页账本保持提醒结算和空状态可达', () => {
  const wxml = read('miniprogram/pages/home/home.wxml');
  for (const token of ['model.needsSettlement', 'model.showPlanOverdueBanner', 'model.planPendingItems.length', 'ledger-empty', '还没有流水']) {
    assert.match(wxml, new RegExp(token.replace('.', '\\.')));
  }
});

test('首页结算只提供未预选的全量带入或全量不带入', () => {
  const js = read('miniprogram/pages/home/home.js');
  const wxml = read('miniprogram/pages/home/home.wxml');
  assert.match(js, /settlementDecisionLabels:\s*\['全部带入', '全部不带入'\]/);
  assert.match(js, /decisionRequired/);
  assert.match(js, /请先选择本期结算方式/);
  assert.match(wxml, /settlementDecisionLabels/);
  assert.match(wxml, /settlementDecisionSelected \? settlementDecisionIndex : ''/);
  assert.doesNotMatch(js, /reward|奖励|positiveMode|overspendMode/);
  assert.doesNotMatch(wxml, /reward|奖励|positiveMode|overspendMode/);
});

test('首页账本在320px下允许长文本换行且不使用逐笔卡片', () => {
  const wxss = read('miniprogram/pages/home/home.wxss');
  assert.match(wxss, /@media\s*\(max-width:\s*320px\)/);
  assert.match(wxss, /\.ledger-row\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  assert.doesNotMatch(wxss, /\.ledger-row\s*\{[^}]*border-radius/s);
  assert.doesNotMatch(wxss, /\.ledger-row\s*\{[^}]*box-shadow/s);
});

function jsText() {
  return read('miniprogram/pages/home/home.js');
}
