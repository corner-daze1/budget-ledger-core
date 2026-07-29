// GENERATED FILE. Run npm run build:mini.
const { actualBudgetCents, budgetDebtCents, budgetSnapshot, cycleForDate, dateDistance, settleBudgetCycle } = require('./domain/budget.js');
const { addAccount, addBudgetPeriod, closeBudgetPeriod, createLedger, recordBorrowing, recordCreditCardRepayment, recordExpense, recordFixedExpense, recordIncome, recordInvestmentTrade, recordLoanInterestPayment, recordLoanPrincipalRepayment, recordTransfer, setInvestmentValue, totals } = require('./domain/ledger.js');
const { restoreBackup, serializeBackup } = require('./domain/storage.js');

const STORAGE_KEY = 'yongdu-ledger-v1';

function todayIso(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const CATEGORY_TREE = [
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
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new TypeError('date must be YYYY-MM-DD');
}

function parseYuanToCents(input) {
  const text = String(input ?? '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error('金额必须是非负数字，最多两位小数');
  const [yuan, fraction = ''] = text.split('.');
  const cents = Number(yuan) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new RangeError('金额超过可安全记录的范围');
  return integer(cents, 'amountCents');
}

function formatCents(amountCents) {
  integer(amountCents, 'amountCents');
  const sign = amountCents < 0 ? '-' : '';
  const absolute = Math.abs(amountCents);
  return `¥${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

function categoryOptions() {
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

function initializeState({ monthlyBudgetYuan, startDay = 1, nowDate, accounts }) {
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

function loadPersisted(storage) {
  const rawData = storage.get(STORAGE_KEY);
  if (rawData === undefined || rawData === null || rawData === '') return { ok: true, state: null, rawData: null };
  const restored = restoreBackup(rawData);
  return restored.ok ? { ok: true, state: restored.data, rawData } : restored;
}

function savePersisted(storage, state) {
  const rawData = serializeBackup(state);
  storage.set(STORAGE_KEY, rawData);
  return { ok: true, rawData };
}

function getHomeModel(state, date) {
  const activePeriod = state.budgetPeriods.find((item) => date >= item.startDate && date <= item.endDate);
  if (!activePeriod) {
    const pendingPeriod = openPeriodWaitingForSettlement(state, date);
    if (pendingPeriod) {
      const settlement = getSettlementModel(state, date);
      return {
        date,
        periodId: pendingPeriod.id,
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
        settlement,
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

function getSettlementModel(state, date) {
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

function settleCurrentPeriod(state, date, { positiveMode = null, overspendMode = null } = {}) {
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
  const nextCycle = cycleForDate(date, state.appSettings.startDay, state.appSettings.monthlyBudgetCents);
  return addBudgetPeriod(closed, {
    id: `period-${state.budgetPeriods.length + 1}`,
    startDate: nextCycle.startDate,
    endDate: nextCycle.endDate,
    baseBudgetCents: nextCycle.baseBudgetCents,
    carryCents: result.nextCarryCents,
    status: 'open',
  });
}

function setTransactionNote(state, transactionId, note) {
  const next = clone(state);
  const transaction = next.transactions.find((item) => item.id === transactionId);
  if (transaction) transaction.note = String(note || '').trim();
  return next;
}

function recordEntry(state, { amountYuan, date, accountId, categoryLevel1, categoryLevel2, note = '', includeControlledBudget = true }) {
  const amountCents = parseYuanToCents(amountYuan);
  assertDate(date);
  if (!categoryLevel1 || !categoryLevel2) throw new Error('请选择完整的两级分类');
  const details = { id: `entry-${state.transactions.length + 1}`, date, accountId, amountCents, categoryLevel1, categoryLevel2 };
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
  return setTransactionNote(next, details.id, note);
}

function findPreviousSimilar(state, { categoryLevel1, categoryLevel2 }) {
  const expenses = state.transactions
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.kind === 'controlled_expense' || item.kind === 'fixed_expense');
  const exact = categoryLevel2 ? expenses.filter(({ item }) => item.categoryLevel2 === categoryLevel2) : [];
  const candidates = exact.length ? exact : expenses.filter(({ item }) => item.categoryLevel1 === categoryLevel1);
  candidates.sort((left, right) => left.item.date.localeCompare(right.item.date) || left.index - right.index);
  const latest = candidates.length ? candidates[candidates.length - 1].item : undefined;
  return latest ? { amountCents: latest.amountCents, amount: formatCents(latest.amountCents), date: latest.date } : null;
}

function listRecentBills(state) {
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

function accountTypeOptions() {
  return Object.entries(ACCOUNT_TYPE_LABELS).map(([value, label]) => ({ value, label }));
}

function getAssetsModel(state) {
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

function addAssetAccount(state, { id = null, name, type, balanceYuan = '0', costBasisYuan = '0' }) {
  return runOperation(() => {
    if (!name || !String(name).trim()) throw new Error('请输入账户名称');
    if (!ALL_ACCOUNT_TYPES.has(type)) throw new Error('不支持的账户类型');
    const balanceCents = parseYuanToCents(balanceYuan);
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

function recordIncomeEntry(state, { amountYuan, date, accountId, categoryLevel2 = '其他收入', source = 'manual' }) {
  return runOperation(() => recordIncome(state, {
    date,
    accountId,
    amountCents: positiveAmount(amountYuan),
    categoryLevel1: '收入',
    categoryLevel2,
    source,
  }));
}

function recordTransferEntry(state, { amountYuan, date, fromAccountId, toAccountId, source = 'manual' }) {
  return runOperation(() => {
    const from = state.accounts.find((item) => item.id === fromAccountId);
    const to = state.accounts.find((item) => item.id === toAccountId);
    if (!from || !to) throw new Error('未找到账户');
    if (!TRANSFER_ACCOUNT_TYPES.has(from.type) || !TRANSFER_ACCOUNT_TYPES.has(to.type)) throw new Error('转账仅支持现金、储蓄卡和电子钱包');
    return recordTransfer(state, { date, fromAccountId, toAccountId, amountCents: positiveAmount(amountYuan), source });
  });
}

function repayCreditCard(state, { amountYuan, date, fromAccountId, creditCardAccountId, source = 'manual' }) {
  return runOperation(() => recordCreditCardRepayment(state, {
    date,
    fromAccountId,
    creditCardAccountId,
    amountCents: positiveAmount(amountYuan),
    source,
  }));
}

function borrowLoan(state, { amountYuan, date, cashAccountId, loanAccountId, source = 'manual' }) {
  return runOperation(() => recordBorrowing(state, {
    date,
    cashAccountId,
    loanAccountId,
    amountCents: positiveAmount(amountYuan),
    source,
  }));
}

function repayLoanPrincipal(state, { amountYuan, date, cashAccountId, loanAccountId, source = 'manual' }) {
  return runOperation(() => recordLoanPrincipalRepayment(state, {
    date,
    cashAccountId,
    loanAccountId,
    amountCents: positiveAmount(amountYuan),
    source,
  }));
}

function payLoanInterest(state, { amountYuan, date, cashAccountId, loanAccountId, source = 'manual' }) {
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

function buyInvestment(state, { amountYuan, date, cashAccountId, investmentAccountId, source = 'manual' }) {
  return runOperation(() => recordInvestmentTrade(state, {
    date,
    side: 'buy',
    cashAccountId,
    investmentAccountId,
    amountCents: positiveAmount(amountYuan),
    source,
  }));
}

function sellInvestment(state, { amountYuan, date, cashAccountId, investmentAccountId, source = 'manual' }) {
  return runOperation(() => recordInvestmentTrade(state, {
    date,
    side: 'sell',
    cashAccountId,
    investmentAccountId,
    amountCents: positiveAmount(amountYuan),
    source,
  }));
}

function updateInvestmentValue(state, { currentValueYuan, date, investmentAccountId, source = 'manual valuation' }) {
  return runOperation(() => setInvestmentValue(state, {
    date,
    investmentAccountId,
    currentValueCents: parseYuanToCents(currentValueYuan),
    source,
  }));
}

function listRecentTransactions(state) {
  return state.transactions
    .map((item, index) => ({ item, index }))
    .sort((left, right) => right.item.date.localeCompare(left.item.date) || right.index - left.index)
    .map(({ item }) => {
      const typeLabel = item.kind === 'fixed_expense' && item.categoryLevel1 === '利息'
        ? '利息支付'
        : (TRANSACTION_TYPE_LABELS[item.kind] || item.kind);
      const fromAccount = item.accountId ? accountName(state, item.accountId) : '';
      const toAccount = item.counterpartyAccountId ? accountName(state, item.counterpartyAccountId) : '';
      const categoryParts = [item.categoryLevel1, item.categoryLevel2].filter(Boolean);
      return {
        id: item.id,
        kind: item.kind,
        typeLabel,
        date: item.date,
        amountCents: item.amountCents,
        amount: formatCents(item.amountCents),
        account: fromAccount,
        counterpartyAccount: toAccount,
        accountFlow: toAccount ? `${fromAccount} → ${toAccount}` : fromAccount,
        category: categoryParts.join(' · ') || typeLabel,
        budgetType: item.kind === 'controlled_expense' ? '计入预算' : '不计预算',
        note: item.note || '',
      };
    });
}

function getSettingsModel(state) {
  const assets = getAssetsModel(state);
  return {
    monthlyBudgetCents: state.appSettings?.monthlyBudgetCents ?? state.defaultBudgetCents,
    monthlyBudget: formatCents(state.appSettings?.monthlyBudgetCents ?? state.defaultBudgetCents),
    startDay: state.appSettings?.startDay ?? 1,
    accounts: assets.accounts,
    assets,
  };
}

module.exports = { todayIso, parseYuanToCents, formatCents, categoryOptions, initializeState, loadPersisted, savePersisted, getHomeModel, getSettlementModel, settleCurrentPeriod, recordEntry, findPreviousSimilar, listRecentBills, accountTypeOptions, getAssetsModel, addAssetAccount, recordIncomeEntry, recordTransferEntry, repayCreditCard, borrowLoan, repayLoanPrincipal, payLoanInterest, buyInvestment, sellInvestment, updateInvestmentValue, listRecentTransactions, getSettingsModel, STORAGE_KEY, CATEGORY_TREE };
