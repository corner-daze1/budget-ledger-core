const CURRENT_SCHEMA_VERSION = 1;

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
  if (state.defaultBudgetCents !== undefined && (!isInteger(state.defaultBudgetCents) || state.defaultBudgetCents < 0)) throw new Error('defaultBudgetCents must be a non-negative integer');
  for (const field of ['accounts', 'budgetPeriods', 'transactions', 'plans', 'pendingItems']) {
    if (!Array.isArray(state[field])) throw new Error(`backup field ${field} must be an array`);
  }
  if (!isInteger(state.rewardBalanceCents) || state.rewardBalanceCents < 0) throw new Error('rewardBalanceCents must be a non-negative integer');
  const accountIds = new Set();
  for (const item of state.accounts) {
    if (!item || typeof item.id !== 'string' || accountIds.has(item.id)) throw new Error('backup contains an invalid or duplicate account id');
    if (!isInteger(item.balanceCents) || item.balanceCents < 0) throw new Error(`invalid balance for account ${item.id}`);
    accountIds.add(item.id);
  }
  const transactionIds = new Set();
  for (const item of state.transactions) {
    if (!item || typeof item.id !== 'string' || transactionIds.has(item.id)) throw new Error('backup contains an invalid or duplicate transaction id');
    if (!isInteger(item.amountCents) || item.amountCents <= 0) throw new Error(`invalid transaction amount: ${item.id}`);
    if (!isInteger(item.budgetImpactCents) || !isInteger(item.rewardImpactCents)) throw new Error(`invalid transaction impact: ${item.id}`);
    transactionIds.add(item.id);
  }
  return state;
}

export function migrateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new Error('backup root must be an object');
  if (snapshot.schemaVersion === CURRENT_SCHEMA_VERSION) return clone(validateState(snapshot));
  if (snapshot.schemaVersion === 0) {
    const migrated = {
      schemaVersion: 1,
      currency: 'CNY',
      defaultBudgetCents: snapshot.defaultBudgetCents ?? 0,
      accounts: (snapshot.accounts || []).map((item) => ({ ...item, balanceCents: item.balanceCents ?? item.balance ?? 0, costBasisCents: item.costBasisCents ?? 0 })),
      budgetPeriods: snapshot.budgetPeriods || [],
      rewardBalanceCents: snapshot.rewardBalanceCents || 0,
      plans: snapshot.plans || [],
      pendingItems: snapshot.pendingItems || [],
      transactions: snapshot.transactions || [],
    };
    return clone(validateState(migrated));
  }
  throw new Error(`unsupported schema version: ${snapshot.schemaVersion}`);
}

export function serializeBackup(state) {
  return JSON.stringify(validateState(clone(state)));
}

export function restoreBackup(rawData) {
  if (typeof rawData !== 'string') return { ok: false, error: 'backup data must be a string', rawData };
  try {
    const parsed = JSON.parse(rawData);
    return { ok: true, data: migrateSnapshot(parsed) };
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
  const columns = ['id', 'date', 'kind', 'accountId', 'counterpartyAccountId', 'amountCents', 'budgetPeriodId', 'budgetImpactCents', 'rewardImpactCents', 'categoryLevel1', 'categoryLevel2', 'source', 'relatedTransactionId'];
  const rows = [columns.join(',')];
  for (const transaction of state.transactions) rows.push(columns.map((column) => csvCell(transaction[column])).join(','));
  return `${rows.join('\n')}\n`;
}

export { CURRENT_SCHEMA_VERSION };
