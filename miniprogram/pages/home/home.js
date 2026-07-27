const core = require('../../lib/application.js');

Page({
  data: { model: null, error: '' },

  onShow() {
    const app = getApp();
    if (!app.globalData.state) {
      wx.redirectTo({ url: '/pages/settings/settings' });
      return;
    }
    this.setData({ model: core.getHomeModel(app.globalData.state, core.todayIso()), error: app.globalData.storageError || '' });
  },

  goEntry() { wx.navigateTo({ url: '/pages/entry/entry' }); },
  goBills() { wx.navigateTo({ url: '/pages/bills/bills' }); },
  goSettings() { wx.navigateTo({ url: '/pages/settings/settings' }); },
});
