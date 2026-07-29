// GENERATED FILE. Run npm run build:mini.
const { actualBudgetCents: calculateActualBudget, budgetDebtCents: calculateBudgetDebt, daysInMonth, formatDate, parseDate } = require('./budget.js');

const ACCOUNT_TYPES = new Set(['cash', 'bank', 'wallet', 'credit_card', 'loan', 'investment']);
const LIABILITY_TYPES = new Set(['credit_card', 'loan']);
const PLAN_TYPES = new Set(['fixed_expense', 'credit_card_repayment', 'loan_repayment']);
const PLAN_RECURRENCES = new Set(['one_time', 'monthly', 'yearly']);
const REMINDER_DAYS = new Set([0, 1, 3]);

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
  parseDate(date);
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

function createLedger({ accounts = [], budgetPeriods = [], defaultBudgetCents = 0, rewardBalanceCents = 0, plans = [], pendingItems = [] } = {}) {
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

function addAccount(state, { id, name, type, balanceCents = 0, costBasisCents = 0 }) {
  if (!id || state.accounts.some((item) => item.id === id)) throw new Error(`duplicate account id: ${id}`);
  if (!ACCOUNT_TYPES.has(type)) throw new Error(`unknown account type: ${type}`);
  nonNegativeCents(balanceCents, 'balanceCents');
  nonNegativeCents(costBasisCents, 'costBasisCents');
  const next = clone(state);
  next.accounts.push({ id, name: name || id, type, balanceCents, costBasisCents });
  return next;
}

function addBudgetPeriod(state, { id, startDate, endDate, baseBudgetCents, carryCents = 0, status = 'open' }) {
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

function recordIncome(state, { id, date, accountId, amountCents, categoryLevel1 = '收入', categoryLevel2 = null, source = null }) {
  positiveCents(amountCents);
  requireAsset(state, accountId);
  let next = updateAccount(state, accountId, amountCents);
  return withTransaction(next, transactionBase(next, { id, date, kind: 'income', amountCents, accountId, categoryLevel1, categoryLevel2, source }));
}

function recordExpense(state, { id, date, accountId, amountCents, budgetPeriodId, categoryLevel1, categoryLevel2 = null, rewardOffsetCents = 0, source = null }) {
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

function recordFixedExpense(state, { id, date, accountId, amountCents, categoryLevel1, categoryLevel2 = null, source = null }) {
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

function recordTransfer(state, { id, date, fromAccountId, toAccountId, amountCents, source = null }) {
  positiveCents(amountCents);
  if (fromAccountId === toAccountId) throw new Error('transfer accounts must differ');
  requireAsset(state, fromAccountId);
  requireAsset(state, toAccountId);
  let next = updateAccount(state, fromAccountId, -amountCents);
  next = updateAccount(next, toAccountId, amountCents);
  return withTransaction(next, transactionBase(next, { id, date, kind: 'transfer', amountCents, accountId: fromAccountId, counterpartyAccountId: toAccountId, source }));
}

function recordCreditCardRepayment(state, { id, date, fromAccountId, creditCardAccountId, amountCents, source = null }) {
  positiveCents(amountCents);
  requireAsset(state, fromAccountId);
  const card = requireLiability(state, creditCardAccountId, 'credit_card');
  if (card.balanceCents < amountCents) throw new Error('repayment exceeds credit card liability');
  let next = updateAccount(state, fromAccountId, -amountCents);
  next = updateLiability(next, creditCardAccountId, -amountCents);
  return withTransaction(next, transactionBase(next, { id, date, kind: 'credit_card_repayment', amountCents, accountId: fromAccountId, counterpartyAccountId: creditCardAccountId, source }));
}

function recordBorrowing(state, { id, date, cashAccountId, loanAccountId, amountCents, source = null }) {
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

function recordLoanPrincipalRepayment(state, { id, date, cashAccountId, loanAccountId, amountCents, source = null }) {
  positiveCents(amountCents);
  requireAsset(state, cashAccountId);
  const loan = requireLiability(state, loanAccountId, 'loan');
  if (loan.balanceCents < amountCents) throw new Error('principal repayment exceeds loan liability');
  let next = updateAccount(state, cashAccountId, -amountCents);
  next = updateLiability(next, loanAccountId, -amountCents);
  return withTransaction(next, transactionBase(next, { id, date, kind: 'loan_principal_repayment', amountCents, accountId: cashAccountId, counterpartyAccountId: loanAccountId, source }));
}

function recordLoanInterestPayment(state, { id, date, cashAccountId, loanAccountId = null, amountCents, categoryLevel1 = '利息', source = null }) {
  positiveCents(amountCents);
  requireAsset(state, cashAccountId);
  if (loanAccountId !== null) requireLiability(state, loanAccountId, 'loan');
  return recordFixedExpense(state, { id, date, accountId: cashAccountId, amountCents, categoryLevel1, source });
}

function recordLoanInterestAccrual(state, { id, date, loanAccountId, amountCents, source = null }) {
  positiveCents(amountCents);
  requireLiability(state, loanAccountId, 'loan');
  const next = updateAccountAllowLiability(state, loanAccountId, amountCents);
  return withTransaction(next, transactionBase(next, { id, date, kind: 'loan_interest_accrual', amountCents, accountId: loanAccountId, expenseKind: 'fixed', source }));
}

function recordInvestmentTrade(state, { id, date, side, cashAccountId, investmentAccountId, amountCents, source = null }) {
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

function setInvestmentValue(state, { id, date, investmentAccountId, currentValueCents, source = 'manual valuation' }) {
  nonNegativeCents(currentValueCents, 'currentValueCents');
  const investment = account(state, investmentAccountId);
  if (investment.type !== 'investment') throw new Error('target account is not an investment account');
  const next = clone(state);
  account(next, investmentAccountId).balanceCents = currentValueCents;
  return withTransaction(next, transactionBase(next, { id, date, kind: 'investment_valuation', amountCents: currentValueCents, accountId: investmentAccountId, source }));
}

function recordRewardPayment(state, { id, date, accountId, amountCents, categoryLevel1 = '奖励支付', source = null }) {
  positiveCents(amountCents);
  requireAsset(state, accountId);
  if (state.rewardBalanceCents < amountCents) throw new Error('reward balance is insufficient');
  let next = updateAccount(state, accountId, -amountCents);
  next.rewardBalanceCents -= amountCents;
  return withTransaction(next, transactionBase(next, { id, date, kind: 'reward_payment', amountCents, accountId, categoryLevel1, rewardImpactCents: -amountCents, source }));
}

function recordRefund(state, { id, date, originalTransactionId, amountCents, source = null }) {
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

function normalizeReminderDays(reminderDays = [1, 0]) {
  if (!Array.isArray(reminderDays)) throw new TypeError('reminderDays must be an array');
  const normalized = [...new Set(reminderDays)];
  for (const day of normalized) {
    integer(day, 'reminderDay');
    if (!REMINDER_DAYS.has(day)) throw new RangeError('reminder day must be 3, 1, or 0');
  }
  return normalized.sort((left, right) => right - left);
}

function validatePlanAccounts(state, plan) {
  requireAsset(state, plan.accountId);
  if (plan.type === 'credit_card_repayment') requireLiability(state, plan.targetLiabilityAccountId, 'credit_card');
  if (plan.type === 'loan_repayment') requireLiability(state, plan.targetLiabilityAccountId, 'loan');
}

function normalizedPlan(state, details, existing = null) {
  const plan = {
    ...(existing || {}),
    ...details,
    type: details.type ?? existing?.type ?? 'fixed_expense',
    amountCents: details.amountCents !== undefined ? details.amountCents : (existing?.amountCents ?? null),
    principalCents: details.principalCents !== undefined ? details.principalCents : (existing?.principalCents ?? null),
    interestCents: details.interestCents !== undefined ? details.interestCents : (existing?.interestCents ?? null),
    targetLiabilityAccountId: details.targetLiabilityAccountId !== undefined
      ? details.targetLiabilityAccountId
      : (existing?.targetLiabilityAccountId ?? null),
    recurrence: details.recurrence !== undefined
      ? details.recurrence
      : (existing?.recurrence ?? (details.nextDueDate ? 'one_time' : null)),
    nextDueDate: details.nextDueDate !== undefined ? details.nextDueDate : (existing?.nextDueDate ?? null),
    active: details.active !== undefined ? Boolean(details.active) : (existing?.active ?? true),
    reminderEnabled: details.reminderEnabled !== undefined
      ? Boolean(details.reminderEnabled)
      : (existing?.reminderEnabled ?? false),
    reminderDays: normalizeReminderDays(details.reminderDays ?? existing?.reminderDays ?? [1, 0]),
  };
  if (!PLAN_TYPES.has(plan.type)) throw new RangeError('unknown fixed plan type');
  if (plan.amountCents !== null) positiveCents(plan.amountCents);
  if (plan.principalCents !== null) positiveCents(plan.principalCents, 'principalCents');
  if (plan.interestCents !== null) positiveCents(plan.interestCents, 'interestCents');
  if (plan.recurrence !== null && !PLAN_RECURRENCES.has(plan.recurrence)) throw new RangeError('unknown fixed plan recurrence');
  if (plan.nextDueDate !== null) {
    const point = parseDate(plan.nextDueDate);
    if (details.nextDueDate !== undefined || !existing?.anchorDay) {
      plan.anchorDay = point.day;
      plan.anchorMonth = point.month;
    }
  }
  validatePlanAccounts(state, plan);
  return plan;
}

function createFixedPlan(state, details) {
  const {
    id,
    name,
    amountCents = null,
    accountId,
    categoryLevel1,
    source = null,
    active = true,
  } = details;
  if (!id || state.plans.some((item) => item.id === id)) throw new Error(`duplicate plan id: ${id}`);
  const usesLifecycle = ['type', 'principalCents', 'interestCents', 'targetLiabilityAccountId', 'recurrence', 'nextDueDate', 'reminderEnabled', 'reminderDays']
    .some((field) => Object.prototype.hasOwnProperty.call(details, field));
  if (!usesLifecycle) {
    if (amountCents !== null) positiveCents(amountCents);
    requireAsset(state, accountId);
    const next = clone(state);
    next.plans.push({ id, name: name || id, amountCents, accountId, categoryLevel1, source, active });
    return next;
  }
  const plan = normalizedPlan(state, {
    id,
    name: name || id,
    type: details.type ?? 'fixed_expense',
    amountCents,
    principalCents: details.principalCents ?? null,
    interestCents: details.interestCents ?? null,
    accountId,
    targetLiabilityAccountId: details.targetLiabilityAccountId ?? null,
    categoryLevel1,
    recurrence: details.recurrence ?? (details.nextDueDate ? 'one_time' : null),
    nextDueDate: details.nextDueDate ?? null,
    reminderEnabled: details.reminderEnabled ?? false,
    reminderDays: details.reminderDays ?? [1, 0],
    source,
    active,
  });
  const next = clone(state);
  next.plans.push(plan);
  return next;
}

function editFixedPlan(state, planId, changes) {
  const existing = state.plans.find((item) => item.id === planId);
  if (!existing) throw new Error(`unknown plan: ${planId}`);
  const plan = normalizedPlan(state, { ...changes, id: existing.id }, existing);
  const next = clone(state);
  Object.assign(next.plans.find((item) => item.id === planId), plan);
  return next;
}

function revokeFixedPlan(state, planId) {
  const next = clone(state);
  const target = next.plans.find((item) => item.id === planId);
  if (!target) throw new Error(`unknown plan: ${planId}`);
  target.active = false;
  return next;
}

function fixedPlanOccurrenceKey(planId, dueDate) {
  if (!planId) throw new Error('planId is required');
  assertDate(dueDate);
  return `${planId}@${dueDate}`;
}

function occurrenceWasHandled(state, occurrenceKey, ignoredPendingId = null) {
  return state.transactions.some((item) => item.occurrenceKey === occurrenceKey)
    || state.pendingItems.some((item) => item.id !== ignoredPendingId && item.occurrenceKey === occurrenceKey);
}

const PENDING_REASON_TEXT = {
  amount_required: '金额未填写',
  insufficient_balance: '账户余额不足',
  liability_insufficient: '当前欠款不足',
  account_invalid: '账户已失效',
  plan_info_required: '待补充计划信息',
};

function executionFailureReason(state, plan) {
  if (plan.type === 'loan_repayment') {
    if (plan.principalCents === null || plan.interestCents === null) return 'amount_required';
  } else if (plan.amountCents === null) return 'amount_required';
  let asset;
  let liability;
  try {
    asset = requireAsset(state, plan.accountId);
    if (plan.type === 'credit_card_repayment') liability = requireLiability(state, plan.targetLiabilityAccountId, 'credit_card');
    if (plan.type === 'loan_repayment') liability = requireLiability(state, plan.targetLiabilityAccountId, 'loan');
  } catch {
    return 'account_invalid';
  }
  const requiredCents = plan.type === 'loan_repayment'
    ? plan.principalCents + plan.interestCents
    : plan.amountCents;
  if (asset.balanceCents < requiredCents) return 'insufficient_balance';
  if (plan.type === 'credit_card_repayment' && liability.balanceCents < plan.amountCents) return 'liability_insufficient';
  if (plan.type === 'loan_repayment' && liability.balanceCents < plan.principalCents) return 'liability_insufficient';
  return null;
}

function withPendingOccurrence(state, plan, dueDate, occurrenceKey, reason) {
  if (occurrenceWasHandled(state, occurrenceKey)) return state;
  const next = clone(state);
  next.pendingItems.push({
    id: `pending-${occurrenceKey}`,
    type: 'fixed_plan',
    planId: plan.id,
    date: dueDate,
    dueDate,
    occurrenceKey,
    reason,
    reasonText: PENDING_REASON_TEXT[reason],
    status: 'pending',
    planSnapshot: clone(plan),
    relatedTransactionIds: [],
  });
  return next;
}

function tagTransactions(state, transactionIds, plan, dueDate, occurrenceKey) {
  const next = clone(state);
  for (const transactionId of transactionIds) {
    const transaction = next.transactions.find((item) => item.id === transactionId);
    transaction.planId = plan.id;
    transaction.dueDate = dueDate;
    transaction.occurrenceKey = occurrenceKey;
  }
  return next;
}

function executePlanOccurrence(state, plan, dueDate, {
  transactionId = null,
  ignoredPendingId = null,
  createPendingOnFailure = true,
} = {}) {
  const occurrenceKey = fixedPlanOccurrenceKey(plan.id, dueDate);
  if (occurrenceWasHandled(state, occurrenceKey, ignoredPendingId)) return state;
  const failureReason = executionFailureReason(state, plan);
  if (failureReason) {
    if (!createPendingOnFailure) throw new Error(PENDING_REASON_TEXT[failureReason]);
    return withPendingOccurrence(state, plan, dueDate, occurrenceKey, failureReason);
  }
  const source = plan.source || `plan:${plan.id}`;
  if (plan.type === 'credit_card_repayment') {
    const id = transactionId || `plan-${occurrenceKey}`;
    const next = recordCreditCardRepayment(state, {
      id,
      date: dueDate,
      fromAccountId: plan.accountId,
      creditCardAccountId: plan.targetLiabilityAccountId,
      amountCents: plan.amountCents,
      source,
    });
    return tagTransactions(next, [id], plan, dueDate, occurrenceKey);
  }
  if (plan.type === 'loan_repayment') {
    const principalId = `${transactionId || `plan-${occurrenceKey}`}-principal`;
    const interestId = `${transactionId || `plan-${occurrenceKey}`}-interest`;
    let next = recordLoanPrincipalRepayment(state, {
      id: principalId,
      date: dueDate,
      cashAccountId: plan.accountId,
      loanAccountId: plan.targetLiabilityAccountId,
      amountCents: plan.principalCents,
      source,
    });
    next = recordLoanInterestPayment(next, {
      id: interestId,
      date: dueDate,
      cashAccountId: plan.accountId,
      loanAccountId: plan.targetLiabilityAccountId,
      amountCents: plan.interestCents,
      source,
    });
    return tagTransactions(next, [principalId, interestId], plan, dueDate, occurrenceKey);
  }
  const id = transactionId || `plan-${occurrenceKey}`;
  const next = recordFixedExpense(state, {
    id,
    date: dueDate,
    accountId: plan.accountId,
    amountCents: plan.amountCents,
    categoryLevel1: plan.categoryLevel1,
    source,
  });
  return tagTransactions(next, [id], plan, dueDate, occurrenceKey);
}

function executeFixedPlan(state, { planId, date, transactionId = null }) {
  const plan = state.plans.find((item) => item.id === planId);
  if (!plan) throw new Error(`unknown plan: ${planId}`);
  if (!plan.active) throw new Error('fixed plan is revoked');
  return executePlanOccurrence(state, plan, date, { transactionId });
}

function scheduledDate(year, month, anchorDay) {
  return formatDate({ year, month, day: Math.min(anchorDay, daysInMonth(year, month)) });
}

function nextFixedPlanDueDate(plan, dueDate) {
  const point = parseDate(dueDate);
  if (plan.recurrence === 'one_time') return null;
  if (plan.recurrence === 'monthly') {
    const next = point.month === 12 ? { year: point.year + 1, month: 1 } : { year: point.year, month: point.month + 1 };
    return scheduledDate(next.year, next.month, plan.anchorDay || point.day);
  }
  if (plan.recurrence === 'yearly') {
    return scheduledDate(point.year + 1, plan.anchorMonth || point.month, plan.anchorDay || point.day);
  }
  return null;
}

function advanceFixedPlan(state, planId, handledDueDate) {
  const target = state.plans.find((item) => item.id === planId);
  if (!target) throw new Error(`unknown plan: ${planId}`);
  if (target.nextDueDate !== handledDueDate) return state;
  const next = clone(state);
  const mutable = next.plans.find((item) => item.id === planId);
  mutable.nextDueDate = nextFixedPlanDueDate(mutable, handledDueDate);
  if (mutable.nextDueDate === null) mutable.active = false;
  return next;
}

function markLegacyPlanPending(state, planId) {
  const plan = state.plans.find((item) => item.id === planId);
  if (!plan) throw new Error(`unknown plan: ${planId}`);
  const occurrenceKey = `${planId}@missing-plan-info`;
  if (state.pendingItems.some((item) => item.occurrenceKey === occurrenceKey)) return state;
  const next = clone(state);
  next.pendingItems.push({
    id: `pending-${occurrenceKey}`,
    type: 'fixed_plan',
    planId,
    date: null,
    dueDate: null,
    occurrenceKey,
    reason: 'plan_info_required',
    reasonText: PENDING_REASON_TEXT.plan_info_required,
    status: 'pending',
    planSnapshot: clone(plan),
    relatedTransactionIds: [],
  });
  return next;
}

function retryFixedPlanPending(state, {
  pendingId,
  amountCents,
  principalCents,
  interestCents,
}) {
  const pending = state.pendingItems.find((item) => item.id === pendingId);
  if (!pending) throw new Error(`unknown pending item: ${pendingId}`);
  if (pending.status !== 'pending') return state;
  if (!pending.dueDate) throw new Error('请先补充计划到期日');
  const currentPlan = state.plans.find((item) => item.id === pending.planId);
  const snapshot = clone(pending.planSnapshot || currentPlan);
  if (!snapshot) throw new Error('计划不存在');
  if (amountCents !== undefined) snapshot.amountCents = amountCents;
  if (principalCents !== undefined) snapshot.principalCents = principalCents;
  if (interestCents !== undefined) snapshot.interestCents = interestCents;
  if (snapshot.amountCents !== null) positiveCents(snapshot.amountCents);
  if (snapshot.principalCents !== null) positiveCents(snapshot.principalCents, 'principalCents');
  if (snapshot.interestCents !== null) positiveCents(snapshot.interestCents, 'interestCents');
  const transactionCount = state.transactions.length;
  let next = executePlanOccurrence(state, snapshot, pending.dueDate, {
    ignoredPendingId: pendingId,
    createPendingOnFailure: false,
  });
  next = clone(next);
  const mutablePending = next.pendingItems.find((item) => item.id === pendingId);
  mutablePending.status = 'resolved';
  mutablePending.resolvedAt = pending.dueDate;
  mutablePending.relatedTransactionIds = next.transactions.slice(transactionCount).map((item) => item.id);
  return next;
}

function closeBudgetPeriod(state, periodId) {
  const next = clone(state);
  period(next, periodId).status = 'closed';
  return next;
}

function budgetForPeriod(state, periodId) {
  const target = period(state, periodId);
  return {
    actualBudgetCents: calculateActualBudget(target.baseBudgetCents, target.carryCents),
    budgetDebtCents: calculateBudgetDebt(target.baseBudgetCents, target.carryCents),
  };
}

function totals(state) {
  const totalAssetsCents = state.accounts.filter((item) => !LIABILITY_TYPES.has(item.type)).reduce((sum, item) => sum + item.balanceCents, 0);
  const totalLiabilitiesCents = state.accounts.filter((item) => LIABILITY_TYPES.has(item.type)).reduce((sum, item) => sum + item.balanceCents, 0);
  return { totalAssetsCents, totalLiabilitiesCents, netAssetsCents: totalAssetsCents - totalLiabilitiesCents, rewardBalanceCents: state.rewardBalanceCents };
}

module.exports = { createLedger, addAccount, addBudgetPeriod, recordIncome, recordExpense, recordFixedExpense, recordTransfer, recordCreditCardRepayment, recordBorrowing, recordLoanPrincipalRepayment, recordLoanInterestPayment, recordLoanInterestAccrual, recordInvestmentTrade, setInvestmentValue, recordRewardPayment, recordRefund, createFixedPlan, editFixedPlan, revokeFixedPlan, fixedPlanOccurrenceKey, executeFixedPlan, nextFixedPlanDueDate, advanceFixedPlan, markLegacyPlanPending, retryFixedPlanPending, closeBudgetPeriod, budgetForPeriod, totals };
