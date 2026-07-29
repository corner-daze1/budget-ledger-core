import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  addAssetAccount,
  cancelPendingStartDayChange,
  changeBudgetSettings,
  changeStartDay,
  getHomeModel,
  getSettingsModel,
  initializeState,
  loadPersisted,
  previewStartDayChange,
  recordEntry,
  recordIncomeEntry,
  savePersisted,
  settleCurrentPeriod,
} from '../src/application/app-core.js';
import { planStartDayTransition } from '../src/domain/budget.js';

const ROOT = new URL('..', import.meta.url);

function baseState({ date = '2026-07-15', startDay = 1, budget = '3000' } = {}) {
  return initializeState({
    monthlyBudgetYuan: budget,
    startDay,
    nowDate: date,
    accounts: [{ id: 'cash', name: '现金', type: 'cash', balanceYuan: '10000' }],
  });
}

function stateWithFlow(options) {
  return recordIncomeEntry(baseState(options), {
    amountYuan: '100',
    date: options?.date || '2026-07-15',
    accountId: 'cash',
    categoryLevel2: '工资',
  });
}

function memoryStorage() {
  const values = new Map();
  return {
    get(key) { return values.get(key); },
    set(key, value) { values.set(key, value); },
  };
}

test('仅本周期修改只更新基础预算并逐字段保留财务历史', () => {
  let state = recordEntry(baseState(), {
    amountYuan: '120',
    date: '2026-07-15',
    accountId: 'cash',
    categoryLevel1: '餐饮',
    categoryLevel2: '午餐',
  });
  const before = structuredClone(state);
  state = changeBudgetSettings(state, { newBudgetYuan: '3500', scope: 'only_current', date: '2026-07-15' });
  assert.equal(state.budgetPeriods[0].baseBudgetCents, 350000);
  assert.equal(state.defaultBudgetCents, 300000);
  assert.equal(state.appSettings.monthlyBudgetCents, 300000);
  assert.deepEqual(state.accounts, before.accounts);
  assert.deepEqual(state.transactions, before.transactions);
  assert.equal(state.budgetPeriods[0].netBudgetSpendCents, before.budgetPeriods[0].netBudgetSpendCents);
  assert.equal(state.budgetPeriods[0].carryCents, before.budgetPeriods[0].carryCents);
  assert.equal(state.rewardBalanceCents, before.rewardBalanceCents);
});

test('本周期及以后同时更新当前基础预算和两个默认预算字段', () => {
  const state = changeBudgetSettings(baseState(), { newBudgetYuan: '3600', scope: 'current_and_future', date: '2026-07-15' });
  assert.equal(state.budgetPeriods[0].baseBudgetCents, 360000);
  assert.equal(state.defaultBudgetCents, 360000);
  assert.equal(state.appSettings.monthlyBudgetCents, 360000);
});

test('下周期及以后不改当前周期只更新两个默认预算字段', () => {
  const state = changeBudgetSettings(baseState(), { newBudgetYuan: '2800', scope: 'next_and_future', date: '2026-07-15' });
  assert.equal(state.budgetPeriods[0].baseBudgetCents, 300000);
  assert.equal(state.defaultBudgetCents, 280000);
  assert.equal(state.appSettings.monthlyBudgetCents, 280000);
});

test('正结转在修改本期基础预算后仍参与实际天数累计释放', () => {
  let state = baseState({ date: '2026-06-15' });
  state = settleCurrentPeriod(state, '2026-07-01', { positiveMode: 'carry' });
  assert.equal(state.budgetPeriods[1].carryCents, 300000);
  state = changeBudgetSettings(state, { newBudgetYuan: '3100', scope: 'only_current', date: '2026-07-01' });
  const model = getHomeModel(state, '2026-07-01');
  assert.equal(model.actualBudgetCents, 610000);
  assert.equal(model.todayFreeCents, Math.floor(610000 / 31));
});

test('负结转在修改本期基础预算后保持原值且继续抵扣', () => {
  let state = recordEntry(baseState({ date: '2026-06-15' }), {
    amountYuan: '3500',
    date: '2026-06-15',
    accountId: 'cash',
    categoryLevel1: '购物',
    categoryLevel2: '数码',
  });
  state = settleCurrentPeriod(state, '2026-07-01', { overspendMode: 'carry' });
  assert.equal(state.budgetPeriods[1].carryCents, -50000);
  state = changeBudgetSettings(state, { newBudgetYuan: '3200', scope: 'only_current', date: '2026-07-01' });
  assert.equal(state.budgetPeriods[1].carryCents, -50000);
  assert.equal(getHomeModel(state, '2026-07-01').actualBudgetCents, 270000);
});

test('待结算时拒绝修改本期预算且原状态没有半次修改', () => {
  const state = baseState();
  const before = structuredClone(state);
  assert.throws(
    () => changeBudgetSettings(state, { newBudgetYuan: '4000', scope: 'current_and_future', date: '2026-08-01' }),
    /本期待结算/,
  );
  assert.deepEqual(state, before);
});

test('待结算时仍允许只修改下周期及以后默认预算', () => {
  const state = changeBudgetSettings(baseState(), { newBudgetYuan: '4000', scope: 'next_and_future', date: '2026-08-01' });
  assert.equal(state.budgetPeriods[0].baseBudgetCents, 300000);
  assert.equal(state.defaultBudgetCents, 400000);
});

test('没有流水时修改起始日立即重建当前空周期', () => {
  const state = changeStartDay(baseState({ date: '2026-07-20' }), { newStartDay: 15, date: '2026-07-20' });
  assert.equal(state.appSettings.startDay, 15);
  assert.equal(state.budgetPeriods.length, 1);
  assert.deepEqual(
    { startDate: state.budgetPeriods[0].startDate, endDate: state.budgetPeriods[0].endDate },
    { startDate: '2026-07-15', endDate: '2026-08-14' },
  );
  assert.equal(state.appSettings.pendingStartDayChange, undefined);
});

test('已有流水时起始日只保存待生效规则且不改历史', () => {
  const before = stateWithFlow();
  const state = changeStartDay(before, { newStartDay: 10, date: '2026-07-15' });
  assert.equal(state.appSettings.startDay, 1);
  assert.equal(state.appSettings.pendingStartDayChange.newStartDay, 10);
  assert.deepEqual(state.budgetPeriods, before.budgetPeriods);
  assert.deepEqual(state.accounts, before.accounts);
  assert.deepEqual(state.transactions, before.transactions);
});

test('待生效起始日可以取消且不改财务数据', () => {
  const before = stateWithFlow();
  const pending = changeStartDay(before, { newStartDay: 10, date: '2026-07-15' });
  const state = cancelPendingStartDayChange(pending, { date: '2026-07-15' });
  assert.equal(state.appSettings.pendingStartDayChange, undefined);
  assert.deepEqual(state.accounts, before.accounts);
  assert.deepEqual(state.transactions, before.transactions);
  assert.deepEqual(state.budgetPeriods, before.budgetPeriods);
});

test('待生效起始日再次设置时最后一次规则覆盖前一次', () => {
  let state = changeStartDay(stateWithFlow(), { newStartDay: 10, date: '2026-07-15' });
  state = changeStartDay(state, { newStartDay: 25, date: '2026-07-16' });
  assert.equal(state.appSettings.pendingStartDayChange.newStartDay, 25);
  assert.equal(state.appSettings.pendingStartDayChange.requestedAt, '2026-07-16');
  assert.equal(state.budgetPeriods[0].endDate, '2026-07-31');
});

test('结算旧周期后创建无重叠无断档且按月实际天数折算的过渡周期', () => {
  let state = changeStartDay(stateWithFlow(), { newStartDay: 10, date: '2026-07-15' });
  state = settleCurrentPeriod(state, '2026-08-01', { positiveMode: 'reward' });
  assert.equal(state.budgetPeriods[0].status, 'closed');
  assert.deepEqual(
    { startDate: state.budgetPeriods[1].startDate, endDate: state.budgetPeriods[1].endDate, kind: state.budgetPeriods[1].kind },
    { startDate: '2026-08-01', endDate: '2026-08-09', kind: 'transition' },
  );
  assert.equal(state.budgetPeriods[1].baseBudgetCents, Math.floor(300000 * 9 / 31));
  assert.equal(state.appSettings.startDay, 1);
});

test('结算过渡周期后从目标日期建立常规周期并正式启用新起始日', () => {
  let state = changeStartDay(stateWithFlow(), { newStartDay: 10, date: '2026-07-15' });
  state = settleCurrentPeriod(state, '2026-08-01', { positiveMode: 'reward' });
  state = settleCurrentPeriod(state, '2026-08-10', { positiveMode: 'reward' });
  assert.equal(state.appSettings.startDay, 10);
  assert.equal(state.appSettings.pendingStartDayChange, undefined);
  assert.deepEqual(
    { startDate: state.budgetPeriods[2].startDate, endDate: state.budgetPeriods[2].endDate },
    { startDate: '2026-08-10', endDate: '2026-09-09' },
  );
  assert.equal(state.budgetPeriods[1].endDate < state.budgetPeriods[2].startDate, true);
});

test('闰年二月和31日起始日的过渡预算按过渡开始月份精确折算', () => {
  const planned = planStartDayTransition({
    currentPeriodEndDate: '2028-01-31',
    newStartDay: 31,
    defaultMonthlyBudgetCents: 300000,
  });
  assert.deepEqual(
    { startDate: planned.transition.startDate, endDate: planned.transition.endDate, totalDays: planned.transition.totalDays },
    { startDate: '2028-02-01', endDate: '2028-02-28', totalDays: 28 },
  );
  assert.equal(planned.transition.baseBudgetCents, Math.floor(300000 * 28 / 29));
  assert.deepEqual(
    { startDate: planned.nextCycle.startDate, endDate: planned.nextCycle.endDate },
    { startDate: '2028-02-29', endDate: '2028-03-30' },
  );
});

test('跨年起始日规划保持日期连续并正确处理30日', () => {
  const planned = planStartDayTransition({
    currentPeriodEndDate: '2026-12-09',
    newStartDay: 30,
    defaultMonthlyBudgetCents: 310000,
  });
  assert.deepEqual(
    { startDate: planned.transition.startDate, endDate: planned.transition.endDate },
    { startDate: '2026-12-10', endDate: '2026-12-29' },
  );
  assert.deepEqual(
    { startDate: planned.nextCycle.startDate, endDate: planned.nextCycle.endDate },
    { startDate: '2026-12-30', endDate: '2027-01-29' },
  );
});

test('待生效规则经schemaVersion一存储往返后完整恢复', () => {
  const storage = memoryStorage();
  const state = changeStartDay(stateWithFlow(), { newStartDay: 10, date: '2026-07-15' });
  savePersisted(storage, state);
  const restored = loadPersisted(storage);
  assert.equal(restored.ok, true);
  assert.deepEqual(restored.state.appSettings.pendingStartDayChange, state.appSettings.pendingStartDayChange);
  assert.deepEqual(restored.state.accounts, state.accounts);
  assert.deepEqual(restored.state.transactions, state.transactions);
  assert.equal(restored.state.schemaVersion, 1);
});

test('预算修改逐字段保持资产负债投资流水和奖励余额不变', () => {
  let state = baseState({ date: '2026-06-15' });
  state = settleCurrentPeriod(state, '2026-07-01', { positiveMode: 'reward' });
  state = addAssetAccount(state, { id: 'card', name: '信用卡', type: 'credit_card', balanceYuan: '500' });
  state = addAssetAccount(state, { id: 'loan', name: '贷款', type: 'loan', balanceYuan: '3000' });
  state = addAssetAccount(state, { id: 'fund', name: '投资', type: 'investment', balanceYuan: '1000', costBasisYuan: '800' });
  state = recordIncomeEntry(state, { amountYuan: '100', date: '2026-07-01', accountId: 'cash', categoryLevel2: '工资' });
  const before = {
    accounts: structuredClone(state.accounts),
    transactions: structuredClone(state.transactions),
    rewardBalanceCents: state.rewardBalanceCents,
  };
  const changed = changeBudgetSettings(state, { newBudgetYuan: '3300', scope: 'current_and_future', date: '2026-07-01' });
  assert.deepEqual(changed.accounts, before.accounts);
  assert.deepEqual(changed.transactions, before.transactions);
  assert.equal(changed.rewardBalanceCents, before.rewardBalanceCents);
});

test('待生效期间修改默认预算后过渡周期使用最新默认值折算', () => {
  let state = changeStartDay(stateWithFlow(), { newStartDay: 10, date: '2026-07-15' });
  state = changeBudgetSettings(state, { newBudgetYuan: '3100', scope: 'next_and_future', date: '2026-07-15' });
  state = settleCurrentPeriod(state, '2026-08-01', { positiveMode: 'reward' });
  assert.equal(state.budgetPeriods[1].baseBudgetCents, Math.floor(310000 * 9 / 31));
});

test('进入过渡周期后取消会明确失败并保持连续性规则', () => {
  let state = changeStartDay(stateWithFlow(), { newStartDay: 10, date: '2026-07-15' });
  state = settleCurrentPeriod(state, '2026-08-01', { positiveMode: 'reward' });
  const before = structuredClone(state);
  assert.throws(() => cancelPendingStartDayChange(state, { date: '2026-08-01' }), /已进入过渡周期/);
  assert.deepEqual(state, before);
});

test('设置模型同时公开当前周期默认预算和待生效说明', () => {
  const state = changeStartDay(stateWithFlow(), { newStartDay: 10, date: '2026-07-15' });
  const model = getSettingsModel(state, '2026-07-15');
  assert.equal(model.currentPeriodStartDate, '2026-07-01');
  assert.equal(model.currentPeriodEndDate, '2026-07-31');
  assert.equal(model.currentBaseBudget, '¥3000.00');
  assert.equal(model.defaultBudget, '¥3000.00');
  assert.equal(model.startDay, 1);
  assert.equal(model.pendingStartDay, 10);
  assert.match(model.pendingExplanation, /生效前可以取消或改期/);
});

test('设置页契约包含三个预算范围二次确认起始日预览取消和固定开支提示', () => {
  const js = readFileSync(new URL('miniprogram/pages/settings/settings.js', ROOT), 'utf8');
  const wxml = readFileSync(new URL('miniprogram/pages/settings/settings.wxml', ROOT), 'utf8');
  for (const text of ['仅本周期', '本周期及以后', '下周期及以后', 'showModal', 'previewStartDayChange', 'cancelPendingStartDayChange']) {
    assert.equal(js.includes(text) || wxml.includes(text), true, `missing lifecycle contract: ${text}`);
  }
  assert.match(wxml, /房租、房贷、车贷/);
});
