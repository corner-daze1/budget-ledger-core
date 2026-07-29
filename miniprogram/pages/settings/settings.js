const core = require('../../lib/application.js');

const OPERATION_LABELS = ['信用卡还款', '借款', '归还本金', '支付利息', '投资买入', '投资卖出', '手工估值'];
const BUDGET_SCOPE_LABELS = ['仅本周期', '本周期及以后', '下周期及以后'];
const BUDGET_SCOPE_VALUES = ['only_current', 'current_and_future', 'next_and_future'];

Page({
  data: {
    initialized: false,
    monthlyBudgetYuan: '3000',
    startDay: '1',
    accountTypes: ['现金', '储蓄卡', '电子钱包'],
    accountTypeValues: ['cash', 'bank', 'wallet'],
    accounts: [{ name: '现金', typeIndex: 0, balanceYuan: '0' }],
    settings: null,
    assets: null,
    budgetEditYuan: '',
    budgetScopeLabels: BUDGET_SCOPE_LABELS,
    startDayEdit: '',
    startDayPreview: null,
    allAccountTypeLabels: ['现金', '储蓄卡', '电子钱包', '信用卡', '借贷', '投资'],
    allAccountTypeValues: ['cash', 'bank', 'wallet', 'credit_card', 'loan', 'investment'],
    newAccountName: '',
    newAccountTypeIndex: 0,
    newAccountBalanceYuan: '0',
    newAccountCostBasisYuan: '0',
    operationLabels: OPERATION_LABELS,
    operationIndex: 0,
    operationAmountYuan: '',
    sourceAccounts: [],
    targetAccounts: [],
    sourceIndex: 0,
    targetIndex: 0,
    operationNeedsSource: true,
    operationValueLabel: '金额',
    error: '',
    notice: '',
  },

  onShow() {
    const app = getApp();
    if (app.globalData.storageError) this.setData({ error: app.globalData.storageError });
    if (app.globalData.state) {
      this.setData({ initialized: true });
      this.refreshAssetCenter();
    }
  },

  refreshAssetCenter() {
    const state = getApp().globalData.state;
    const settings = core.getSettingsModel(state, core.todayIso());
    this.setData({
      settings,
      assets: settings.assets,
      budgetEditYuan: this.data.budgetEditYuan || String(settings.defaultBudgetCents / 100),
      startDayEdit: this.data.startDayEdit || String(settings.pendingStartDay || settings.startDay),
      error: '',
    });
    this.refreshOperationAccounts(this.data.operationIndex);
  },

  refreshOperationAccounts(operationIndex) {
    const accounts = getApp().globalData.state.accounts;
    const liquid = accounts.filter((item) => ['cash', 'bank', 'wallet'].includes(item.type));
    const cards = accounts.filter((item) => item.type === 'credit_card');
    const loans = accounts.filter((item) => item.type === 'loan');
    const investments = accounts.filter((item) => item.type === 'investment');
    const configs = [
      { source: liquid, target: cards, needsSource: true, valueLabel: '还款金额' },
      { source: liquid, target: loans, needsSource: true, valueLabel: '借款金额' },
      { source: liquid, target: loans, needsSource: true, valueLabel: '还本金额' },
      { source: liquid, target: loans, needsSource: true, valueLabel: '利息金额' },
      { source: liquid, target: investments, needsSource: true, valueLabel: '买入金额' },
      { source: liquid, target: investments, needsSource: true, valueLabel: '卖出金额' },
      { source: [], target: investments, needsSource: false, valueLabel: '当前现值' },
    ];
    const config = configs[operationIndex];
    this.setData({
      sourceAccounts: config.source,
      targetAccounts: config.target,
      sourceIndex: 0,
      targetIndex: 0,
      operationNeedsSource: config.needsSource,
      operationValueLabel: config.valueLabel,
    });
  },

  onBudgetInput(event) { this.setData({ monthlyBudgetYuan: event.detail.value }); },
  onStartDayInput(event) { this.setData({ startDay: event.detail.value }); },
  onBudgetEditInput(event) { this.setData({ budgetEditYuan: event.detail.value }); },
  chooseBudgetScope() {
    wx.showActionSheet({
      itemList: BUDGET_SCOPE_LABELS,
      success: ({ tapIndex }) => {
        const scope = BUDGET_SCOPE_VALUES[tapIndex];
        const label = BUDGET_SCOPE_LABELS[tapIndex];
        if (this.data.settings.needsSettlement && scope !== 'next_and_future') {
          this.setData({ error: '本期待结算，只能修改下周期及以后的默认预算', notice: '' });
          return;
        }
        wx.showModal({
          title: '确认修改预算',
          content: `新预算 ${this.data.budgetEditYuan || '未填写'} 元，范围：${label}。历史流水和已发生消费不会改变。`,
          confirmText: '确认修改',
          success: ({ confirm }) => {
            if (!confirm) return;
            try {
              const app = getApp();
              app.globalData.state = core.changeBudgetSettings(app.globalData.state, {
                newBudgetYuan: this.data.budgetEditYuan,
                scope,
                date: core.todayIso(),
              });
              app.saveState();
              this.setData({ notice: `预算已按“${label}”更新`, error: '' });
              this.refreshAssetCenter();
            } catch (error) {
              this.setData({ error: error.message, notice: '' });
            }
          },
        });
      },
    });
  },
  onStartDayEditInput(event) {
    this.setData({ startDayEdit: event.detail.value, startDayPreview: null });
  },
  previewStartDayChange() {
    try {
      const preview = core.previewStartDayChange(getApp().globalData.state, {
        newStartDay: Number(this.data.startDayEdit),
        date: core.todayIso(),
      });
      this.setData({ startDayPreview: preview, error: '', notice: '' });
    } catch (error) {
      this.setData({ startDayPreview: null, error: error.message, notice: '' });
    }
  },
  confirmStartDayChange() {
    const preview = this.data.startDayPreview;
    if (!preview) {
      this.setData({ error: '请先预览起始日变更' });
      return;
    }
    wx.showModal({
      title: preview.mode === 'immediate' ? '确认立即调整' : '确认待生效规则',
      content: `${preview.explanation}。历史账单不会移动。`,
      confirmText: '确认设置',
      success: ({ confirm }) => {
        if (!confirm) return;
        try {
          const app = getApp();
          app.globalData.state = core.changeStartDay(app.globalData.state, {
            newStartDay: Number(this.data.startDayEdit),
            date: core.todayIso(),
          });
          app.saveState();
          this.setData({ startDayPreview: null, notice: preview.mode === 'immediate' ? '空周期已立即调整' : '待生效起始日已保存', error: '' });
          this.refreshAssetCenter();
        } catch (error) {
          this.setData({ error: error.message, notice: '' });
        }
      },
    });
  },
  cancelPendingStartDayChange() {
    wx.showModal({
      title: '取消待生效规则',
      content: '取消后继续沿用当前周期起始日，历史账单不受影响。',
      confirmText: '确认取消',
      success: ({ confirm }) => {
        if (!confirm) return;
        try {
          const app = getApp();
          app.globalData.state = core.cancelPendingStartDayChange(app.globalData.state, { date: core.todayIso() });
          app.saveState();
          this.setData({ startDayPreview: null, startDayEdit: String(app.globalData.state.appSettings.startDay), notice: '待生效起始日已取消', error: '' });
          this.refreshAssetCenter();
        } catch (error) {
          this.setData({ error: error.message, notice: '' });
        }
      },
    });
  },
  onAccountNameInput(event) {
    const accounts = this.data.accounts.slice();
    accounts[event.currentTarget.dataset.index].name = event.detail.value;
    this.setData({ accounts });
  },
  onAccountBalanceInput(event) {
    const accounts = this.data.accounts.slice();
    accounts[event.currentTarget.dataset.index].balanceYuan = event.detail.value;
    this.setData({ accounts });
  },
  onAccountTypeChange(event) {
    const accounts = this.data.accounts.slice();
    accounts[event.currentTarget.dataset.index].typeIndex = Number(event.detail.value);
    this.setData({ accounts });
  },
  addInitialAccount() {
    const accounts = this.data.accounts.concat([{ name: `账户${this.data.accounts.length + 1}`, typeIndex: 1, balanceYuan: '0' }]);
    this.setData({ accounts });
  },
  removeAccount(event) {
    if (this.data.accounts.length === 1) return;
    const accounts = this.data.accounts.slice();
    accounts.splice(Number(event.currentTarget.dataset.index), 1);
    this.setData({ accounts });
  },
  onNewAccountNameInput(event) { this.setData({ newAccountName: event.detail.value }); },
  onNewAccountTypeChange(event) { this.setData({ newAccountTypeIndex: Number(event.detail.value) }); },
  onNewAccountBalanceInput(event) { this.setData({ newAccountBalanceYuan: event.detail.value }); },
  onNewAccountCostInput(event) { this.setData({ newAccountCostBasisYuan: event.detail.value }); },
  addAssetAccount() {
    try {
      const app = getApp();
      app.globalData.state = core.addAssetAccount(app.globalData.state, {
        name: this.data.newAccountName,
        type: this.data.allAccountTypeValues[this.data.newAccountTypeIndex],
        balanceYuan: this.data.newAccountBalanceYuan,
        costBasisYuan: this.data.newAccountCostBasisYuan,
      });
      app.saveState();
      this.setData({
        newAccountName: '',
        newAccountBalanceYuan: '0',
        newAccountCostBasisYuan: '0',
        notice: '账户已添加',
        error: '',
      });
      this.refreshAssetCenter();
    } catch (error) {
      this.setData({ error: error.message, notice: '' });
    }
  },
  onOperationChange(event) {
    const operationIndex = Number(event.detail.value);
    this.setData({ operationIndex, operationAmountYuan: '', notice: '', error: '' });
    this.refreshOperationAccounts(operationIndex);
  },
  onOperationAmountInput(event) { this.setData({ operationAmountYuan: event.detail.value }); },
  onSourceChange(event) { this.setData({ sourceIndex: Number(event.detail.value) }); },
  onTargetChange(event) { this.setData({ targetIndex: Number(event.detail.value) }); },
  performOperation() {
    try {
      const app = getApp();
      const state = app.globalData.state;
      const source = this.data.sourceAccounts[this.data.sourceIndex];
      const target = this.data.targetAccounts[this.data.targetIndex];
      if (!target || (this.data.operationNeedsSource && !source)) throw new Error('请先创建对应的账户');
      const common = { amountYuan: this.data.operationAmountYuan, date: core.todayIso() };
      const operations = [
        () => core.repayCreditCard(state, { ...common, fromAccountId: source.id, creditCardAccountId: target.id }),
        () => core.borrowLoan(state, { ...common, cashAccountId: source.id, loanAccountId: target.id }),
        () => core.repayLoanPrincipal(state, { ...common, cashAccountId: source.id, loanAccountId: target.id }),
        () => core.payLoanInterest(state, { ...common, cashAccountId: source.id, loanAccountId: target.id }),
        () => core.buyInvestment(state, { ...common, cashAccountId: source.id, investmentAccountId: target.id }),
        () => core.sellInvestment(state, { ...common, cashAccountId: source.id, investmentAccountId: target.id }),
        () => core.updateInvestmentValue(state, { currentValueYuan: this.data.operationAmountYuan, date: common.date, investmentAccountId: target.id }),
      ];
      app.globalData.state = operations[this.data.operationIndex]();
      app.saveState();
      this.setData({ operationAmountYuan: '', notice: `${OPERATION_LABELS[this.data.operationIndex]}已记录`, error: '' });
      this.refreshAssetCenter();
    } catch (error) {
      this.setData({ error: error.message, notice: '' });
    }
  },
  submit() {
    if (this.data.initialized) {
      wx.navigateTo({ url: '/pages/home/home' });
      return;
    }
    try {
      const app = getApp();
      const accounts = this.data.accounts.map((item) => ({
        name: item.name,
        type: this.data.accountTypeValues[item.typeIndex],
        balanceYuan: item.balanceYuan,
      }));
      app.globalData.state = core.initializeState({
        monthlyBudgetYuan: this.data.monthlyBudgetYuan,
        startDay: Number(this.data.startDay),
        nowDate: core.todayIso(),
        accounts,
      });
      app.saveState();
      wx.redirectTo({ url: '/pages/home/home' });
    } catch (error) {
      this.setData({ error: error.message });
    }
  },
});
