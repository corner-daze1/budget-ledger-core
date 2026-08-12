import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  addAssetAccount,
  createScheduledPlan,
  disableScheduledPlan,
  dismissOverduePlanBanner,
  editScheduledPlan,
  getHomeModel,
  getSettingsModel,
  initializeState,
  loadPersisted,
  processDuePlans,
  retryPendingPlan,
  savePersisted,
} from '../src/application/app-core.js';

const ROOT = new URL('..', import.meta.url);

function baseState({ cashYuan = '10000', cardYuan = '1000', loanYuan = '5000' } = {}) {
  let state = initializeState({
    monthlyBudgetYuan: '3000',
    startDay: 1,
    nowDate: '2028-01-15',
    accounts: [{ id: 'cash', name: '现金', type: 'cash', balanceYuan: cashYuan }],
  });
  state = addAssetAccount(state, { id: 'card', name: '信用卡', type: 'credit_card', balanceYuan: cardYuan });
  state = addAssetAccount(state, { id: 'loan', name: '贷款', type: 'loan', balanceYuan: loanYuan });
  return state;
}

function addPlan(state, overrides = {}) {
  return createScheduledPlan(state, {
    id: overrides.id || 'rent',
    name: overrides.name || '房租',
    type: overrides.type || 'fixed_expense',
    accountId: overrides.accountId || 'cash',
    targetLiabilityAccountId: overrides.targetLiabilityAccountId || null,
    amountYuan: overrides.amountYuan === undefined ? '1000' : overrides.amountYuan,
    principalYuan: overrides.principalYuan,
    interestYuan: overrides.interestYuan,
    categoryLevel1: overrides.categoryLevel1 || '居住',
    recurrence: overrides.recurrence || 'monthly',
    nextDueDate: overrides.nextDueDate || '2028-01-31',
    reminderEnabled: overrides.reminderEnabled ?? true,
    reminderDays: overrides.reminderDays,
  });
}

function storage() {
  const values = new Map();
  return {
    get(key) { return values.get(key); },
    set(key, value) { values.set(key, value); },
  };
}

test('单次固定支出到期后自动记账并结束且不占可控预算', () => {
  const before = addPlan(baseState(), { recurrence: 'one_time', nextDueDate: '2028-01-20' });
  const result = processDuePlans(before, '2028-01-20');
  assert.equal(result.summary.executed.length, 1);
  assert.equal(result.state.transactions.at(-1).kind, 'fixed_expense');
  assert.equal(result.state.accounts.find((item) => item.id === 'cash').balanceCents, 900000);
  assert.equal(result.state.budgetPeriods[0].netBudgetSpendCents, 0);
  assert.equal(result.state.plans[0].active, false);
  assert.equal(result.state.plans[0].nextDueDate, null);
});

test('月度31日计划在短月取月末并在长月恢复31日', () => {
  const result = processDuePlans(addPlan(baseState()), '2028-03-31');
  assert.deepEqual(result.state.transactions.map((item) => item.dueDate), ['2028-01-31', '2028-02-29', '2028-03-31']);
  assert.equal(result.state.plans[0].nextDueDate, '2028-04-30');
});

test('非闰年月度31日计划按2月28日执行', () => {
  const state = addPlan(baseState(), { nextDueDate: '2029-01-31' });
  const result = processDuePlans(state, '2029-02-28');
  assert.deepEqual(result.state.transactions.map((item) => item.dueDate), ['2029-01-31', '2029-02-28']);
  assert.equal(result.state.plans[0].nextDueDate, '2029-03-31');
});

test('年度2月29日计划非闰年取28日并在闰年恢复29日', () => {
  const state = addPlan(baseState(), { recurrence: 'yearly', nextDueDate: '2028-02-29', amountYuan: '100' });
  const result = processDuePlans(state, '2032-02-29');
  assert.deepEqual(
    result.state.transactions.map((item) => item.dueDate),
    ['2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29'],
  );
  assert.equal(result.state.plans[0].nextDueDate, '2033-02-28');
});

test('错过多个月时从最早到期发生期逐笔补记', () => {
  let state = addPlan(baseState(), { id: 'later', nextDueDate: '2028-02-10', amountYuan: '10' });
  state = addPlan(state, { id: 'earlier', nextDueDate: '2028-01-20', amountYuan: '20' });
  const result = processDuePlans(state, '2028-03-10');
  assert.deepEqual(
    result.state.transactions.map((item) => [item.planId, item.dueDate]),
    [
      ['earlier', '2028-01-20'],
      ['later', '2028-02-10'],
      ['earlier', '2028-02-20'],
      ['later', '2028-03-10'],
      ['earlier', '2028-03-20'],
    ].filter(([, date]) => date <= '2028-03-10'),
  );
});

test('同一天重复启动只产生一个发生期结果', () => {
  const first = processDuePlans(addPlan(baseState(), { recurrence: 'one_time', nextDueDate: '2028-01-20' }), '2028-01-20');
  const second = processDuePlans(first.state, '2028-01-20');
  assert.equal(first.state.transactions.length, 1);
  assert.equal(second.state.transactions.length, 1);
  assert.equal(second.state.pendingItems.length, 0);
});

test('同一发生期重复点击处理不会重复流水', () => {
  const state = addPlan(baseState(), { recurrence: 'monthly', nextDueDate: '2028-01-20' });
  const first = processDuePlans(state, '2028-01-20');
  const second = processDuePlans(first.state, '2028-01-20');
  assert.equal(second.state.transactions.filter((item) => item.occurrenceKey === 'rent@2028-01-20').length, 1);
});

test('关闭重开备份后重复检查不重复发生期', () => {
  const store = storage();
  const first = processDuePlans(addPlan(baseState(), { recurrence: 'one_time', nextDueDate: '2028-01-20' }), '2028-01-20').state;
  savePersisted(store, first);
  const restored = loadPersisted(store);
  const second = processDuePlans(restored.state, '2028-01-20');
  assert.equal(second.state.transactions.length, 1);
  assert.equal(second.state.transactions[0].occurrenceKey, 'rent@2028-01-20');
});

test('信用卡计划同时减少资产和卡欠款且不影响预算', () => {
  const state = addPlan(baseState(), {
    type: 'credit_card_repayment',
    targetLiabilityAccountId: 'card',
    amountYuan: '400',
    recurrence: 'one_time',
    nextDueDate: '2028-01-20',
  });
  const result = processDuePlans(state, '2028-01-20').state;
  assert.equal(result.accounts.find((item) => item.id === 'cash').balanceCents, 960000);
  assert.equal(result.accounts.find((item) => item.id === 'card').balanceCents, -60000);
  assert.equal(result.budgetPeriods[0].netBudgetSpendCents, 0);
  assert.equal(result.transactions[0].kind, 'credit_card_repayment');
});

test('信用卡固定还款超过欠款时按原金额形成溢缴余额', () => {
  const before = addPlan(baseState({ cardYuan: '100' }), {
    type: 'credit_card_repayment',
    targetLiabilityAccountId: 'card',
    amountYuan: '200',
    recurrence: 'one_time',
    nextDueDate: '2028-01-20',
  });
  const result = processDuePlans(before, '2028-01-20').state;
  assert.equal(result.pendingItems.length, 0);
  assert.equal(result.transactions.length, 1);
  assert.equal(result.accounts.find((item) => item.id === 'cash').balanceCents, 980000);
  assert.equal(result.accounts.find((item) => item.id === 'card').balanceCents, 10000);
});

test('信用卡金额为空到期转一条中文待处理', () => {
  const state = addPlan(baseState(), {
    type: 'credit_card_repayment',
    targetLiabilityAccountId: 'card',
    amountYuan: '',
    recurrence: 'one_time',
    nextDueDate: '2028-01-20',
  });
  const result = processDuePlans(state, '2028-01-20').state;
  assert.equal(result.pendingItems.length, 1);
  assert.equal(result.pendingItems[0].reasonText, '金额未填写');
  assert.equal(result.transactions.length, 0);
});

test('贷款还款成功原子生成本金和利息两笔流水', () => {
  const state = addPlan(baseState(), {
    type: 'loan_repayment',
    targetLiabilityAccountId: 'loan',
    amountYuan: '',
    principalYuan: '600',
    interestYuan: '40',
    recurrence: 'one_time',
    nextDueDate: '2028-01-20',
  });
  const result = processDuePlans(state, '2028-01-20').state;
  assert.deepEqual(result.transactions.map((item) => item.kind), ['loan_principal_repayment', 'fixed_expense']);
  assert.equal(result.transactions[0].occurrenceKey, result.transactions[1].occurrenceKey);
  assert.equal(result.accounts.find((item) => item.id === 'cash').balanceCents, 936000);
  assert.equal(result.accounts.find((item) => item.id === 'loan').balanceCents, 440000);
});

test('贷款还款余额不足时两笔都不记且账户逐字段不变', () => {
  const before = addPlan(baseState({ cashYuan: '100' }), {
    type: 'loan_repayment',
    targetLiabilityAccountId: 'loan',
    amountYuan: '',
    principalYuan: '80',
    interestYuan: '30',
    recurrence: 'one_time',
    nextDueDate: '2028-01-20',
  });
  const result = processDuePlans(before, '2028-01-20').state;
  assert.equal(result.pendingItems[0].reason, 'insufficient_balance');
  assert.equal(result.transactions.length, 0);
  assert.deepEqual(result.accounts, before.accounts);
});

test('贷款本金超过欠款时不记本金也不记利息', () => {
  const before = addPlan(baseState({ loanYuan: '100' }), {
    type: 'loan_repayment',
    targetLiabilityAccountId: 'loan',
    amountYuan: '',
    principalYuan: '120',
    interestYuan: '10',
    recurrence: 'one_time',
    nextDueDate: '2028-01-20',
  });
  const result = processDuePlans(before, '2028-01-20').state;
  assert.equal(result.pendingItems[0].reason, 'liability_insufficient');
  assert.equal(result.transactions.length, 0);
  assert.deepEqual(result.accounts, before.accounts);
});

test('固定支出金额为空只建一个待处理且不改余额', () => {
  const before = addPlan(baseState(), { amountYuan: '', recurrence: 'one_time', nextDueDate: '2028-01-20' });
  const first = processDuePlans(before, '2028-01-20').state;
  const second = processDuePlans(first, '2028-01-20').state;
  assert.equal(second.pendingItems.length, 1);
  assert.equal(second.pendingItems[0].reason, 'amount_required');
  assert.deepEqual(second.accounts, before.accounts);
});

test('固定支出余额不足转待处理且预算与流水不变', () => {
  const before = addPlan(baseState({ cashYuan: '50' }), { amountYuan: '100', recurrence: 'one_time', nextDueDate: '2028-01-20' });
  const result = processDuePlans(before, '2028-01-20').state;
  assert.equal(result.pendingItems[0].reasonText, '账户余额不足');
  assert.equal(result.transactions.length, 0);
  assert.deepEqual(result.budgetPeriods, before.budgetPeriods);
});

test('账户失效时生成中文待处理且不产生交易', () => {
  const state = addPlan(baseState(), { recurrence: 'one_time', nextDueDate: '2028-01-20' });
  const broken = structuredClone(state);
  broken.plans[0].accountId = 'removed-account';
  const result = processDuePlans(broken, '2028-01-20').state;
  assert.equal(result.pendingItems[0].reasonText, '账户已失效');
  assert.equal(result.transactions.length, 0);
  assert.deepEqual(result.accounts, broken.accounts);
});

test('补金额重试成功后待处理解决并绑定交易', () => {
  const pending = processDuePlans(addPlan(baseState(), { amountYuan: '', recurrence: 'one_time', nextDueDate: '2028-01-20' }), '2028-01-20').state;
  const result = retryPendingPlan(pending, { pendingId: pending.pendingItems[0].id, amountYuan: '88' });
  assert.equal(result.pendingItems[0].status, 'resolved');
  assert.deepEqual(result.pendingItems[0].relatedTransactionIds, [result.transactions[0].id]);
  assert.equal(result.transactions[0].amountCents, 8800);
});

test('重试仍余额不足时抛中文错误且原state逐字段不变', () => {
  const pending = processDuePlans(addPlan(baseState({ cashYuan: '50' }), { amountYuan: '100', recurrence: 'one_time', nextDueDate: '2028-01-20' }), '2028-01-20').state;
  const before = structuredClone(pending);
  assert.throws(() => retryPendingPlan(pending, { pendingId: pending.pendingItems[0].id, amountYuan: '100' }), /账户余额不足/);
  assert.deepEqual(pending, before);
});

test('已解决待处理重复重试无效且不重复交易', () => {
  const pending = processDuePlans(addPlan(baseState(), { amountYuan: '', recurrence: 'one_time', nextDueDate: '2028-01-20' }), '2028-01-20').state;
  const once = retryPendingPlan(pending, { pendingId: pending.pendingItems[0].id, amountYuan: '88' });
  const twice = retryPendingPlan(once, { pendingId: once.pendingItems[0].id, amountYuan: '99' });
  assert.strictEqual(twice, once);
  assert.equal(twice.transactions.length, 1);
});

test('编辑只改变未来计划不改已执行流水', () => {
  const executed = processDuePlans(addPlan(baseState(), { nextDueDate: '2028-01-20' }), '2028-01-20').state;
  const beforeTransactions = structuredClone(executed.transactions);
  const changed = editScheduledPlan(executed, { planId: 'rent', amountYuan: '1200', nextDueDate: '2028-02-25' });
  assert.equal(changed.plans[0].amountCents, 120000);
  assert.equal(changed.plans[0].nextDueDate, '2028-02-25');
  assert.deepEqual(changed.transactions, beforeTransactions);
});

test('停用计划只阻止未来发生期且保留历史', () => {
  const executed = processDuePlans(addPlan(baseState(), { nextDueDate: '2028-01-20' }), '2028-01-20').state;
  const stopped = disableScheduledPlan(executed, 'rent');
  const later = processDuePlans(stopped, '2028-03-20').state;
  assert.equal(later.transactions.length, 1);
  assert.equal(later.plans[0].active, false);
});

test('旧计划缺少到期日时只标记待补充且幂等', () => {
  const state = baseState();
  state.plans.push({ id: 'legacy', name: '旧计划', amountCents: 1000, accountId: 'cash', categoryLevel1: '固定支出', active: true });
  const first = processDuePlans(state, '2028-01-20');
  const second = processDuePlans(first.state, '2028-01-20');
  assert.equal(second.state.pendingItems.length, 1);
  assert.equal(second.state.pendingItems[0].reasonText, '待补充计划信息');
  assert.equal(second.state.transactions.length, 0);
  assert.equal(second.state.schemaVersion, 3);
});

test('编辑旧计划补充到期信息后解除待补充标记', () => {
  const state = baseState();
  state.plans.push({ id: 'legacy', name: '旧计划', amountCents: 1000, accountId: 'cash', categoryLevel1: '固定支出', active: true });
  const pending = processDuePlans(state, '2028-01-20').state;
  const edited = editScheduledPlan(pending, { planId: 'legacy', recurrence: 'monthly', nextDueDate: '2028-02-01' });
  assert.equal(edited.pendingItems[0].status, 'resolved');
  assert.equal(edited.plans[0].nextDueDate, '2028-02-01');
});

test('提醒开启默认选择提前1天和当天', () => {
  const state = addPlan(baseState(), { nextDueDate: '2028-01-20', reminderEnabled: true, reminderDays: undefined });
  assert.deepEqual(state.plans[0].reminderDays, [1, 0]);
  assert.equal(getHomeModel(state, '2028-01-19').planReminders[0].daysUntil, 1);
  assert.equal(getHomeModel(state, '2028-01-20').planDueToday[0].daysUntil, 0);
});

test('提醒多选只在选中的提前3天和当天出现', () => {
  const state = addPlan(baseState(), { nextDueDate: '2028-01-20', reminderEnabled: true, reminderDays: [3, 0] });
  assert.equal(getHomeModel(state, '2028-01-17').planReminders.length, 1);
  assert.equal(getHomeModel(state, '2028-01-19').planReminders.length, 0);
  assert.equal(getHomeModel(state, '2028-01-20').planDueToday.length, 1);
});

test('关闭提醒的计划不出现在提前或当天横幅', () => {
  const state = addPlan(baseState(), { nextDueDate: '2028-01-20', reminderEnabled: false });
  assert.equal(getHomeModel(state, '2028-01-19').planReminders.length, 0);
  assert.equal(getHomeModel(state, '2028-01-20').planDueToday.length, 0);
});

test('关闭逾期横幅后待处理仍在首页和设置计划列表可见', () => {
  const pending = processDuePlans(addPlan(baseState(), { amountYuan: '', recurrence: 'one_time', nextDueDate: '2028-01-20' }), '2028-01-20').state;
  assert.equal(getHomeModel(pending, '2028-01-21').showPlanOverdueBanner, true);
  const dismissed = dismissOverduePlanBanner(pending);
  const home = getHomeModel(dismissed, '2028-01-21');
  assert.equal(home.showPlanOverdueBanner, false);
  assert.equal(home.planPendingItems.length, 1);
  assert.equal(getSettingsModel(dismissed, '2028-01-21').pendingPlanItems.length, 1);
});

test('成功自动执行只显示已自动记账且不显示逾期', () => {
  const result = processDuePlans(addPlan(baseState(), { recurrence: 'one_time', nextDueDate: '2028-01-20' }), '2028-01-20');
  const home = getHomeModel(result.state, '2028-01-20', result.summary);
  assert.equal(home.planExecutionMessage, '已自动记账');
  assert.equal(home.planExecutionResults.length, 1);
  assert.equal(home.showPlanOverdueBanner, false);
});

test('计划待处理提醒和发生期键经schemaVersion三备份完整恢复', () => {
  const store = storage();
  const state = processDuePlans(addPlan(baseState(), { amountYuan: '', nextDueDate: '2028-01-20', reminderDays: [3, 1, 0] }), '2028-01-20').state;
  savePersisted(store, state);
  const restored = loadPersisted(store);
  assert.equal(restored.ok, true);
  assert.deepEqual(restored.state.plans, state.plans);
  assert.deepEqual(restored.state.pendingItems, state.pendingItems);
  assert.equal(restored.state.schemaVersion, 3);
});

test('三类自动计划的预算净支出始终保持原值', () => {
  let state = addPlan(baseState(), { id: 'fixed', amountYuan: '100', recurrence: 'one_time', nextDueDate: '2028-01-20' });
  state = addPlan(state, { id: 'card-plan', type: 'credit_card_repayment', targetLiabilityAccountId: 'card', amountYuan: '100', recurrence: 'one_time', nextDueDate: '2028-01-20' });
  state = addPlan(state, { id: 'loan-plan', type: 'loan_repayment', targetLiabilityAccountId: 'loan', amountYuan: '', principalYuan: '100', interestYuan: '10', recurrence: 'one_time', nextDueDate: '2028-01-20' });
  const beforeBudget = structuredClone(state.budgetPeriods);
  const result = processDuePlans(state, '2028-01-20').state;
  assert.equal(result.budgetPeriods[0].netBudgetSpendCents, beforeBudget[0].netBudgetSpendCents);
  assert.equal(result.transactions.length, 4);
});

test('未来未到期计划不会提前执行或改变state', () => {
  const state = addPlan(baseState(), { recurrence: 'one_time', nextDueDate: '2028-02-20' });
  const result = processDuePlans(state, '2028-01-20');
  assert.strictEqual(result.state, state);
  assert.equal(result.changed, false);
});

test('app启动和回前台复用同一幂等入口且只在变化后保存', () => {
  const app = readFileSync(new URL('miniprogram/app.js', ROOT), 'utf8');
  assert.match(app, /onLaunch\(\)[\s\S]*this\.runDuePlans\(\)/);
  assert.match(app, /onShow\(\)[\s\S]*this\.runDuePlans\(\)/);
  assert.match(app, /core\.processDuePlans/);
  assert.match(app, /if \(result\.changed\)[\s\S]*this\.commitState\(result\.state\)/);
});

test('设置页和首页提供计划创建编辑停用提醒待处理重试及空状态契约', () => {
  const settingsJs = readFileSync(new URL('miniprogram/pages/settings/settings.js', ROOT), 'utf8');
  const settingsWxml = readFileSync(new URL('miniprogram/pages/settings/settings.wxml', ROOT), 'utf8');
  const homeJs = readFileSync(new URL('miniprogram/pages/home/home.js', ROOT), 'utf8');
  const homeWxml = readFileSync(new URL('miniprogram/pages/home/home.wxml', ROOT), 'utf8');
  for (const text of ['createScheduledPlan', 'editScheduledPlan', 'disableScheduledPlan', '提前3天', '提前1天', '当天']) {
    assert.equal(settingsJs.includes(text) || settingsWxml.includes(text), true, `missing settings contract: ${text}`);
  }
  for (const text of ['retryPendingPlan', 'dismissOverduePlanBanner', '已自动记账']) {
    assert.equal(homeJs.includes(text) || homeWxml.includes(text), true, `missing home contract: ${text}`);
  }
  // 首页计划区为事件驱动，不再要求常驻空计划提示文案
  assert.equal(
    homeJs.includes('hasPlanEvents') || homeWxml.includes('hasPlanEvents'),
    true,
    'missing home contract: event-driven hasPlanEvents',
  );
  assert.equal(homeWxml.includes('暂无计划提醒或待处理项'), false, 'home must not keep permanent empty-plan copy');
});
