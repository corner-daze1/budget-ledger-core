import { actualBudgetCents as calculateActualBudget, budgetDebtCents as calculateBudgetDebt } from './budget.js';

const ACCOUNT_TYPES = new Set(['cash', 'bank', 'wallet', 'credit_card', 'loan', 'investment']);
const LIABILITY_TYPES = new Set(['credit_card', 'loan']);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function integer(value, label) {
  if (!Number.isInteger(value)) throw new TypeError(`${label} must be an integer`);
  return value;
}

function positiveCents(value, label = 'amountCents') {
  integer(value, label);
  if (value <= 0) throw new RangeError(`${label} must be positive`);
  return value;
}

function nonNegativeCents(value, label) {
  integer(value, label);
  if (value < 0) throw new RangeError(`${label} must not be negative`);
  return value;
}

function assertDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new TypeError('date must be YYYY-MM-DD');
}

function nextTransactionId(state) {
  return `txn-${state.transactions.length + 1}`;
}

function account(state, id) {
  const found = state.accounts.find((item) => item.id === id);
  if (!found) throw new Error(`unknown account: ${id}`);
  return found;
}

function period(state, id) {
  const found = state.budgetPeriods.find((item) => item.id === id);
  if (!found) throw new Error(`unknown budget period: ${id}`);
  return found;
}

function withTransaction(state, transaction) {
  const next = clone(state);
  next.transactions.push(transaction);
  return next;
}

function transactionBase(state, details) {
  assertDate(details.date);
  return {
    id: details.id || nextTransactionId(state),
    date: details.date,
    kind: details.kind,
    amountCents: details.amountCents,
    currency: 'CNY',
    accountId: details.accountId ?? null,
    counterpartyAccountId: details.counterpartyAccountId ?? null,
    categoryLevel1: details.categoryLevel1 ?? null,
    categoryLevel2: details.categoryLevel2 ?? null,
    expenseKind: details.expenseKind ?? null,
    budgetPeriodId: details.budgetPeriodId ?? null,
    budgetImpactCents: details.budgetImpactCents ?? 0,
    rewardImpactCents: details.rewardImpactCents ?? 0,
    source: details.source ?? null,
    relatedTransactionId: details.relatedTransactionId ?? null,
    refundedCents: details.refundedCents ?? 0,
  };
}

function updateAccount(state, id, change) {
  const next = clone(state);
  const target = account(next, id);
  target.balanceCents += change;
  if (target.balanceCents < 0) throw new Error(`insufficient balance in account: ${id}`);
  return next;
}

function updateLiability(state, id, change) {
  const next = clone(state);
  const target = account(next, id);
  target.balanceCents += change;
  if (target.balanceCents < 0) throw new Error(`liability cannot be negative: ${id}`);
  return next;
}

function requireAsset(state, id) {
  const found = account(state, id);
  if (LIABILITY_TYPES.has(found.type)) throw new Error(`account is not an asset account: ${id}`);
  return found;
}

function requireLiability(state, id, expectedType = null) {
  const found = account(state, id);
  if (!LIABILITY_TYPES.has(found.type) || (expectedType && found.type !== expectedType)) throw new Error(`account is not the expected liability account: ${id}`);
  return found;
}

export function createLedger({ accounts = [], budgetPeriods = [], defaultBudgetCents = 0, rewardBalanceCents = 0, plans = [], pendingItems = [] } = {}) {
  nonNegativeCents(defaultBudgetCents, 'defaultBudgetCents');
  nonNegativeCents(rewardBalanceCents, 'rewardBalanceCents');
  const ids = new Set();
  for (const item of accounts) {
    if (!item.id || ids.has(item.id)) throw new Error(`duplicate account id: ${item.id}`);
    if (!ACCOUNT_TYPES.has(item.type)) throw new Error(`unknown account type: ${item.type}`);
    nonNegativeCents(item.balanceCents, `account ${item.id} balanceCents`);
    ids.add(item.id);
  }
  return {
    schemaVersion: 1,
    currency: 'CNY',
    defaultBudgetCents,
    accounts: clone(accounts),
    budgetPeriods: clone(budgetPeriods).map((item) => ({
      status: 'open',
      carryCents: 0,
      netBudgetSpendCents: 0,
      ...item,
    })),
    rewardBalanceCents,
    plans: clone(plans),
    pendingItems: clone(pendingItems),
    transactions: [],
  };
}

export function addAccount(state, { id, name, type, balanceCents = 0, costBasisCents = 0 }) {
  if (!id || state.accounts.some((item) => item.id === id)) throw new Error(`duplicate account id: ${id}`);
  if (!ACCOUNT_TYPES.has(type)) throw new Error(`unknown account type: ${type}`);
  nonNegativeCents(balanceCents, 'balanceCents');
  nonNegativeCents(costBasisCents, 'costBasisCents');
  const next = clone(state);
  next.accounts.push({ id, name: name || id, type, balanceCents, costBasisCents });
  return next;
}

export function addBudgetPeriod(state, { id, startDate, endDate, baseBudgetCents, carryCents = 0, status = 'open' }) {
  if (!id || state.budgetPeriods.some((item) => item.id === id)) throw new Error(`duplicate budget period id: ${id}`);
  assertDate(startDate);
  assertDate(endDate);
  nonNegativeCents(baseBudgetCents, 'baseBudgetCents');
  integer(carryCents, 'carryCents');
  if (!['open', 'closed'].includes(status)) throw new RangeError('unknown budget period status');
  const next = clone(state);
  next.budgetPeriods.push({ id, startDate, endDate, baseBudgetCents, carryCents, status, netBudgetSpendCents: 0 });
  return next;
}

export function recordIncome(state, { id, date, accountId, amountCents, categoryLevel1 = '收入', categoryLevel2 = null, source = null }) {
  positiveCents(amountCents);
  requireAsset(state, accountId);
  let next = updateAccount(state, accountId, amountCents);
  return withTransaction(next, transactionBase(next, { id, date, kind: 'income', amountCents, accountId, categoryLevel1, categoryLevel2, source }));
}

export function recordExpense(state, { id, date, accountId, amountCents, budgetPeriodId, categoryLevel1, categoryLevel2 = null, rewardOffsetCents = 0, source = null }) {
  positiveCents(amountCents);
  nonNegativeCents(rewardOffsetCents, 'rewardOffsetCents');
  if (rewardOffsetCents > amountCents) throw new RangeError('reward offset cannot exceed expense');
  const periodTarget = period(state, budgetPeriodId);
  if (periodTarget.status !== 'open') throw new Error('budget period is closed');
  const budgetImpactCents = amountCents - rewardOffsetCents;
  let next = clone(state);
  const target = account(next, accountId);
  if (target.type === 'credit_card') target.balanceCents += amountCents;
  else {
    requireAsset(next, accountId);
    if (target.balanceCents < amountCents) throw new Error(`insufficient balance in account: ${accountId}`);
    target.balanceCents -= amountCents;
  }
  next.rewardBalanceCents -= rewardOffsetCents;
  if (next.rewardBalanceCents < 0) throw new Error('reward balance cannot be negative');
  period(next, budgetPeriodId).netBudgetSpendCents += budgetImpactCents;
  return withTransaction(next, transactionBase(next, { id, date, kind: 'controlled_expense', amountCents, accountId, categoryLevel1, categoryLevel2, expenseKind: 'controlled', budgetPeriodId, budgetImpactCents, rewardImpactCents: -rewardOffsetCents, source }));
}

export function recordFixedExpense(state, { id, date, accountId, amountCents, categoryLevel1, categoryLevel2 = null, source = null }) {
  positiveCents(amountCents);
  let next = clone(state);
  const target = account(next, accountId);
  if (target.type === 'credit_card') target.balanceCents += amountCents;
  else {
    requireAsset(next, accountId);
    if (target.balanceCents < amountCents) throw new Error(`insufficient balance in account: ${accountId}`);
    target.balanceCents -= amountCents;
  }
  return withTransaction(next, transactionBase(next, { id, date, kind: 'fixed_expense', amountCents, accountId, categoryLevel1, categoryLevel2, expenseKind: 'fixed', source }));
}

export function recordTransfer(state, { id, date, fromAccountId, toAccountId, amountCents, source = null }) {
  positiveCents(amountCents);
  if (fromAccountId === toAccountId) throw new Error('transfer accounts must differ');
  requireAsset(state, fromAccountId);
  requireAsset(state, toAccountId);
  let next = updateAccount(state, fromAccountId, -amountCents);
  next = updateAccount(next, toAccountId, amountCents);
  return withTransaction(next, transactionBase(next, { id, date, kind: 'transfer', amountCents, accountId: fromAccountId, counterpartyAccountId: toAccountId, source }));
}

export function recordCreditCardRepayment(state, { id, date, fromAccountId, creditCardAccountId, amountCents, source = null }) {
  positiveCents(amountCents);
  requireAsset(state, fromAccountId);
  const card = requireLiability(state, creditCardAccountId, 'credit_card');
  if (card.balanceCents < amountCents) throw new Error('repayment exceeds credit card liability');
  let next = updateAccount(state, fromAccountId, -amountCents);
  next = updateLiability(next, creditCardAccountId, -amountCents);
  return withTransaction(next, transactionBase(next, { id, date, kind: 'credit_card_repayment', amountCents, accountId: fromAccountId, counterpartyAccountId: creditCardAccountId, source }));
}

export function recordBorrowing(state, { id, date, cashAccountId, loanAccountId, amountCents, source = null }) {
  positiveCents(amountCents);
  requireAsset(state, cashAccountId);
  requireLiability(state, loanAccountId, 'loan');
  let next = updateAccount(state, cashAccountId, amountCents);
  next = updateAccountAllowLiability(next, loanAccountId, amountCents);
  return withTransaction(next, transactionBase(next, { id, date, kind: 'borrowing', amountCents, accountId: cashAccountId, counterpartyAccountId: loanAccountId, source }));
}

function updateAccountAllowLiability(state, id, change) {
  const next = clone(state);
  account(next, id).balanceCents += change;
  return next;
}

export function recordLoanPrincipalRepayment(state, { id, date, cashAccountId, loanAccountId, amountCents, source = null }) {
  positiveCents(amountCents);
  requireAsset(state, cashAccountId);
  const loan = requireLiability(state, loanAccountId, 'loan');
  if (loan.balanceCents < amountCents) throw new Error('principal repayment exceeds loan liability');
  let next = updateAccount(state, cashAccountId, -amountCents);
  next = updateLiability(next, loanAccountId, -amountCents);
  return withTransaction(next, transactionBase(next, { id, date, kind: 'loan_principal_repayment', amountCents, accountId: cashAccountId, counterpartyAccountId: loanAccountId, source }));
}

export function recordLoanInterestPayment(state, { id, date, cashAccountId, loanAccountId = null, amountCents, categoryLevel1 = '利息', source = null }) {
  positiveCents(amountCents);
  requireAsset(state, cashAccountId);
  if (loanAccountId !== null) requireLiability(state, loanAccountId, 'loan');
  return recordFixedExpense(state, { id, date, accountId: cashAccountId, amountCents, categoryLevel1, source });
}

export function recordLoanInterestAccrual(state, { id, date, loanAccountId, amountCents, source = null }) {
  positiveCents(amountCents);
  requireLiability(state, loanAccountId, 'loan');
  const next = updateAccountAllowLiability(state, loanAccountId, amountCents);
  return withTransaction(next, transactionBase(next, { id, date, kind: 'loan_interest_accrual', amountCents, accountId: loanAccountId, expenseKind: 'fixed', source }));
}

export function recordInvestmentTrade(state, { id, date, side, cashAccountId, investmentAccountId, amountCents, source = null }) {
  positiveCents(amountCents);
  if (!['buy', 'sell'].includes(side)) throw new RangeError('investment side must be buy or sell');
  requireAsset(state, cashAccountId);
  const investment = account(state, investmentAccountId);
  if (investment.type !== 'investment') throw new Error('target account is not an investment account');
  let next;
  if (side === 'buy') {
    next = updateAccount(state, cashAccountId, -amountCents);
    next = updateAccount(next, investmentAccountId, amountCents);
    account(next, investmentAccountId).costBasisCents = (account(next, investmentAccountId).costBasisCents || 0) + amountCents;
  } else {
    if (investment.balanceCents < amountCents) throw new Error('investment value is insufficient');
    next = updateAccount(state, investmentAccountId, -amountCents);
    next = updateAccount(next, cashAccountId, amountCents);
    account(next, investmentAccountId).costBasisCents = Math.max(0, (account(next, investmentAccountId).costBasisCents || 0) - amountCents);
  }
  return withTransaction(next, transactionBase(next, { id, date, kind: `investment_${side}`, amountCents, accountId: cashAccountId, counterpartyAccountId: investmentAccountId, source }));
}

export function setInvestmentValue(state, { id, date, investmentAccountId, currentValueCents, source = 'manual valuation' }) {
  nonNegativeCents(currentValueCents, 'currentValueCents');
  const investment = account(state, investmentAccountId);
  if (investment.type !== 'investment') throw new Error('target account is not an investment account');
  const next = clone(state);
  account(next, investmentAccountId).balanceCents = currentValueCents;
  return withTransaction(next, transactionBase(next, { id, date, kind: 'investment_valuation', amountCents: currentValueCents, accountId: investmentAccountId, source }));
}

export function recordRewardPayment(state, { id, date, accountId, amountCents, categoryLevel1 = '奖励支付', source = null }) {
  positiveCents(amountCents);
  requireAsset(state, accountId);
  if (state.rewardBalanceCents < amountCents) throw new Error('reward balance is insufficient');
  let next = updateAccount(state, accountId, -amountCents);
  next.rewardBalanceCents -= amountCents;
  return withTransaction(next, transactionBase(next, { id, date, kind: 'reward_payment', amountCents, accountId, categoryLevel1, rewardImpactCents: -amountCents, source }));
}

export function recordRefund(state, { id, date, originalTransactionId, amountCents, source = null }) {
  positiveCents(amountCents);
  const original = state.transactions.find((item) => item.id === originalTransactionId);
  if (!original) throw new Error(`unknown transaction: ${originalTransactionId}`);
  const remaining = original.amountCents - (original.refundedCents || 0);
  if (amountCents > remaining) throw new Error('refund exceeds original transaction amount');
  let next = clone(state);
  const target = account(next, original.accountId);
  if (target.type === 'credit_card') target.balanceCents -= amountCents;
  else target.balanceCents += amountCents;
  const originalMutable = next.transactions.find((item) => item.id === originalTransactionId);
  originalMutable.refundedCents = (originalMutable.refundedCents || 0) + amountCents;
  let budgetImpactCents = 0;
  let rewardImpactCents = 0;
  if (original.kind === 'controlled_expense') {
    const originalPeriod = original.budgetPeriodId ? period(next, original.budgetPeriodId) : null;
    if (originalPeriod && originalPeriod.status === 'open') {
      const priorRefunds = state.transactions.filter((item) => item.kind === 'refund' && item.relatedTransactionId === originalTransactionId);
      const budgetRestoredSoFar = priorRefunds.reduce((sum, item) => sum + Math.max(0, -(item.budgetImpactCents || 0)), 0);
      const rewardRestoredSoFar = priorRefunds.reduce((sum, item) => sum + Math.max(0, item.rewardImpactCents || 0), 0);
      const originalRewardOffsetCents = Math.max(0, original.amountCents - original.budgetImpactCents);
      const remainingBudgetToRestore = Math.max(0, original.budgetImpactCents - budgetRestoredSoFar);
      const remainingRewardToRestore = Math.max(0, originalRewardOffsetCents - rewardRestoredSoFar);
      const budgetRestoreCents = Math.min(amountCents, remainingBudgetToRestore);
      const rewardRestoreCents = Math.min(amountCents - budgetRestoreCents, remainingRewardToRestore);
      budgetImpactCents = -budgetRestoreCents;
      originalPeriod.netBudgetSpendCents += budgetImpactCents;
      rewardImpactCents = rewardRestoreCents;
    } else {
      rewardImpactCents = amountCents;
    }
  } else if (original.kind === 'reward_payment') {
    rewardImpactCents = amountCents;
  }
  next.rewardBalanceCents += rewardImpactCents;
  return withTransaction(next, transactionBase(next, { id, date, kind: 'refund', amountCents, accountId: original.accountId, budgetPeriodId: original.budgetPeriodId, budgetImpactCents, rewardImpactCents, source, relatedTransactionId: originalTransactionId }));
}

export function createFixedPlan(state, { id, name, amountCents = null, accountId, categoryLevel1, source = null, active = true }) {
  if (!id || state.plans.some((item) => item.id === id)) throw new Error(`duplicate plan id: ${id}`);
  if (amountCents !== null) positiveCents(amountCents);
  requireAsset(state, accountId);
  const next = clone(state);
  next.plans.push({ id, name: name || id, amountCents, accountId, categoryLevel1, source, active });
  return next;
}

export function revokeFixedPlan(state, planId) {
  const next = clone(state);
  const target = next.plans.find((item) => item.id === planId);
  if (!target) throw new Error(`unknown plan: ${planId}`);
  target.active = false;
  return next;
}

export function executeFixedPlan(state, { planId, date, transactionId = null }) {
  const plan = state.plans.find((item) => item.id === planId);
  if (!plan) throw new Error(`unknown plan: ${planId}`);
  if (!plan.active) throw new Error('fixed plan is revoked');
  const pendingReason = plan.amountCents === null ? 'amount_required' : (account(state, plan.accountId).balanceCents < plan.amountCents ? 'insufficient_balance' : null);
  if (pendingReason) {
    const next = clone(state);
    next.pendingItems.push({ id: `pending-${planId}-${date}`, type: 'fixed_plan', planId, date, reason: pendingReason, status: 'pending' });
    return next;
  }
  return recordFixedExpense(state, { id: transactionId || `plan-${planId}-${date}`, date, accountId: plan.accountId, amountCents: plan.amountCents, categoryLevel1: plan.categoryLevel1, source: plan.source || `plan:${planId}` });
}

export function closeBudgetPeriod(state, periodId) {
  const next = clone(state);
  period(next, periodId).status = 'closed';
  return next;
}

export function budgetForPeriod(state, periodId) {
  const target = period(state, periodId);
  return {
    actualBudgetCents: calculateActualBudget(target.baseBudgetCents, target.carryCents),
    budgetDebtCents: calculateBudgetDebt(target.baseBudgetCents, target.carryCents),
  };
}

export function totals(state) {
  const totalAssetsCents = state.accounts.filter((item) => !LIABILITY_TYPES.has(item.type)).reduce((sum, item) => sum + item.balanceCents, 0);
  const totalLiabilitiesCents = state.accounts.filter((item) => LIABILITY_TYPES.has(item.type)).reduce((sum, item) => sum + item.balanceCents, 0);
  return { totalAssetsCents, totalLiabilitiesCents, netAssetsCents: totalAssetsCents - totalLiabilitiesCents, rewardBalanceCents: state.rewardBalanceCents };
}
