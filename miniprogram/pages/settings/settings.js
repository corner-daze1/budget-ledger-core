const core = require('../../lib/application.js');

Page({
  data: {
    initialized: false,
    monthlyBudgetYuan: '3000',
    startDay: '1',
    accountTypes: ['现金', '储蓄卡', '电子钱包'],
    accountTypeValues: ['cash', 'bank', 'wallet'],
    accounts: [{ name: '现金', typeIndex: 0, balanceYuan: '0' }],
    settings: null,
    error: '',
  },

  onShow() {
    const app = getApp();
    if (app.globalData.storageError) this.setData({ error: app.globalData.storageError });
    if (app.globalData.state) this.setData({ initialized: true, settings: core.getSettingsModel(app.globalData.state) });
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
  addAccount() {
    const accounts = this.data.accounts.concat([{ name: `账户${this.data.accounts.length + 1}`, typeIndex: 1, balanceYuan: '0' }]);
    this.setData({ accounts });
  },
  removeAccount(event) {
    if (this.data.accounts.length === 1) return;
    const accounts = this.data.accounts.slice();
    accounts.splice(Number(event.currentTarget.dataset.index), 1);
    this.setData({ accounts });
  },
  submit() {
    if (this.data.initialized) {
      wx.navigateTo({ url: '/pages/home/home' });
      return;
    }
    try {
      const app = getApp();
      const accounts = this.data.accounts.map((item) => ({ name: item.name, type: this.data.accountTypeValues[item.typeIndex], balanceYuan: item.balanceYuan }));
      app.globalData.state = core.initializeState({ monthlyBudgetYuan: this.data.monthlyBudgetYuan, startDay: Number(this.data.startDay), nowDate: core.todayIso(), accounts });
      app.saveState();
      wx.redirectTo({ url: '/pages/home/home' });
    } catch (error) {
      this.setData({ error: error.message });
    }
  },
});
