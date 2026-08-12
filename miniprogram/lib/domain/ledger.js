// GENERATED FILE. Run npm run build:mini.
const { actualBudgetCents: calculateActualBudget, budgetDebtCents: calculateBudgetDebt, daysInMonth, formatDate, parseDate } = require('./budget.js');

const ACCOUNT_TYPES = new Set(['cash', 'bank', 'wallet', 'credit_card', 'loan', 'investment']);
const LIABILITY_TYPES = new Set(['credit_card', 'loan']);
const EXPENSE_KINDS = new Set(['controlled_expense', 'fixed_expense']);
const PLAN_TYPES = new Set(['fixed_expense', 'credit_card_repayment', 'loan_repayment']);
const PLAN_RECURRENCES = new Set(['one_time', 'monthly', 'yearly']);
const REMINDER_DAYS = new Set([0, 1, 3]);
const CORRECTION_STATUSES = new Set(['active', 'superseded', 'revoked']);

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

function assertNotFuture(date, today) {
  assertDate(date);
  if (today !== undefined && today !== null) {
    assertDate(today);
    if (date > today) throw new RangeError(`date cannot be in the future: ${date}`);
  }
}

function nextTransactionId(state) {
  let sequence = state.transactions.length + 1;
  let id = `txn-${sequence}`;
  while (state.transactions.some((item) => item.id === id)) {
    sequence += 1;
    id = `txn-${sequence}`;
  }
  return id;
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
  if (state.transactions.some((item) => item.id === transaction.id)) throw new Error(`duplicate transaction id: ${transaction.id}`);
  const next = clone(state);
  next.transactions.push(transaction);
  return next;
}

function transactionBase(state, details) {
  assertDate(details.date);
  const id = details.id || nextTransactionId(state);
  const logicalTransactionId = details.logicalTransactionId || id;
  const operationGroupId = details.operationGroupId || logicalTransactionId;
  return {
    id,
    date: details.date,
    effectiveDate: details.effectiveDate || details.date,
    kind: details.kind,
    businessKind: details.businessKind || details.kind,
    amountCents: details.amountCents,
    currency: 'CNY',
    accountId: details.accountId ?? null,
    counterpartyAccountId: details.counterpartyAccountId ?? null,
    categoryLevel1: details.categoryLevel1 ?? null,
    categoryLevel2: details.categoryLevel2 ?? null,
    expenseKind: details.expenseKind ?? null,
    budgetPeriodId: details.budgetPeriodId ?? null,
    budgetImpactCents: details.budgetImpactCents ?? 0,
    source: details.source ?? null,
    note: details.note ?? null,
    relatedTransactionId: details.relatedTransactionId ?? null,
    refundedCents: details.refundedCents ?? 0,
    logicalTransactionId,
    operationGroupId,
    status: details.status || 'active',
    version: details.version || 1,
    supersedesTransactionId: details.supersedesTransactionId ?? null,
    replacedByTransactionId: details.replacedByTransactionId ?? null,
    refundOfLogicalTransactionId: details.refundOfLogicalTransactionId ?? null,
    revokedByTransactionId: details.revokedByTransactionId ?? null,
    requestId: details.requestId ?? null,
    accountImpacts: clone(details.accountImpacts || []),
    businessPayload: clone(details.businessPayload || {}),
    technical: Boolean(details.technical),
    userReadable: details.userReadable !== false,
    affectsStatistics: details.affectsStatistics !== false,
    planId: details.planId ?? null,
    dueDate: details.dueDate ?? null,
    occurrenceKey: details.occurrenceKey ?? null,
  };
}

function transactionMetadata(details, businessPayload, accountImpacts, businessKind = null) {
  return {
    logicalTransactionId: details.logicalTransactionId,
    operationGroupId: details.operationGroupId,
    version: details.version,
    supersedesTransactionId: details.supersedesTransactionId,
    requestId: details.requestId,
    note: details.note,
    planId: details.planId,
    dueDate: details.dueDate,
    occurrenceKey: details.occurrenceKey,
    businessKind: businessKind || details.businessKind,
    businessPayload,
    accountImpacts,
  };
}

function accountShortfall(id, shortfallCents) {
  return new Error(`insufficient balance in account: ${id}; shortfallCents=${shortfallCents}`);
}

function updateAccount(state, id, change) {
  const next = clone(state);
  const target = account(next, id);
  target.balanceCents += change;
  if (target.type !== 'credit_card' && target.balanceCents < 0) throw accountShortfall(id, -target.balanceCents);
  return next;
}

function updateLoanLiability(state, id, change) {
  const next = clone(state);
  const target = account(next, id);
  target.balanceCents += change;
  if (target.balanceCents < 0) throw new Error(`loan liability cannot be negative: ${id}; shortfallCents=${-target.balanceCents}`);
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

function createLedger(options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, 'rewardBalanceCents')) throw new Error('removed field: rewardBalanceCents');
  const {
    accounts = [],
    budgetPeriods = [],
    defaultBudgetCents = 0,
    plans = [],
    pendingItems = [],
  } = options;
  nonNegativeCents(defaultBudgetCents, 'defaultBudgetCents');
  const ids = new Set();
  for (const item of accounts) {
    if (!item.id || ids.has(item.id)) throw new Error(`duplicate account id: ${item.id}`);
    if (!ACCOUNT_TYPES.has(item.type)) throw new Error(`unknown account type: ${item.type}`);
    integer(item.balanceCents, `account ${item.id} balanceCents`);
    if (item.type !== 'credit_card' && item.balanceCents < 0) throw new RangeError(`account ${item.id} balanceCents must not be negative`);
    nonNegativeCents(item.costBasisCents ?? 0, `account ${item.id} costBasisCents`);
    ids.add(item.id);
  }
  return {
    schemaVersion: 3,
    currency: 'CNY',
    defaultBudgetCents,
    accounts: clone(accounts),
    budgetPeriods: clone(budgetPeriods).map((item) => ({
      status: 'open',
      carryCents: 0,
      netBudgetSpendCents: 0,
      settlement: null,
      ...item,
    })),
    plans: clone(plans),
    pendingItems: clone(pendingItems),
    transactions: [],
  };
}

function addAccount(state, { id, name, type, balanceCents = 0, costBasisCents = 0 }) {
  if (!id || state.accounts.some((item) => item.id === id)) throw new Error(`duplicate account id: ${id}`);
  if (!ACCOUNT_TYPES.has(type)) throw new Error(`unknown account type: ${type}`);
  integer(balanceCents, 'balanceCents');
  if (type !== 'credit_card' && balanceCents < 0) throw new RangeError('balanceCents must not be negative');
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
  next.budgetPeriods.push({ id, startDate, endDate, baseBudgetCents, carryCents, status, netBudgetSpendCents: 0, settlement: null });
  return next;
}

function recordIncome(state, details) {
  const { id, date, accountId, amountCents, categoryLevel1 = '收入', categoryLevel2 = null, source = null } = details;
  positiveCents(amountCents);
  requireAsset(state, accountId);
  let next = updateAccount(state, accountId, amountCents);
  const businessPayload = { date, accountId, amountCents, categoryLevel1, categoryLevel2, source, note: details.note ?? null };
  const accountImpacts = [{ accountId, balanceDeltaCents: amountCents, costBasisDeltaCents: 0 }];
  return withTransaction(next, transactionBase(next, {
    id, date, kind: 'income', amountCents, accountId, categoryLevel1, categoryLevel2, source,
    ...transactionMetadata(details, businessPayload, accountImpacts, 'income'),
  }));
}

function recordExpense(state, details) {
  if (Object.prototype.hasOwnProperty.call(details, 'rewardOffsetCents')) throw new Error('removed field: rewardOffsetCents');
  const { id, date, accountId, amountCents, budgetPeriodId, categoryLevel1, categoryLevel2 = null, source = null } = details;
  positiveCents(amountCents);
  const periodTarget = period(state, budgetPeriodId);
  if (periodTarget.status !== 'open') throw new Error('budget period is closed');
  let next = clone(state);
  const target = account(next, accountId);
  if (target.type === 'credit_card') target.balanceCents -= amountCents;
  else {
    requireAsset(next, accountId);
    if (target.balanceCents < amountCents) throw accountShortfall(accountId, amountCents - target.balanceCents);
    target.balanceCents -= amountCents;
  }
  period(next, budgetPeriodId).netBudgetSpendCents += amountCents;
  const businessPayload = { date, accountId, amountCents, budgetPeriodId, categoryLevel1, categoryLevel2, expenseKind: 'controlled', source, note: details.note ?? null };
  const accountImpacts = [{ accountId, balanceDeltaCents: -amountCents, costBasisDeltaCents: 0 }];
  return withTransaction(next, transactionBase(next, {
    id, date, kind: 'controlled_expense', amountCents, accountId, categoryLevel1, categoryLevel2,
    expenseKind: 'controlled', budgetPeriodId, budgetImpactCents: amountCents, source,
    ...transactionMetadata(details, businessPayload, accountImpacts, 'expense'),
  }));
}

function recordFixedExpense(state, details) {
  const { id, date, accountId, amountCents, categoryLevel1, categoryLevel2 = null, source = null } = details;
  positiveCents(amountCents);
  let next = clone(state);
  const target = account(next, accountId);
  if (target.type === 'credit_card') target.balanceCents -= amountCents;
  else {
    requireAsset(next, accountId);
    if (target.balanceCents < amountCents) throw accountShortfall(accountId, amountCents - target.balanceCents);
    target.balanceCents -= amountCents;
  }
  const businessPayload = details.businessPayload || { date, accountId, amountCents, categoryLevel1, categoryLevel2, expenseKind: 'fixed', source, note: details.note ?? null };
  const accountImpacts = [{ accountId, balanceDeltaCents: -amountCents, costBasisDeltaCents: 0 }];
  return withTransaction(next, transactionBase(next, {
    id, date, kind: 'fixed_expense', amountCents, accountId, categoryLevel1, categoryLevel2, expenseKind: 'fixed', source,
    ...transactionMetadata(details, businessPayload, accountImpacts, details.businessKind || 'expense'),
  }));
}

function recordTransfer(state, details) {
  const { id, date, fromAccountId, toAccountId, amountCents, source = null } = details;
  positiveCents(amountCents);
  if (fromAccountId === toAccountId) throw new Error('transfer accounts must differ');
  requireAsset(state, fromAccountId);
  requireAsset(state, toAccountId);
  let next = updateAccount(state, fromAccountId, -amountCents);
  next = updateAccount(next, toAccountId, amountCents);
  const businessPayload = { date, fromAccountId, toAccountId, amountCents, source, note: details.note ?? null };
  const accountImpacts = [
    { accountId: fromAccountId, balanceDeltaCents: -amountCents, costBasisDeltaCents: 0 },
    { accountId: toAccountId, balanceDeltaCents: amountCents, costBasisDeltaCents: 0 },
  ];
  return withTransaction(next, transactionBase(next, {
    id, date, kind: 'transfer', amountCents, accountId: fromAccountId, counterpartyAccountId: toAccountId, source,
    ...transactionMetadata(details, businessPayload, accountImpacts, 'transfer'),
  }));
}

function recordCreditCardRepayment(state, details) {
  const { id, date, fromAccountId, creditCardAccountId, amountCents, source = null } = details;
  positiveCents(amountCents);
  requireAsset(state, fromAccountId);
  requireLiability(state, creditCardAccountId, 'credit_card');
  let next = updateAccount(state, fromAccountId, -amountCents);
  next = updateAccount(next, creditCardAccountId, amountCents);
  const businessPayload = { date, fromAccountId, creditCardAccountId, amountCents, source, note: details.note ?? null };
  const accountImpacts = [
    { accountId: fromAccountId, balanceDeltaCents: -amountCents, costBasisDeltaCents: 0 },
    { accountId: creditCardAccountId, balanceDeltaCents: amountCents, costBasisDeltaCents: 0 },
  ];
  return withTransaction(next, transactionBase(next, {
    id, date, kind: 'credit_card_repayment', amountCents, accountId: fromAccountId, counterpartyAccountId: creditCardAccountId, source,
    ...transactionMetadata(details, businessPayload, accountImpacts, 'credit_card_repayment'),
  }));
}

function recordBorrowing(state, details) {
  const { id, date, cashAccountId, loanAccountId, amountCents, source = null } = details;
  positiveCents(amountCents);
  requireAsset(state, cashAccountId);
  requireLiability(state, loanAccountId, 'loan');
  let next = updateAccount(state, cashAccountId, amountCents);
  next = updateAccountAllowLiability(next, loanAccountId, amountCents);
  const businessPayload = { date, cashAccountId, loanAccountId, amountCents, source, note: details.note ?? null };
  const accountImpacts = [
    { accountId: cashAccountId, balanceDeltaCents: amountCents, costBasisDeltaCents: 0 },
    { accountId: loanAccountId, balanceDeltaCents: amountCents, costBasisDeltaCents: 0 },
  ];
  return withTransaction(next, transactionBase(next, {
    id, date, kind: 'borrowing', amountCents, accountId: cashAccountId, counterpartyAccountId: loanAccountId, source,
    ...transactionMetadata(details, businessPayload, accountImpacts, 'borrowing'),
  }));
}

function updateAccountAllowLiability(state, id, change) {
  const next = clone(state);
  account(next, id).balanceCents += change;
  return next;
}

function recordLoanPrincipalRepayment(state, details) {
  const { id, date, cashAccountId, loanAccountId, amountCents, source = null } = details;
  positiveCents(amountCents);
  requireAsset(state, cashAccountId);
  const loan = requireLiability(state, loanAccountId, 'loan');
  if (loan.balanceCents < amountCents) throw new Error(`principal repayment exceeds loan liability; shortfallCents=${amountCents - loan.balanceCents}`);
  let next = updateAccount(state, cashAccountId, -amountCents);
  next = updateLoanLiability(next, loanAccountId, -amountCents);
  const businessPayload = details.businessPayload || { date, cashAccountId, loanAccountId, amountCents, source, note: details.note ?? null };
  const accountImpacts = [
    { accountId: cashAccountId, balanceDeltaCents: -amountCents, costBasisDeltaCents: 0 },
    { accountId: loanAccountId, balanceDeltaCents: -amountCents, costBasisDeltaCents: 0 },
  ];
  return withTransaction(next, transactionBase(next, {
    id, date, kind: 'loan_principal_repayment', amountCents, accountId: cashAccountId, counterpartyAccountId: loanAccountId, source,
    ...transactionMetadata(details, businessPayload, accountImpacts, details.businessKind || 'loan_principal_repayment'),
  }));
}

function recordLoanInterestPayment(state, details) {
  const { id, date, cashAccountId, loanAccountId = null, amountCents, categoryLevel1 = '利息', source = null } = details;
  positiveCents(amountCents);
  requireAsset(state, cashAccountId);
  if (loanAccountId !== null) requireLiability(state, loanAccountId, 'loan');
  const businessPayload = details.businessPayload || {
    date,
    cashAccountId,
    loanAccountId,
    amountCents,
    categoryLevel1,
    source,
    note: details.note ?? null,
  };
  return recordFixedExpense(state, {
    ...details, id, date, accountId: cashAccountId, amountCents, categoryLevel1, source,
    businessKind: details.businessKind || 'loan_interest_payment',
    businessPayload,
  });
}

function recordLoanRepayment(state, details) {
  const {
    id = nextTransactionId(state),
    date,
    cashAccountId,
    loanAccountId,
    principalCents,
    interestCents,
    source = null,
  } = details;
  positiveCents(principalCents, 'principalCents');
  positiveCents(interestCents, 'interestCents');
  const asset = requireAsset(state, cashAccountId);
  const loan = requireLiability(state, loanAccountId, 'loan');
  const totalCents = principalCents + interestCents;
  if (asset.balanceCents < totalCents) throw accountShortfall(cashAccountId, totalCents - asset.balanceCents);
  if (loan.balanceCents < principalCents) throw new Error(`principal repayment exceeds loan liability; shortfallCents=${principalCents - loan.balanceCents}`);
  const logicalTransactionId = details.logicalTransactionId || id;
  const operationGroupId = details.operationGroupId || logicalTransactionId;
  const businessPayload = {
    date, cashAccountId, loanAccountId, principalCents, interestCents, source, note: details.note ?? null,
  };
  const common = {
    logicalTransactionId,
    operationGroupId,
    version: details.version,
    supersedesTransactionId: details.supersedesTransactionId,
    requestId: details.requestId,
    note: details.note,
    planId: details.planId,
    dueDate: details.dueDate,
    occurrenceKey: details.occurrenceKey,
    businessKind: 'loan_repayment',
    businessPayload,
  };
  let next = recordLoanPrincipalRepayment(state, {
    ...common,
    id: `${id}-principal`,
    date,
    cashAccountId,
    loanAccountId,
    amountCents: principalCents,
    source,
  });
  next = recordLoanInterestPayment(next, {
    ...common,
    id: `${id}-interest`,
    date,
    cashAccountId,
    loanAccountId,
    amountCents: interestCents,
    source,
  });
  return next;
}

function recordLoanInterestAccrual(state, details) {
  const { id, date, loanAccountId, amountCents, source = null } = details;
  positiveCents(amountCents);
  requireLiability(state, loanAccountId, 'loan');
  const next = updateAccountAllowLiability(state, loanAccountId, amountCents);
  const businessPayload = { date, loanAccountId, amountCents, source, note: details.note ?? null };
  const accountImpacts = [{ accountId: loanAccountId, balanceDeltaCents: amountCents, costBasisDeltaCents: 0 }];
  return withTransaction(next, transactionBase(next, {
    id, date, kind: 'loan_interest_accrual', amountCents, accountId: loanAccountId, expenseKind: 'fixed', source,
    ...transactionMetadata(details, businessPayload, accountImpacts, 'loan_interest_accrual'),
  }));
}

function recordInvestmentTrade(state, details) {
  const { id, date, side, cashAccountId, investmentAccountId, amountCents, source = null } = details;
  positiveCents(amountCents);
  if (!['buy', 'sell'].includes(side)) throw new RangeError('investment side must be buy or sell');
  requireAsset(state, cashAccountId);
  const investment = account(state, investmentAccountId);
  if (investment.type !== 'investment') throw new Error('target account is not an investment account');
  let next;
  let investmentCostDeltaCents;
  if (side === 'buy') {
    next = updateAccount(state, cashAccountId, -amountCents);
    next = updateAccount(next, investmentAccountId, amountCents);
    account(next, investmentAccountId).costBasisCents = (account(next, investmentAccountId).costBasisCents || 0) + amountCents;
    investmentCostDeltaCents = amountCents;
  } else {
    if (investment.balanceCents < amountCents) throw new Error('investment value is insufficient');
    next = updateAccount(state, investmentAccountId, -amountCents);
    next = updateAccount(next, cashAccountId, amountCents);
    const priorCost = account(next, investmentAccountId).costBasisCents || 0;
    investmentCostDeltaCents = -Math.min(priorCost, amountCents);
    account(next, investmentAccountId).costBasisCents = priorCost + investmentCostDeltaCents;
  }
  const businessPayload = { date, side, cashAccountId, investmentAccountId, amountCents, source, note: details.note ?? null };
  const accountImpacts = side === 'buy'
    ? [
      { accountId: cashAccountId, balanceDeltaCents: -amountCents, costBasisDeltaCents: 0 },
      { accountId: investmentAccountId, balanceDeltaCents: amountCents, costBasisDeltaCents: investmentCostDeltaCents },
    ]
    : [
      { accountId: investmentAccountId, balanceDeltaCents: -amountCents, costBasisDeltaCents: investmentCostDeltaCents },
      { accountId: cashAccountId, balanceDeltaCents: amountCents, costBasisDeltaCents: 0 },
    ];
  return withTransaction(next, transactionBase(next, {
    id, date, kind: `investment_${side}`, amountCents, accountId: cashAccountId, counterpartyAccountId: investmentAccountId, source,
    ...transactionMetadata(details, businessPayload, accountImpacts, 'investment_trade'),
  }));
}

function setInvestmentValue(state, details) {
  const { id, date, investmentAccountId, currentValueCents, source = 'manual valuation' } = details;
  nonNegativeCents(currentValueCents, 'currentValueCents');
  const investment = account(state, investmentAccountId);
  if (investment.type !== 'investment') throw new Error('target account is not an investment account');
  const next = clone(state);
  const balanceDeltaCents = currentValueCents - account(next, investmentAccountId).balanceCents;
  account(next, investmentAccountId).balanceCents = currentValueCents;
  const businessPayload = { date, investmentAccountId, currentValueCents, source, note: details.note ?? null };
  const accountImpacts = [{ accountId: investmentAccountId, balanceDeltaCents, costBasisDeltaCents: 0 }];
  return withTransaction(next, transactionBase(next, {
    id, date, kind: 'investment_valuation', amountCents: currentValueCents, accountId: investmentAccountId, source,
    ...transactionMetadata(details, businessPayload, accountImpacts, 'investment_valuation'),
  }));
}

function requestWasHandled(state, requestId) {
  return Boolean(requestId) && state.transactions.some((item) => item.requestId === requestId);
}

function resolveLogicalTransactionId(state, id) {
  const direct = state.transactions.find((item) => item.id === id);
  return direct?.logicalTransactionId || id;
}

function transactionsForLogicalId(state, logicalTransactionId) {
  const resolved = resolveLogicalTransactionId(state, logicalTransactionId);
  return state.transactions.filter((item) => item.logicalTransactionId === resolved && !item.technical);
}

function representativeForGroup(group) {
  if (group.length === 0) return null;
  const sorted = [...group].sort((left, right) => left.id.localeCompare(right.id));
  const representative = clone(sorted[0]);
  if (representative.businessKind === 'loan_repayment') {
    representative.amountCents = group.reduce((sum, item) => sum + item.amountCents, 0);
    representative.groupTransactionIds = sorted.map((item) => item.id);
  }
  return representative;
}

function getLatestTransaction(state, logicalTransactionId) {
  const transactions = transactionsForLogicalId(state, logicalTransactionId);
  if (transactions.length === 0) throw new Error(`unknown logical transaction: ${logicalTransactionId}`);
  const latestVersion = Math.max(...transactions.map((item) => item.version || 1));
  const latest = transactions.filter((item) => (item.version || 1) === latestVersion);
  const active = latest.filter((item) => item.status === 'active');
  return representativeForGroup(active.length > 0 ? active : latest);
}

function activeGroup(state, logicalTransactionId) {
  const transactions = transactionsForLogicalId(state, logicalTransactionId);
  const active = transactions.filter((item) => item.status === 'active');
  if (active.length === 0) throw new Error(`transaction is not active: ${logicalTransactionId}`);
  const latestVersion = Math.max(...active.map((item) => item.version || 1));
  return active.filter((item) => (item.version || 1) === latestVersion);
}

function activeRefundsFor(state, originalLogicalTransactionId) {
  return state.transactions.filter((item) => item.kind === 'refund'
    && item.status === 'active'
    && item.refundOfLogicalTransactionId === originalLogicalTransactionId);
}

function refreshRefundedCents(state, originalLogicalTransactionId) {
  const next = clone(state);
  const refundedCents = activeRefundsFor(next, originalLogicalTransactionId).reduce((sum, item) => sum + item.amountCents, 0);
  for (const transaction of next.transactions) {
    if (transaction.logicalTransactionId === originalLogicalTransactionId && EXPENSE_KINDS.has(transaction.kind)) {
      transaction.refundedCents = refundedCents;
    }
  }
  return next;
}

function applyAccountImpactsInPlace(state, impacts, factor) {
  for (const impact of impacts || []) {
    const target = account(state, impact.accountId);
    const balanceDeltaCents = factor * (impact.balanceDeltaCents || 0);
    const nextBalance = target.balanceCents + balanceDeltaCents;
    if (target.type !== 'credit_card' && nextBalance < 0) throw accountShortfall(target.id, -nextBalance);
    target.balanceCents = nextBalance;
    const costBasisDeltaCents = factor * (impact.costBasisDeltaCents || 0);
    const nextCostBasis = (target.costBasisCents || 0) + costBasisDeltaCents;
    if (nextCostBasis < 0) throw new Error(`investment cost basis cannot be negative: ${target.id}; shortfallCents=${-nextCostBasis}`);
    target.costBasisCents = nextCostBasis;
  }
}

function reverseFinancialEffects(state, group) {
  const next = clone(state);
  for (const transaction of group) {
    applyAccountImpactsInPlace(next, transaction.accountImpacts, -1);
  }
  return next;
}

function budgetImpactMap(group) {
  const result = new Map();
  for (const transaction of group) {
    if (!transaction.budgetPeriodId || !transaction.budgetImpactCents) continue;
    result.set(transaction.budgetPeriodId, (result.get(transaction.budgetPeriodId) || 0) + transaction.budgetImpactCents);
  }
  return result;
}

function currentOpenPeriod(state, today) {
  return state.budgetPeriods.find((item) => item.status === 'open' && today && item.startDate <= today && today <= item.endDate) || null;
}

function applyBudgetDifferences(state, oldGroup, newGroup, correctionDate) {
  const next = clone(state);
  const oldMap = budgetImpactMap(oldGroup);
  const newMap = budgetImpactMap(newGroup);
  const ids = new Set([...oldMap.keys(), ...newMap.keys()]);
  const historicalChanges = [];
  for (const periodId of ids) {
    const oldImpactCents = oldMap.get(periodId) || 0;
    const newImpactCents = newMap.get(periodId) || 0;
    const deltaCents = newImpactCents - oldImpactCents;
    if (deltaCents === 0) continue;
    const target = period(next, periodId);
    if (target.status === 'open') {
      target.netBudgetSpendCents += deltaCents;
      if (target.netBudgetSpendCents < 0) throw new Error(`budget restoration exceeds recorded spend: ${periodId}`);
      continue;
    }
    const open = currentOpenPeriod(next, correctionDate);
    if (!open) throw new Error('no open budget period for historical adjustment');
    open.netBudgetSpendCents += deltaCents;
    historicalChanges.push({ periodId, deltaCents, currentBudgetDeltaCents: deltaCents, currentBudgetPeriodId: open.id });
  }
  return { state: next, historicalChanges };
}

function reverseHistoricalBudgetAdjustments(state, changes, correctionDate) {
  const next = clone(state);
  const historicalChanges = [];
  for (const change of changes) {
    const open = currentOpenPeriod(next, correctionDate);
    if (!open) throw new Error('no open budget period for historical adjustment');
    const deltaCents = -(change.currentBudgetDeltaCents ?? change.deltaCents ?? 0);
    open.netBudgetSpendCents += deltaCents;
    historicalChanges.push({
      periodId: change.periodId,
      deltaCents: -(change.deltaCents ?? 0),
      currentBudgetDeltaCents: deltaCents,
      currentBudgetPeriodId: open.id,
    });
  }
  return { state: next, historicalChanges };
}

function appendTechnicalReversals(state, group, { requestId, date, operationGroupId, status }) {
  let next = clone(state);
  const reversalIds = [];
  for (const original of group) {
    const id = nextTransactionId(next);
    reversalIds.push(id);
    const accountImpacts = (original.accountImpacts || []).map((impact) => ({
      accountId: impact.accountId,
      balanceDeltaCents: -(impact.balanceDeltaCents || 0),
      costBasisDeltaCents: -(impact.costBasisDeltaCents || 0),
    }));
    next = withTransaction(next, transactionBase(next, {
      id,
      date,
      kind: 'technical_reversal',
      businessKind: 'technical_reversal',
      amountCents: original.amountCents,
      accountId: original.accountId,
      counterpartyAccountId: original.counterpartyAccountId,
      relatedTransactionId: original.id,
      logicalTransactionId: `technical:${original.id}:${id}`,
      operationGroupId,
      requestId,
      accountImpacts,
      businessPayload: {
        reversedTransactionId: original.id,
        reversedBudgetImpactCents: original.budgetImpactCents || 0,
        resultingStatus: status,
      },
      technical: true,
      userReadable: false,
      affectsStatistics: false,
    }));
  }
  return { state: next, reversalIds };
}

function appendHistoricalAdjustment(state, {
  requestId,
  date,
  operationGroupId,
  logicalTransactionId,
  oldGroup,
  newGroup,
  historicalChanges,
}) {
  if (historicalChanges.length === 0) return state;
  const accountImpactMap = (group) => {
    const result = new Map();
    for (const transaction of group) {
      for (const impact of transaction.accountImpacts || []) {
        const current = result.get(impact.accountId) || { balanceDeltaCents: 0, costBasisDeltaCents: 0 };
        current.balanceDeltaCents += impact.balanceDeltaCents || 0;
        current.costBasisDeltaCents += impact.costBasisDeltaCents || 0;
        result.set(impact.accountId, current);
      }
    }
    return result;
  };
  const beforeAccounts = accountImpactMap(oldGroup);
  const afterAccounts = accountImpactMap(newGroup);
  const accountIds = new Set([...beforeAccounts.keys(), ...afterAccounts.keys()]);
  const accountChanges = [...accountIds].map((accountId) => ({
    accountId,
    balanceDeltaCents: (afterAccounts.get(accountId)?.balanceDeltaCents || 0) - (beforeAccounts.get(accountId)?.balanceDeltaCents || 0),
    costBasisDeltaCents: (afterAccounts.get(accountId)?.costBasisDeltaCents || 0) - (beforeAccounts.get(accountId)?.costBasisDeltaCents || 0),
  })).filter((item) => item.balanceDeltaCents !== 0 || item.costBasisDeltaCents !== 0);
  const id = nextTransactionId(state);
  const amountCents = Math.max(1, historicalChanges.reduce((sum, item) => sum + Math.abs(item.deltaCents), 0));
  return withTransaction(state, transactionBase(state, {
    id,
    date,
    kind: 'historical_adjustment',
    businessKind: 'historical_adjustment',
    amountCents,
    logicalTransactionId: `adjustment:${logicalTransactionId}:${requestId || id}`,
    operationGroupId,
    requestId,
    relatedTransactionId: oldGroup[0]?.id || null,
    businessPayload: {
      originalLogicalTransactionId: logicalTransactionId,
      originalDate: oldGroup[0]?.date || null,
      beforeAmountCents: oldGroup.reduce((sum, item) => sum + item.amountCents, 0),
      afterAmountCents: newGroup.reduce((sum, item) => sum + item.amountCents, 0),
      accountChanges,
      changes: historicalChanges,
    },
    accountImpacts: [],
    affectsStatistics: false,
  }));
}

const ALLOWED_CHANGE_FIELDS = {
  expense: new Set(['date', 'accountId', 'amountCents', 'budgetPeriodId', 'categoryLevel1', 'categoryLevel2', 'note', 'expenseKind', 'source']),
  income: new Set(['date', 'accountId', 'amountCents', 'categoryLevel1', 'categoryLevel2', 'note', 'source']),
  transfer: new Set(['date', 'fromAccountId', 'toAccountId', 'amountCents', 'note', 'source']),
  credit_card_repayment: new Set(['date', 'fromAccountId', 'creditCardAccountId', 'amountCents', 'note', 'source']),
  borrowing: new Set(['date', 'cashAccountId', 'loanAccountId', 'amountCents', 'note', 'source']),
  loan_repayment: new Set(['date', 'cashAccountId', 'loanAccountId', 'principalCents', 'interestCents', 'note', 'source']),
  loan_principal_repayment: new Set(['date', 'cashAccountId', 'loanAccountId', 'amountCents', 'note', 'source']),
  loan_interest_payment: new Set(['date', 'cashAccountId', 'loanAccountId', 'amountCents', 'categoryLevel1', 'note', 'source']),
  loan_interest_accrual: new Set(['date', 'loanAccountId', 'amountCents', 'note', 'source']),
  investment_trade: new Set(['date', 'side', 'cashAccountId', 'investmentAccountId', 'amountCents', 'note', 'source']),
  investment_valuation: new Set(['date', 'investmentAccountId', 'currentValueCents', 'note', 'source']),
};

function validateModificationChanges(businessKind, changes) {
  if (Object.prototype.hasOwnProperty.call(changes, 'kind') || Object.prototype.hasOwnProperty.call(changes, 'businessKind')) {
    throw new Error('modification cannot change business type');
  }
  const allowed = ALLOWED_CHANGE_FIELDS[businessKind];
  if (!allowed) throw new Error(`transaction business type cannot be modified: ${businessKind}`);
  for (const field of Object.keys(changes)) {
    if (!allowed.has(field)) throw new Error(`field cannot be modified for ${businessKind}: ${field}`);
  }
}

function recordBusinessPayload(state, businessKind, payload, metadata) {
  const details = { ...payload, ...metadata };
  if (businessKind === 'expense') {
    if ((payload.expenseKind || 'controlled') === 'fixed') return recordFixedExpense(state, details);
    return recordExpense(state, details);
  }
  if (businessKind === 'income') return recordIncome(state, details);
  if (businessKind === 'transfer') return recordTransfer(state, details);
  if (businessKind === 'credit_card_repayment') return recordCreditCardRepayment(state, details);
  if (businessKind === 'borrowing') return recordBorrowing(state, details);
  if (businessKind === 'loan_repayment') return recordLoanRepayment(state, details);
  if (businessKind === 'loan_principal_repayment') return recordLoanPrincipalRepayment(state, details);
  if (businessKind === 'loan_interest_payment') return recordLoanInterestPayment(state, details);
  if (businessKind === 'loan_interest_accrual') return recordLoanInterestAccrual(state, details);
  if (businessKind === 'investment_trade') return recordInvestmentTrade(state, details);
  if (businessKind === 'investment_valuation') return setInvestmentValue(state, details);
  throw new Error(`transaction business type cannot be modified: ${businessKind}`);
}

function setGroupStatusInPlace(state, group, status, relationField, relationId) {
  for (const original of group) {
    const mutable = state.transactions.find((item) => item.id === original.id);
    mutable.status = status;
    if (relationField) mutable[relationField] = relationId;
  }
}

function modifyTransaction(state, {
  logicalTransactionId,
  changes,
  requestId,
  today,
}) {
  if (requestWasHandled(state, requestId)) return clone(state);
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new TypeError('changes must be an object');
  const group = activeGroup(state, logicalTransactionId);
  const representative = representativeForGroup(group);
  if (representative.kind === 'historical_adjustment') throw new Error('historical adjustments cannot be modified');
  if (representative.kind === 'refund') throw new Error('refund records cannot be modified');
  const refunds = activeRefundsFor(state, representative.logicalTransactionId);
  if (refunds.length > 0) {
    const allowedWithRefund = new Set(['categoryLevel1', 'categoryLevel2', 'note']);
    if (Object.keys(changes).some((field) => !allowedWithRefund.has(field))) {
      throw new Error('financial modification is blocked by active refunds');
    }
  }
  validateModificationChanges(representative.businessKind, changes);
  const payload = { ...clone(representative.businessPayload), ...clone(changes) };
  if (representative.businessKind === 'expense'
    && (payload.expenseKind || 'controlled') === 'controlled'
    && Object.prototype.hasOwnProperty.call(changes, 'date')
    && !Object.prototype.hasOwnProperty.call(changes, 'budgetPeriodId')) {
    const matchingPeriod = state.budgetPeriods.find((item) => item.startDate <= payload.date && payload.date <= item.endDate);
    if (!matchingPeriod) throw new Error('no budget period covers modified expense date');
    payload.budgetPeriodId = matchingPeriod.id;
  }
  assertNotFuture(payload.date, today);
  const version = Math.max(...group.map((item) => item.version || 1)) + 1;
  const operationGroupId = `${representative.logicalTransactionId}:v${version}:${requestId || 'modify'}`;
  let next = reverseFinancialEffects(state, group);
  const periodSnapshots = next.budgetPeriods.map((item) => ({ id: item.id, status: item.status, netBudgetSpendCents: item.netBudgetSpendCents }));
  for (const item of next.budgetPeriods) item.status = 'open';
  const transactionCount = next.transactions.length;
  next = recordBusinessPayload(next, representative.businessKind, payload, {
    id: nextTransactionId(next),
    logicalTransactionId: representative.logicalTransactionId,
    operationGroupId,
    version,
    supersedesTransactionId: group[0].id,
    requestId,
    planId: representative.planId,
    dueDate: representative.dueDate,
    occurrenceKey: representative.occurrenceKey,
  });
  const newGroup = next.transactions.slice(transactionCount);
  for (const snapshot of periodSnapshots) {
    const mutable = period(next, snapshot.id);
    mutable.status = snapshot.status;
    mutable.netBudgetSpendCents = snapshot.netBudgetSpendCents;
  }
  const budgetResult = applyBudgetDifferences(next, group, newGroup, today || payload.date);
  next = budgetResult.state;
  setGroupStatusInPlace(next, group, 'superseded', 'replacedByTransactionId', newGroup[0].id);
  const reversal = appendTechnicalReversals(next, group, {
    requestId, date: today || payload.date, operationGroupId, status: 'superseded',
  });
  next = reversal.state;
  next = appendHistoricalAdjustment(next, {
    requestId,
    date: today || payload.date,
    operationGroupId,
    logicalTransactionId: representative.logicalTransactionId,
    oldGroup: group,
    newGroup,
    historicalChanges: budgetResult.historicalChanges,
  });
  return refreshRefundedCents(next, representative.logicalTransactionId);
}

function revokeTransaction(state, {
  logicalTransactionId,
  requestId,
  date,
  today,
}) {
  if (requestWasHandled(state, requestId)) return clone(state);
  assertNotFuture(date, today);
  const group = activeGroup(state, logicalTransactionId);
  const representative = representativeForGroup(group);
  if (representative.kind === 'historical_adjustment') throw new Error('historical adjustments cannot be revoked');
  if (representative.kind === 'refund') return revokeRefund(state, { logicalTransactionId, requestId, date, today });
  if (activeRefundsFor(state, representative.logicalTransactionId).length > 0) {
    throw new Error('transaction cannot be revoked while it has active refunds');
  }
  let next = reverseFinancialEffects(state, group);
  const budgetResult = applyBudgetDifferences(next, group, [], date);
  next = budgetResult.state;
  const operationGroupId = `${representative.logicalTransactionId}:revoke:${requestId || date}`;
  setGroupStatusInPlace(next, group, 'revoked', 'revokedByTransactionId', null);
  const reversal = appendTechnicalReversals(next, group, { requestId, date, operationGroupId, status: 'revoked' });
  next = reversal.state;
  for (const original of group) {
    const mutable = next.transactions.find((item) => item.id === original.id);
    mutable.revokedByTransactionId = reversal.reversalIds[0];
  }
  return appendHistoricalAdjustment(next, {
    requestId,
    date,
    operationGroupId,
    logicalTransactionId: representative.logicalTransactionId,
    oldGroup: group,
    newGroup: [],
    historicalChanges: budgetResult.historicalChanges,
  });
}

function recordRefund(state, details) {
  const {
    id = nextTransactionId(state),
    date,
    originalTransactionId,
    amountCents,
    destinationAccountId = null,
    source = null,
    requestId = null,
    today = null,
  } = details;
  if (requestWasHandled(state, requestId)) return clone(state);
  positiveCents(amountCents);
  assertNotFuture(date, today);
  const original = getLatestTransaction(state, originalTransactionId);
  if (original.status !== 'active' || !EXPENSE_KINDS.has(original.kind)) throw new Error('only an active real expense can be refunded');
  if (date < original.date) throw new RangeError('refund date cannot be before original expense date');
  const priorRefunds = activeRefundsFor(state, original.logicalTransactionId);
  const refundedSoFar = priorRefunds.reduce((sum, item) => sum + item.amountCents, 0);
  const remainingCents = original.amountCents - refundedSoFar;
  if (amountCents > remainingCents) throw new Error(`refund exceeds remaining amount: remainingCents=${remainingCents}`);
  const refundAccountId = destinationAccountId || original.accountId;
  const refundAccount = account(state, refundAccountId);
  const originalAccount = account(state, original.accountId);
  const ordinaryDestination = ['cash', 'bank', 'wallet'].includes(refundAccount.type);
  const originalCardDestination = originalAccount.type === 'credit_card' && refundAccountId === original.accountId;
  if (!ordinaryDestination && !originalCardDestination) throw new Error('refund destination must be cash, bank, wallet, or the original credit card');
  let next = updateAccount(state, refundAccountId, amountCents);
  let budgetImpactCents = 0;
  let historicalChanges = [];
  if (original.kind === 'controlled_expense') {
    const originalPeriod = period(next, original.budgetPeriodId);
    if (originalPeriod.status === 'open') {
      budgetImpactCents = -amountCents;
      originalPeriod.netBudgetSpendCents += budgetImpactCents;
    } else {
      const open = currentOpenPeriod(next, date);
      if (!open) throw new Error('no open budget period for historical adjustment');
      open.netBudgetSpendCents -= amountCents;
      historicalChanges = [{
        periodId: originalPeriod.id,
        deltaCents: -amountCents,
        currentBudgetDeltaCents: -amountCents,
        currentBudgetPeriodId: open.id,
      }];
    }
  }
  const logicalTransactionId = details.logicalTransactionId || id;
  const businessPayload = {
    date,
    originalLogicalTransactionId: original.logicalTransactionId,
    amountCents,
    destinationAccountId: refundAccountId,
    source,
    note: details.note ?? null,
  };
  if (historicalChanges.length > 0) businessPayload.historicalChanges = clone(historicalChanges);
  const accountImpacts = [{ accountId: refundAccountId, balanceDeltaCents: amountCents, costBasisDeltaCents: 0 }];
  next = withTransaction(next, transactionBase(next, {
    id,
    date,
    kind: 'refund',
    businessKind: 'refund',
    amountCents,
    accountId: refundAccountId,
    budgetPeriodId: original.budgetPeriodId,
    budgetImpactCents,
    source,
    note: details.note,
    relatedTransactionId: original.id,
    refundOfLogicalTransactionId: original.logicalTransactionId,
    logicalTransactionId,
    operationGroupId: details.operationGroupId || logicalTransactionId,
    requestId,
    accountImpacts,
    businessPayload,
  }));
  if (historicalChanges.length > 0) {
    next = appendHistoricalAdjustment(next, {
      requestId,
      date,
      operationGroupId: details.operationGroupId || logicalTransactionId,
      logicalTransactionId: original.logicalTransactionId,
      oldGroup: [original],
      newGroup: [original],
      historicalChanges,
    });
  }
  return refreshRefundedCents(next, original.logicalTransactionId);
}

function revokeRefund(state, {
  logicalTransactionId,
  requestId,
  date,
  today,
}) {
  if (requestWasHandled(state, requestId)) return clone(state);
  assertNotFuture(date, today);
  const group = activeGroup(state, logicalTransactionId);
  const refund = representativeForGroup(group);
  if (refund.kind !== 'refund') throw new Error('only refund records can use revokeRefund');
  let next = reverseFinancialEffects(state, group);
  const budgetResult = refund.businessPayload?.historicalChanges?.length
    ? reverseHistoricalBudgetAdjustments(next, refund.businessPayload.historicalChanges, date)
    : applyBudgetDifferences(next, group, [], date);
  next = budgetResult.state;
  const historicalChanges = [...budgetResult.historicalChanges];
  const operationGroupId = `${refund.logicalTransactionId}:revoke:${requestId || date}`;
  setGroupStatusInPlace(next, group, 'revoked', 'revokedByTransactionId', null);
  const reversal = appendTechnicalReversals(next, group, { requestId, date, operationGroupId, status: 'revoked' });
  next = reversal.state;
  for (const original of group) {
    next.transactions.find((item) => item.id === original.id).revokedByTransactionId = reversal.reversalIds[0];
  }
  next = appendHistoricalAdjustment(next, {
    requestId,
    date,
    operationGroupId,
    logicalTransactionId: refund.logicalTransactionId,
    oldGroup: group,
    newGroup: [],
    historicalChanges,
  });
  return refreshRefundedCents(next, refund.refundOfLogicalTransactionId);
}

function getTransactionActionAvailability(state, logicalTransactionId) {
  const latest = getLatestTransaction(state, logicalTransactionId);
  const none = { refund: false, modify: false, revoke: false, modifyFields: 'none' };
  if (latest.status !== 'active' || latest.technical || latest.kind === 'historical_adjustment') return none;
  if (latest.kind === 'refund') return { ...none, revoke: true };
  if (EXPENSE_KINDS.has(latest.kind)) {
    const refundedCents = activeRefundsFor(state, latest.logicalTransactionId).reduce((sum, item) => sum + item.amountCents, 0);
    if (refundedCents <= 0) return { refund: true, modify: true, revoke: true, modifyFields: 'all' };
    return {
      refund: refundedCents < latest.amountCents,
      modify: true,
      revoke: false,
      modifyFields: 'category-note',
    };
  }
  return { ...none, modify: true, revoke: true, modifyFields: 'all' };
}

function listUserTransactions(state, { includeRevoked = false } = {}) {
  const groups = new Map();
  for (const transaction of state.transactions) {
    if (transaction.technical || transaction.userReadable === false) continue;
    const logicalId = transaction.logicalTransactionId || transaction.id;
    const current = groups.get(logicalId) || [];
    current.push(transaction);
    groups.set(logicalId, current);
  }
  const result = [];
  for (const group of groups.values()) {
    const latestVersion = Math.max(...group.map((item) => item.version || 1));
    const latest = group.filter((item) => (item.version || 1) === latestVersion);
    const representative = representativeForGroup(latest);
    if (!includeRevoked && representative.status === 'revoked') continue;
    result.push(representative);
  }
  return result.sort((left, right) => right.date.localeCompare(left.date) || right.id.localeCompare(left.id));
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
    const baseId = transactionId || `plan-${occurrenceKey}`;
    const principalId = `${baseId}-principal`;
    const interestId = `${baseId}-interest`;
    const next = recordLoanRepayment(state, {
      id: baseId,
      date: dueDate,
      cashAccountId: plan.accountId,
      loanAccountId: plan.targetLiabilityAccountId,
      principalCents: plan.principalCents,
      interestCents: plan.interestCents,
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

function closeBudgetPeriod(state, periodId, settlement = null) {
  const next = clone(state);
  const target = period(next, periodId);
  target.status = 'closed';
  if (settlement !== null) target.settlement = clone(settlement);
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
  const totalAssetsCents = state.accounts.reduce((sum, item) => {
    if (item.type === 'credit_card') return sum + Math.max(0, item.balanceCents);
    if (item.type === 'loan') return sum;
    return sum + item.balanceCents;
  }, 0);
  const totalLiabilitiesCents = state.accounts.reduce((sum, item) => {
    if (item.type === 'credit_card') return sum + Math.max(0, -item.balanceCents);
    if (item.type === 'loan') return sum + item.balanceCents;
    return sum;
  }, 0);
  return { totalAssetsCents, totalLiabilitiesCents, netAssetsCents: totalAssetsCents - totalLiabilitiesCents };
}

module.exports = { createLedger, addAccount, addBudgetPeriod, recordIncome, recordExpense, recordFixedExpense, recordTransfer, recordCreditCardRepayment, recordBorrowing, recordLoanPrincipalRepayment, recordLoanInterestPayment, recordLoanRepayment, recordLoanInterestAccrual, recordInvestmentTrade, setInvestmentValue, getLatestTransaction, modifyTransaction, revokeTransaction, recordRefund, revokeRefund, getTransactionActionAvailability, listUserTransactions, createFixedPlan, editFixedPlan, revokeFixedPlan, fixedPlanOccurrenceKey, executeFixedPlan, nextFixedPlanDueDate, advanceFixedPlan, markLegacyPlanPending, retryFixedPlanPending, closeBudgetPeriod, budgetForPeriod, totals };
