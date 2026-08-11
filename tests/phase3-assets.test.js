import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  accountTypeOptions,
  addAssetAccount,
  borrowLoan,
  buyInvestment,
  getAssetsModel,
  getSettingsModel,
  initializeState,
  listRecentBills,
  listRecentTransactions,
  loadPersisted,
  payLoanInterest,
  recordEntry,
  recordIncomeEntry,
  recordTransferEntry,
  repayCreditCard,
  repayLoanPrincipal,
  savePersisted,
  sellInvestment,
  updateInvestmentValue,
} from '../src/application/app-core.js';

const DATE = '2026-07-28';

function baseState() {
  return initializeState({
    monthlyBudgetYuan: '3000',
    startDay: 1,
    nowDate: DATE,
    accounts: [{ id: 'cash', name: '现金', type: 'cash', balanceYuan: '1000' }],
  });
}

function sixAccountState() {
  let state = baseState();
  state = addAssetAccount(state, { id: 'bank', name: '储蓄卡', type: 'bank', balanceYuan: '2000' });
  state = addAssetAccount(state, { id: 'wallet', name: '钱包', type: 'wallet', balanceYuan: '300' });
  state = addAssetAccount(state, { id: 'card', name: '信用卡', type: 'credit_card', balanceYuan: '500' });
  state = addAssetAccount(state, { id: 'loan', name: '贷款', type: 'loan', balanceYuan: '3000' });
  state = addAssetAccount(state, { id: 'fund', name: '投资', type: 'investment', balanceYuan: '1000', costBasisYuan: '800' });
  return state;
}

function finalAcceptanceState() {
  let state = sixAccountState();
  state = recordIncomeEntry(state, { amountYuan: '1000', date: DATE, accountId: 'cash', categoryLevel2: '工资' });
  state = recordTransferEntry(state, { amountYuan: '300', date: DATE, fromAccountId: 'cash', toAccountId: 'bank' });
  state = recordEntry(state, { amountYuan: '120', date: DATE, accountId: 'card', categoryLevel1: '餐饮', categoryLevel2: '晚餐', includeControlledBudget: true });
  state = repayCreditCard(state, { amountYuan: '200', date: DATE, fromAccountId: 'bank', creditCardAccountId: 'card' });
  state = borrowLoan(state, { amountYuan: '1000', date: DATE, cashAccountId: 'cash', loanAccountId: 'loan' });
  state = repayLoanPrincipal(state, { amountYuan: '400', date: DATE, cashAccountId: 'cash', loanAccountId: 'loan' });
  state = payLoanInterest(state, { amountYuan: '50', date: DATE, cashAccountId: 'cash', loanAccountId: 'loan' });
  state = buyInvestment(state, { amountYuan: '500', date: DATE, cashAccountId: 'cash', investmentAccountId: 'fund' });
  return updateInvestmentValue(state, { currentValueYuan: '1550', date: DATE, investmentAccountId: 'fund' });
}

test('asset account options expose exactly the six phase-three account types', () => {
  assert.deepEqual(accountTypeOptions().map((item) => item.value), ['cash', 'bank', 'wallet', 'credit_card', 'loan', 'investment']);
});

test('adding all six account types produces separate asset and liability cards', () => {
  const model = getAssetsModel(sixAccountState());
  assert.equal(model.accounts.length, 6);
  assert.deepEqual(model.accounts.filter((item) => item.isLiability).map((item) => item.type), ['credit_card', 'loan']);
  assert.equal(model.accounts.find((item) => item.type === 'investment').costBasisCents, 80000);
});

test('income increases an asset account without changing controlled budget spend', () => {
  const before = sixAccountState();
  const after = recordIncomeEntry(before, { amountYuan: '1000', date: DATE, accountId: 'cash', categoryLevel2: '工资' });
  assert.equal(after.accounts.find((item) => item.id === 'cash').balanceCents, 200000);
  assert.equal(after.budgetPeriods[0].netBudgetSpendCents, before.budgetPeriods[0].netBudgetSpendCents);
});

test('income rejects a liability account with a visible Chinese error and no half transaction', () => {
  const state = sixAccountState();
  assert.throws(() => recordIncomeEntry(state, { amountYuan: '100', date: DATE, accountId: 'card' }), /请选择资产账户/);
  assert.equal(state.transactions.length, 0);
  assert.equal(state.accounts.find((item) => item.id === 'card').balanceCents, -50000);
});

test('transfer moves cash between asset accounts without changing net assets or budget', () => {
  const before = sixAccountState();
  const after = recordTransferEntry(before, { amountYuan: '300', date: DATE, fromAccountId: 'cash', toAccountId: 'bank' });
  assert.equal(after.accounts.find((item) => item.id === 'cash').balanceCents, 70000);
  assert.equal(after.accounts.find((item) => item.id === 'bank').balanceCents, 230000);
  assert.equal(getAssetsModel(after).netAssetsCents, getAssetsModel(before).netAssetsCents);
  assert.equal(after.budgetPeriods[0].netBudgetSpendCents, 0);
});

test('transfer rejects the same source and destination without appending a transaction', () => {
  const state = sixAccountState();
  assert.throws(() => recordTransferEntry(state, { amountYuan: '1', date: DATE, fromAccountId: 'cash', toAccountId: 'cash' }), /不能相同/);
  assert.equal(state.transactions.length, 0);
});

test('credit-card controlled spending increases liability and consumes only controlled budget', () => {
  const after = recordEntry(sixAccountState(), { amountYuan: '120', date: DATE, accountId: 'card', categoryLevel1: '餐饮', categoryLevel2: '晚餐', includeControlledBudget: true });
  assert.equal(after.accounts.find((item) => item.id === 'card').balanceCents, -62000);
  assert.equal(after.budgetPeriods[0].netBudgetSpendCents, 12000);
});

test('credit-card repayment reduces asset and liability without consuming budget twice', () => {
  const before = sixAccountState();
  const after = repayCreditCard(before, { amountYuan: '200', date: DATE, fromAccountId: 'bank', creditCardAccountId: 'card' });
  assert.equal(after.accounts.find((item) => item.id === 'bank').balanceCents, 180000);
  assert.equal(after.accounts.find((item) => item.id === 'card').balanceCents, -30000);
  assert.equal(after.budgetPeriods[0].netBudgetSpendCents, 0);
});

test('borrowing increases cash and loan liability by the same amount', () => {
  const after = borrowLoan(sixAccountState(), { amountYuan: '1000', date: DATE, cashAccountId: 'cash', loanAccountId: 'loan' });
  assert.equal(after.accounts.find((item) => item.id === 'cash').balanceCents, 200000);
  assert.equal(after.accounts.find((item) => item.id === 'loan').balanceCents, 400000);
  assert.equal(getAssetsModel(after).netAssetsCents, getAssetsModel(sixAccountState()).netAssetsCents);
});

test('loan principal repayment reduces cash and principal without touching budget', () => {
  const after = repayLoanPrincipal(sixAccountState(), { amountYuan: '400', date: DATE, cashAccountId: 'cash', loanAccountId: 'loan' });
  assert.equal(after.accounts.find((item) => item.id === 'cash').balanceCents, 60000);
  assert.equal(after.accounts.find((item) => item.id === 'loan').balanceCents, 260000);
  assert.equal(after.budgetPeriods[0].netBudgetSpendCents, 0);
});

test('loan interest payment is a fixed expense and preserves the related loan in the flow', () => {
  const after = payLoanInterest(sixAccountState(), { amountYuan: '50', date: DATE, cashAccountId: 'cash', loanAccountId: 'loan' });
  assert.equal(after.accounts.find((item) => item.id === 'cash').balanceCents, 95000);
  assert.equal(after.budgetPeriods[0].netBudgetSpendCents, 0);
  assert.equal(after.transactions[0].counterpartyAccountId, 'loan');
  assert.equal(listRecentTransactions(after)[0].typeLabel, '利息支付');
});

test('investment buy converts cash to investment and increases cost basis without budget impact', () => {
  const after = buyInvestment(sixAccountState(), { amountYuan: '500', date: DATE, cashAccountId: 'cash', investmentAccountId: 'fund' });
  assert.equal(after.accounts.find((item) => item.id === 'cash').balanceCents, 50000);
  assert.equal(after.accounts.find((item) => item.id === 'fund').balanceCents, 150000);
  assert.equal(after.accounts.find((item) => item.id === 'fund').costBasisCents, 130000);
  assert.equal(after.budgetPeriods[0].netBudgetSpendCents, 0);
});

test('investment sell returns value to cash without consuming controlled budget', () => {
  const after = sellInvestment(sixAccountState(), { amountYuan: '200', date: DATE, cashAccountId: 'cash', investmentAccountId: 'fund' });
  assert.equal(after.accounts.find((item) => item.id === 'cash').balanceCents, 120000);
  assert.equal(after.accounts.find((item) => item.id === 'fund').balanceCents, 80000);
  assert.equal(after.accounts.find((item) => item.id === 'fund').costBasisCents, 60000);
  assert.equal(after.budgetPeriods[0].netBudgetSpendCents, 0);
});

test('manual investment valuation changes current value while preserving entered cost basis', () => {
  const after = updateInvestmentValue(sixAccountState(), { currentValueYuan: '1550', date: DATE, investmentAccountId: 'fund' });
  assert.equal(after.accounts.find((item) => item.id === 'fund').balanceCents, 155000);
  assert.equal(after.accounts.find((item) => item.id === 'fund').costBasisCents, 80000);
});

test('insufficient asset balance returns Chinese feedback and leaves the original state unchanged', () => {
  const state = sixAccountState();
  assert.throws(() => repayLoanPrincipal(state, { amountYuan: '2000', date: DATE, cashAccountId: 'cash', loanAccountId: 'loan' }), /账户余额不足/);
  assert.equal(state.accounts.find((item) => item.id === 'cash').balanceCents, 100000);
  assert.equal(state.accounts.find((item) => item.id === 'loan').balanceCents, 300000);
  assert.equal(state.transactions.length, 0);
});

test('phase-three nine-step acceptance produces exact assets liabilities net assets and account balances', () => {
  const state = finalAcceptanceState();
  const model = getAssetsModel(state);
  assert.equal(model.totalAssetsCents, 570000);
  assert.equal(model.totalLiabilitiesCents, 402000);
  assert.equal(model.netAssetsCents, 168000);
  assert.equal(model.accounts.find((item) => item.id === 'cash').balanceCents, 175000);
  assert.equal(model.accounts.find((item) => item.id === 'bank').balanceCents, 210000);
  assert.equal(model.accounts.find((item) => item.id === 'card').balanceCents, -42000);
  assert.equal(model.accounts.find((item) => item.id === 'loan').balanceCents, 360000);
  assert.equal(model.accounts.find((item) => item.id === 'fund').balanceCents, 155000);
  assert.equal(state.budgetPeriods[0].netBudgetSpendCents, 12000);
});

test('phase-three state round trips through the schema-version-three storage contract', () => {
  const memory = new Map();
  const state = finalAcceptanceState();
  savePersisted(memory, state);
  const loaded = loadPersisted(memory);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.state.schemaVersion, 3);
  assert.deepEqual(loaded.state.accounts, state.accounts);
  assert.deepEqual(loaded.state.transactions, state.transactions);
  assert.deepEqual(loaded.state.budgetPeriods, state.budgetPeriods);
});

test('recent flows expose income transfer debt interest and investment operations with account directions', () => {
  const flows = listRecentTransactions(finalAcceptanceState());
  assert.deepEqual(new Set(flows.map((item) => item.typeLabel)), new Set([
    '收入',
    '转账',
    '可控支出',
    '信用卡还款',
    '借款',
    '归还本金',
    '利息支付',
    '投资买入',
    '手工估值',
  ]));
  assert.ok(flows.some((item) => item.accountFlow === '现金 → 储蓄卡'));
  assert.ok(flows.some((item) => item.accountFlow === '储蓄卡 → 信用卡'));
  assert.ok(flows.some((item) => item.accountFlow === '现金 → 贷款'));
});

test('legacy phase-two controlled expenses remain readable in both bill and flow models', () => {
  let state = baseState();
  state = recordEntry(state, { amountYuan: '50', date: DATE, accountId: 'cash', categoryLevel1: '餐饮', categoryLevel2: '早餐', includeControlledBudget: true });
  state = recordEntry(state, { amountYuan: '80', date: DATE, accountId: 'cash', categoryLevel1: '餐饮', categoryLevel2: '早餐', includeControlledBudget: true });
  assert.deepEqual(listRecentBills(state).map((item) => item.amountCents), [8000, 5000]);
  assert.deepEqual(listRecentTransactions(state).map((item) => item.amountCents), [8000, 5000]);
});

test('settings model reuses the asset center contract after initialization', () => {
  const settings = getSettingsModel(finalAcceptanceState());
  assert.equal(settings.assets.totalAssetsCents, 570000);
  assert.equal(settings.assets.totalLiabilitiesCents, 402000);
  assert.equal(settings.assets.netAssetsCents, 168000);
  assert.equal(settings.accounts.length, 6);
});

test('entry page contract exposes all three unified transaction modes', () => {
  const entry = readFileSync(new URL('../miniprogram/pages/entry/entry.js', import.meta.url), 'utf8');
  assert.match(entry, /modes:\s*\['支出', '收入', '转账'\]/);
});

test('asset center contract exposes debt investment and three financial totals', () => {
  const assets = readFileSync(new URL('../miniprogram/pages/settings/settings.wxml', import.meta.url), 'utf8');
  const behavior = readFileSync(new URL('../miniprogram/pages/settings/settings.js', import.meta.url), 'utf8');
  for (const text of ['总资产', '总负债', '净资产']) assert.match(assets, new RegExp(text));
  for (const text of ['信用卡还款', '投资买入', '手工估值']) assert.match(behavior, new RegExp(text));
});

test('recent flow page contract names income transfer repayment debt interest and investment records', () => {
  const source = readFileSync(new URL('../src/application/app-core.js', import.meta.url), 'utf8');
  for (const text of ['收入', '转账', '信用卡还款', '借款', '归还本金', '利息支付', '投资买入', '投资卖出', '手工估值']) assert.match(source, new RegExp(text));
});
