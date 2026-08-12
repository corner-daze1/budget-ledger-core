import { addDays, dateDistance, parseDate, settleBudgetCycle } from './budget.js';

const CURRENT_SCHEMA_VERSION = 3;

const ACCOUNT_TYPES = new Set(['cash', 'bank', 'wallet', 'credit_card', 'loan', 'investment']);
const TRANSACTION_STATUSES = new Set(['active', 'superseded', 'revoked']);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isInteger(value) {
  return Number.isInteger(value);
}

function validateBudgetPeriods(periods) {
  const periodIds = new Set();
  for (let index = 0; index < periods.length; index += 1) {
    const item = periods[index];
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`invalid budget period at index ${index}`);
    if (typeof item.id !== 'string' || !item.id || periodIds.has(item.id)) throw new Error('backup contains an invalid or duplicate budget period id');
    if (typeof item.startDate !== 'string' || typeof item.endDate !== 'string') throw new Error(`invalid budget period dates: ${item.id}`);
    try {
      parseDate(item.startDate);
      parseDate(item.endDate);
    } catch (error) {
      throw new Error(`invalid budget period dates: ${item.id}: ${error.message}`);
    }
    if (item.startDate > item.endDate) throw new Error(`budget period starts after it ends: ${item.id}`);
    if (!isInteger(item.baseBudgetCents) || item.baseBudgetCents < 0) throw new Error(`invalid base budget: ${item.id}`);
    if (!isInteger(item.carryCents)) throw new Error(`invalid carry cents: ${item.id}`);
    if (!isInteger(item.netBudgetSpendCents)) throw new Error(`invalid budget spend: ${item.id}`);
    if (!['open', 'closed'].includes(item.status)) throw new Error(`invalid budget period status: ${item.id}`);
    if (item.kind !== undefined && !['regular', 'transition'].includes(item.kind)) throw new Error(`invalid budget period kind: ${item.id}`);
    const totalDays = item.totalDays;
    if (totalDays !== undefined && (!isInteger(totalDays) || totalDays !== dateDistance(item.startDate, item.endDate) + 1)) {
      throw new Error(`invalid budget period day count: ${item.id}`);
    }
    if (index > 0) {
      const previous = periods[index - 1];
      if (item.startDate !== addDays(previous.endDate, 1)) throw new Error(`budget periods are out of order or not contiguous: ${item.id}`);
    }
    periodIds.add(item.id);
  }

  for (let index = 0; index < periods.length; index += 1) {
    const item = periods[index];
    if (item.status === 'open') {
      if (item.settlement !== null) throw new Error(`open budget period cannot contain settlement: ${item.id}`);
      continue;
    }
    const settlement = item.settlement;
    if (!settlement || typeof settlement !== 'object' || Array.isArray(settlement)) {
      throw new Error(`closed budget period must contain settlement: ${item.id}`);
    }
    const requiredFields = ['settledAt', 'result', 'resultCents', 'decision', 'carryCents', 'nextPeriodId'];
    for (const field of requiredFields) {
      if (!Object.prototype.hasOwnProperty.call(settlement, field)) throw new Error(`settlement field ${field} is required: ${item.id}`);
    }
    if (typeof settlement.settledAt !== 'string') throw new Error(`invalid settlement date: ${item.id}`);
    try {
      parseDate(settlement.settledAt);
    } catch (error) {
      throw new Error(`invalid settlement date: ${item.id}: ${error.message}`);
    }
    if (settlement.settledAt < item.endDate) throw new Error(`settlement date is before period end: ${item.id}`);
    if (!['surplus', 'overspend', 'balanced'].includes(settlement.result)) throw new Error(`invalid settlement result: ${item.id}`);
    if (!isInteger(settlement.resultCents)) throw new Error(`invalid settlement result cents: ${item.id}`);
    if (!isInteger(settlement.carryCents)) throw new Error(`invalid settlement carry cents: ${item.id}`);
    if (!['carry', 'discard', 'none'].includes(settlement.decision)) throw new Error(`invalid settlement decision: ${item.id}`);
    const signResult = settlement.resultCents > 0 ? 'surplus' : (settlement.resultCents < 0 ? 'overspend' : 'balanced');
    if (settlement.result !== signResult) throw new Error(`settlement result sign mismatch: ${item.id}`);
    const expected = settleBudgetCycle({
      baseBudgetCents: item.baseBudgetCents,
      carryCents: item.carryCents,
      netBudgetSpendCents: item.netBudgetSpendCents,
      decision: settlement.resultCents === 0 ? null : settlement.decision,
    });
    if (settlement.resultCents !== expected.resultCents || settlement.result !== expected.result) {
      throw new Error(`settlement result does not match budget calculation: ${item.id}`);
    }
    if (settlement.resultCents === 0 && settlement.decision !== 'none') throw new Error(`balanced settlement must use decision none: ${item.id}`);
    if (settlement.resultCents !== 0 && !['carry', 'discard'].includes(settlement.decision)) throw new Error(`non-zero settlement requires carry or discard: ${item.id}`);
    const expectedCarry = settlement.decision === 'carry' ? settlement.resultCents : 0;
    if (settlement.carryCents !== expectedCarry) throw new Error(`settlement carry does not match decision: ${item.id}`);
    const nextPeriod = periods[index + 1];
    if (!nextPeriod || settlement.nextPeriodId !== nextPeriod.id) throw new Error(`settlement nextPeriodId must reference the next period: ${item.id}`);
  }
}

function validateState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('backup root must be an object');
  if (state.schemaVersion !== CURRENT_SCHEMA_VERSION) throw new Error(`unsupported schema version: ${state.schemaVersion}`);
  if (state.currency !== 'CNY') throw new Error('only CNY backups are supported');
  if (Object.prototype.hasOwnProperty.call(state, 'rewardBalanceCents')) throw new Error('backup contains a removed field');
  if (state.defaultBudgetCents !== undefined && (!isInteger(state.defaultBudgetCents) || state.defaultBudgetCents < 0)) throw new Error('defaultBudgetCents must be a non-negative integer');
  for (const field of ['accounts', 'budgetPeriods', 'transactions', 'plans', 'pendingItems']) {
    if (!Array.isArray(state[field])) throw new Error(`backup field ${field} must be an array`);
  }
  validateBudgetPeriods(state.budgetPeriods);
  const accountIds = new Set();
  for (const item of state.accounts) {
    if (!item || typeof item.id !== 'string' || accountIds.has(item.id)) throw new Error('backup contains an invalid or duplicate account id');
    if (!ACCOUNT_TYPES.has(item.type)) throw new Error(`invalid account type for account ${item.id}`);
    if (!isInteger(item.balanceCents) || (item.type !== 'credit_card' && item.balanceCents < 0)) throw new Error(`invalid balance for account ${item.id}`);
    if (item.costBasisCents !== undefined && (!isInteger(item.costBasisCents) || item.costBasisCents < 0)) throw new Error(`invalid cost basis for account ${item.id}`);
    accountIds.add(item.id);
  }
  const transactionIds = new Set();
  for (const item of state.transactions) {
    if (!item || typeof item.id !== 'string' || transactionIds.has(item.id)) throw new Error('backup contains an invalid or duplicate transaction id');
    if (!isInteger(item.amountCents) || item.amountCents <= 0) throw new Error(`invalid transaction amount: ${item.id}`);
    if (Object.prototype.hasOwnProperty.call(item, 'rewardImpactCents')) throw new Error(`transaction contains a removed field: ${item.id}`);
    if (!isInteger(item.budgetImpactCents)) throw new Error(`invalid transaction impact: ${item.id}`);
    if (typeof item.logicalTransactionId !== 'string' || !item.logicalTransactionId) throw new Error(`invalid logical transaction id: ${item.id}`);
    if (typeof item.operationGroupId !== 'string' || !item.operationGroupId) throw new Error(`invalid operation group id: ${item.id}`);
    if (!TRANSACTION_STATUSES.has(item.status)) throw new Error(`invalid transaction status: ${item.id}`);
    if (!isInteger(item.version) || item.version <= 0) throw new Error(`invalid transaction version: ${item.id}`);
    if (!Array.isArray(item.accountImpacts)) throw new Error(`invalid account impacts: ${item.id}`);
    for (const impact of item.accountImpacts) {
      if (!impact || !accountIds.has(impact.accountId) || !isInteger(impact.balanceDeltaCents) || !isInteger(impact.costBasisDeltaCents)) {
        throw new Error(`invalid account impact: ${item.id}`);
      }
    }
    if (!item.businessPayload || typeof item.businessPayload !== 'object' || Array.isArray(item.businessPayload)) throw new Error(`invalid business payload: ${item.id}`);
    transactionIds.add(item.id);
  }
  return state;
}

export function serializeBackup(state) {
  return JSON.stringify(validateState(clone(state)));
}

export function restoreBackup(rawData) {
  if (typeof rawData !== 'string') return { ok: false, error: 'backup data must be a string', rawData };
  try {
    const parsed = JSON.parse(rawData);
    return { ok: true, data: clone(validateState(parsed)) };
  } catch (error) {
    return { ok: false, error: `backup restore failed: ${error.message}`, rawData };
  }
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function exportTransactionsCsv(state) {
  validateState(clone(state));
  const columns = ['logicalTransactionId', 'id', 'date', 'kind', 'businessKind', 'status', 'version', 'accountId', 'counterpartyAccountId', 'amountCents', 'budgetPeriodId', 'budgetImpactCents', 'categoryLevel1', 'categoryLevel2', 'note', 'source', 'refundOfLogicalTransactionId'];
  const rows = [columns.join(',')];
  const grouped = new Map();
  for (const transaction of state.transactions) {
    if (transaction.technical || transaction.userReadable === false) continue;
    const logicalTransactionId = transaction.logicalTransactionId || transaction.id;
    const current = grouped.get(logicalTransactionId) || [];
    current.push(transaction);
    grouped.set(logicalTransactionId, current);
  }
  const exported = [];
  for (const group of grouped.values()) {
    const latestVersion = Math.max(...group.map((item) => item.version || 1));
    const latest = group.filter((item) => (item.version || 1) === latestVersion && item.status === 'active');
    if (latest.length === 0) continue;
    const ordered = [...latest].sort((left, right) => left.id.localeCompare(right.id));
    const representative = { ...ordered[0] };
    if (representative.businessKind === 'loan_repayment') representative.kind = 'loan_repayment';
    representative.amountCents = ordered.reduce((sum, item) => sum + item.amountCents, 0);
    representative.budgetImpactCents = ordered.reduce((sum, item) => sum + item.budgetImpactCents, 0);
    exported.push(representative);
  }
  exported.sort((left, right) => right.date.localeCompare(left.date) || right.id.localeCompare(left.id));
  for (const transaction of exported) rows.push(columns.map((column) => csvCell(transaction[column])).join(','));
  return `${rows.join('\n')}\n`;
}

export { CURRENT_SCHEMA_VERSION };
