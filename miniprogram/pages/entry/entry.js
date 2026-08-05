const core = require('../../lib/application.js');

Page({
  data: {
    modes: ['支出', '收入', '转账'],
    modeIndex: 0,
    amountYuan: '',
    date: '',
    accounts: [],
    accountIndex: 0,
    toAccounts: [],
    toAccountIndex: 0,
    categories: [],
    level1Index: 0,
    level2Index: 0,
    level2Options: [],
    note: '',
    includeControlledBudget: true,
    previous: null,
    error: '',
  },

  onShow() {
    const app = getApp();
    if (!app.globalData.state) {
      wx.switchTab({ url: '/pages/settings/settings' });
      return;
    }
    const categories = core.categoryOptions();
    this.setData({
      date: core.todayIso(),
      categories,
      level2Options: categories[0].level2,
      error: app.globalData.storageError || '',
    });
    this.refreshAccountOptions(this.data.modeIndex);
    this.refreshPrevious(categories[0].level1, categories[0].level2[0]);
  },

  refreshAccountOptions(modeIndex) {
    const all = getApp().globalData.state.accounts;
    let accounts;
    if (modeIndex === 0) accounts = all.filter((item) => ['cash', 'bank', 'wallet', 'credit_card'].includes(item.type));
    else if (modeIndex === 1) accounts = all.filter((item) => !['credit_card', 'loan'].includes(item.type));
    else accounts = all.filter((item) => ['cash', 'bank', 'wallet'].includes(item.type));
    this.setData({
      accounts,
      accountIndex: 0,
      toAccounts: modeIndex === 2 ? accounts : [],
      toAccountIndex: accounts.length > 1 ? 1 : 0,
    });
  },

  onModeChange(event) {
    const modeIndex = Number(event.currentTarget.dataset.index);
    this.setData({ modeIndex, error: '', previous: modeIndex === 0 ? this.data.previous : null });
    this.refreshAccountOptions(modeIndex);
    if (modeIndex === 0) {
      const category = this.data.categories[this.data.level1Index];
      this.refreshPrevious(category.level1, this.data.level2Options[this.data.level2Index]);
    }
  },
  onAmountInput(event) { this.setData({ amountYuan: event.detail.value }); },
  onDateChange(event) { this.setData({ date: event.detail.value }); },
  onNoteInput(event) { this.setData({ note: event.detail.value }); },
  onAccountChange(event) { this.setData({ accountIndex: Number(event.detail.value) }); },
  onToAccountChange(event) { this.setData({ toAccountIndex: Number(event.detail.value) }); },
  onControlledChange(event) { this.setData({ includeControlledBudget: event.detail.value }); },
  onLevel1Change(event) {
    const level1Index = Number(event.detail.value);
    const level2Options = this.data.categories[level1Index].level2;
    this.setData({ level1Index, level2Index: 0, level2Options });
    this.refreshPrevious(this.data.categories[level1Index].level1, level2Options[0]);
  },
  onLevel2Change(event) {
    const level2Index = Number(event.detail.value);
    this.setData({ level2Index });
    this.refreshPrevious(this.data.categories[this.data.level1Index].level1, this.data.level2Options[level2Index]);
  },
  refreshPrevious(level1, level2) {
    const previous = core.findPreviousSimilar(getApp().globalData.state, { categoryLevel1: level1, categoryLevel2: level2 });
    this.setData({ previous });
  },
  submit() {
    try {
      const app = getApp();
      const from = this.data.accounts[this.data.accountIndex];
      if (!from) throw new Error('请先在资产中心创建可用账户');
      let state;
      if (this.data.modeIndex === 0) {
        const category = this.data.categories[this.data.level1Index];
        state = core.recordEntry(app.globalData.state, {
          amountYuan: this.data.amountYuan,
          date: this.data.date,
          accountId: from.id,
          categoryLevel1: category.level1,
          categoryLevel2: this.data.level2Options[this.data.level2Index],
          note: this.data.note,
          includeControlledBudget: this.data.includeControlledBudget,
        });
      } else if (this.data.modeIndex === 1) {
        state = core.recordIncomeEntry(app.globalData.state, {
          amountYuan: this.data.amountYuan,
          date: this.data.date,
          accountId: from.id,
          categoryLevel2: this.data.note || '其他收入',
        });
      } else {
        const to = this.data.toAccounts[this.data.toAccountIndex];
        if (!to) throw new Error('请选择转入账户');
        state = core.recordTransferEntry(app.globalData.state, {
          amountYuan: this.data.amountYuan,
          date: this.data.date,
          fromAccountId: from.id,
          toAccountId: to.id,
        });
      }
      app.globalData.state = state;
      app.saveState();
      wx.navigateBack({ delta: 1 });
    } catch (error) {
      this.setData({ error: error.message });
    }
  },
});
