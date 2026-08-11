import test from 'node:test';
import assert from 'node:assert/strict';

import {
  closeBudgetPeriod,
  createFixedPlan,
  createLedger,
  executeFixedPlan,
  getLatestTransaction,
  getTransactionActionAvailability,
  listUserTransactions,
  modifyTransaction,
  recordBorrowing,
  recordCreditCardRepayment,
  recordExpense,
  recordFixedExpense,
  recordIncome,
  recordInvestmentTrade,
  recordLoanRepayment,
  recordRefund,
  recordTransfer,
  revokeRefund,
  revokeTransaction,
  setInvestmentValue,
  totals,
} from '../src/domain/ledger.js';
import {
  CURRENT_SCHEMA_VERSION,
  restoreBackup,
  serializeBackup,
} from '../src/domain/storage.js';
import { commitPreparedState, STORAGE_KEY } from '../src/application/app-core.js';

const TODAY = '2026-08-09';

function accountBalance(state, id) {
  return state.accounts.find((item) => item.id === id).balanceCents;
}

function periodSpend(state, id) {
  return state.budgetPeriods.find((item) => item.id === id).netBudgetSpendCents;
}

function freshLedger(overrides = {}) {
  return createLedger({
    accounts: [
      { id: 'cash', name: '现金', type: 'cash', balanceCents: 100000 },
      { id: 'bank', name: '储蓄卡', type: 'bank', balanceCents: 50000 },
      { id: 'wallet', name: '电子钱包', type: 'wallet', balanceCents: 10000 },
      { id: 'card', name: '信用卡', type: 'credit_card', balanceCents: 0 },
      { id: 'loan', name: '借贷', type: 'loan', balanceCents: 20000 },
      { id: 'fund', name: '投资', type: 'investment', balanceCents: 50000, costBasisCents: 50000 },
    ],
    budgetPeriods: [
      { id: 'p0', startDate: '2026-07-01', endDate: '2026-07-31', baseBudgetCents: 100000, status: 'closed' },
      { id: 'p1', startDate: '2026-08-01', endDate: '2026-08-31', baseBudgetCents: 100000, status: 'open' },
    ],
    ...overrides,
  });
}

function openExpense(state = freshLedger(), details = {}) {
  return recordExpense(state, {
    id: 'expense-1',
    date: '2026-08-02',
    accountId: 'cash',
    amountCents: 10000,
    budgetPeriodId: 'p1',
    categoryLevel1: '餐饮',
    categoryLevel2: '早餐',
    note: '原备注',
    ...details,
  });
}

function closedExpense(details = {}) {
  const opened = freshLedger();
  opened.budgetPeriods.find((item) => item.id === 'p0').status = 'open';
  const spent = recordExpense(opened, {
    id: 'closed-expense',
    date: '2026-07-20',
    accountId: 'cash',
    amountCents: 10000,
    budgetPeriodId: 'p0',
    categoryLevel1: '餐饮',
    ...details,
  });
  return closeBudgetPeriod(spent, 'p0');
}

test('schema v3 ledger uses negative credit-card balances for debt', () => {
  const state = recordExpense(freshLedger(), {
    id: 'card-spend', date: '2026-08-02', accountId: 'card', amountCents: 7000,
    budgetPeriodId: 'p1', categoryLevel1: '交通',
  });
  assert.equal(state.schemaVersion, 3);
  assert.equal(accountBalance(state, 'card'), -7000);
  assert.equal(totals(state).totalLiabilitiesCents, 27000);
});

test('credit-card repayment may create a positive overpayment balance without budget impact', () => {
  const spent = recordExpense(freshLedger(), {
    id: 'card-spend', date: '2026-08-02', accountId: 'card', amountCents: 7000,
    budgetPeriodId: 'p1', categoryLevel1: '交通',
  });
  const paid = recordCreditCardRepayment(spent, {
    id: 'card-pay', date: '2026-08-03', fromAccountId: 'cash', creditCardAccountId: 'card', amountCents: 9000,
  });
  assert.equal(accountBalance(paid, 'card'), 2000);
  assert.equal(periodSpend(paid, 'p1'), 7000);
  assert.equal(totals(paid).totalAssetsCents, 203000);
  assert.equal(totals(paid).totalLiabilitiesCents, 20000);
});

test('obsolete correction backup is rejected without partial conversion', () => {
  const raw = JSON.stringify({
    schemaVersion: 1, currency: 'CNY', defaultBudgetCents: 0,
    accounts: [{ id: 'card', type: 'credit_card', balanceCents: '7000' }],
    budgetPeriods: [], transactions: [], plans: [], pendingItems: [],
  });
  const result = restoreBackup(raw);
  assert.equal(result.ok, false);
  assert.equal(result.rawData, raw);
  assert.match(result.error, /unsupported schema/);
});

test('every recorded user action receives stable logical, operation, version, status and effect metadata', () => {
  const state = openExpense();
  const transaction = state.transactions[0];
  assert.equal(transaction.logicalTransactionId, 'expense-1');
  assert.equal(transaction.operationGroupId, 'expense-1');
  assert.equal(transaction.status, 'active');
  assert.equal(transaction.version, 1);
  assert.equal(transaction.effectiveDate, '2026-08-02');
  assert.deepEqual(transaction.accountImpacts, [{ accountId: 'cash', balanceDeltaCents: -10000, costBasisDeltaCents: 0 }]);
});

test('modifying an open controlled expense atomically replaces its financial effects', () => {
  const spent = openExpense();
  const modified = modifyTransaction(spent, {
    logicalTransactionId: 'expense-1', requestId: 'modify-1', today: TODAY,
    changes: { amountCents: 12000, accountId: 'bank', categoryLevel1: '购物', note: '新备注' },
  });
  assert.equal(accountBalance(modified, 'cash'), 100000);
  assert.equal(accountBalance(modified, 'bank'), 38000);
  assert.equal(periodSpend(modified, 'p1'), 12000);
  assert.equal(getLatestTransaction(modified, 'expense-1').amountCents, 12000);
  assert.equal(getLatestTransaction(modified, 'expense-1').version, 2);
  assert.equal(getLatestTransaction(modified, 'expense-1').note, '新备注');
  assert.equal(modified.transactions.find((item) => item.id === 'expense-1').status, 'superseded');
  assert.equal(modified.transactions.filter((item) => item.kind === 'technical_reversal').length, 1);
});

test('repeating the same modification request id does not add transactions or change balances', () => {
  const first = modifyTransaction(openExpense(), {
    logicalTransactionId: 'expense-1', requestId: 'same-request', today: TODAY,
    changes: { amountCents: 9000 },
  });
  const repeated = modifyTransaction(first, {
    logicalTransactionId: 'expense-1', requestId: 'same-request', today: TODAY,
    changes: { amountCents: 9000 },
  });
  assert.deepEqual(repeated, first);
});

test('future-dated modification fails without mutating the original state', () => {
  const original = openExpense();
  const snapshot = structuredClone(original);
  assert.throws(() => modifyTransaction(original, {
    logicalTransactionId: 'expense-1', requestId: 'future', today: TODAY,
    changes: { date: '2026-08-10' },
  }), /future/);
  assert.deepEqual(original, snapshot);
});

test('modification cannot change a transaction into another business kind', () => {
  assert.throws(() => modifyTransaction(openExpense(), {
    logicalTransactionId: 'expense-1', requestId: 'cross-kind', today: TODAY,
    changes: { kind: 'income' },
  }), /business type/);
});

test('insufficient destination balance fails a modification group with an exact shortfall and no partial state', () => {
  const original = openExpense();
  const snapshot = structuredClone(original);
  assert.throws(() => modifyTransaction(original, {
    logicalTransactionId: 'expense-1', requestId: 'shortfall', today: TODAY,
    changes: { accountId: 'wallet', amountCents: 15000 },
  }), /shortfallCents=5000/);
  assert.deepEqual(original, snapshot);
});

test('revoking an open expense leaves audit records and restores account and budget', () => {
  const revoked = revokeTransaction(openExpense(), {
    logicalTransactionId: 'expense-1', requestId: 'revoke-1', date: '2026-08-09', today: TODAY,
  });
  assert.equal(accountBalance(revoked, 'cash'), 100000);
  assert.equal(periodSpend(revoked, 'p1'), 0);
  assert.equal(getLatestTransaction(revoked, 'expense-1').status, 'revoked');
  assert.equal(revoked.transactions.filter((item) => item.kind === 'technical_reversal').length, 1);
});

test('revoking income fails atomically when later spending leaves an asset shortfall', () => {
  let state = freshLedger({
    accounts: [{ id: 'cash', name: '现金', type: 'cash', balanceCents: 0 }],
    budgetPeriods: [],
  });
  state = recordIncome(state, { id: 'income', date: '2026-08-01', accountId: 'cash', amountCents: 1000 });
  state = recordFixedExpense(state, { id: 'spent-income', date: '2026-08-02', accountId: 'cash', amountCents: 1000, categoryLevel1: '房租' });
  const snapshot = structuredClone(state);
  assert.throws(() => revokeTransaction(state, {
    logicalTransactionId: 'income', requestId: 'revoke-income', date: '2026-08-09', today: TODAY,
  }), /shortfallCents=1000/);
  assert.deepEqual(state, snapshot);
});

test('multiple ordinary refunds restore the exact original budget cumulatively', () => {
  const spent = openExpense(freshLedger(), { amountCents: 10000 });
  const first = recordRefund(spent, {
    id: 'refund-1', date: '2026-08-03', originalTransactionId: 'expense-1', amountCents: 6000,
    requestId: 'refund-request-1', today: TODAY,
  });
  const second = recordRefund(first, {
    id: 'refund-2', date: '2026-08-04', originalTransactionId: 'expense-1', amountCents: 4000,
    requestId: 'refund-request-2', today: TODAY,
  });
  assert.equal(periodSpend(second, 'p1'), 0);
  assert.deepEqual(second.transactions.filter((item) => item.kind === 'refund').map((item) => item.budgetImpactCents), [-6000, -4000]);
});

test('refund may be deposited into a different ordinary asset account', () => {
  const refunded = recordRefund(openExpense(), {
    id: 'refund-bank', date: '2026-08-03', originalTransactionId: 'expense-1', amountCents: 4000,
    destinationAccountId: 'bank', requestId: 'refund-bank-request', today: TODAY,
  });
  assert.equal(accountBalance(refunded, 'cash'), 90000);
  assert.equal(accountBalance(refunded, 'bank'), 54000);
  assert.equal(refunded.transactions.at(-1).accountId, 'bank');
});

test('credit-card expense refund increases the original card balance under schema v3 signs', () => {
  const spent = openExpense(freshLedger(), { id: 'card-expense', accountId: 'card', amountCents: 8000 });
  const refunded = recordRefund(spent, {
    id: 'card-refund', date: '2026-08-03', originalTransactionId: 'card-expense', amountCents: 3000,
    requestId: 'card-refund-request', today: TODAY,
  });
  assert.equal(accountBalance(refunded, 'card'), -5000);
});

test('refund rejects non-expense transactions', () => {
  const transferred = recordTransfer(freshLedger(), {
    id: 'transfer', date: '2026-08-02', fromAccountId: 'cash', toAccountId: 'bank', amountCents: 1000,
  });
  assert.throws(() => recordRefund(transferred, {
    id: 'bad-refund', date: '2026-08-03', originalTransactionId: 'transfer', amountCents: 1000,
    requestId: 'bad-refund-request', today: TODAY,
  }), /real expense/);
});

test('refund rejects amounts above the active unrefunded remainder', () => {
  const first = recordRefund(openExpense(), {
    id: 'refund-1', date: '2026-08-03', originalTransactionId: 'expense-1', amountCents: 7000,
    requestId: 'refund-1-request', today: TODAY,
  });
  assert.throws(() => recordRefund(first, {
    id: 'refund-2', date: '2026-08-04', originalTransactionId: 'expense-1', amountCents: 3001,
    requestId: 'refund-2-request', today: TODAY,
  }), /remaining/);
});

test('refund date must be between the original expense date and today', () => {
  const spent = openExpense();
  assert.throws(() => recordRefund(spent, {
    id: 'early', date: '2026-08-01', originalTransactionId: 'expense-1', amountCents: 1,
    requestId: 'early-request', today: TODAY,
  }), /before original/);
  assert.throws(() => recordRefund(spent, {
    id: 'future', date: '2026-08-10', originalTransactionId: 'expense-1', amountCents: 1,
    requestId: 'future-request', today: TODAY,
  }), /future/);
});

test('active refund limits original expense modification to category and note', () => {
  const refunded = recordRefund(openExpense(), {
    id: 'refund', date: '2026-08-03', originalTransactionId: 'expense-1', amountCents: 1000,
    requestId: 'refund-request', today: TODAY,
  });
  assert.throws(() => modifyTransaction(refunded, {
    logicalTransactionId: 'expense-1', requestId: 'blocked-modify', today: TODAY,
    changes: { amountCents: 9000 },
  }), /active refunds/);
  const categorized = modifyTransaction(refunded, {
    logicalTransactionId: 'expense-1', requestId: 'category-modify', today: TODAY,
    changes: { categoryLevel1: '购物', note: '只改备注' },
  });
  assert.equal(getLatestTransaction(categorized, 'expense-1').categoryLevel1, '购物');
  assert.equal(getLatestTransaction(categorized, 'expense-1').note, '只改备注');
});

test('revoking a refund restores its account and budget effects exactly', () => {
  const spent = openExpense(freshLedger(), { amountCents: 10000 });
  const refunded = recordRefund(spent, {
    id: 'refund', date: '2026-08-03', originalTransactionId: 'expense-1', amountCents: 8000,
    requestId: 'refund-request', today: TODAY,
  });
  const revoked = revokeRefund(refunded, {
    logicalTransactionId: 'refund', requestId: 'revoke-refund', date: '2026-08-09', today: TODAY,
  });
  assert.equal(accountBalance(revoked, 'cash'), accountBalance(spent, 'cash'));
  assert.equal(periodSpend(revoked, 'p1'), periodSpend(spent, 'p1'));
  assert.equal(getLatestTransaction(revoked, 'refund').status, 'revoked');
});

test('original expense cannot be revoked while it has an active refund', () => {
  const refunded = recordRefund(openExpense(), {
    id: 'refund', date: '2026-08-03', originalTransactionId: 'expense-1', amountCents: 1000,
    requestId: 'refund-request', today: TODAY,
  });
  assert.throws(() => revokeTransaction(refunded, {
    logicalTransactionId: 'expense-1', requestId: 'bad-revoke', date: '2026-08-09', today: TODAY,
  }), /active refunds/);
});

test('closed-period refund leaves the closed period untouched and changes the current open budget', () => {
  const spent = closedExpense();
  const refunded = recordRefund(spent, {
    id: 'closed-refund', date: '2026-08-02', originalTransactionId: 'closed-expense', amountCents: 4000,
    requestId: 'closed-refund-request', today: TODAY,
  });
  assert.equal(periodSpend(refunded, 'p0'), 10000);
  assert.equal(periodSpend(refunded, 'p1'), -4000);
});

test('revoking a closed-period refund reverses only the current open budget adjustment', () => {
  const refunded = recordRefund(closedExpense(), {
    id: 'closed-refund', date: '2026-08-02', originalTransactionId: 'closed-expense', amountCents: 4000,
    requestId: 'closed-refund-request', today: TODAY,
  });
  const revoked = revokeRefund(refunded, {
    logicalTransactionId: 'closed-refund', requestId: 'closed-refund-revoke', date: TODAY, today: TODAY,
  });
  assert.equal(periodSpend(revoked, 'p0'), 10000);
  assert.equal(periodSpend(revoked, 'p1'), 0);
  assert.equal(getLatestTransaction(revoked, 'closed-refund').status, 'revoked');
  const adjustment = revoked.transactions.filter((item) => item.kind === 'historical_adjustment').at(-1);
  assert.equal(adjustment.businessPayload.changes[0].currentBudgetDeltaCents, 4000);
});

test('reducing a closed-period expense preserves the closed period and credits the difference to the current open budget', () => {
  const modified = modifyTransaction(closedExpense(), {
    logicalTransactionId: 'closed-expense', requestId: 'closed-less', today: TODAY,
    changes: { amountCents: 7000 },
  });
  assert.equal(periodSpend(modified, 'p0'), 10000);
  assert.equal(periodSpend(modified, 'p1'), -3000);
  assert.equal(modified.transactions.filter((item) => item.kind === 'historical_adjustment').length, 1);
});

test('increasing a closed-period expense preserves settlement and charges the current open budget', () => {
  const modified = modifyTransaction(closedExpense(), {
    logicalTransactionId: 'closed-expense', requestId: 'closed-more', today: TODAY,
    changes: { amountCents: 13000 },
  });
  assert.equal(periodSpend(modified, 'p0'), 10000);
  assert.equal(periodSpend(modified, 'p1'), 3000);
  assert.equal(modified.transactions.filter((item) => item.kind === 'historical_adjustment').length, 1);
});

test('historical undercharge fails atomically when no open period covers the correction date', () => {
  const state = closedExpense();
  state.budgetPeriods.find((item) => item.id === 'p1').startDate = '2026-09-01';
  state.budgetPeriods.find((item) => item.id === 'p1').endDate = '2026-09-30';
  const before = structuredClone(state);
  assert.throws(() => modifyTransaction(state, {
    logicalTransactionId: 'closed-expense', requestId: 'no-current-period', today: TODAY,
    changes: { amountCents: 13000 },
  }), /no open budget period/);
  assert.deepEqual(state, before);
  assert.equal(periodSpend(state, 'p1'), 0);
});

test('closed fixed-expense modification never changes controlled budget', () => {
  const state = recordFixedExpense(freshLedger(), {
    id: 'fixed', date: '2026-07-20', accountId: 'cash', amountCents: 5000, categoryLevel1: '房租',
  });
  const modified = modifyTransaction(state, {
    logicalTransactionId: 'fixed', requestId: 'fixed-change', today: TODAY,
    changes: { amountCents: 6000 },
  });
  assert.equal(periodSpend(modified, 'p0'), 0);
  assert.equal(periodSpend(modified, 'p1'), 0);
});

test('loan repayment records principal and interest as one atomic logical operation group', () => {
  const repaid = recordLoanRepayment(freshLedger(), {
    id: 'loan-pay', date: '2026-08-04', cashAccountId: 'cash', loanAccountId: 'loan',
    principalCents: 5000, interestCents: 1000,
  });
  const group = repaid.transactions.filter((item) => item.logicalTransactionId === 'loan-pay');
  assert.equal(group.length, 2);
  assert.equal(new Set(group.map((item) => item.operationGroupId)).size, 1);
  assert.equal(accountBalance(repaid, 'cash'), 94000);
  assert.equal(accountBalance(repaid, 'loan'), 15000);
});

test('modifying a loan repayment updates the whole principal-interest group atomically', () => {
  const repaid = recordLoanRepayment(freshLedger(), {
    id: 'loan-pay', date: '2026-08-04', cashAccountId: 'cash', loanAccountId: 'loan',
    principalCents: 5000, interestCents: 1000,
  });
  const modified = modifyTransaction(repaid, {
    logicalTransactionId: 'loan-pay', requestId: 'loan-change', today: TODAY,
    changes: { principalCents: 7000, interestCents: 1500, cashAccountId: 'bank' },
  });
  assert.equal(accountBalance(modified, 'cash'), 100000);
  assert.equal(accountBalance(modified, 'bank'), 41500);
  assert.equal(accountBalance(modified, 'loan'), 13000);
  assert.equal(getLatestTransaction(modified, 'loan-pay').version, 2);
});

test('failed loan repayment modification leaves both sides of the group unchanged', () => {
  const repaid = recordLoanRepayment(freshLedger(), {
    id: 'loan-pay', date: '2026-08-04', cashAccountId: 'cash', loanAccountId: 'loan',
    principalCents: 5000, interestCents: 1000,
  });
  const snapshot = structuredClone(repaid);
  assert.throws(() => modifyTransaction(repaid, {
    logicalTransactionId: 'loan-pay', requestId: 'loan-too-much', today: TODAY,
    changes: { principalCents: 21000 },
  }), /loan liability/);
  assert.deepEqual(repaid, snapshot);
});

test('modifying a plan occurrence preserves its occurrence key and cannot execute it twice', () => {
  const planned = createFixedPlan(freshLedger(), {
    id: 'rent-plan', amountCents: 5000, accountId: 'cash', categoryLevel1: '房租',
  });
  const posted = executeFixedPlan(planned, { planId: 'rent-plan', date: '2026-08-05', transactionId: 'rent-occurrence' });
  const modified = modifyTransaction(posted, {
    logicalTransactionId: 'rent-occurrence', requestId: 'rent-change', today: TODAY,
    changes: { amountCents: 6000 },
  });
  assert.equal(getLatestTransaction(modified, 'rent-occurrence').occurrenceKey, 'rent-plan@2026-08-05');
  assert.deepEqual(executeFixedPlan(modified, { planId: 'rent-plan', date: '2026-08-05', transactionId: 'duplicate' }), modified);
});

test('transaction action availability follows expense, refund and revoked matrices', () => {
  const spent = openExpense();
  assert.deepEqual(getTransactionActionAvailability(spent, 'expense-1'), { refund: true, modify: true, revoke: true, modifyFields: 'all' });
  const refunded = recordRefund(spent, {
    id: 'refund', date: '2026-08-03', originalTransactionId: 'expense-1', amountCents: 1000,
    requestId: 'refund-request', today: TODAY,
  });
  assert.deepEqual(getTransactionActionAvailability(refunded, 'expense-1'), { refund: true, modify: true, revoke: false, modifyFields: 'category-note' });
  assert.deepEqual(getTransactionActionAvailability(refunded, 'refund'), { refund: false, modify: false, revoke: true, modifyFields: 'none' });
  const revoked = revokeRefund(refunded, {
    logicalTransactionId: 'refund', requestId: 'refund-revoke', date: '2026-08-09', today: TODAY,
  });
  assert.deepEqual(getTransactionActionAvailability(revoked, 'refund'), { refund: false, modify: false, revoke: false, modifyFields: 'none' });
});

test('user transaction listing hides technical reversals and returns only the latest business version', () => {
  const modified = modifyTransaction(openExpense(), {
    logicalTransactionId: 'expense-1', requestId: 'modify-list', today: TODAY,
    changes: { amountCents: 9000 },
  });
  const visible = listUserTransactions(modified);
  assert.equal(visible.filter((item) => item.logicalTransactionId === 'expense-1').length, 1);
  assert.equal(visible.some((item) => item.kind === 'technical_reversal'), false);
  assert.equal(visible.find((item) => item.logicalTransactionId === 'expense-1').amountCents, 9000);
});

test('schema v3 backup round trip preserves complete correction audit relations', () => {
  const modified = modifyTransaction(openExpense(), {
    logicalTransactionId: 'expense-1', requestId: 'modify-backup', today: TODAY,
    changes: { amountCents: 9000 },
  });
  const restored = restoreBackup(serializeBackup(modified));
  assert.equal(CURRENT_SCHEMA_VERSION, 3);
  assert.equal(restored.ok, true);
  assert.deepEqual(restored.data, modified);
});

test('failed candidate save rolls storage back and returns the exact original in-memory state', () => {
  const original = openExpense();
  const candidate = modifyTransaction(original, {
    logicalTransactionId: 'expense-1', requestId: 'save-failure-change', today: TODAY,
    changes: { amountCents: 9000 },
  });
  const originalRaw = serializeBackup(original);
  const values = new Map([[STORAGE_KEY, originalRaw]]);
  let writes = 0;
  const storage = {
    get(key) { return values.get(key); },
    set(key, value) {
      writes += 1;
      values.set(key, value);
      if (writes === 1) throw new Error('disk full');
    },
    remove(key) { values.delete(key); },
  };
  const result = commitPreparedState(storage, original, candidate);
  assert.equal(result.ok, false);
  assert.deepEqual(result.state, original);
  assert.equal(values.get(STORAGE_KEY), originalRaw);
  assert.equal(result.rollbackError, null);
});

test('income modification changes amount, date, destination and source as one replacement', () => {
  const earned = recordIncome(freshLedger(), {
    id: 'income', date: '2026-08-01', accountId: 'cash', amountCents: 5000, source: '工资',
  });
  const modified = modifyTransaction(earned, {
    logicalTransactionId: 'income', requestId: 'income-change', today: TODAY,
    changes: { date: '2026-08-02', accountId: 'bank', amountCents: 7000, source: '奖金' },
  });
  assert.equal(accountBalance(modified, 'cash'), 100000);
  assert.equal(accountBalance(modified, 'bank'), 57000);
  assert.equal(getLatestTransaction(modified, 'income').source, '奖金');
  assert.equal(getLatestTransaction(modified, 'income').date, '2026-08-02');
});

test('transfer modification restores old accounts before applying the new route', () => {
  const transferred = recordTransfer(freshLedger(), {
    id: 'transfer', date: '2026-08-01', fromAccountId: 'cash', toAccountId: 'bank', amountCents: 5000,
  });
  const modified = modifyTransaction(transferred, {
    logicalTransactionId: 'transfer', requestId: 'transfer-change', today: TODAY,
    changes: { fromAccountId: 'wallet', toAccountId: 'bank', amountCents: 3000 },
  });
  assert.equal(accountBalance(modified, 'cash'), 100000);
  assert.equal(accountBalance(modified, 'wallet'), 7000);
  assert.equal(accountBalance(modified, 'bank'), 53000);
});

test('credit-card repayment modification preserves schema v3 debt signs and may switch payment account', () => {
  const state = freshLedger();
  state.accounts.find((item) => item.id === 'card').balanceCents = -10000;
  const repaid = recordCreditCardRepayment(state, {
    id: 'card-pay', date: '2026-08-02', fromAccountId: 'cash', creditCardAccountId: 'card', amountCents: 4000,
  });
  const modified = modifyTransaction(repaid, {
    logicalTransactionId: 'card-pay', requestId: 'card-pay-change', today: TODAY,
    changes: { fromAccountId: 'bank', amountCents: 6000 },
  });
  assert.equal(accountBalance(modified, 'cash'), 100000);
  assert.equal(accountBalance(modified, 'bank'), 44000);
  assert.equal(accountBalance(modified, 'card'), -4000);
});

test('borrowing modification atomically changes proceeds account and principal', () => {
  const borrowed = recordBorrowing(freshLedger(), {
    id: 'borrow', date: '2026-08-02', cashAccountId: 'cash', loanAccountId: 'loan', amountCents: 10000,
  });
  const modified = modifyTransaction(borrowed, {
    logicalTransactionId: 'borrow', requestId: 'borrow-change', today: TODAY,
    changes: { cashAccountId: 'bank', amountCents: 7000 },
  });
  assert.equal(accountBalance(modified, 'cash'), 100000);
  assert.equal(accountBalance(modified, 'bank'), 57000);
  assert.equal(accountBalance(modified, 'loan'), 27000);
});

test('expense modification may change controlled spending into fixed without leaving budget impact', () => {
  const modified = modifyTransaction(openExpense(), {
    logicalTransactionId: 'expense-1', requestId: 'expense-to-fixed', today: TODAY,
    changes: { expenseKind: 'fixed' },
  });
  assert.equal(getLatestTransaction(modified, 'expense-1').kind, 'fixed_expense');
  assert.equal(periodSpend(modified, 'p1'), 0);
  assert.equal(accountBalance(modified, 'cash'), 90000);
});

test('expense modification may change fixed spending into controlled for an explicit period', () => {
  const fixed = recordFixedExpense(freshLedger(), {
    id: 'fixed', date: '2026-08-02', accountId: 'cash', amountCents: 5000, categoryLevel1: '房租',
  });
  const modified = modifyTransaction(fixed, {
    logicalTransactionId: 'fixed', requestId: 'fixed-to-controlled', today: TODAY,
    changes: { expenseKind: 'controlled', budgetPeriodId: 'p1' },
  });
  assert.equal(getLatestTransaction(modified, 'fixed').kind, 'controlled_expense');
  assert.equal(periodSpend(modified, 'p1'), 5000);
});

test('investment buy modification restores cash, value and cost basis before replay', () => {
  const bought = recordInvestmentTrade(freshLedger(), {
    id: 'buy', date: '2026-08-02', side: 'buy', cashAccountId: 'cash', investmentAccountId: 'fund', amountCents: 5000,
  });
  const modified = modifyTransaction(bought, {
    logicalTransactionId: 'buy', requestId: 'buy-change', today: TODAY,
    changes: { cashAccountId: 'bank', amountCents: 7000 },
  });
  assert.equal(accountBalance(modified, 'cash'), 100000);
  assert.equal(accountBalance(modified, 'bank'), 43000);
  assert.equal(accountBalance(modified, 'fund'), 57000);
  assert.equal(modified.accounts.find((item) => item.id === 'fund').costBasisCents, 57000);
});

test('investment sell modification restores the old sale before applying new proceeds', () => {
  const sold = recordInvestmentTrade(freshLedger(), {
    id: 'sell', date: '2026-08-02', side: 'sell', cashAccountId: 'cash', investmentAccountId: 'fund', amountCents: 5000,
  });
  const modified = modifyTransaction(sold, {
    logicalTransactionId: 'sell', requestId: 'sell-change', today: TODAY,
    changes: { cashAccountId: 'bank', amountCents: 8000 },
  });
  assert.equal(accountBalance(modified, 'cash'), 100000);
  assert.equal(accountBalance(modified, 'bank'), 58000);
  assert.equal(accountBalance(modified, 'fund'), 42000);
  assert.equal(modified.accounts.find((item) => item.id === 'fund').costBasisCents, 42000);
});

test('investment valuation modification restores and replaces only the manually entered current value', () => {
  const valued = setInvestmentValue(freshLedger(), {
    id: 'value', date: '2026-08-02', investmentAccountId: 'fund', currentValueCents: 60000,
  });
  const modified = modifyTransaction(valued, {
    logicalTransactionId: 'value', requestId: 'value-change', today: TODAY,
    changes: { date: '2026-08-03', currentValueCents: 55000 },
  });
  assert.equal(accountBalance(modified, 'fund'), 55000);
  assert.equal(modified.accounts.find((item) => item.id === 'fund').costBasisCents, 50000);
  assert.equal(getLatestTransaction(modified, 'value').date, '2026-08-03');
});

test('revoking a transfer restores both accounts and preserves the audit trail', () => {
  const transferred = recordTransfer(freshLedger(), {
    id: 'transfer', date: '2026-08-02', fromAccountId: 'cash', toAccountId: 'bank', amountCents: 5000,
  });
  const revoked = revokeTransaction(transferred, {
    logicalTransactionId: 'transfer', requestId: 'transfer-revoke', date: '2026-08-09', today: TODAY,
  });
  assert.equal(accountBalance(revoked, 'cash'), 100000);
  assert.equal(accountBalance(revoked, 'bank'), 50000);
  assert.equal(getLatestTransaction(revoked, 'transfer').status, 'revoked');
});

test('repeating refund and revoke request ids is idempotent', () => {
  const refunded = recordRefund(openExpense(), {
    id: 'refund', date: '2026-08-03', originalTransactionId: 'expense-1', amountCents: 1000,
    requestId: 'same-refund', today: TODAY,
  });
  const repeatedRefund = recordRefund(refunded, {
    id: 'another-refund-id', date: '2026-08-03', originalTransactionId: 'expense-1', amountCents: 1000,
    requestId: 'same-refund', today: TODAY,
  });
  assert.deepEqual(repeatedRefund, refunded);
  const revoked = revokeRefund(refunded, {
    logicalTransactionId: 'refund', requestId: 'same-revoke', date: '2026-08-09', today: TODAY,
  });
  const repeatedRevoke = revokeRefund(revoked, {
    logicalTransactionId: 'refund', requestId: 'same-revoke', date: '2026-08-09', today: TODAY,
  });
  assert.deepEqual(repeatedRevoke, revoked);
});

test('current backup round trip preserves application settings and audit metadata', () => {
  const source = freshLedger();
  source.appSettings = { startDay: 8, monthlyBudgetCents: 300000, customFlag: 'kept' };
  const restored = restoreBackup(serializeBackup(source));
  assert.equal(restored.ok, true);
  assert.deepEqual(restored.data.appSettings, source.appSettings);
  assert.equal(restored.data.schemaVersion, 3);
});
