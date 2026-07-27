const core = require('../../lib/application.js');

Page({
  data: {
    amountYuan: '',
    date: '',
    accounts: [],
    accountIndex: 0,
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
      wx.redirectTo({ url: '/pages/settings/settings' });
      return;
    }
    const categories = core.categoryOptions();
    this.setData({ date: core.todayIso(), accounts: app.globalData.state.accounts, categories, level2Options: categories[0].level2, error: app.globalData.storageError || '' });
    this.refreshPrevious(categories[0].level1, categories[0].level2[0]);
  },

  onAmountInput(event) { this.setData({ amountYuan: event.detail.value }); },
  onDateChange(event) { this.setData({ date: event.detail.value }); },
  onNoteInput(event) { this.setData({ note: event.detail.value }); },
  onAccountChange(event) { this.setData({ accountIndex: Number(event.detail.value) }); },
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
      const category = this.data.categories[this.data.level1Index];
      const state = core.recordEntry(getApp().globalData.state, {
        amountYuan: this.data.amountYuan,
        date: this.data.date,
        accountId: this.data.accounts[this.data.accountIndex].id,
        categoryLevel1: category.level1,
        categoryLevel2: this.data.level2Options[this.data.level2Index],
        note: this.data.note,
        includeControlledBudget: this.data.includeControlledBudget,
      });
      getApp().globalData.state = state;
      getApp().saveState();
      wx.navigateBack({ delta: 1 });
    } catch (error) {
      this.setData({ error: error.message });
    }
  },
});
