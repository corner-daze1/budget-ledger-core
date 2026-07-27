import test from 'node:test';
import assert from 'node:assert/strict';
import {
  categoryOptions,
  findPreviousSimilar,
  formatCents,
  getHomeModel,
  getSettingsModel,
  initializeState,
  listRecentBills,
  loadPersisted,
  parseYuanToCents,
  recordEntry,
  savePersisted,
  todayIso,
} from '../src/application/app-core.js';

function readyState(nowDate = '2028-01-01') {
  return initializeState({
    monthlyBudgetYuan: '3000',
    startDay: 1,
    nowDate,
    accounts: [
      { id: 'cash', name: '现金', type: 'cash', balanceYuan: '1000' },
      { id: 'bank', name: '储蓄卡', type: 'bank', balanceYuan: '500' },
    ],
  });
}

function memoryStorage(value = null) {
  return {
    value,
    get() { return this.value; },
    set(_key, next) { this.value = next; },
  };
}

test('parseYuanToCents parses two decimal yuan without floating arithmetic', () => assert.equal(parseYuanToCents('12.30'), 1230));
test('parseYuanToCents pads a one digit fractional yuan amount', () => assert.equal(parseYuanToCents('12.3'), 1230));
test('parseYuanToCents rejects a third decimal place instead of rounding', () => assert.throws(() => parseYuanToCents('12.345'), /最多两位/));
test('parseYuanToCents rejects amounts beyond safe integer cents', () => assert.throws(() => parseYuanToCents('9007199254740992'), /安全记录/));
test('formatCents renders a signed integer-cent amount for UI display', () => assert.equal(formatCents(-5), '¥-0.05'));
test('todayIso uses the supplied local calendar date', () => assert.equal(todayIso(new Date(2028, 6, 9)), '2028-07-09'));
test('initializeState creates a current budget period and stores start-day settings', () => {
  const state = readyState();
  assert.equal(state.defaultBudgetCents, 300000);
  assert.equal(state.budgetPeriods[0].startDate, '2028-01-01');
  assert.equal(state.appSettings.startDay, 1);
});
test('initializeState accepts multiple initial cash-like asset accounts', () => assert.equal(readyState().accounts.length, 2));
test('initializeState rejects setup without an initial asset account', () => assert.throws(() => initializeState({ monthlyBudgetYuan: '3000', nowDate: '2028-01-01', accounts: [] }), /至少需要/));
test('categoryOptions exposes a built-in two-level category tree', () => {
  const options = categoryOptions();
  assert.ok(options.some((item) => item.level1 === '餐饮' && item.level2.includes('午餐')));
});
test('getHomeModel shows one full daily quota before any spending in a 30-day cycle', () => assert.equal(getHomeModel(readyState('2028-04-01'), '2028-04-01').todayFreeCents, 10000));
test('getHomeModel returns 50 yuan on day three after 50 yuan then 200 yuan controlled spending', () => {
  const dayOne = recordEntry(readyState('2028-04-01'), { amountYuan: '50', date: '2028-04-01', accountId: 'cash', categoryLevel1: '餐饮', categoryLevel2: '午餐', note: '第一天', includeControlledBudget: true });
  const dayTwo = recordEntry(dayOne, { amountYuan: '200', date: '2028-04-02', accountId: 'cash', categoryLevel1: '购物', categoryLevel2: '日用品', includeControlledBudget: true });
  assert.equal(getHomeModel(dayTwo, '2028-04-03').todayFreeCents, 5000);
});
test('recordEntry with controlled budget on reduces the application period budget', () => {
  const state = recordEntry(readyState(), { amountYuan: '20', date: '2028-01-01', accountId: 'cash', categoryLevel1: '餐饮', categoryLevel2: '早餐', includeControlledBudget: true });
  assert.equal(state.budgetPeriods[0].netBudgetSpendCents, 2000);
  assert.equal(state.accounts[0].balanceCents, 98000);
});
test('recordEntry with controlled budget off records a fixed expense without reducing budget', () => {
  const state = recordEntry(readyState(), { amountYuan: '20', date: '2028-01-01', accountId: 'cash', categoryLevel1: '居住', categoryLevel2: '房租', includeControlledBudget: false });
  assert.equal(state.budgetPeriods[0].netBudgetSpendCents, 0);
  assert.equal(state.transactions[0].kind, 'fixed_expense');
});
test('recordEntry preserves note, two-level category and selected account in the transaction', () => {
  const state = recordEntry(readyState(), { amountYuan: '20', date: '2028-01-01', accountId: 'bank', categoryLevel1: '交通', categoryLevel2: '打车', note: '回家', includeControlledBudget: true });
  assert.deepEqual(state.transactions[0], { id: 'entry-1', date: '2028-01-01', kind: 'controlled_expense', amountCents: 2000, currency: 'CNY', accountId: 'bank', counterpartyAccountId: null, categoryLevel1: '交通', categoryLevel2: '打车', expenseKind: 'controlled', budgetPeriodId: 'period-1', budgetImpactCents: 2000, rewardImpactCents: 0, source: null, relatedTransactionId: null, refundedCents: 0, note: '回家' });
});
test('findPreviousSimilar prefers exact second-level category and returns only amount and date', () => {
  const first = recordEntry(readyState(), { amountYuan: '12', date: '2028-01-01', accountId: 'cash', categoryLevel1: '餐饮', categoryLevel2: '午餐', includeControlledBudget: true });
  const second = recordEntry(first, { amountYuan: '18', date: '2028-01-02', accountId: 'cash', categoryLevel1: '餐饮', categoryLevel2: '早餐', includeControlledBudget: true });
  assert.deepEqual(findPreviousSimilar(second, { categoryLevel1: '餐饮', categoryLevel2: '午餐' }), { amountCents: 1200, amount: '¥12.00', date: '2028-01-01' });
});
test('findPreviousSimilar falls back to latest first-level category when second-level has no match', () => {
  const state = recordEntry(readyState(), { amountYuan: '18', date: '2028-01-02', accountId: 'cash', categoryLevel1: '餐饮', categoryLevel2: '早餐', includeControlledBudget: true });
  assert.equal(findPreviousSimilar(state, { categoryLevel1: '餐饮', categoryLevel2: '晚餐' }).amountCents, 1800);
});
test('findPreviousSimilar returns no record for an unused category', () => assert.equal(findPreviousSimilar(readyState(), { categoryLevel1: '娱乐', categoryLevel2: '电影' }), null));
test('findPreviousSimilar uses the latest insertion when same-date entries share a category', () => {
  const first = recordEntry(readyState(), { amountYuan: '12', date: '2028-01-01', accountId: 'cash', categoryLevel1: '餐饮', categoryLevel2: '午餐', includeControlledBudget: true });
  const second = recordEntry(first, { amountYuan: '18', date: '2028-01-01', accountId: 'cash', categoryLevel1: '餐饮', categoryLevel2: '午餐', includeControlledBudget: true });
  assert.equal(findPreviousSimilar(second, { categoryLevel1: '餐饮', categoryLevel2: '午餐' }).amountCents, 1800);
});
test('listRecentBills sorts by date then newest insertion and marks controlled or fixed', () => {
  const first = recordEntry(readyState(), { amountYuan: '12', date: '2028-01-02', accountId: 'cash', categoryLevel1: '餐饮', categoryLevel2: '午餐', includeControlledBudget: true });
  const second = recordEntry(first, { amountYuan: '18', date: '2028-01-03', accountId: 'cash', categoryLevel1: '居住', categoryLevel2: '房租', includeControlledBudget: false });
  const third = recordEntry(second, { amountYuan: '20', date: '2028-01-03', accountId: 'bank', categoryLevel1: '餐饮', categoryLevel2: '早餐', includeControlledBudget: true });
  assert.deepEqual(listRecentBills(third).map((item) => [item.amountCents, item.budgetType]), [[2000, '可控'], [1800, '固定'], [1200, '可控']]);
});
test('savePersisted and loadPersisted round trip application state through versioned JSON', () => {
  const storage = memoryStorage();
  const state = readyState();
  savePersisted(storage, state);
  const loaded = loadPersisted(storage);
  assert.equal(loaded.ok, true);
  assert.deepEqual(loaded.state, state);
  assert.equal(JSON.parse(storage.value).schemaVersion, 1);
});
test('loadPersisted preserves corrupted raw storage and returns a user-facing error', () => {
  const rawData = '{not-json';
  const loaded = loadPersisted(memoryStorage(rawData));
  assert.equal(loaded.ok, false);
  assert.equal(loaded.rawData, rawData);
  assert.match(loaded.error, /backup restore failed/);
});
test('getSettingsModel exposes the configured budget and all initial accounts', () => {
  const model = getSettingsModel(readyState());
  assert.equal(model.monthlyBudget, '¥3000.00');
  assert.equal(model.accounts.length, 2);
});
