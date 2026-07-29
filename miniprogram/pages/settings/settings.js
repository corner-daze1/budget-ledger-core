const core = require('../../lib/application.js');

const OPERATION_LABELS = ['信用卡还款', '借款', '归还本金', '支付利息', '投资买入', '投资卖出', '手工估值'];

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
    const settings = core.getSettingsModel(state);
    this.setData({ settings, assets: settings.assets, error: '' });
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
