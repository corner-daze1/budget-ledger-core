const core = require('../../lib/application.js');

Page({
  data: {
    model: null,
    error: '',
    positiveModeIndex: 0,
    positiveModeSelected: false,
    positiveModeLabel: '请选择',
    overspendModeIndex: 0,
    overspendModeSelected: false,
    overspendModeLabel: '请选择',
    positiveModeLabels: ['带入下期', '转入奖励余额'],
    overspendModeLabels: ['带入下期', '用奖励余额抵扣'],
  },

  onShow() {
    const app = getApp();
    if (!app.globalData.state) {
      wx.redirectTo({ url: '/pages/settings/settings' });
      return;
    }
    try {
      this.setData({
        model: core.getHomeModel(app.globalData.state, core.todayIso()),
        error: app.globalData.storageError || '',
        positiveModeSelected: false,
        positiveModeLabel: '请选择',
        overspendModeSelected: false,
        overspendModeLabel: '请选择',
      });
    } catch (error) {
      this.setData({ model: null, error: error.message });
    }
  },

  goEntry() { wx.navigateTo({ url: '/pages/entry/entry' }); },
  goBills() { wx.navigateTo({ url: '/pages/bills/bills' }); },
  goSettings() { wx.navigateTo({ url: '/pages/settings/settings' }); },
  goAssets() { wx.navigateTo({ url: '/pages/settings/settings' }); },
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
