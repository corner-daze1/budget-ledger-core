const CURRENT_SCHEMA_VERSION = 3;

const ACCOUNT_TYPES = new Set(['cash', 'bank', 'wallet', 'credit_card', 'loan', 'investment']);
const TRANSACTION_STATUSES = new Set(['active', 'superseded', 'revoked']);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isInteger(value) {
  return Number.isInteger(value);
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
