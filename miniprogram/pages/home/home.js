const core = require('../../lib/application.js');

const EXPENSE_KINDS = new Set([
  'controlled_expense',
  'fixed_expense',
  'loan_interest_accrual',
]);

function hasPlanEvents(model) {
  if (!model) return false;
  // Generic plan summary only — overdue banner and pending lists render in their own regions.
  return Boolean(
    (model.planExecutionResults && model.planExecutionResults.length)
    || (model.planReminders && model.planReminders.length)
    || (model.planDueToday && model.planDueToday.length)
    || model.planExecutionMessage,
  );
}

function normalizeCategoryPart(value) {
  if (value == null) return '';
  const text = String(value).trim();
  if (!text || text === 'null' || text === 'undefined') return '';
  return text;
}

function formatBillCategory(bill) {
  const parts = [bill && bill.categoryLevel1, bill && bill.categoryLevel2]
    .map(normalizeCategoryPart)
    .filter(Boolean);
  return parts.length ? parts.join(' · ') : '未分类';
}

function formatCents(amountCents) {
  const cents = Number(amountCents) || 0;
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  return `¥${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

function transactionImpact(item) {
  const amountCents = Number(item && item.amountCents) || 0;
  if (item && item.kind === 'income') return { expenseCents: 0, incomeCents: amountCents };
  if (item && item.kind === 'refund') return { expenseCents: -amountCents, incomeCents: 0 };
  if (item && EXPENSE_KINDS.has(item.kind)) return { expenseCents: amountCents, incomeCents: 0 };
  return { expenseCents: 0, incomeCents: 0 };
}

function transactionTone(item) {
  if (item.kind === 'income') return 'income';
  if (item.kind === 'refund') return 'refund';
  if (EXPENSE_KINDS.has(item.kind)) return 'expense';
  return 'neutral';
}

function normalizeLedgerTransaction(item) {
  const category = item && (item.categoryLevel1 || item.categoryLevel2)
    ? formatBillCategory(item)
    : (item?.category || item?.typeLabel || '未分类');
  return {
    ...item,
    category,
    accountFlow: item?.accountFlow || item?.account || '',
    typeLabel: item?.typeLabel || item?.kind || '',
    amount: item?.amount || formatCents(item?.amountCents),
    note: item?.note || '',
    amountTone: transactionTone(item || {}),
  };
}

function buildLedgerGroups(transactions = []) {
  const groups = [];
  for (const original of transactions) {
    const item = normalizeLedgerTransaction(original);
    let group = groups[groups.length - 1];
    if (!group || group.date !== item.date) {
      group = { date: item.date, expenseCents: 0, incomeCents: 0, transactions: [] };
      groups.push(group);
    }
    const impact = transactionImpact(item);
    group.expenseCents += impact.expenseCents;
    group.incomeCents += impact.incomeCents;
    group.transactions.push(item);
  }
  return groups.map((group) => ({
    ...group,
    expenseText: formatCents(group.expenseCents),
    incomeText: formatCents(group.incomeCents),
  }));
}

function buildScale(model) {
  if (!model || model.needsSettlement) {
    return {
      mode: 'settlement',
      fillPercent: 0,
      surplusText: '',
      dailyLabel: '',
    };
  }
  const free = Number(model.todayFreeCents) || 0;
  const daily = Math.max(1, Number(model.fullSingleDayQuotaCents) || 1);
  if ((model.prepaidCents || 0) > 0) {
    const over = Math.min(100, Math.round((model.prepaidCents / daily) * 40) + 60);
    return {
      mode: 'prepaid',
      fillPercent: Math.min(100, over),
      surplusText: '',
      dailyLabel: model.fullSingleDayQuota,
    };
  }
  const ratio = free / daily;
  // Scale expresses saved-vs-daily feel; saturate when free >> daily. Not a month budget %.
  const fillPercent = Math.max(8, Math.min(100, Math.round(Math.min(ratio, 2.5) / 2.5 * 100)));
  const surplusCents = free - daily;
  let surplusText = '';
  if (surplusCents > 0) {
    const yuan = (surplusCents / 100).toFixed(2);
    surplusText = `比今日基准多 ¥${yuan}`;
  } else if (surplusCents === 0) {
    surplusText = '刚好等于今日基准额度';
  } else {
    surplusText = '今日可用已低于单日基准';
  }
  return {
    mode: 'normal',
    fillPercent,
    surplusText,
    dailyLabel: model.fullSingleDayQuota,
  };
}

function touchY(event) {
  const point = event?.changedTouches?.[0] || event?.touches?.[0];
  return point ? (point.pageY ?? point.clientY ?? point.y) : null;
}

function touchPoint(event) {
  const point = event?.changedTouches?.[0] || event?.touches?.[0];
  if (!point) return null;
  return { x: point.pageX ?? point.clientX ?? point.x, y: point.pageY ?? point.clientY ?? point.y };
}

Page({
  data: {
    model: null,
    ledgerGroups: [],
    ledgerTransactionCount: 0,
    ledgerMode: 'overview',
    ledgerScrollEnabled: false,
    ledgerScrollTop: 0,
    ledgerTouchStartY: null,
    scale: null,
    hasPlanEvents: false,
    error: '',
    settlementDecisionIndex: 0,
    settlementDecisionSelected: false,
    settlementDecisionLabel: '请选择',
    settlementDecisionLabels: ['全部带入', '全部不带入'],
    pendingAmountYuan: '',
    pendingPrincipalYuan: '',
    pendingInterestYuan: '',
    openLogicalTransactionId: '',
    rowGesture: null,
    swipeAxis: null,
  },

  onShow() {
    const app = getApp();
    if (!app.globalData.state) {
      wx.switchTab({ url: '/pages/settings/settings' });
      return;
    }
    if (app.globalData.homeResetRequested === true) {
      app.globalData.homeResetRequested = false;
      this.resetHomeLedger();
    }
    try {
      const model = core.getHomeModel(app.globalData.state, core.todayIso(), app.globalData.planRunSummary);
      const transactions = typeof core.listRecentTransactions === 'function'
        ? core.listRecentTransactions(app.globalData.state)
        : [];
      const ledgerGroups = buildLedgerGroups(transactions);
      this.setData({
        model,
        ledgerGroups,
        ledgerTransactionCount: transactions.length,
        scale: buildScale(model),
        hasPlanEvents: hasPlanEvents(model),
        error: app.globalData.storageError || '',
        settlementDecisionSelected: false,
        settlementDecisionLabel: '请选择',
      });
    } catch (error) {
      this.setData({ model: null, ledgerGroups: [], ledgerTransactionCount: 0, scale: null, hasPlanEvents: false, error: error.message });
    }
  },

  enterLedger() {
    this.setData({ ledgerMode: 'expanded', ledgerScrollEnabled: true, ledgerScrollTop: 0, ledgerTouchStartY: null });
  },

  resetHomeLedger() {
    this.setData({ ledgerMode: 'overview', ledgerScrollEnabled: false, ledgerScrollTop: 0, ledgerTouchStartY: null });
  },

  onLedgerTouchStart(event) {
    const y = touchY(event);
    if (y == null) return;
    this.setData({ ledgerTouchStartY: y });
  },

  onLedgerTouchMove() {
    // State changes are committed only at touchend.
  },

  onLedgerTouchEnd(event) {
    const startY = this.data.ledgerTouchStartY;
    const endY = touchY(event);
    this.setData({ ledgerTouchStartY: null });
    if (startY == null || endY == null) return;
    const deltaY = endY - startY;
    if (Math.abs(deltaY) < 48) return;
    if (this.data.ledgerMode === 'overview' && deltaY < 0) {
      this.enterLedger();
    } else if (this.data.ledgerMode === 'expanded' && deltaY > 0 && Number(this.data.ledgerScrollTop) <= 0) {
      this.resetHomeLedger();
    }
  },

  onLedgerTouchCancel() {
    this.setData({ ledgerTouchStartY: null });
  },

  onLedgerScroll(event) {
    this.setData({ ledgerScrollTop: Number(event.detail.scrollTop) || 0, openLogicalTransactionId: '', swipeAxis: null });
  },

  closeSwipeRows() {
    if (this.data.openLogicalTransactionId) this.setData({ openLogicalTransactionId: '', swipeAxis: null });
  },

  onRowTouchStart(event) {
    const point = touchPoint(event);
    if (!point) return;
    const logicalTransactionId = event.currentTarget.dataset.id;
    if (this.data.openLogicalTransactionId && this.data.openLogicalTransactionId !== logicalTransactionId) this.closeSwipeRows();
    this.setData({ rowGesture: { logicalTransactionId, startX: point.x, startY: point.y, axis: null }, swipeAxis: null });
  },

  onRowTouchMove(event) {
    const gesture = this.data.rowGesture;
    const point = touchPoint(event);
    if (!gesture || !point) return;
    const deltaX = point.x - gesture.startX;
    const deltaY = point.y - gesture.startY;
    if (!gesture.axis && Math.max(Math.abs(deltaX), Math.abs(deltaY)) >= 8) {
      gesture.axis = Math.abs(deltaX) > Math.abs(deltaY) ? 'x' : 'y';
      this.setData({ rowGesture: gesture, swipeAxis: gesture.axis });
    }
  },

  onRowTouchEnd(event) {
    const gesture = this.data.rowGesture;
    const point = touchPoint(event);
    this.setData({ rowGesture: null, swipeAxis: null });
    if (!gesture || !point) return;
    const deltaX = point.x - gesture.startX;
    const deltaY = point.y - gesture.startY;
    if (gesture.axis !== 'x' || Math.abs(deltaX) < Math.abs(deltaY)) {
      if (gesture.axis === 'y') this.closeSwipeRows();
      return;
    }
    if (deltaX < -48) this.setData({ openLogicalTransactionId: gesture.logicalTransactionId });
    else if (deltaX > 48) this.closeSwipeRows();
  },

  onRowTouchCancel() {
    this.setData({ rowGesture: null, swipeAxis: null });
  },

  openTransaction(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    this.closeSwipeRows();
    const app = getApp();
    app.globalData.transactionReturn = { page: 'home', scrollTop: this.data.ledgerScrollTop };
    wx.navigateTo({ url: `/pages/transaction-detail/transaction-detail?id=${encodeURIComponent(id)}&mode=view` });
  },

  openTransactionAction(event) {
    const id = event.currentTarget.dataset.id;
    const mode = event.currentTarget.dataset.mode;
    if (!id || !mode) return;
    this.closeSwipeRows();
    const app = getApp();
    app.globalData.transactionReturn = { page: 'home', scrollTop: this.data.ledgerScrollTop };
    wx.navigateTo({ url: `/pages/transaction-detail/transaction-detail?id=${encodeURIComponent(id)}&mode=${mode}` });
  },

  goBills() { wx.navigateTo({ url: '/pages/bills/bills' }); },
  onPendingAmountInput(event) { this.setData({ pendingAmountYuan: event.detail.value }); },
  onPendingPrincipalInput(event) { this.setData({ pendingPrincipalYuan: event.detail.value }); },
  onPendingInterestInput(event) { this.setData({ pendingInterestYuan: event.detail.value }); },
  retryPendingPlan(event) {
    try {
      const app = getApp();
      app.globalData.state = core.retryPendingPlan(app.globalData.state, {
        pendingId: event.currentTarget.dataset.id,
        amountYuan: this.data.pendingAmountYuan,
        principalYuan: this.data.pendingPrincipalYuan,
        interestYuan: this.data.pendingInterestYuan,
      });
      app.saveState();
      app.globalData.planRunSummary = {
        date: core.todayIso(),
        executed: [],
        pending: [],
        legacy: [],
        message: '待处理计划已补记',
      };
      this.setData({ pendingAmountYuan: '', pendingPrincipalYuan: '', pendingInterestYuan: '' });
      this.onShow();
    } catch (error) {
      this.setData({ error: error.message });
    }
  },
  dismissPlanOverdueBanner() {
    const app = getApp();
    app.globalData.state = core.dismissOverduePlanBanner(
      app.globalData.state,
      this.data.model.planOverdueItems.map((item) => item.occurrenceKey),
    );
    app.saveState();
    this.onShow();
  },
  onSettlementDecisionChange(event) {
    const index = Number(event.detail.value);
    this.setData({ settlementDecisionIndex: index, settlementDecisionSelected: true, settlementDecisionLabel: this.data.settlementDecisionLabels[index] });
  },
  settlePeriod() {
    const settlement = this.data.model?.settlement;
    if (!settlement) return;
    if (settlement.decisionRequired && !this.data.settlementDecisionSelected) {
      this.setData({ error: '请先选择本期结算方式' });
      return;
    }
    try {
      const app = getApp();
      app.globalData.state = core.settleCurrentPeriod(app.globalData.state, core.todayIso(), {
        decision: settlement.decisionRequired ? ['carry', 'discard'][this.data.settlementDecisionIndex] : null,
      });
      app.saveState();
      this.onShow();
    } catch (error) {
      this.setData({ error: error.message });
    }
  },
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports.hasPlanEvents = hasPlanEvents;
  module.exports.formatBillCategory = formatBillCategory;
  module.exports.normalizeCategoryPart = normalizeCategoryPart;
  module.exports.formatCents = formatCents;
  module.exports.transactionImpact = transactionImpact;
  module.exports.buildLedgerGroups = buildLedgerGroups;
  module.exports.buildScale = buildScale;
}
