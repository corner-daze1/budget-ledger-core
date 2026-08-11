import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  addAssetAccount,
  borrowLoan,
  buyInvestment,
  getBillAnalysisModel,
  initializeState,
  payLoanInterest,
  recordEntry,
  recordIncomeEntry,
  recordTransferEntry,
  repayCreditCard,
  repayLoanPrincipal,
  sellInvestment,
  settleCurrentPeriod,
  updateInvestmentValue,
} from '../src/application/app-core.js';
import {
  recordFixedExpense,
  recordRefund,
} from '../src/domain/ledger.js';

const ROOT = new URL('..', import.meta.url);

function baseState({ date = '2026-07-15', budget = '3000' } = {}) {
  return initializeState({
    monthlyBudgetYuan: budget,
    startDay: 1,
    nowDate: date,
    accounts: [{ id: 'cash', name: '现金', type: 'cash', balanceYuan: '20000' }],
  });
}

function expense(state, {
  amount = '100',
  date = '2026-07-15',
  level1 = '餐饮',
  level2 = '午餐',
  controlled = true,
  accountId = 'cash',
} = {}) {
  return recordEntry(state, {
    amountYuan: amount,
    date,
    accountId,
    categoryLevel1: level1,
    categoryLevel2: level2,
    includeControlledBudget: controlled,
  });
}

function sixAccountState() {
  let state = baseState();
  state = addAssetAccount(state, { id: 'bank', name: '储蓄卡', type: 'bank', balanceYuan: '5000' });
  state = addAssetAccount(state, { id: 'card', name: '信用卡', type: 'credit_card', balanceYuan: '1000' });
  state = addAssetAccount(state, { id: 'loan', name: '贷款', type: 'loan', balanceYuan: '3000' });
  state = addAssetAccount(state, { id: 'invest', name: '投资', type: 'investment', balanceYuan: '1000', costBasisYuan: '800' });
  return state;
}

function trendState(count) {
  const state = baseState();
  state.budgetPeriods = Array.from({ length: count }, (_, index) => ({
    id: `p-${index + 1}`,
    startDate: `2026-${String(index + 1).padStart(2, '0')}-01`,
    endDate: `2026-${String(index + 1).padStart(2, '0')}-28`,
    baseBudgetCents: 100000 + index * 1000,
    carryCents: 0,
    netBudgetSpendCents: 50000 + index * 1000,
    status: index === count - 1 ? 'open' : 'closed',
    totalDays: 28,
  }));
  return state;
}

test('分析周期首日和末日都计入且今天之后的交易不进入折线', () => {
  let state = expense(baseState(), { amount: '10', date: '2026-07-01' });
  state = expense(state, { amount: '20', date: '2026-07-15' });
  state = expense(state, { amount: '30', date: '2026-07-31' });
  const model = getBillAnalysisModel(state, { today: '2026-07-15' });
  assert.equal(model.daily.points.length, 15);
  assert.equal(model.daily.points[0].amountCents, 1000);
  assert.equal(model.daily.points.at(-1).amountCents, 2000);
  assert.equal(model.daily.totalCents, 3000);
});

test('跨月过渡周期按真实开始结束日期独立分析', () => {
  const state = baseState();
  state.budgetPeriods[0] = {
    ...state.budgetPeriods[0],
    id: 'transition',
    startDate: '2026-07-28',
    endDate: '2026-08-05',
    totalDays: 9,
    kind: 'transition',
  };
  const model = getBillAnalysisModel(expense(state, { date: '2026-08-01' }), { today: '2026-08-03' });
  assert.equal(model.period.kindLabel, '过渡周期');
  assert.equal(model.daily.points.length, 7);
  assert.equal(model.daily.points[4].date, '2026-08-01');
});

test('今天不属于任何周期时选择最近已结束周期并绘制完整日期', () => {
  const state = baseState({ date: '2026-06-15' });
  const model = getBillAnalysisModel(state, { today: '2026-08-15' });
  assert.equal(model.period.id, 'period-1');
  assert.equal(model.period.statusLabel, '已结束');
  assert.equal(model.daily.endDate, '2026-06-30');
  assert.equal(model.daily.points.length, 30);
});

test('每日折线按自然日稳定升序并给无支出日补零', () => {
  const state = expense(baseState(), { amount: '12.34', date: '2026-07-03' });
  const points = getBillAnalysisModel(state, { today: '2026-07-05' }).daily.points;
  assert.deepEqual(points.map((item) => item.date), [
    '2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05',
  ]);
  assert.deepEqual(points.map((item) => item.amountCents), [0, 0, 1234, 0, 0]);
});

test('空账本仍输出完整周期零点且分类为空', () => {
  const model = getBillAnalysisModel(baseState(), { today: '2026-07-31' });
  assert.equal(model.daily.points.length, 31);
  assert.ok(model.daily.points.every((item) => item.amountCents === 0));
  assert.equal(model.categories.emptyText, '本周期还没有支出');
  assert.deepEqual(model.categories.items, []);
});

test('同一天多笔支出合并为一个每日净额点', () => {
  let state = expense(baseState(), { amount: '10', date: '2026-07-10' });
  state = expense(state, { amount: '25.50', date: '2026-07-10', level1: '交通' });
  const point = getBillAnalysisModel(state, { today: '2026-07-10' }).daily.points.at(-1);
  assert.equal(point.amountCents, 3550);
});

test('信用卡消费按可控支出口径进入每日和分类统计', () => {
  let state = addAssetAccount(baseState(), { id: 'card', name: '信用卡', type: 'credit_card', balanceYuan: '0' });
  state = expense(state, { amount: '120', accountId: 'card', level1: '购物', level2: '数码' });
  const model = getBillAnalysisModel(state, { today: '2026-07-15' });
  assert.equal(model.daily.totalCents, 12000);
  assert.equal(model.categories.items[0].name, '购物');
});

test('固定支出只进入全部支出而不进入可控支出', () => {
  const state = expense(baseState(), { amount: '800', controlled: false, level1: '居住', level2: '房租' });
  assert.equal(getBillAnalysisModel(state, { today: '2026-07-15', scope: 'controlled' }).daily.totalCents, 0);
  assert.equal(getBillAnalysisModel(state, { today: '2026-07-15', scope: 'all' }).daily.totalCents, 80000);
});

test('全部支出排除收入转账借款还本还卡投资买卖和估值', () => {
  let state = sixAccountState();
  state = recordIncomeEntry(state, { amountYuan: '500', date: '2026-07-15', accountId: 'cash' });
  state = recordTransferEntry(state, { amountYuan: '100', date: '2026-07-15', fromAccountId: 'cash', toAccountId: 'bank' });
  state = borrowLoan(state, { amountYuan: '200', date: '2026-07-15', cashAccountId: 'cash', loanAccountId: 'loan' });
  state = repayLoanPrincipal(state, { amountYuan: '100', date: '2026-07-15', cashAccountId: 'cash', loanAccountId: 'loan' });
  state = repayCreditCard(state, { amountYuan: '100', date: '2026-07-15', fromAccountId: 'cash', creditCardAccountId: 'card' });
  state = buyInvestment(state, { amountYuan: '100', date: '2026-07-15', cashAccountId: 'cash', investmentAccountId: 'invest' });
  state = sellInvestment(state, { amountYuan: '50', date: '2026-07-15', cashAccountId: 'cash', investmentAccountId: 'invest' });
  state = updateInvestmentValue(state, { currentValueYuan: '1200', date: '2026-07-15', investmentAccountId: 'invest' });
  assert.equal(getBillAnalysisModel(state, { today: '2026-07-15', scope: 'all' }).daily.totalCents, 0);
});

test('贷款利息作为固定消费进入全部支出', () => {
  const state = payLoanInterest(sixAccountState(), {
    amountYuan: '60',
    date: '2026-07-15',
    cashAccountId: 'cash',
    loanAccountId: 'loan',
  });
  const model = getBillAnalysisModel(state, { today: '2026-07-15', scope: 'all' });
  assert.equal(model.daily.totalCents, 6000);
  assert.equal(model.categories.items[0].name, '利息');
});

test('待结算期间固定支出仍进入全部支出但不进入可控支出', () => {
  let state = settleCurrentPeriod(baseState({ date: '2026-06-15' }), '2026-07-01', { decision: 'discard' });
  state = expense(state, { amount: '50', date: '2026-07-15', controlled: false, level1: '居住', level2: '房租' });
  assert.equal(getBillAnalysisModel(state, { today: '2026-07-15', scope: 'all' }).daily.totalCents, 5000);
  assert.equal(getBillAnalysisModel(state, { today: '2026-07-15', scope: 'controlled' }).daily.totalCents, 0);
});

test('全部支出退款在原消费日重述净额并继承原一级分类', () => {
  let state = expense(baseState(), { amount: '100', date: '2026-07-02', level1: '购物' });
  state = recordRefund(state, { id: 'refund-1', date: '2026-07-10', originalTransactionId: 'entry-1', amountCents: 4000 });
  const model = getBillAnalysisModel(state, { today: '2026-07-10', scope: 'all' });
  assert.equal(model.daily.points[1].amountCents, 6000);
  assert.equal(model.daily.points[9].amountCents, 0);
  assert.equal(model.categories.items[0].name, '购物');
  assert.equal(model.categories.items[0].amountCents, 6000);
});

test('开放周期退款在原消费日重述可控净支出', () => {
  let state = expense(baseState(), { amount: '100', date: '2026-07-02' });
  state = recordRefund(state, { id: 'refund-1', date: '2026-07-10', originalTransactionId: 'entry-1', amountCents: 4000 });
  const model = getBillAnalysisModel(state, { today: '2026-07-10', scope: 'controlled' });
  assert.equal(model.daily.points[1].amountCents, 6000);
  assert.equal(model.daily.points[9].amountCents, 0);
  assert.equal(model.daily.totalCents, 6000);
});

test('关闭周期退款冻结预算结算但重述历史可控净支出', () => {
  let state = expense(baseState({ date: '2026-06-15' }), { amount: '100', date: '2026-06-15' });
  state = settleCurrentPeriod(state, '2026-07-01', { decision: 'carry' });
  state = recordRefund(state, { id: 'refund-closed', date: '2026-07-05', originalTransactionId: 'entry-1', amountCents: 10000 });
  const june = getBillAnalysisModel(state, { today: '2026-06-30', scope: 'controlled' });
  const july = getBillAnalysisModel(state, { today: '2026-07-05', scope: 'controlled' });
  assert.equal(june.daily.totalCents, 0);
  assert.equal(july.daily.totalCents, 0);
  assert.equal(state.budgetPeriods[0].netBudgetSpendCents, 10000);
  assert.equal(state.transactions.at(-1).budgetImpactCents, 0);
});

test('跨期退款只重述原消费周期且退款周期不产生负支出', () => {
  let state = expense(baseState({ date: '2026-06-15' }), { amount: '100', date: '2026-06-15', level1: '购物' });
  state = settleCurrentPeriod(state, '2026-07-01', { decision: 'carry' });
  state = recordRefund(state, { id: 'refund-cross', date: '2026-07-05', originalTransactionId: 'entry-1', amountCents: 3000 });
  const june = getBillAnalysisModel(state, { today: '2026-06-30', scope: 'all' });
  const july = getBillAnalysisModel(state, { today: '2026-07-05', scope: 'all' });
  assert.equal(june.daily.totalCents, 7000);
  assert.equal(july.daily.totalCents, 0);
  assert.equal(july.daily.points.at(-1).amountCents, 0);
  assert.equal(july.categories.items.length, 0);
});

test('分类净额小于等于零时不画扇区但文字合计保留负退款', () => {
  let state = expense(baseState(), { amount: '20', date: '2026-07-02', level1: '购物' });
  state = recordRefund(state, { id: 'refund-all', date: '2026-07-03', originalTransactionId: 'entry-1', amountCents: 2000 });
  const model = getBillAnalysisModel(state, { today: '2026-07-03', scope: 'all' });
  assert.equal(model.categories.netTotalCents, 0);
  assert.deepEqual(model.categories.items, []);
  assert.equal(model.categories.emptyText, '本周期还没有支出');
});

test('退款原账单缺少分类时不会凭空创建其他分类', () => {
  let state = recordFixedExpense(baseState(), { id: 'entry-1', date: '2026-07-02', accountId: 'cash', amountCents: 5000, categoryLevel1: null, categoryLevel2: null });
  state = recordRefund(state, { id: 'refund-1', date: '2026-07-03', originalTransactionId: 'entry-1', amountCents: 1000 });
  const model = getBillAnalysisModel(state, { today: '2026-07-03', scope: 'all' });
  assert.equal(model.categories.items.some((item) => item.name === '其他'), false);
});

test('少于六个预算周期时趋势只展示真实周期', () => {
  const model = getBillAnalysisModel(trendState(3), { today: '2026-03-15' });
  assert.deepEqual(model.trend.periods.map((item) => item.id), ['p-1', 'p-2', 'p-3']);
});

test('等于六个预算周期时趋势按开始日升序完整展示', () => {
  const model = getBillAnalysisModel(trendState(6), { today: '2026-06-15' });
  assert.equal(model.trend.periods.length, 6);
  assert.deepEqual(model.trend.periods.map((item) => item.id), ['p-1', 'p-2', 'p-3', 'p-4', 'p-5', 'p-6']);
});

test('多于六个预算周期时趋势只取最近六个且不伪造月份', () => {
  const model = getBillAnalysisModel(trendState(8), { today: '2026-08-15' });
  assert.deepEqual(model.trend.periods.map((item) => item.id), ['p-3', 'p-4', 'p-5', 'p-6', 'p-7', 'p-8']);
});

test('今天所在真实周期在趋势中标记进行中', () => {
  const model = getBillAnalysisModel(trendState(4), { today: '2026-04-15' });
  assert.equal(model.trend.periods.at(-1).statusLabel, '进行中');
  assert.equal(model.period.statusLabel, '进行中');
});

test('过渡周期在趋势中作为独立周期显示', () => {
  const state = trendState(3);
  state.budgetPeriods[1].kind = 'transition';
  state.budgetPeriods[1].startDate = '2026-02-01';
  state.budgetPeriods[1].endDate = '2026-02-09';
  const model = getBillAnalysisModel(state, { today: '2026-03-15' });
  assert.equal(model.trend.periods[1].kindLabel, '过渡周期');
  assert.equal(model.trend.periods.length, 3);
});

test('趋势实际可用预算包含正结转且直接读取可控净支出', () => {
  const state = trendState(1);
  state.budgetPeriods[0].baseBudgetCents = 300000;
  state.budgetPeriods[0].carryCents = 50000;
  state.budgetPeriods[0].netBudgetSpendCents = 123456;
  const period = getBillAnalysisModel(state, { today: '2026-01-15' }).trend.periods[0];
  assert.equal(period.actualBudgetCents, 350000);
  assert.equal(period.netBudgetSpendCents, 123456);
});

test('趋势实际可用预算遇过大负结转归零而支出保持原值', () => {
  const state = trendState(1);
  state.budgetPeriods[0].baseBudgetCents = 300000;
  state.budgetPeriods[0].carryCents = -400000;
  state.budgetPeriods[0].netBudgetSpendCents = -2000;
  const period = getBillAnalysisModel(state, { today: '2026-01-15' }).trend.periods[0];
  assert.equal(period.actualBudgetCents, 0);
  assert.equal(period.netBudgetSpendCents, -2000);
});

test('切换全部支出不会改变可控预算趋势或隐藏最近流水', () => {
  const state = expense(baseState(), { amount: '80', controlled: false, level1: '居住' });
  const controlled = getBillAnalysisModel(state, { today: '2026-07-15', scope: 'controlled' });
  const all = getBillAnalysisModel(state, { today: '2026-07-15', scope: 'all' });
  assert.deepEqual(all.trend, controlled.trend);
  assert.deepEqual(all.flows, controlled.flows);
  assert.equal(all.flows.length, 1);
});

test('长一级分类名在统计模型中保持原文且不被改写为其他', () => {
  const longName = '跨城家庭共同生活与长期照护支出';
  const state = expense(baseState(), { amount: '66', level1: longName });
  const item = getBillAnalysisModel(state, { today: '2026-07-15' }).categories.items[0];
  assert.equal(item.name, longName);
  assert.equal(item.shareBasisPoints, 10000);
});

test('没有预算周期时三图返回真实空状态而不造演示数据', () => {
  const state = baseState();
  state.budgetPeriods = [];
  const model = getBillAnalysisModel(state, { today: '2026-07-15' });
  assert.equal(model.period, null);
  assert.deepEqual(model.daily.points, []);
  assert.deepEqual(model.trend.periods, []);
  assert.equal(model.emptyText, '暂无可分析预算周期');
});

test('分析模型只读且不会修改传入账本的任何字段', () => {
  const state = expense(baseState(), { amount: '88.88' });
  const before = structuredClone(state);
  getBillAnalysisModel(state, { today: '2026-07-15', scope: 'all' });
  assert.deepEqual(state, before);
});

test('非法分析范围被明确拒绝而不是退回错误口径', () => {
  assert.throws(
    () => getBillAnalysisModel(baseState(), { today: '2026-07-15', scope: 'everything' }),
    /请选择账单分析范围/,
  );
});

test('账单分析页面契约包含范围切换三图文字兜底和最近流水', () => {
  const js = readFileSync(new URL('miniprogram/pages/bills/bills.js', ROOT), 'utf8');
  const wxml = readFileSync(new URL('miniprogram/pages/bills/bills.wxml', ROOT), 'utf8');
  const home = readFileSync(new URL('miniprogram/pages/home/home.wxml', ROOT), 'utf8');
  assert.match(js, /getBillAnalysisModel/);
  assert.match(wxml, /可控支出/);
  assert.match(wxml, /全部支出/);
  assert.match(wxml, /每日净支出/);
  assert.match(wxml, /一级分类净支出占比/);
  assert.match(wxml, /实际可用预算.*可控净支出/s);
  assert.match(wxml, /最近流水/);
  assert.match(wxml, /本周期还没有支出/);
  assert.match(home, /账单分析/);
});
