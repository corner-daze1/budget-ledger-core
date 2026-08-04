const core = require('../../lib/application.js');

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

Page({
  data: {
    model: null,
    recentBills: [],
    scale: null,
    hasPlanEvents: false,
    error: '',
    positiveModeIndex: 0,
    positiveModeSelected: false,
    positiveModeLabel: '请选择',
    overspendModeIndex: 0,
    overspendModeSelected: false,
    overspendModeLabel: '请选择',
    positiveModeLabels: ['带入下期', '转入奖励余额'],
    overspendModeLabels: ['带入下期', '用奖励余额抵扣'],
    pendingAmountYuan: '',
    pendingPrincipalYuan: '',
    pendingInterestYuan: '',
  },

  onShow() {
    const app = getApp();
    if (!app.globalData.state) {
      wx.redirectTo({ url: '/pages/settings/settings' });
      return;
    }
    try {
      const model = core.getHomeModel(app.globalData.state, core.todayIso(), app.globalData.planRunSummary);
      const recentBills = core.listRecentBills(app.globalData.state).slice(0, 5).map((item) => ({
        ...item,
        category: formatBillCategory(item),
      }));
      this.setData({
        model,
        recentBills,
        scale: buildScale(model),
        hasPlanEvents: hasPlanEvents(model),
        error: app.globalData.storageError || '',
        positiveModeSelected: false,
        positiveModeLabel: '请选择',
        overspendModeSelected: false,
        overspendModeLabel: '请选择',
      });
    } catch (error) {
      this.setData({ model: null, recentBills: [], scale: null, hasPlanEvents: false, error: error.message });
    }
  },

  goEntry() { wx.navigateTo({ url: '/pages/entry/entry' }); },
  goBills() { wx.navigateTo({ url: '/pages/bills/bills' }); },
  goSettings() { wx.navigateTo({ url: '/pages/settings/settings' }); },
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
  onPositiveModeChange(event) {
    const index = Number(event.detail.value);
    this.setData({ positiveModeIndex: index, positiveModeSelected: true, positiveModeLabel: this.data.positiveModeLabels[index] });
  },
  onOverspendModeChange(event) {
    const index = Number(event.detail.value);
    this.setData({ overspendModeIndex: index, overspendModeSelected: true, overspendModeLabel: this.data.overspendModeLabels[index] });
  },
  settlePeriod() {
    const settlement = this.data.model?.settlement;
    if (!settlement) return;
    if (settlement.positiveChoiceRequired && !this.data.positiveModeSelected) {
      this.setData({ error: '请先选择结余处理方式' });
      return;
    }
    if (settlement.overspendChoiceRequired && !this.data.overspendModeSelected) {
      this.setData({ error: '请先选择超支处理方式' });
      return;
    }
    try {
      const app = getApp();
      app.globalData.state = core.settleCurrentPeriod(app.globalData.state, core.todayIso(), {
        positiveMode: settlement.positiveChoiceRequired ? ['carry', 'reward'][this.data.positiveModeIndex] : null,
        overspendMode: settlement.overspendChoiceRequired ? ['carry', 'reward'][this.data.overspendModeIndex] : null,
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
  module.exports.buildScale = buildScale;
}
