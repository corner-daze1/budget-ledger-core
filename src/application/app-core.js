import { actualBudgetCents, budgetDebtCents, budgetSnapshot, cycleForDate, dateDistance } from '../domain/budget.js';
import {
  addBudgetPeriod,
  createLedger,
  recordExpense,
  recordFixedExpense,
} from '../domain/ledger.js';
import { restoreBackup, serializeBackup } from '../domain/storage.js';

export const STORAGE_KEY = 'yongdu-ledger-v1';

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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function integer(value, label) {
  if (!Number.isInteger(value)) throw new TypeError(`${label} must be an integer`);
  return value;
}

function assertDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new TypeError('date must be YYYY-MM-DD');
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

function withSettings(state, settings) {
  const next = clone(state);
  next.appSettings = { ...settings };
  return next;
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

export function getHomeModel(state, date) {
  const activePeriod = currentPeriod(state, date);
  const elapsedDays = Math.min(activePeriod.totalDays || dateDistance(activePeriod.startDate, date) + 1, Math.max(1, dateDistance(activePeriod.startDate, date) + 1));
  const rawActualBudgetCents = activePeriod.baseBudgetCents + activePeriod.carryCents;
  const snapshot = budgetSnapshot({ actualBudgetCents: rawActualBudgetCents, elapsedDays, totalDays: activePeriod.totalDays || dateDistance(activePeriod.startDate, activePeriod.endDate) + 1, netBudgetSpendCents: activePeriod.netBudgetSpendCents, startDate: activePeriod.startDate });
  return {
    date,
    periodId: activePeriod.id,
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
  };
}

function setTransactionNote(state, transactionId, note) {
  const next = clone(state);
  const transaction = next.transactions.find((item) => item.id === transactionId);
  if (transaction) transaction.note = String(note || '').trim();
  return next;
}

export function recordEntry(state, { amountYuan, date, accountId, categoryLevel1, categoryLevel2, note = '', includeControlledBudget = true }) {
  const amountCents = parseYuanToCents(amountYuan);
  assertDate(date);
  if (!categoryLevel1 || !categoryLevel2) throw new Error('请选择完整的两级分类');
  const activePeriod = currentPeriod(state, date);
  const details = { id: `entry-${state.transactions.length + 1}`, date, accountId, amountCents, categoryLevel1, categoryLevel2 };
  const next = includeControlledBudget
    ? recordExpense(state, { ...details, budgetPeriodId: activePeriod.id })
    : recordFixedExpense(state, details);
  return setTransactionNote(next, details.id, note);
}

export function findPreviousSimilar(state, { categoryLevel1, categoryLevel2 }) {
  const expenses = state.transactions
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.kind === 'controlled_expense' || item.kind === 'fixed_expense');
  const exact = categoryLevel2 ? expenses.filter(({ item }) => item.categoryLevel2 === categoryLevel2) : [];
  const candidates = exact.length ? exact : expenses.filter(({ item }) => item.categoryLevel1 === categoryLevel1);
  candidates.sort((left, right) => left.item.date.localeCompare(right.item.date) || left.index - right.index);
  const latest = candidates.at(-1)?.item;
  return latest ? { amountCents: latest.amountCents, amount: formatCents(latest.amountCents), date: latest.date } : null;
}

export function listRecentBills(state) {
  return state.transactions
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.kind === 'controlled_expense' || item.kind === 'fixed_expense')
    .sort((left, right) => right.item.date.localeCompare(left.item.date) || right.index - left.index)
    .map(({ item }) => ({
      id: item.id,
      date: item.date,
      amountCents: item.amountCents,
      amount: formatCents(item.amountCents),
      budgetType: item.kind === 'controlled_expense' ? '可控' : '固定',
      categoryLevel1: item.categoryLevel1,
      categoryLevel2: item.categoryLevel2,
      category: `${item.categoryLevel1} · ${item.categoryLevel2}`,
      account: accountName(state, item.accountId),
      note: item.note || '',
    }));
}

export function getSettingsModel(state) {
  return {
    monthlyBudgetCents: state.appSettings?.monthlyBudgetCents ?? state.defaultBudgetCents,
    monthlyBudget: formatCents(state.appSettings?.monthlyBudgetCents ?? state.defaultBudgetCents),
    startDay: state.appSettings?.startDay ?? 1,
    accounts: state.accounts.map((item) => ({ id: item.id, name: item.name, type: item.type, balance: formatCents(item.balanceCents) })),
  };
}
