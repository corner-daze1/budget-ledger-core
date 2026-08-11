import {
  actualBudgetCents,
  addDays,
  applyBudgetChange,
  budgetDebtCents,
  budgetSnapshot,
  cycleForDate,
  dateDistance,
  parseDate,
  planStartDayTransition,
  prorateMonthlyBudgetCents,
  settleBudgetCycle,
} from '../domain/budget.js';
import {
  addAccount,
  addBudgetPeriod,
  advanceFixedPlan,
  closeBudgetPeriod,
  createFixedPlan,
  createLedger,
  editFixedPlan,
  executeFixedPlan,
  fixedPlanOccurrenceKey,
  getLatestTransaction,
  getTransactionActionAvailability,
  listUserTransactions,
  markLegacyPlanPending,
  modifyTransaction,
  recordBorrowing,
  recordCreditCardRepayment,
  recordExpense,
  recordFixedExpense,
  recordIncome,
  recordInvestmentTrade,
  recordLoanInterestPayment,
  recordLoanPrincipalRepayment,
  recordRefund,
  recordTransfer,
  retryFixedPlanPending,
  revokeRefund,
  revokeFixedPlan,
  revokeTransaction,
  setInvestmentValue,
  totals,
} from '../domain/ledger.js';
import {
  CURRENT_SCHEMA_VERSION,
  exportTransactionsCsv,
  restoreBackup,
  serializeBackup,
} from '../domain/storage.js';

export const STORAGE_KEY = 'yongdu-ledger-v1';
export const RESTORE_TEMP_KEY = `${STORAGE_KEY}-restore-temp`;
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;

export function todayIso(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export const CATEGORY_TREE = [
  { level1: '餐饮', level2: ['早餐', '午餐', '晚餐', '零食'] },
  { level1: '交通', level2: ['公交地铁', '打车', '加油停车'] },
  { level1: '购物', level2: ['日用品', '衣物', '数码'] },
  { level1: '居住', level2: ['房租', '水电燃气', '家居'] },
  { level1: '健康', level2: ['药品', '就医', '运动'] },
  { level1: '娱乐', level2: ['电影', '游戏', '旅行'] },
  { level1: '学习', level2: ['书籍', '课程', '工具'] },
  { level1: '其他', level2: ['其他'] },
];

const ALLOWED_ACCOUNT_TYPES = new Set(['cash', 'bank', 'wallet']);
const ALL_ACCOUNT_TYPES = new Set(['cash', 'bank', 'wallet', 'credit_card', 'loan', 'investment']);
const LIABILITY_ACCOUNT_TYPES = new Set(['credit_card', 'loan']);
const TRANSFER_ACCOUNT_TYPES = new Set(['cash', 'bank', 'wallet']);
const ACCOUNT_TYPE_LABELS = {
  cash: '现金',
  bank: '储蓄卡',
  wallet: '电子钱包',
  credit_card: '信用卡',
  loan: '借贷',
  investment: '投资',
};
const TRANSACTION_TYPE_LABELS = {
  income: '收入',
  controlled_expense: '可控支出',
  fixed_expense: '固定支出',
  transfer: '转账',
  credit_card_repayment: '信用卡还款',
  borrowing: '借款',
  loan_principal_repayment: '归还本金',
  investment_buy: '投资买入',
  investment_sell: '投资卖出',
  investment_valuation: '手工估值',
  refund: '退款',
  reward_payment: '奖励支付',
  loan_interest_accrual: '利息计提',
  historical_adjustment: '历史账单调整',
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function integer(value, label) {
  if (!Number.isInteger(value)) throw new TypeError(`${label} must be an integer`);
  return value;
}

function positiveAmount(input) {
  const amountCents = parseYuanToCents(input);
  if (amountCents <= 0) throw new Error('金额必须大于0');
  return amountCents;
}

function chineseOperationError(error) {
  const message = String(error?.message || error || '');
  const rules = [
    [/unknown account/, '未找到账户'],
    [/duplicate account id/, '账户标识重复'],
    [/unknown account type/, '不支持的账户类型'],
    [/must be positive/, '金额必须大于0'],
    [/insufficient balance/, '账户余额不足'],
    [/account is not an asset account/, '请选择资产账户'],
    [/account is not the expected liability account/, '请选择正确的负债账户'],
    [/transfer accounts must differ/, '转出和转入账户不能相同'],
    [/repayment exceeds credit card liability/, '还款金额不能超过信用卡欠款'],
    [/principal repayment exceeds loan liability/, '还本金额不能超过贷款欠款'],
    [/investment value is insufficient/, '投资现值不足'],
    [/target account is not an investment account/, '请选择投资账户'],
    [/liability cannot be negative/, '负债余额不能为负'],
  ];
  const translated = rules.find(([pattern]) => pattern.test(message));
  return translated ? translated[1] : (/[一-龥]/.test(message) ? message : '操作失败，请检查账户和金额');
}

function runOperation(operation) {
  try {
    return operation();
  } catch (error) {
    throw new Error(chineseOperationError(error));
  }
}

function nextAccountId(state, type) {
  let suffix = state.accounts.length + 1;
  let id = `${type}-${suffix}`;
  while (state.accounts.some((item) => item.id === id)) {
    suffix += 1;
    id = `${type}-${suffix}`;
  }
  return id;
}

function assertDate(date) {
  try {
    parseDate(date);
  } catch {
    throw new Error('日期无效，请检查年月日');
  }
}

export function parseYuanToCents(input) {
  const text = String(input ?? '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error('金额必须是非负数字，最多两位小数');
  const [yuan, fraction = ''] = text.split('.');
  const cents = Number(yuan) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new RangeError('金额超过可安全记录的范围');
  return integer(cents, 'amountCents');
}

export function formatCents(amountCents) {
  integer(amountCents, 'amountCents');
  const sign = amountCents < 0 ? '-' : '';
  const absolute = Math.abs(amountCents);
  return `¥${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

export function categoryOptions() {
  return clone(CATEGORY_TREE);
}

function accountName(state, accountId) {
  return state.accounts.find((item) => item.id === accountId)?.name || accountId;
}

function currentPeriod(state, date) {
  assertDate(date);
  const found = state.budgetPeriods.find((item) => date >= item.startDate && date <= item.endDate);
  if (!found) throw new Error(`no budget period covers ${date}`);
  return found;
}

function openPeriodWaitingForSettlement(state, date) {
  assertDate(date);
  const candidates = state.budgetPeriods
    .filter((item) => item.status === 'open' && date > item.endDate)
    .sort((left, right) => left.endDate.localeCompare(right.endDate));
  return candidates.length ? candidates[candidates.length - 1] : null;
}

function withSettings(state, settings) {
  const next = clone(state);
  next.appSettings = { ...settings };
  return next;
}

function nextBudgetPeriodId(state) {
  let suffix = state.budgetPeriods.length + 1;
  let id = `period-${suffix}`;
  while (state.budgetPeriods.some((item) => item.id === id)) {
    suffix += 1;
    id = `period-${suffix}`;
  }
  return id;
}

function activePeriodForDate(state, date) {
  assertDate(date);
  return state.budgetPeriods.find((item) => item.status === 'open' && date >= item.startDate && date <= item.endDate) || null;
}

function waitingPeriodForDate(state, date) {
  return openPeriodWaitingForSettlement(state, date);
}

function assertStartDay(startDay) {
  integer(startDay, 'startDay');
  if (startDay < 1 || startDay > 31) throw new Error('周期起始日必须是1到31');
}

export function initializeState({ monthlyBudgetYuan, startDay = 1, nowDate, accounts }) {
  assertDate(nowDate);
  integer(startDay, 'startDay');
  if (startDay < 1 || startDay > 31) throw new RangeError('发薪日必须是1到31');
  if (!Array.isArray(accounts) || accounts.length === 0) throw new Error('至少需要一个资产账户');
  const monthlyBudgetCents = parseYuanToCents(monthlyBudgetYuan);
  const normalizedAccounts = accounts.map((item, index) => {
    if (!item || !ALLOWED_ACCOUNT_TYPES.has(item.type)) throw new Error('初始化账户只能是现金、储蓄卡或电子钱包');
    const balanceCents = item.balanceCents === undefined ? parseYuanToCents(item.balanceYuan || '0') : item.balanceCents;
    integer(balanceCents, 'balanceCents');
    if (balanceCents < 0) throw new RangeError('账户余额不能为负');
    return { id: item.id || `account-${index + 1}`, name: item.name || `账户${index + 1}`, type: item.type, balanceCents };
  });
  const cycle = cycleForDate(nowDate, startDay, monthlyBudgetCents);
  const ledger = createLedger({ accounts: normalizedAccounts, defaultBudgetCents: monthlyBudgetCents });
  const withPeriod = addBudgetPeriod(ledger, { id: 'period-1', startDate: cycle.startDate, endDate: cycle.endDate, baseBudgetCents: monthlyBudgetCents });
  return withSettings(withPeriod, { monthlyBudgetCents, startDay, initializedAt: nowDate });
}

export function loadPersisted(storage) {
  const rawData = storage.get(STORAGE_KEY);
  if (rawData === undefined || rawData === null || rawData === '') return { ok: true, state: null, rawData: null };
  const restored = restoreBackup(rawData);
  return restored.ok ? { ok: true, state: restored.data, rawData } : restored;
}

export function savePersisted(storage, state) {
  const rawData = serializeBackup(state);
  storage.set(STORAGE_KEY, rawData);
  return { ok: true, rawData };
}

export function commitPreparedState(storage, currentState, candidateState) {
  let oldRawData;
  let hadOldValue = false;
  let candidateRawData;
  try {
    candidateRawData = serializeBackup(candidateState);
    oldRawData = storage.get(STORAGE_KEY);
    hadOldValue = oldRawData !== undefined && oldRawData !== null && oldRawData !== '';
  } catch (error) {
    return { ok: false, state: clone(currentState), error: `保存预检失败：${error.message}` };
  }
  try {
    storage.set(STORAGE_KEY, candidateRawData);
    const readback = storage.get(STORAGE_KEY);
    if (readback !== candidateRawData) throw new Error('保存读回校验不一致');
    return { ok: true, state: clone(candidateState), rawData: candidateRawData };
  } catch (error) {
    let rollbackError = null;
    try {
      if (hadOldValue) storage.set(STORAGE_KEY, oldRawData);
      else if (typeof storage.remove === 'function') storage.remove(STORAGE_KEY);
      else storage.set(STORAGE_KEY, oldRawData ?? '');
      const rollbackReadback = storage.get(STORAGE_KEY);
      const rollbackMatches = hadOldValue ? rollbackReadback === oldRawData : (rollbackReadback === undefined || rollbackReadback === null || rollbackReadback === '');
      if (!rollbackMatches) throw new Error('原数据回滚读回校验不一致');
    } catch (rollbackFailure) {
      rollbackError = rollbackFailure.message;
    }
    return {
      ok: false,
      state: clone(currentState),
      error: `本地数据保存失败：${error.message}`,
      rollbackError,
      originalRawData: oldRawData,
    };
  }
}

function utf8ByteLength(text) {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

function localTimestamp(now) {
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '-',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
}

function assertWithinBackupLimit(sizeBytes) {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) throw new Error('文件大小无效');
  if (sizeBytes > MAX_BACKUP_BYTES) throw new Error('文件超过 5 MiB 限制');
}

function chineseBackupError(error) {
  const message = String(error?.message || error || '');
  const rules = [
    [/unsupported schema version:\s*(.+)/, (match) => `不支持的备份版本：${match[1]}`],
    [/only CNY backups are supported/, () => '仅支持人民币 CNY 备份'],
    [/backup field ([A-Za-z]+) must be an array/, (match) => `备份缺少或损坏字段：${match[1]}`],
    [/backup root must be an object/, () => '备份根节点必须是对象'],
    [/backup contains an invalid or duplicate account id/, () => '备份包含无效或重复的账户标识'],
    [/backup contains an invalid or duplicate transaction id/, () => '备份包含无效或重复的流水标识'],
    [/defaultBudgetCents must be a non-negative integer/, () => '默认预算金额无效'],
    [/rewardBalanceCents must be a non-negative integer/, () => '奖励余额金额无效'],
    [/invalid balance for account/, () => '账户余额无效'],
    [/invalid transaction amount/, () => '流水金额无效'],
    [/invalid transaction impact/, () => '流水预算或奖励影响金额无效'],
    [/backup data must be a string/, () => '备份内容必须是文本'],
  ];
  for (const [pattern, translate] of rules) {
    const match = message.match(pattern);
    if (match) return translate(match);
  }
  return /[一-龥]/.test(message) ? message : '备份数据校验失败';
}

function assertUniqueIds(items, label) {
  const ids = new Set();
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || item.id.length === 0) throw new Error(`${label}存在无效标识`);
    if (ids.has(item.id)) throw new Error(`${label}存在重复标识：${item.id}`);
    ids.add(item.id);
  }
}

function assertApplicationBackup(candidate) {
  if (!candidate.appSettings || typeof candidate.appSettings !== 'object' || Array.isArray(candidate.appSettings)) {
    throw new Error('备份缺少或损坏设置字段');
  }
  if (!Number.isInteger(candidate.appSettings.startDay) || candidate.appSettings.startDay < 1 || candidate.appSettings.startDay > 31) {
    throw new Error('备份周期起始日设置无效');
  }
  if (!Number.isInteger(candidate.appSettings.monthlyBudgetCents) || candidate.appSettings.monthlyBudgetCents < 0) {
    throw new Error('备份默认预算设置无效');
  }
  assertUniqueIds(candidate.accounts, '账户');
  assertUniqueIds(candidate.transactions, '流水');
  assertUniqueIds(candidate.budgetPeriods, '预算周期');
  assertUniqueIds(candidate.plans, '计划');
  assertUniqueIds(candidate.pendingItems, '待确认项');
  for (const transaction of candidate.transactions) {
    if (transaction.accountId && !candidate.accounts.some((item) => item.id === transaction.accountId)) {
      throw new Error(`流水引用了不存在的账户：${transaction.id}`);
    }
    if (transaction.counterpartyAccountId && !candidate.accounts.some((item) => item.id === transaction.counterpartyAccountId)) {
      throw new Error(`流水引用了不存在的对方账户：${transaction.id}`);
    }
    if (transaction.budgetPeriodId && !candidate.budgetPeriods.some((item) => item.id === transaction.budgetPeriodId)) {
      throw new Error(`流水引用了不存在的预算周期：${transaction.id}`);
    }
    if (transaction.relatedTransactionId && !candidate.transactions.some((item) => item.id === transaction.relatedTransactionId)) {
      throw new Error(`流水引用了不存在的关联流水：${transaction.id}`);
    }
  }
  for (const plan of candidate.plans) {
    if (plan.accountId && !candidate.accounts.some((item) => item.id === plan.accountId)) {
      throw new Error(`计划引用了不存在的账户：${plan.id}`);
    }
    if (plan.targetLiabilityAccountId && !candidate.accounts.some((item) => item.id === plan.targetLiabilityAccountId)) {
      throw new Error(`计划引用了不存在的负债账户：${plan.id}`);
    }
  }
  for (const pendingItem of candidate.pendingItems) {
    if (pendingItem.accountId && !candidate.accounts.some((item) => item.id === pendingItem.accountId)) {
      throw new Error(`待确认项引用了不存在的账户：${pendingItem.id}`);
    }
  }
  return candidate;
}

export function createBackupExport(state, now = new Date()) {
  try {
    const content = serializeBackup(state);
    const sizeBytes = utf8ByteLength(content);
    assertWithinBackupLimit(sizeBytes);
    return {
      kind: 'backup',
      filename: `yongdu-backup-${localTimestamp(now)}.json`,
      content,
      sizeBytes,
      mimeType: 'application/json',
      canRestore: true,
    };
  } catch (error) {
    throw new Error(`完整备份生成失败：${chineseBackupError(error)}`);
  }
}

export function createTransactionsCsvExport(state, now = new Date()) {
  try {
    const content = exportTransactionsCsv(state);
    const sizeBytes = utf8ByteLength(content);
    assertWithinBackupLimit(sizeBytes);
    return {
      kind: 'transactions',
      filename: `yongdu-transactions-${localTimestamp(now)}.csv`,
      content,
      sizeBytes,
      mimeType: 'text/csv',
      canRestore: false,
      warning: 'CSV 仅供查看账单，不能用于恢复。',
    };
  } catch (error) {
    throw new Error(`CSV 生成失败：${chineseBackupError(error)}`);
  }
}

export function previewBackupRestore(rawData, { fileName = '粘贴的 JSON', sizeBytes = null } = {}) {
  if (typeof rawData !== 'string') return { ok: false, error: '备份内容必须是文本', rawData };
  const actualSizeBytes = utf8ByteLength(rawData);
  try {
    if (sizeBytes !== null) assertWithinBackupLimit(sizeBytes);
    assertWithinBackupLimit(actualSizeBytes);
    let source;
    try {
      source = JSON.parse(rawData);
    } catch {
      throw new Error('JSON 格式损坏，未对现有数据做任何修改');
    }
    const restored = restoreBackup(rawData);
    if (!restored.ok) throw new Error(chineseBackupError(restored.error));
    const candidate = assertApplicationBackup(clone(restored.data));
    const canonicalRawData = serializeBackup(candidate);
    assertWithinBackupLimit(utf8ByteLength(canonicalRawData));
    const transactionDates = candidate.transactions
      .map((item) => item.date)
      .filter((date) => typeof date === 'string')
      .sort();
    const latestTransactionDate = transactionDates.length ? transactionDates[transactionDates.length - 1] : '无';
    return {
      ok: true,
      candidate,
      canonicalRawData,
      preview: {
        fileName,
        sizeBytes: actualSizeBytes,
        sourceSchemaVersion: source.schemaVersion,
        targetSchemaVersion: CURRENT_SCHEMA_VERSION,
        currency: candidate.currency,
        accountCount: candidate.accounts.length,
        transactionCount: candidate.transactions.length,
        budgetPeriodCount: candidate.budgetPeriods.length,
        planCount: candidate.plans.length,
        pendingItemCount: candidate.pendingItems.length,
        latestTransactionDate,
        generatedAt: '未知',
      },
    };
  } catch (error) {
    return { ok: false, error: `备份预检失败：${error.message}`, rawData };
  }
}

function sameSnapshot(left, right) {
  return serializeBackup(left) === serializeBackup(right);
}

function tryTwice(operation) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      operation();
      return null;
    } catch (error) {
      lastError = error;
    }
  }
  return lastError;
}

export function commitBackupRestore(storage, candidate, { phrase, confirmed } = {}) {
  if (phrase !== '恢复') return { ok: false, error: '请输入“恢复”后再继续' };
  if (confirmed !== true) return { ok: false, cancelled: true, error: '已取消恢复，现有数据未改变' };
  let canonicalRawData;
  try {
    canonicalRawData = serializeBackup(assertApplicationBackup(clone(candidate)));
    assertWithinBackupLimit(utf8ByteLength(canonicalRawData));
  } catch (error) {
    return { ok: false, error: `恢复预检失败：${chineseBackupError(error)}` };
  }
  let oldRaw;
  let hadOldValue = false;
  let oldReadSucceeded = false;
  let tempWriteAttempted = false;
  let mainWriteAttempted = false;
  try {
    try {
      oldRaw = storage.get(STORAGE_KEY);
    } catch {
      throw new Error('原数据读取失败');
    }
    oldReadSucceeded = true;
    hadOldValue = oldRaw !== undefined && oldRaw !== null;
    tempWriteAttempted = true;
    try {
      storage.set(RESTORE_TEMP_KEY, canonicalRawData);
    } catch {
      throw new Error('临时数据写入失败');
    }
    let tempRaw;
    try {
      tempRaw = storage.get(RESTORE_TEMP_KEY);
    } catch {
      throw new Error('临时数据读回失败');
    }
    const tempCheck = restoreBackup(tempRaw);
    if (!tempCheck.ok || !sameSnapshot(tempCheck.data, candidate)) throw new Error('临时备份写入校验失败');
    mainWriteAttempted = true;
    try {
      storage.set(STORAGE_KEY, canonicalRawData);
    } catch {
      throw new Error('主数据写入失败');
    }
    let mainRaw;
    try {
      mainRaw = storage.get(STORAGE_KEY);
    } catch {
      throw new Error('主数据读回失败');
    }
    const mainCheck = restoreBackup(mainRaw);
    if (!mainCheck.ok || !sameSnapshot(mainCheck.data, candidate)) throw new Error('主数据写入校验失败');
    try {
      storage.remove(RESTORE_TEMP_KEY);
    } catch {
      throw new Error('临时数据清理失败');
    }
    return { ok: true, state: clone(candidate), rawData: canonicalRawData };
  } catch (error) {
    const rollbackError = oldReadSucceeded && mainWriteAttempted ? tryTwice(() => {
      if (hadOldValue) storage.set(STORAGE_KEY, oldRaw);
      else storage.remove(STORAGE_KEY);
      const rolledBack = storage.get(STORAGE_KEY);
      if (hadOldValue ? rolledBack !== oldRaw : rolledBack !== undefined && rolledBack !== null) throw new Error('原数据回滚校验失败');
    }) : null;
    const cleanupError = tempWriteAttempted ? tryTwice(() => storage.remove(RESTORE_TEMP_KEY)) : null;
    const suffix = [
      rollbackError ? '；原数据回滚失败' : '',
      !oldReadSucceeded ? '；原数据读取失败，未尝试改写主数据' : '',
      cleanupError ? '；临时数据清理失败' : '',
    ].join('');
    return { ok: false, error: `恢复失败，已尝试保留原数据：${error.message}${suffix}` };
  }
}

export function clearLocalLedger(storage, { phrase, confirmed } = {}) {
  if (phrase !== '清除') return { ok: false, error: '请输入“清除”后再继续' };
  if (confirmed !== true) return { ok: false, cancelled: true, error: '已取消清除，现有数据未改变' };
  let oldMain;
  let oldTemp;
  try {
    oldMain = storage.get(STORAGE_KEY);
    oldTemp = storage.get(RESTORE_TEMP_KEY);
  } catch {
    return { ok: false, error: '清除失败：无法读取现有本地数据，未执行删除' };
  }
  const hadMain = oldMain !== undefined && oldMain !== null;
  const hadTemp = oldTemp !== undefined && oldTemp !== null;
  let deletionAttempted = false;
  try {
    deletionAttempted = true;
    storage.remove(STORAGE_KEY);
    const mainAfterRemoval = storage.get(STORAGE_KEY);
    if (mainAfterRemoval !== undefined && mainAfterRemoval !== null) throw new Error('主数据删除校验失败');
    storage.remove(RESTORE_TEMP_KEY);
    const tempAfterRemoval = storage.get(RESTORE_TEMP_KEY);
    if (tempAfterRemoval !== undefined && tempAfterRemoval !== null) throw new Error('临时数据删除校验失败');
    return { ok: true, removedKeys: [STORAGE_KEY, RESTORE_TEMP_KEY] };
  } catch (error) {
    const rollbackError = deletionAttempted ? tryTwice(() => {
      if (hadMain) storage.set(STORAGE_KEY, oldMain);
      else storage.remove(STORAGE_KEY);
      if (hadTemp) storage.set(RESTORE_TEMP_KEY, oldTemp);
      else storage.remove(RESTORE_TEMP_KEY);
      const main = storage.get(STORAGE_KEY);
      const temp = storage.get(RESTORE_TEMP_KEY);
      if (hadMain ? main !== oldMain : main !== undefined && main !== null) throw new Error('主数据恢复校验失败');
      if (hadTemp ? temp !== oldTemp : temp !== undefined && temp !== null) throw new Error('临时数据恢复校验失败');
    }) : null;
    return {
      ok: false,
      error: `清除失败：本地数据删除或校验失败${rollbackError ? '；原数据回滚失败' : '；原数据已保留'}`,
    };
  }
}

export function getHomeModel(state, date, planSummary = null) {
  const planFields = getPlanHomeFields(state, date, planSummary);
  const activePeriod = state.budgetPeriods.find((item) => date >= item.startDate && date <= item.endDate);
  if (!activePeriod) {
    const pendingPeriod = openPeriodWaitingForSettlement(state, date);
    if (pendingPeriod) {
      const settlement = getSettlementModel(state, date);
      return {
        date,
        periodId: pendingPeriod.id,
        periodStartDate: pendingPeriod.startDate,
        periodEndDate: pendingPeriod.endDate,
        needsSettlement: true,
        todayFreeCents: 0,
        todayFree: formatCents(0),
        prepaidCents: 0,
        prepaid: formatCents(0),
        fullSingleDayQuotaCents: 0,
        fullSingleDayQuota: formatCents(0),
        earliestRecoveryDate: null,
        actualBudgetCents: settlement.actualBudgetCents,
        budgetDebtCents: settlement.budgetDebtCents,
        netBudgetSpendCents: pendingPeriod.netBudgetSpendCents,
        pendingStartDay: state.appSettings?.pendingStartDayChange?.newStartDay ?? null,
        settlement,
        ...planFields,
      };
    }
    throw new Error(`no budget period covers ${date}`);
  }
  const elapsedDays = Math.min(activePeriod.totalDays || dateDistance(activePeriod.startDate, date) + 1, Math.max(1, dateDistance(activePeriod.startDate, date) + 1));
  const rawActualBudgetCents = activePeriod.baseBudgetCents + activePeriod.carryCents;
  const snapshot = budgetSnapshot({ actualBudgetCents: rawActualBudgetCents, elapsedDays, totalDays: activePeriod.totalDays || dateDistance(activePeriod.startDate, activePeriod.endDate) + 1, netBudgetSpendCents: activePeriod.netBudgetSpendCents, startDate: activePeriod.startDate });
  return {
    date,
    periodId: activePeriod.id,
    periodStartDate: activePeriod.startDate,
    periodEndDate: activePeriod.endDate,
    todayFreeCents: snapshot.todayAvailableCents,
    todayFree: formatCents(snapshot.todayAvailableCents),
    prepaidCents: snapshot.prepaidCents,
    prepaid: formatCents(snapshot.prepaidCents),
    fullSingleDayQuotaCents: snapshot.fullSingleDayQuotaCents,
    fullSingleDayQuota: formatCents(snapshot.fullSingleDayQuotaCents),
    earliestRecoveryDate: snapshot.earliestRecoveryDate,
    actualBudgetCents: actualBudgetCents(activePeriod.baseBudgetCents, activePeriod.carryCents),
    budgetDebtCents: budgetDebtCents(activePeriod.baseBudgetCents, activePeriod.carryCents),
    netBudgetSpendCents: activePeriod.netBudgetSpendCents,
    pendingStartDay: state.appSettings?.pendingStartDayChange?.newStartDay ?? null,
    ...planFields,
  };
}

export function getSettlementModel(state, date) {
  const pendingPeriod = openPeriodWaitingForSettlement(state, date);
  if (!pendingPeriod) return null;
  const settlement = settleBudgetCycle({
    baseBudgetCents: pendingPeriod.baseBudgetCents,
    carryCents: pendingPeriod.carryCents,
    netBudgetSpendCents: pendingPeriod.netBudgetSpendCents,
    positiveMode: 'carry',
    overspendMode: 'carry',
    rewardBalanceCents: state.rewardBalanceCents,
    rewardOffsetCents: 0,
  });
  return {
    periodId: pendingPeriod.id,
    periodEndDate: pendingPeriod.endDate,
    baseBudgetCents: pendingPeriod.baseBudgetCents,
    carryCents: pendingPeriod.carryCents,
    actualBudgetCents: settlement.actualBudgetCents,
    actualBudget: formatCents(settlement.actualBudgetCents),
    budgetDebtCents: settlement.budgetDebtCents,
    budgetDebt: formatCents(settlement.budgetDebtCents),
    netBudgetSpendCents: pendingPeriod.netBudgetSpendCents,
    netBudgetSpend: formatCents(pendingPeriod.netBudgetSpendCents),
    positiveSurplusCents: settlement.positiveSurplusCents,
    positiveSurplus: formatCents(settlement.positiveSurplusCents),
    grossDebtCents: settlement.grossDebtCents,
    grossDebt: formatCents(settlement.grossDebtCents),
    rewardBalanceCents: state.rewardBalanceCents,
    rewardBalance: formatCents(state.rewardBalanceCents),
    rewardOffsetCents: Math.min(state.rewardBalanceCents, settlement.grossDebtCents),
    rewardOffset: formatCents(Math.min(state.rewardBalanceCents, settlement.grossDebtCents)),
    remainingDebtCents: Math.max(0, settlement.grossDebtCents - Math.min(state.rewardBalanceCents, settlement.grossDebtCents)),
    remainingDebt: formatCents(Math.max(0, settlement.grossDebtCents - Math.min(state.rewardBalanceCents, settlement.grossDebtCents))),
    positiveChoiceRequired: settlement.positiveSurplusCents > 0,
    overspendChoiceRequired: settlement.grossDebtCents > 0,
    rewardCanOffsetDebt: state.rewardBalanceCents >= settlement.grossDebtCents,
  };
}

export function settleCurrentPeriod(state, date, { positiveMode = null, overspendMode = null } = {}) {
  const model = getSettlementModel(state, date);
  if (!model) throw new Error('no budget period is waiting for settlement');
  if (model.positiveChoiceRequired && !['carry', 'reward'].includes(positiveMode)) throw new Error('请选择结余处理方式');
  if (model.overspendChoiceRequired && !['carry', 'reward'].includes(overspendMode)) throw new Error('请选择超支处理方式');
  const selectedPositiveMode = model.positiveChoiceRequired ? positiveMode : 'carry';
  const selectedOverspendMode = model.overspendChoiceRequired ? overspendMode : 'carry';
  const result = settleBudgetCycle({
    baseBudgetCents: model.baseBudgetCents,
    carryCents: model.carryCents,
    netBudgetSpendCents: model.netBudgetSpendCents,
    positiveMode: selectedPositiveMode,
    overspendMode: selectedOverspendMode === 'reward' ? 'carry' : selectedOverspendMode,
    rewardBalanceCents: state.rewardBalanceCents,
    rewardOffsetCents: selectedOverspendMode === 'reward' ? model.rewardOffsetCents : 0,
  });
  const closed = closeBudgetPeriod(state, model.periodId);
  closed.rewardBalanceCents = result.rewardBalanceAfterCents;
  const pending = state.appSettings?.pendingStartDayChange;
  if (pending?.stage === 'transition' && pending.transitionPeriodId === model.periodId) {
    const nextCycle = cycleForDate(pending.regularStartDate, pending.newStartDay, closed.defaultBudgetCents);
    let next = addBudgetPeriod(closed, {
      id: nextBudgetPeriodId(closed),
      startDate: pending.regularStartDate,
      endDate: nextCycle.endDate,
      baseBudgetCents: closed.defaultBudgetCents,
      carryCents: result.nextCarryCents,
      status: 'open',
    });
    next.appSettings = { ...next.appSettings, startDay: pending.newStartDay };
    delete next.appSettings.pendingStartDayChange;
    return next;
  }
  if (pending?.stage === 'pending' && pending.appliesAfterPeriodId === model.periodId) {
    const planned = planStartDayTransition({
      currentPeriodEndDate: model.periodEndDate,
      newStartDay: pending.newStartDay,
      defaultMonthlyBudgetCents: closed.defaultBudgetCents,
    });
    if (planned.transition) {
      const transitionPeriodId = nextBudgetPeriodId(closed);
      let next = addBudgetPeriod(closed, {
        id: transitionPeriodId,
        startDate: planned.transition.startDate,
        endDate: planned.transition.endDate,
        baseBudgetCents: planned.transition.baseBudgetCents,
        carryCents: result.nextCarryCents,
        status: 'open',
      });
      next.budgetPeriods.find((item) => item.id === transitionPeriodId).kind = 'transition';
      next.appSettings.pendingStartDayChange = {
        ...pending,
        stage: 'transition',
        transitionPeriodId,
        regularStartDate: planned.nextCycle.startDate,
      };
      return next;
    }
    let next = addBudgetPeriod(closed, {
      id: nextBudgetPeriodId(closed),
      startDate: planned.nextCycle.startDate,
      endDate: planned.nextCycle.endDate,
      baseBudgetCents: closed.defaultBudgetCents,
      carryCents: result.nextCarryCents,
      status: 'open',
    });
    next.appSettings = { ...next.appSettings, startDay: pending.newStartDay };
    delete next.appSettings.pendingStartDayChange;
    return next;
  }
  const nextPeriodStartDate = addDays(model.periodEndDate, 1);
  const nextCycle = cycleForDate(nextPeriodStartDate, state.appSettings.startDay, state.appSettings.monthlyBudgetCents);
  return addBudgetPeriod(closed, {
    id: nextBudgetPeriodId(closed),
    startDate: nextCycle.startDate,
    endDate: nextCycle.endDate,
    baseBudgetCents: nextCycle.baseBudgetCents,
    carryCents: result.nextCarryCents,
    status: 'open',
  });
}

export function changeBudgetSettings(state, { newBudgetYuan, scope, date }) {
  assertDate(date);
  const newBudgetCents = parseYuanToCents(newBudgetYuan);
  const activePeriod = activePeriodForDate(state, date);
  const waitingPeriod = waitingPeriodForDate(state, date);
  if (waitingPeriod && scope !== 'next_and_future') throw new Error('本期待结算，只能修改下周期及以后的默认预算');
  if (!activePeriod && !waitingPeriod) throw new Error('当前日期没有可修改的预算周期');
  if (!['only_current', 'current_and_future', 'next_and_future'].includes(scope)) throw new Error('请选择预算修改范围');
  const currentBudgetCents = activePeriod?.baseBudgetCents ?? waitingPeriod.baseBudgetCents;
  const changed = applyBudgetChange({
    currentBudgetCents,
    defaultBudgetCents: state.defaultBudgetCents,
    newBudgetCents,
    scope,
  });
  const changedCurrentBudgetCents = activePeriod?.kind === 'transition' && scope !== 'next_and_future'
    ? prorateMonthlyBudgetCents(newBudgetCents, activePeriod.startDate, activePeriod.totalDays || dateDistance(activePeriod.startDate, activePeriod.endDate) + 1)
    : changed.currentBudgetCents;
  const next = clone(state);
  if (activePeriod && scope !== 'next_and_future') {
    next.budgetPeriods.find((item) => item.id === activePeriod.id).baseBudgetCents = changedCurrentBudgetCents;
  }
  next.defaultBudgetCents = changed.defaultBudgetCents;
  next.appSettings = {
    ...next.appSettings,
    monthlyBudgetCents: changed.defaultBudgetCents,
  };
  return next;
}

export function previewStartDayChange(state, { newStartDay, date }) {
  assertDate(date);
  assertStartDay(newStartDay);
  const waitingPeriod = waitingPeriodForDate(state, date);
  if (waitingPeriod) throw new Error('本期待结算，暂不能修改周期起始日');
  const activePeriod = activePeriodForDate(state, date);
  if (!activePeriod) throw new Error('当前日期没有可修改的预算周期');
  if (newStartDay === state.appSettings.startDay && !state.appSettings.pendingStartDayChange) {
    throw new Error('新的周期起始日与当前设置相同');
  }
  const immediateCycle = cycleForDate(date, newStartDay, state.defaultBudgetCents);
  const previousPeriods = state.budgetPeriods.filter((item) => item.id !== activePeriod.id && item.endDate < activePeriod.startDate);
  const latestPreviousEndDate = previousPeriods.sort((left, right) => right.endDate.localeCompare(left.endDate))[0]?.endDate || null;
  const activePeriodHasFlow = state.transactions.some((item) => (
    item.budgetPeriodId === activePeriod.id
    || (item.date >= activePeriod.startDate && item.date <= activePeriod.endDate)
  ));
  const keepsPreviousBoundary = !latestPreviousEndDate || immediateCycle.startDate === addDays(latestPreviousEndDate, 1);
  if (!activePeriodHasFlow && keepsPreviousBoundary) {
    const cycle = immediateCycle;
    return {
      mode: 'immediate',
      newStartDay,
      currentPeriodId: activePeriod.id,
      currentStartDate: activePeriod.startDate,
      currentEndDate: activePeriod.endDate,
      nextStartDate: cycle.startDate,
      nextEndDate: cycle.endDate,
      explanation: `当前没有流水，将立即把空周期调整为 ${cycle.startDate} 至 ${cycle.endDate}`,
    };
  }
  const planned = planStartDayTransition({
    currentPeriodEndDate: activePeriod.endDate,
    newStartDay,
    defaultMonthlyBudgetCents: state.defaultBudgetCents,
  });
  return {
    mode: 'pending',
    newStartDay,
    currentPeriodId: activePeriod.id,
    currentStartDate: activePeriod.startDate,
    currentEndDate: activePeriod.endDate,
    transition: planned.transition,
    nextStartDate: planned.nextCycle.startDate,
    nextEndDate: planned.nextCycle.endDate,
    explanation: planned.transition
      ? `旧周期保持到 ${activePeriod.endDate}；随后以过渡周期衔接，并从 ${planned.nextCycle.startDate} 起按每月 ${newStartDay} 日运行`
      : `旧周期保持到 ${activePeriod.endDate}；从 ${planned.nextCycle.startDate} 起按每月 ${newStartDay} 日运行`,
  };
}

export function changeStartDay(state, { newStartDay, date }) {
  const preview = previewStartDayChange(state, { newStartDay, date });
  const next = clone(state);
  if (preview.mode === 'immediate') {
    const period = next.budgetPeriods.find((item) => item.id === preview.currentPeriodId);
    period.startDate = preview.nextStartDate;
    period.endDate = preview.nextEndDate;
    period.baseBudgetCents = next.defaultBudgetCents;
    next.appSettings = { ...next.appSettings, startDay: newStartDay };
    delete next.appSettings.pendingStartDayChange;
    return next;
  }
  next.appSettings.pendingStartDayChange = {
    stage: 'pending',
    oldStartDay: next.appSettings.startDay,
    newStartDay,
    requestedAt: date,
    appliesAfterPeriodId: preview.currentPeriodId,
  };
  return next;
}

export function cancelPendingStartDayChange(state, { date }) {
  assertDate(date);
  if (waitingPeriodForDate(state, date)) throw new Error('本期待结算，暂不能修改周期起始日');
  if (!state.appSettings?.pendingStartDayChange) throw new Error('当前没有待生效的起始日修改');
  if (state.appSettings.pendingStartDayChange.stage !== 'pending') throw new Error('起始日变更已进入过渡周期，不能取消');
  const next = clone(state);
  delete next.appSettings.pendingStartDayChange;
  return next;
}

export function recordEntry(state, { amountYuan, date, accountId, categoryLevel1, categoryLevel2, note = '', includeControlledBudget = true }) {
  const amountCents = parseYuanToCents(amountYuan);
  assertDate(date);
  if (!categoryLevel1 || !categoryLevel2) throw new Error('请选择完整的两级分类');
  const details = { id: `entry-${state.transactions.length + 1}`, date, accountId, amountCents, categoryLevel1, categoryLevel2, note: String(note || '').trim() };
  let next;
  if (includeControlledBudget) {
    const activePeriod = state.budgetPeriods.find((item) => date >= item.startDate && date <= item.endDate);
    if (!activePeriod) {
      if (openPeriodWaitingForSettlement(state, date)) throw new Error('请先完成本期预算结算');
      throw new Error('当前日期没有可用预算周期');
    }
    next = runOperation(() => recordExpense(state, { ...details, budgetPeriodId: activePeriod.id }));
  } else {
    next = runOperation(() => recordFixedExpense(state, details));
  }
  return next;
}

export function findPreviousSimilar(state, { categoryLevel1, categoryLevel2 }) {
  const expenses = listUserTransactions(state)
    .filter((item) => item.status === 'active' && (item.kind === 'controlled_expense' || item.kind === 'fixed_expense'));
  const exact = categoryLevel2 ? expenses.filter((item) => item.categoryLevel2 === categoryLevel2) : [];
  const candidates = exact.length ? exact : expenses.filter((item) => item.categoryLevel1 === categoryLevel1);
  candidates.sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));
  const latest = candidates.length ? candidates[candidates.length - 1] : undefined;
  return latest ? { amountCents: latest.amountCents, amount: formatCents(latest.amountCents), date: latest.date } : null;
}

export function listRecentBills(state) {
  return listRecentTransactions(state)
    .filter((item) => item.kind === 'controlled_expense' || item.kind === 'fixed_expense')
    .map((item) => ({
      ...item,
      budgetType: item.kind === 'controlled_expense' ? '可控' : '固定',
    }));
}

export function accountTypeOptions() {
  return Object.entries(ACCOUNT_TYPE_LABELS).map(([value, label]) => ({ value, label }));
}

export function getAssetsModel(state) {
  const summary = totals(state);
  return {
    totalAssetsCents: summary.totalAssetsCents,
    totalAssets: formatCents(summary.totalAssetsCents),
    totalLiabilitiesCents: summary.totalLiabilitiesCents,
    totalLiabilities: formatCents(summary.totalLiabilitiesCents),
    netAssetsCents: summary.netAssetsCents,
    netAssets: formatCents(summary.netAssetsCents),
    rewardBalanceCents: summary.rewardBalanceCents,
    rewardBalance: formatCents(summary.rewardBalanceCents),
    accounts: state.accounts.map((item) => ({
      id: item.id,
      name: item.name,
      type: item.type,
      typeLabel: ACCOUNT_TYPE_LABELS[item.type] || item.type,
      isLiability: LIABILITY_ACCOUNT_TYPES.has(item.type),
      isInvestment: item.type === 'investment',
      balanceCents: item.balanceCents,
      balance: formatCents(item.balanceCents),
      costBasisCents: item.costBasisCents || 0,
      costBasis: formatCents(item.costBasisCents || 0),
    })),
  };
}

export function addAssetAccount(state, { id = null, name, type, balanceYuan = '0', costBasisYuan = '0' }) {
  return runOperation(() => {
    if (!name || !String(name).trim()) throw new Error('请输入账户名称');
    if (!ALL_ACCOUNT_TYPES.has(type)) throw new Error('不支持的账户类型');
    const enteredBalanceCents = parseYuanToCents(balanceYuan);
    const balanceCents = type === 'credit_card' ? -enteredBalanceCents : enteredBalanceCents;
    const costBasisCents = type === 'investment' ? parseYuanToCents(costBasisYuan) : 0;
    if (type !== 'investment' && costBasisCents !== 0) throw new Error('只有投资账户可以填写投入成本');
    return addAccount(state, {
      id: id || nextAccountId(state, type),
      name: String(name).trim(),
      type,
      balanceCents,
      costBasisCents,
    });
  });
}

export function recordIncomeEntry(state, { amountYuan, date, accountId, categoryLevel2 = '其他收入', source = 'manual' }) {
  return runOperation(() => recordIncome(state, {
    date,
    accountId,
    amountCents: positiveAmount(amountYuan),
    categoryLevel1: '收入',
    categoryLevel2,
    source,
  }));
}

export function recordTransferEntry(state, { amountYuan, date, fromAccountId, toAccountId, source = 'manual' }) {
  return runOperation(() => {
    const from = state.accounts.find((item) => item.id === fromAccountId);
    const to = state.accounts.find((item) => item.id === toAccountId);
    if (!from || !to) throw new Error('未找到账户');
    if (!TRANSFER_ACCOUNT_TYPES.has(from.type) || !TRANSFER_ACCOUNT_TYPES.has(to.type)) throw new Error('转账仅支持现金、储蓄卡和电子钱包');
    return recordTransfer(state, { date, fromAccountId, toAccountId, amountCents: positiveAmount(amountYuan), source });
  });
}

export function repayCreditCard(state, { amountYuan, date, fromAccountId, creditCardAccountId, source = 'manual' }) {
  return runOperation(() => recordCreditCardRepayment(state, {
    date,
    fromAccountId,
    creditCardAccountId,
    amountCents: positiveAmount(amountYuan),
    source,
  }));
}

export function borrowLoan(state, { amountYuan, date, cashAccountId, loanAccountId, source = 'manual' }) {
  return runOperation(() => recordBorrowing(state, {
    date,
    cashAccountId,
    loanAccountId,
    amountCents: positiveAmount(amountYuan),
    source,
  }));
}

export function repayLoanPrincipal(state, { amountYuan, date, cashAccountId, loanAccountId, source = 'manual' }) {
  return runOperation(() => recordLoanPrincipalRepayment(state, {
    date,
    cashAccountId,
    loanAccountId,
    amountCents: positiveAmount(amountYuan),
    source,
  }));
}

export function payLoanInterest(state, { amountYuan, date, cashAccountId, loanAccountId, source = 'manual' }) {
  return runOperation(() => {
    const next = recordLoanInterestPayment(state, {
      date,
      cashAccountId,
      loanAccountId,
      amountCents: positiveAmount(amountYuan),
      categoryLevel1: '利息',
      source,
    });
    const annotated = clone(next);
    annotated.transactions[annotated.transactions.length - 1].counterpartyAccountId = loanAccountId;
    return annotated;
  });
}

export function buyInvestment(state, { amountYuan, date, cashAccountId, investmentAccountId, source = 'manual' }) {
  return runOperation(() => recordInvestmentTrade(state, {
    date,
    side: 'buy',
    cashAccountId,
    investmentAccountId,
    amountCents: positiveAmount(amountYuan),
    source,
  }));
}

export function sellInvestment(state, { amountYuan, date, cashAccountId, investmentAccountId, source = 'manual' }) {
  return runOperation(() => recordInvestmentTrade(state, {
    date,
    side: 'sell',
    cashAccountId,
    investmentAccountId,
    amountCents: positiveAmount(amountYuan),
    source,
  }));
}

export function updateInvestmentValue(state, { currentValueYuan, date, investmentAccountId, source = 'manual valuation' }) {
  return runOperation(() => setInvestmentValue(state, {
    date,
    investmentAccountId,
    currentValueCents: parseYuanToCents(currentValueYuan),
    source,
  }));
}

const PLAN_TYPE_LABELS = {
  fixed_expense: '固定支出',
  credit_card_repayment: '信用卡还款',
  loan_repayment: '贷款还款',
};

const PLAN_RECURRENCE_LABELS = {
  one_time: '单次',
  monthly: '每月',
  yearly: '每年',
};

function optionalYuanToCents(input) {
  if (input === null || input === undefined || String(input).trim() === '') return null;
  return positiveAmount(input);
}

function nextPlanId(state) {
  let suffix = state.plans.length + 1;
  let id = `scheduled-plan-${suffix}`;
  while (state.plans.some((item) => item.id === id)) {
    suffix += 1;
    id = `scheduled-plan-${suffix}`;
  }
  return id;
}

function planDetailsFromInput(input) {
  return {
    name: String(input.name || '').trim() || '未命名计划',
    type: input.type,
    accountId: input.accountId,
    targetLiabilityAccountId: input.targetLiabilityAccountId || null,
    amountCents: optionalYuanToCents(input.amountYuan),
    principalCents: optionalYuanToCents(input.principalYuan),
    interestCents: optionalYuanToCents(input.interestYuan),
    categoryLevel1: String(input.categoryLevel1 || '').trim() || '固定支出',
    recurrence: input.recurrence,
    nextDueDate: input.nextDueDate,
    reminderEnabled: Boolean(input.reminderEnabled),
    reminderDays: input.reminderDays ?? [1, 0],
    source: input.source || null,
  };
}

export function createScheduledPlan(state, input) {
  assertDate(input.nextDueDate);
  const details = planDetailsFromInput(input);
  return runOperation(() => createFixedPlan(state, {
    id: input.id || nextPlanId(state),
    ...details,
  }));
}

export function editScheduledPlan(state, { planId, ...input }) {
  if (input.nextDueDate !== undefined) assertDate(input.nextDueDate);
  const supplied = {};
  const mappings = [
    ['name', () => String(input.name || '').trim() || '未命名计划'],
    ['type', () => input.type],
    ['accountId', () => input.accountId],
    ['targetLiabilityAccountId', () => input.targetLiabilityAccountId || null],
    ['amountYuan', () => optionalYuanToCents(input.amountYuan), 'amountCents'],
    ['principalYuan', () => optionalYuanToCents(input.principalYuan), 'principalCents'],
    ['interestYuan', () => optionalYuanToCents(input.interestYuan), 'interestCents'],
    ['categoryLevel1', () => String(input.categoryLevel1 || '').trim() || '固定支出'],
    ['recurrence', () => input.recurrence],
    ['nextDueDate', () => input.nextDueDate],
    ['reminderEnabled', () => Boolean(input.reminderEnabled)],
    ['reminderDays', () => input.reminderDays],
  ];
  for (const [inputKey, getValue, outputKey = inputKey] of mappings) {
    if (Object.prototype.hasOwnProperty.call(input, inputKey)) supplied[outputKey] = getValue();
  }
  let next = runOperation(() => editFixedPlan(state, planId, supplied));
  if (supplied.nextDueDate) {
    next = clone(next);
    for (const item of next.pendingItems) {
      if (item.planId === planId && item.reason === 'plan_info_required' && item.status === 'pending') {
        item.status = 'resolved';
        item.resolvedAt = supplied.nextDueDate;
      }
    }
  }
  return next;
}

export function disableScheduledPlan(state, planId) {
  return runOperation(() => revokeFixedPlan(state, planId));
}

function executionSummaryItem(state, plan, dueDate, transactionIds) {
  return {
    occurrenceKey: fixedPlanOccurrenceKey(plan.id, dueDate),
    planId: plan.id,
    planName: plan.name,
    type: plan.type,
    typeLabel: PLAN_TYPE_LABELS[plan.type] || '固定支出',
    dueDate,
    transactionIds,
    message: '已自动记账',
    amountCents: transactionIds.map((id) => state.transactions.find((item) => item.id === id)?.amountCents || 0)
      .reduce((sum, value) => sum + value, 0),
  };
}

export function processDuePlans(state, today) {
  assertDate(today);
  let next = state;
  const summary = { date: today, executed: [], pending: [], legacy: [], message: '' };
  for (const plan of next.plans) {
    if (plan.active && !plan.nextDueDate) {
      const beforeCount = next.pendingItems.length;
      next = markLegacyPlanPending(next, plan.id);
      if (next.pendingItems.length > beforeCount) summary.legacy.push({ planId: plan.id, planName: plan.name, message: '待补充计划信息' });
    }
  }
  let handledCount = 0;
  while (true) {
    const duePlan = next.plans
      .filter((item) => item.active && item.nextDueDate && item.nextDueDate <= today)
      .sort((left, right) => left.nextDueDate.localeCompare(right.nextDueDate) || left.id.localeCompare(right.id))[0];
    if (!duePlan) break;
    handledCount += 1;
    if (handledCount > 10000) throw new Error('待补记发生期过多，请分次处理');
    const dueDate = duePlan.nextDueDate;
    const occurrenceKey = fixedPlanOccurrenceKey(duePlan.id, dueDate);
    const transactionCount = next.transactions.length;
    const pendingCount = next.pendingItems.length;
    next = executeFixedPlan(next, { planId: duePlan.id, date: dueDate });
    const transactionIds = next.transactions.slice(transactionCount).map((item) => item.id);
    if (transactionIds.length) summary.executed.push(executionSummaryItem(next, duePlan, dueDate, transactionIds));
    if (next.pendingItems.length > pendingCount) {
      const pending = next.pendingItems.find((item) => item.occurrenceKey === occurrenceKey);
      summary.pending.push({
        id: pending.id,
        planId: duePlan.id,
        planName: duePlan.name,
        dueDate,
        reason: pending.reason,
        reasonText: pending.reasonText,
      });
    }
    next = advanceFixedPlan(next, duePlan.id, dueDate);
  }
  if (summary.executed.length) summary.message = '已自动记账';
  return { state: next, summary, changed: next !== state };
}

export function retryPendingPlan(state, { pendingId, amountYuan, principalYuan, interestYuan }) {
  const details = { pendingId };
  if (amountYuan !== undefined && String(amountYuan).trim() !== '') details.amountCents = positiveAmount(amountYuan);
  if (principalYuan !== undefined && String(principalYuan).trim() !== '') details.principalCents = positiveAmount(principalYuan);
  if (interestYuan !== undefined && String(interestYuan).trim() !== '') details.interestCents = positiveAmount(interestYuan);
  return runOperation(() => retryFixedPlanPending(state, details));
}

function pendingPlanModel(state, item) {
  const plan = state.plans.find((candidate) => candidate.id === item.planId) || item.planSnapshot || {};
  return {
    id: item.id,
    occurrenceKey: item.occurrenceKey,
    planId: item.planId,
    planName: plan.name || item.planId,
    type: plan.type || 'fixed_expense',
    typeLabel: PLAN_TYPE_LABELS[plan.type] || '固定支出',
    dueDate: item.dueDate,
    reason: item.reason,
    reasonText: item.reasonText || '待处理',
    status: item.status,
    needsAmount: item.reason === 'amount_required',
  };
}

function getPlanHomeFields(state, date, planSummary = null) {
  assertDate(date);
  const reminders = [];
  const dueToday = [];
  for (const plan of state.plans) {
    if (!plan.active || !plan.nextDueDate || !plan.reminderEnabled) continue;
    const daysUntil = dateDistance(date, plan.nextDueDate);
    if (daysUntil < 0 || daysUntil > 3 || !(plan.reminderDays || [1, 0]).includes(daysUntil)) continue;
    const model = {
      planId: plan.id,
      planName: plan.name,
      typeLabel: PLAN_TYPE_LABELS[plan.type] || '固定支出',
      dueDate: plan.nextDueDate,
      daysUntil,
      message: daysUntil === 0 ? '今天到期' : `${daysUntil}天后到期`,
    };
    if (daysUntil === 0) dueToday.push(model);
    else reminders.push(model);
  }
  const pendingItems = state.pendingItems
    .filter((item) => item.type === 'fixed_plan' && item.status === 'pending')
    .map((item) => pendingPlanModel(state, item))
    .sort((left, right) => String(left.dueDate || '').localeCompare(String(right.dueDate || '')));
  const dismissed = new Set(state.appSettings?.dismissedOverdueOccurrenceKeys || []);
  const overdueItems = pendingItems.filter((item) => item.dueDate && item.dueDate < date && !dismissed.has(item.occurrenceKey));
  return {
    planReminders: reminders,
    planDueToday: dueToday,
    planExecutionResults: planSummary?.executed || [],
    planExecutionMessage: planSummary?.message || '',
    planPendingItems: pendingItems,
    planOverdueItems: overdueItems,
    showPlanOverdueBanner: overdueItems.length > 0,
  };
}

export function dismissOverduePlanBanner(state, occurrenceKeys = null) {
  const pendingKeys = state.pendingItems
    .filter((item) => item.type === 'fixed_plan' && item.status === 'pending')
    .map((item) => item.occurrenceKey);
  const keys = occurrenceKeys || pendingKeys;
  const next = clone(state);
  next.appSettings = {
    ...(next.appSettings || {}),
    dismissedOverdueOccurrenceKeys: [...new Set([
      ...(next.appSettings?.dismissedOverdueOccurrenceKeys || []),
      ...keys,
    ])],
  };
  return next;
}

function transactionTypeLabel(item) {
  if (item.kind === 'fixed_expense' && item.categoryLevel1 === '利息') return '利息支付';
  return TRANSACTION_TYPE_LABELS[item.kind] || item.kind;
}

function transactionCategory(item, fallback) {
  return [item.categoryLevel1, item.categoryLevel2].filter(Boolean).join(' · ') || fallback;
}

function relatedOriginal(state, refund) {
  const logicalId = refund.refundOfLogicalTransactionId
    || state.transactions.find((item) => item.id === refund.relatedTransactionId)?.logicalTransactionId
    || refund.relatedTransactionId;
  if (!logicalId) return null;
  try {
    return getLatestTransaction(state, logicalId);
  } catch {
    return null;
  }
}

function activeRefunds(state, logicalTransactionId) {
  return state.transactions
    .filter((item) => item.kind === 'refund'
      && item.status === 'active'
      && item.refundOfLogicalTransactionId === logicalTransactionId)
    .sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));
}

function transactionStatusBadge(state, item) {
  if (item.status === 'revoked') return '已撤销';
  if (item.kind === 'historical_adjustment') return '历史调整';
  if (item.kind === 'refund') return '退款';
  const refundedCents = activeRefunds(state, item.logicalTransactionId).reduce((sum, refund) => sum + refund.amountCents, 0);
  if (refundedCents >= item.amountCents && item.amountCents > 0) return '已退款';
  if (refundedCents > 0) return '部分退款';
  if ((item.version || 1) > 1) return '已修改';
  return '';
}

function actionModel(state, item) {
  const available = getTransactionActionAvailability(state, item.logicalTransactionId);
  const ordered = [
    available.refund ? { key: 'refund', label: '退款', tone: 'neutral' } : null,
    available.modify ? { key: 'modify', label: '修改', tone: 'accent' } : null,
    available.revoke ? { key: 'revoke', label: '撤销', tone: 'danger' } : null,
  ].filter(Boolean);
  return { ...available, ordered };
}

function historicalAdjustmentModel(state, item) {
  const payload = item.businessPayload || {};
  const before = payload.beforeAmountCents || 0;
  const after = payload.afterAmountCents || 0;
  const budgetDeltaCents = (payload.changes || []).reduce((sum, change) => sum + (change.currentBudgetDeltaCents || 0), 0);
  const rewardDeltaCents = (payload.changes || []).reduce((sum, change) => sum + (change.rewardDeltaCents || 0), 0);
  const accountChanges = (payload.accountChanges || []).map((change) => ({
    accountId: change.accountId,
    accountName: accountName(state, change.accountId),
    balanceDeltaCents: change.balanceDeltaCents || 0,
    balanceDelta: formatCents(change.balanceDeltaCents || 0),
    costBasisDeltaCents: change.costBasisDeltaCents || 0,
    costBasisDelta: formatCents(change.costBasisDeltaCents || 0),
  }));
  return {
    id: item.id,
    logicalTransactionId: item.logicalTransactionId,
    kind: item.kind,
    businessKind: item.businessKind,
    status: item.status,
    statusBadge: '历史调整',
    typeLabel: '历史账单调整',
    date: item.date,
    amountCents: after - before,
    amount: formatCents(after - before),
    account: '',
    counterpartyAccount: '',
    accountFlow: '不改变账户流水统计',
    category: `历史账单调整 · 原账 ${payload.originalDate || '未知日期'}`,
    budgetType: '不计收入、支出和分类统计',
    note: `原金额 ${formatCents(before)} → ${formatCents(after)}；账户影响 ${accountChanges.map((change) => `${change.accountName} ${change.balanceDelta}`).join('、') || '无'}；预算影响 ${formatCents(budgetDeltaCents)}；奖励影响 ${formatCents(rewardDeltaCents)}`,
    accountImpacts: accountChanges,
    budgetImpactCents: budgetDeltaCents,
    budgetImpact: formatCents(budgetDeltaCents),
    rewardImpactCents: rewardDeltaCents,
    rewardImpact: formatCents(rewardDeltaCents),
    actions: { refund: false, modify: false, revoke: false, modifyFields: 'none', ordered: [] },
    canSwipe: false,
    affectsStatistics: false,
    isIncome: false,
    isExpense: false,
  };
}

function transactionListItem(state, item) {
  if (item.kind === 'historical_adjustment') return historicalAdjustmentModel(state, item);
  const typeLabel = transactionTypeLabel(item);
  const original = item.kind === 'refund' ? relatedOriginal(state, item) : null;
  const originalCategory = original ? transactionCategory(original, transactionTypeLabel(original)) : '';
  const fromAccount = item.accountId ? accountName(state, item.accountId) : '';
  const toAccount = item.counterpartyAccountId ? accountName(state, item.counterpartyAccountId) : '';
  const actions = actionModel(state, item);
  const category = item.kind === 'refund'
    ? `${originalCategory || '原支出'}退款`
    : transactionCategory(item, typeLabel);
  const budgetType = item.kind === 'refund'
    ? ((item.budgetImpactCents || 0) < 0 ? '恢复预算' : ((item.rewardImpactCents || 0) > 0 ? '退回奖励' : '退款'))
    : (item.kind === 'controlled_expense' ? '计入预算' : '不计预算');
  return {
    id: item.id,
    logicalTransactionId: item.logicalTransactionId,
    operationGroupId: item.operationGroupId,
    version: item.version || 1,
    status: item.status,
    statusBadge: transactionStatusBadge(state, item),
    kind: item.kind,
    businessKind: item.businessKind,
    typeLabel,
    date: item.date,
    accountId: item.accountId || null,
    counterpartyAccountId: item.counterpartyAccountId || null,
    amountCents: item.amountCents,
    amount: item.kind === 'refund' ? `+${formatCents(item.amountCents)}` : formatCents(item.amountCents),
    account: fromAccount,
    counterpartyAccount: toAccount,
    accountFlow: toAccount ? `${fromAccount} → ${toAccount}` : fromAccount,
    category,
    categoryLevel1: item.categoryLevel1,
    categoryLevel2: item.categoryLevel2,
    budgetType,
    note: item.note || '',
    refundedCents: item.refundedCents || 0,
    actions,
    canSwipe: item.status === 'active' && actions.ordered.length > 0,
    affectsStatistics: item.affectsStatistics !== false,
    isIncome: item.kind === 'income',
    isExpense: item.affectsStatistics !== false && ALL_EXPENSE_KINDS.has(item.kind),
  };
}

export function listRecentTransactions(state, { status = 'active' } = {}) {
  if (!['active', 'revoked', 'all'].includes(status)) throw new Error('请选择有效或已撤销账单筛选');
  return listUserTransactions(state, { includeRevoked: status !== 'active' })
    .filter((item) => status === 'all' || (status === 'revoked' ? item.status === 'revoked' : item.status !== 'revoked'))
    .map((item) => transactionListItem(state, item));
}

function latestLogicalGroup(state, latest) {
  return state.transactions.filter((item) => item.logicalTransactionId === latest.logicalTransactionId
    && (item.version || 1) === (latest.version || 1)
    && item.status === latest.status
    && !item.technical
    && item.kind !== 'historical_adjustment');
}

function sumImpacts(group, field) {
  return group.reduce((sum, item) => sum + (item[field] || 0), 0);
}

function accountImpactModels(state, group) {
  const impacts = new Map();
  for (const transaction of group) {
    for (const impact of transaction.accountImpacts || []) {
      const current = impacts.get(impact.accountId) || { balanceDeltaCents: 0, costBasisDeltaCents: 0 };
      current.balanceDeltaCents += impact.balanceDeltaCents || 0;
      current.costBasisDeltaCents += impact.costBasisDeltaCents || 0;
      impacts.set(impact.accountId, current);
    }
  }
  return [...impacts.entries()].map(([accountId, impact]) => ({
    accountId,
    accountName: accountName(state, accountId),
    ...impact,
    balanceDelta: formatCents(impact.balanceDeltaCents),
    costBasisDelta: formatCents(impact.costBasisDeltaCents),
  }));
}

function yuanInput(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
}

function accountField(state, key, label, value, types) {
  const options = state.accounts
    .filter((item) => types.includes(item.type))
    .map((item) => ({ value: item.id, label: `${item.name} · ${ACCOUNT_TYPE_LABELS[item.type] || item.type}` }));
  const selectedIndex = Math.max(0, options.findIndex((item) => item.value === value));
  return { key, label, type: 'account', value: value || '', displayValue: options[selectedIndex]?.label || '请选择', selectedIndex, options, optionLabels: options.map((item) => item.label) };
}

function textField(key, label, value, type = 'text') {
  return { key, label, type, value: value === null || value === undefined ? '' : String(value) };
}

function editableFieldsFor(state, latest, modifyFields) {
  const payload = latest.businessPayload || {};
  if (modifyFields === 'none') return [];
  if (modifyFields === 'category-note') {
    return [
      textField('categoryLevel1', '一级分类', payload.categoryLevel1),
      textField('categoryLevel2', '二级分类', payload.categoryLevel2),
      textField('note', '备注', payload.note),
    ];
  }
  const fields = [];
  const addDate = () => fields.push(textField('date', '日期', payload.date, 'date'));
  const addAmount = (key = 'amountYuan', cents = payload.amountCents, label = '金额') => fields.push(textField(key, label, yuanInput(cents), 'amount'));
  const cashTypes = ['cash', 'bank', 'wallet'];
  if (latest.businessKind === 'expense') {
    addDate();
    addAmount();
    fields.push(accountField(state, 'accountId', '支出账户', payload.accountId, [...cashTypes, 'credit_card']));
    fields.push(textField('categoryLevel1', '一级分类', payload.categoryLevel1));
    fields.push(textField('categoryLevel2', '二级分类', payload.categoryLevel2));
    fields.push({
      key: 'expenseKind', label: '支出性质', type: 'choice', value: payload.expenseKind || 'controlled',
      options: [{ value: 'controlled', label: '可控支出' }, { value: 'fixed', label: '固定支出' }],
      optionLabels: ['可控支出', '固定支出'],
      selectedIndex: (payload.expenseKind || 'controlled') === 'fixed' ? 1 : 0,
      displayValue: (payload.expenseKind || 'controlled') === 'fixed' ? '固定支出' : '可控支出',
    });
  } else if (latest.businessKind === 'income') {
    addDate(); addAmount();
    fields.push(accountField(state, 'accountId', '到账账户', payload.accountId, cashTypes));
    fields.push(textField('categoryLevel2', '收入来源', payload.categoryLevel2));
    fields.push(textField('source', '来源备注', payload.source));
  } else if (latest.businessKind === 'transfer') {
    addDate(); addAmount();
    fields.push(accountField(state, 'fromAccountId', '转出账户', payload.fromAccountId, cashTypes));
    fields.push(accountField(state, 'toAccountId', '转入账户', payload.toAccountId, cashTypes));
  } else if (latest.businessKind === 'credit_card_repayment') {
    addDate(); addAmount();
    fields.push(accountField(state, 'fromAccountId', '付款账户', payload.fromAccountId, cashTypes));
    fields.push(accountField(state, 'creditCardAccountId', '信用卡', payload.creditCardAccountId, ['credit_card']));
  } else if (latest.businessKind === 'borrowing') {
    addDate(); addAmount();
    fields.push(accountField(state, 'cashAccountId', '到账账户', payload.cashAccountId, cashTypes));
    fields.push(accountField(state, 'loanAccountId', '借贷账户', payload.loanAccountId, ['loan']));
  } else if (latest.businessKind === 'loan_repayment') {
    addDate();
    addAmount('principalYuan', payload.principalCents, '本金');
    addAmount('interestYuan', payload.interestCents, '利息');
    fields.push(accountField(state, 'cashAccountId', '付款账户', payload.cashAccountId, cashTypes));
    fields.push(accountField(state, 'loanAccountId', '借贷账户', payload.loanAccountId, ['loan']));
  } else if (['loan_principal_repayment', 'loan_interest_payment'].includes(latest.businessKind)) {
    addDate(); addAmount();
    fields.push(accountField(state, 'cashAccountId', '付款账户', payload.cashAccountId, cashTypes));
    fields.push(accountField(state, 'loanAccountId', '借贷账户', payload.loanAccountId, ['loan']));
  } else if (latest.businessKind === 'loan_interest_accrual') {
    addDate(); addAmount();
    fields.push(accountField(state, 'loanAccountId', '借贷账户', payload.loanAccountId, ['loan']));
  } else if (latest.businessKind === 'investment_trade') {
    addDate(); addAmount();
    fields.push(accountField(state, 'cashAccountId', '资金账户', payload.cashAccountId, cashTypes));
    fields.push(accountField(state, 'investmentAccountId', '投资账户', payload.investmentAccountId, ['investment']));
  } else if (latest.businessKind === 'investment_valuation') {
    addDate(); addAmount('currentValueYuan', payload.currentValueCents, '当前现值');
    fields.push(accountField(state, 'investmentAccountId', '投资账户', payload.investmentAccountId, ['investment']));
  } else if (latest.businessKind === 'reward_payment') {
    addDate(); addAmount();
    fields.push(accountField(state, 'accountId', '付款账户', payload.accountId, cashTypes));
    fields.push(textField('categoryLevel1', '分类', payload.categoryLevel1));
  }
  fields.push(textField('note', '备注', payload.note));
  return fields;
}

function versionHistory(state, latest) {
  const groups = new Map();
  for (const item of state.transactions) {
    if (item.logicalTransactionId !== latest.logicalTransactionId || item.technical || item.kind === 'historical_adjustment') continue;
    const version = item.version || 1;
    const current = groups.get(version) || [];
    current.push(item);
    groups.set(version, current);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => right - left)
    .map(([version, group]) => {
      const representative = group[0];
      const amountCents = group.reduce((sum, item) => sum + item.amountCents, 0);
      const statusLabel = representative.status === 'active' ? '当前版本' : (representative.status === 'superseded' ? '已被替代' : '已撤销');
      return {
        version,
        date: representative.date,
        status: representative.status,
        statusLabel,
        amountCents,
        amount: formatCents(amountCents),
        summary: `第${version}版 · ${representative.date} · ${formatCents(amountCents)} · ${statusLabel}`,
      };
    });
}

export function getTransactionDetailModel(state, logicalTransactionId) {
  const latest = getLatestTransaction(state, logicalTransactionId);
  if (latest.kind === 'historical_adjustment') return { ...historicalAdjustmentModel(state, latest), readOnly: true, refunds: [], changeHistory: [] };
  const group = latestLogicalGroup(state, latest);
  const listItem = transactionListItem(state, latest);
  const refunds = latest.kind === 'refund' ? [] : activeRefunds(state, latest.logicalTransactionId).map((item) => ({
    logicalTransactionId: item.logicalTransactionId,
    id: item.id,
    date: item.date,
    amountCents: item.amountCents,
    amount: `+${formatCents(item.amountCents)}`,
    destinationAccountId: item.accountId,
    destinationAccount: accountName(state, item.accountId),
    canRevoke: getTransactionActionAvailability(state, item.logicalTransactionId).revoke,
  }));
  const refundedCents = refunds.reduce((sum, item) => sum + item.amountCents, 0);
  const actions = actionModel(state, latest);
  return {
    ...listItem,
    id: latest.id,
    logicalTransactionId: latest.logicalTransactionId,
    version: latest.version || 1,
    status: latest.status,
    statusLabel: latest.status === 'active' ? '有效' : (latest.status === 'superseded' ? '已被替代' : '已撤销'),
    businessPayload: clone(latest.businessPayload || {}),
    accountImpacts: accountImpactModels(state, group),
    budgetImpactCents: sumImpacts(group, 'budgetImpactCents'),
    budgetImpact: formatCents(sumImpacts(group, 'budgetImpactCents')),
    rewardImpactCents: sumImpacts(group, 'rewardImpactCents'),
    rewardImpact: formatCents(sumImpacts(group, 'rewardImpactCents')),
    refunds,
    refundedCents,
    refunded: formatCents(refundedCents),
    remainingRefundableCents: Math.max(0, latest.amountCents - refundedCents),
    remainingRefundable: formatCents(Math.max(0, latest.amountCents - refundedCents)),
    changeHistory: versionHistory(state, latest),
    editableFields: editableFieldsFor(state, latest, actions.modifyFields),
    refundAccountOptions: state.accounts
      .filter((item) => ['cash', 'bank', 'wallet'].includes(item.type) || (item.type === 'credit_card' && item.id === latest.accountId))
      .map((item) => ({ value: item.id, label: `${item.name} · ${ACCOUNT_TYPE_LABELS[item.type]}` })),
    readOnly: latest.status !== 'active',
  };
}

function normalizeModificationChanges(state, latest, supplied) {
  const changes = clone(supplied || {});
  const moneyFields = [
    ['amountYuan', 'amountCents'],
    ['principalYuan', 'principalCents'],
    ['interestYuan', 'interestCents'],
    ['currentValueYuan', 'currentValueCents'],
    ['rewardOffsetYuan', 'rewardOffsetCents'],
  ];
  for (const [yuanField, centsField] of moneyFields) {
    if (!Object.prototype.hasOwnProperty.call(changes, yuanField)) continue;
    changes[centsField] = parseYuanToCents(changes[yuanField]);
    if (['amountCents', 'principalCents'].includes(centsField) && changes[centsField] <= 0) throw new Error('金额必须大于0');
    if (['interestCents', 'currentValueCents', 'rewardOffsetCents'].includes(centsField) && changes[centsField] < 0) throw new Error('金额不能为负');
    delete changes[yuanField];
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'note')) changes.note = String(changes.note || '').trim();
  const targetDate = changes.date || latest.businessPayload?.date || latest.date;
  const targetExpenseKind = changes.expenseKind || latest.businessPayload?.expenseKind;
  const hasActiveRefund = activeRefunds(state, latest.logicalTransactionId).length > 0;
  const categoryOnly = Object.keys(changes).every((field) => ['categoryLevel1', 'categoryLevel2', 'note'].includes(field));
  if (latest.businessKind === 'expense' && targetExpenseKind === 'controlled' && !(hasActiveRefund && categoryOnly)) {
    const matching = state.budgetPeriods.find((item) => item.startDate <= targetDate && targetDate <= item.endDate);
    if (!matching) throw new Error('修改后的日期没有可用预算周期');
    changes.budgetPeriodId = matching.id;
  }
  return changes;
}

export function modifyTransactionEntry(state, { logicalTransactionId, changes, requestId, today = todayIso() }) {
  assertDate(today);
  const latest = getLatestTransaction(state, logicalTransactionId);
  return runOperation(() => modifyTransaction(state, {
    logicalTransactionId,
    changes: normalizeModificationChanges(state, latest, changes),
    requestId,
    today,
  }));
}

export function refundTransactionEntry(state, {
  logicalTransactionId,
  amountYuan,
  date,
  destinationAccountId = null,
  requestId,
  note = '',
  today = todayIso(),
}) {
  assertDate(date);
  assertDate(today);
  return runOperation(() => recordRefund(state, {
    originalTransactionId: logicalTransactionId,
    amountCents: positiveAmount(amountYuan),
    date,
    destinationAccountId,
    requestId,
    note: String(note || '').trim(),
    today,
  }));
}

export function revokeTransactionEntry(state, { logicalTransactionId, requestId, date = todayIso(), today = todayIso() }) {
  assertDate(date);
  assertDate(today);
  return runOperation(() => revokeTransaction(state, { logicalTransactionId, requestId, date, today }));
}

export function revokeRefundEntry(state, { logicalTransactionId, requestId, date = todayIso(), today = todayIso() }) {
  assertDate(date);
  assertDate(today);
  return runOperation(() => revokeRefund(state, { logicalTransactionId, requestId, date, today }));
}

function signedCents(amountCents) {
  if (amountCents > 0) return `+${formatCents(amountCents)}`;
  return formatCents(amountCents);
}

export function buildStateImpactPreview(currentState, candidateState) {
  const accounts = candidateState.accounts.map((candidate) => {
    const current = currentState.accounts.find((item) => item.id === candidate.id);
    const balanceDeltaCents = candidate.balanceCents - (current?.balanceCents || 0);
    const costBasisDeltaCents = (candidate.costBasisCents || 0) - (current?.costBasisCents || 0);
    return {
      accountId: candidate.id,
      accountName: candidate.name,
      balanceDeltaCents,
      balanceDelta: signedCents(balanceDeltaCents),
      costBasisDeltaCents,
      costBasisDelta: signedCents(costBasisDeltaCents),
    };
  }).filter((item) => item.balanceDeltaCents !== 0 || item.costBasisDeltaCents !== 0);
  const budgets = candidateState.budgetPeriods.map((candidate) => {
    const current = currentState.budgetPeriods.find((item) => item.id === candidate.id);
    const netSpendDeltaCents = candidate.netBudgetSpendCents - (current?.netBudgetSpendCents || 0);
    return {
      periodId: candidate.id,
      label: `${candidate.startDate} 至 ${candidate.endDate}`,
      netSpendDeltaCents,
      netSpendDelta: signedCents(netSpendDeltaCents),
    };
  }).filter((item) => item.netSpendDeltaCents !== 0);
  const rewardDeltaCents = candidateState.rewardBalanceCents - currentState.rewardBalanceCents;
  const parts = [
    ...accounts.map((item) => `账户“${item.accountName}” ${item.balanceDelta}`),
    ...budgets.map((item) => `预算净支出 ${item.netSpendDelta}`),
    ...(rewardDeltaCents ? [`奖励余额 ${signedCents(rewardDeltaCents)}`] : []),
  ];
  return {
    accounts,
    budgets,
    rewardDeltaCents,
    rewardDelta: signedCents(rewardDeltaCents),
    summary: parts.length ? parts.join('；') : '账面金额不变，仅更新分类或备注。',
  };
}

const ALL_EXPENSE_KINDS = new Set([
  'controlled_expense',
  'fixed_expense',
  'reward_payment',
  'loan_interest_accrual',
]);

function analysisPeriodForDate(state, today) {
  const covering = state.budgetPeriods.find((item) => today >= item.startDate && today <= item.endDate);
  if (covering) return covering;
  const ended = state.budgetPeriods
    .filter((item) => item.endDate < today)
    .sort((left, right) => right.endDate.localeCompare(left.endDate) || right.startDate.localeCompare(left.startDate));
  return ended[0] || null;
}

function transactionAnalysisEntry(state, item, scope) {
  if (item.affectsStatistics === false || item.status === 'revoked') return null;
  if (scope === 'controlled') {
    if (item.kind !== 'controlled_expense') return null;
    return {
      amountCents: Math.max(0, (item.budgetImpactCents || 0) - (item.refundedCents || 0)),
      categoryLevel1: item.categoryLevel1 || null,
    };
  }

  if (ALL_EXPENSE_KINDS.has(item.kind)) {
    return {
      amountCents: Math.max(0, item.amountCents - (item.refundedCents || 0)),
      categoryLevel1: item.categoryLevel1 || (item.kind === 'loan_interest_accrual' ? '利息' : null),
    };
  }
  return null;
}

function normalizedSeries(values) {
  const minimum = Math.min(0, ...values);
  const maximum = Math.max(0, ...values);
  const span = maximum - minimum;
  return {
    minimumCents: minimum,
    maximumCents: maximum,
    zeroRatio: span === 0 ? 0.5 : maximum / span,
    ratios: values.map((value) => (span === 0 ? 0.5 : (maximum - value) / span)),
  };
}

function dailyAnalysis(state, period, today, scope) {
  if (!period) {
    return {
      points: [],
      totalCents: 0,
      total: formatCents(0),
      minimumCents: 0,
      maximumCents: 0,
      zeroRatio: 0.5,
      empty: true,
    };
  }
  const todayInside = today >= period.startDate && today <= period.endDate;
  const endDate = todayInside && today < period.endDate ? today : period.endDate;
  const days = dateDistance(period.startDate, endDate) + 1;
  const amounts = new Map();
  for (const item of listUserTransactions(state)) {
    if (item.date < period.startDate || item.date > endDate) continue;
    const entry = transactionAnalysisEntry(state, item, scope);
    if (!entry) continue;
    amounts.set(item.date, (amounts.get(item.date) || 0) + entry.amountCents);
  }
  const rawPoints = Array.from({ length: days }, (_, index) => {
    const date = addDays(period.startDate, index);
    return { date, amountCents: amounts.get(date) || 0 };
  });
  const normalized = normalizedSeries(rawPoints.map((item) => item.amountCents));
  const points = rawPoints.map((item, index) => ({
    ...item,
    amount: formatCents(item.amountCents),
    label: item.date.slice(5),
    xRatio: pointsRatio(index, rawPoints.length),
    yRatio: normalized.ratios[index],
  }));
  const totalCents = points.reduce((sum, item) => sum + item.amountCents, 0);
  return {
    startDate: period.startDate,
    endDate,
    points,
    totalCents,
    total: formatCents(totalCents),
    minimumCents: normalized.minimumCents,
    maximumCents: normalized.maximumCents,
    zeroRatio: normalized.zeroRatio,
    empty: points.every((item) => item.amountCents === 0),
  };
}

function pointsRatio(index, count) {
  return count <= 1 ? 0.5 : index / (count - 1);
}

function categoryAnalysis(state, period, daily, scope) {
  const totalsByCategory = new Map();
  if (period) {
    for (const item of listUserTransactions(state)) {
      if (item.date < period.startDate || item.date > daily.endDate) continue;
      const entry = transactionAnalysisEntry(state, item, scope);
      if (!entry || !entry.categoryLevel1) continue;
      totalsByCategory.set(entry.categoryLevel1, (totalsByCategory.get(entry.categoryLevel1) || 0) + entry.amountCents);
    }
  }
  const positive = [...totalsByCategory.entries()]
    .filter(([, amountCents]) => amountCents > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'zh-CN'));
  const positiveTotalCents = positive.reduce((sum, [, amountCents]) => sum + amountCents, 0);
  let cumulativeBasisPoints = 0;
  const items = positive.map(([name, amountCents], index) => {
    const shareBasisPoints = index === positive.length - 1
      ? 10000 - cumulativeBasisPoints
      : Math.floor((amountCents * 10000) / positiveTotalCents);
    const startBasisPoints = cumulativeBasisPoints;
    cumulativeBasisPoints += shareBasisPoints;
    return {
      name,
      amountCents,
      amount: formatCents(amountCents),
      shareBasisPoints,
      share: `${(shareBasisPoints / 100).toFixed(1)}%`,
      startRatio: startBasisPoints / 10000,
      endRatio: cumulativeBasisPoints / 10000,
    };
  });
  return {
    items,
    netTotalCents: daily.totalCents,
    netTotal: daily.total,
    positiveTotalCents,
    empty: items.length === 0,
    emptyText: items.length ? '' : '本周期还没有支出',
  };
}

function budgetTrend(state, today) {
  const periods = [...state.budgetPeriods]
    .sort((left, right) => left.startDate.localeCompare(right.startDate) || left.id.localeCompare(right.id))
    .slice(-6);
  const values = periods.flatMap((item) => [
    actualBudgetCents(item.baseBudgetCents, item.carryCents),
    item.netBudgetSpendCents,
  ]);
  const normalized = normalizedSeries(values);
  return {
    periods: periods.map((item, index) => {
      const actualCents = actualBudgetCents(item.baseBudgetCents, item.carryCents);
      const spendCents = item.netBudgetSpendCents;
      const valueIndex = index * 2;
      const ongoing = today >= item.startDate && today <= item.endDate;
      return {
        id: item.id,
        startDate: item.startDate,
        endDate: item.endDate,
        label: `${item.startDate.slice(5)}–${item.endDate.slice(5)}`,
        fullLabel: `${item.startDate} 至 ${item.endDate}`,
        kind: item.kind || 'regular',
        kindLabel: item.kind === 'transition' ? '过渡周期' : '预算周期',
        statusLabel: ongoing ? '进行中' : '已结束',
        actualBudgetCents: actualCents,
        actualBudget: formatCents(actualCents),
        netBudgetSpendCents: spendCents,
        netBudgetSpend: formatCents(spendCents),
        xRatio: pointsRatio(index, periods.length),
        budgetYRatio: normalized.ratios[valueIndex],
        spendYRatio: normalized.ratios[valueIndex + 1],
      };
    }),
    minimumCents: normalized.minimumCents,
    maximumCents: normalized.maximumCents,
    zeroRatio: normalized.zeroRatio,
    empty: periods.length === 0,
    emptyText: periods.length ? '' : '还没有真实预算周期',
  };
}

export function getBillAnalysisModel(state, { today = todayIso(), scope = 'controlled' } = {}) {
  assertDate(today);
  if (!['controlled', 'all'].includes(scope)) throw new Error('请选择账单分析范围');
  const period = analysisPeriodForDate(state, today);
  const daily = dailyAnalysis(state, period, today, scope);
  const categories = categoryAnalysis(state, period, daily, scope);
  const trend = budgetTrend(state, today);
  return {
    scope,
    scopeLabel: scope === 'controlled' ? '可控支出' : '全部支出',
    period: period ? {
      id: period.id,
      startDate: period.startDate,
      endDate: period.endDate,
      label: `${period.startDate} 至 ${period.endDate}`,
      kind: period.kind || 'regular',
      kindLabel: period.kind === 'transition' ? '过渡周期' : '预算周期',
      statusLabel: today >= period.startDate && today <= period.endDate ? '进行中' : '已结束',
    } : null,
    daily,
    categories,
    trend,
    flows: listRecentTransactions(state),
    emptyText: period ? '' : '暂无可分析预算周期',
  };
}

function scheduledPlanModel(plan) {
  const reminderDays = plan.reminderDays || [1, 0];
  return {
    ...clone(plan),
    typeLabel: PLAN_TYPE_LABELS[plan.type] || '固定支出',
    recurrenceLabel: PLAN_RECURRENCE_LABELS[plan.recurrence] || '待补充',
    amount: plan.amountCents === null || plan.amountCents === undefined ? '待确认' : formatCents(plan.amountCents),
    principal: plan.principalCents === null || plan.principalCents === undefined ? '待确认' : formatCents(plan.principalCents),
    interest: plan.interestCents === null || plan.interestCents === undefined ? '待确认' : formatCents(plan.interestCents),
    statusLabel: plan.active ? '启用' : '已停用',
    scheduleLabel: plan.nextDueDate ? `${PLAN_RECURRENCE_LABELS[plan.recurrence] || ''} · 下次 ${plan.nextDueDate}` : '待补充计划信息',
    reminderLabel: plan.reminderEnabled
      ? `提前${reminderDays.filter((day) => day > 0).join('、') || '0'}天及当天`
      : '提醒已关闭',
  };
}

export function getSettingsModel(state, date = todayIso()) {
  const assets = getAssetsModel(state);
  const activePeriod = activePeriodForDate(state, date);
  const waitingPeriod = waitingPeriodForDate(state, date);
  const displayedPeriod = activePeriod || waitingPeriod || state.budgetPeriods[state.budgetPeriods.length - 1] || null;
  const pending = state.appSettings?.pendingStartDayChange || null;
  const currentBaseBudgetCents = displayedPeriod?.baseBudgetCents ?? state.defaultBudgetCents;
  return {
    monthlyBudgetCents: state.appSettings?.monthlyBudgetCents ?? state.defaultBudgetCents,
    monthlyBudget: formatCents(state.appSettings?.monthlyBudgetCents ?? state.defaultBudgetCents),
    defaultBudgetCents: state.defaultBudgetCents,
    defaultBudget: formatCents(state.defaultBudgetCents),
    currentBaseBudgetCents,
    currentBaseBudget: formatCents(currentBaseBudgetCents),
    currentCarryCents: displayedPeriod?.carryCents ?? 0,
    currentCarry: formatCents(displayedPeriod?.carryCents ?? 0),
    currentPeriodId: displayedPeriod?.id ?? null,
    currentPeriodStartDate: displayedPeriod?.startDate ?? null,
    currentPeriodEndDate: displayedPeriod?.endDate ?? null,
    needsSettlement: Boolean(waitingPeriod),
    canChangeCurrentBudget: Boolean(activePeriod),
    canChangeStartDay: Boolean(activePeriod),
    startDay: state.appSettings?.startDay ?? 1,
    pendingStartDay: pending?.newStartDay ?? null,
    pendingStage: pending?.stage ?? null,
    pendingExplanation: pending
      ? (pending.stage === 'transition'
        ? `过渡周期结束后，从 ${pending.regularStartDate} 起按每月 ${pending.newStartDay} 日运行`
        : `当前周期结束后生效，目标为每月 ${pending.newStartDay} 日；生效前可以取消或改期`)
      : '当前没有待生效的起始日修改',
    accounts: assets.accounts,
    assets,
    plans: state.plans.map(scheduledPlanModel),
    pendingPlanItems: state.pendingItems
      .filter((item) => item.type === 'fixed_plan' && item.status === 'pending')
      .map((item) => pendingPlanModel(state, item)),
  };
}
