const core = require('../../lib/application.js');

Page({
  data: { flows: [], error: '' },

  onShow() {
    const app = getApp();
    if (!app.globalData.state) {
      wx.redirectTo({ url: '/pages/settings/settings' });
      return;
    }
    this.setData({ flows: core.listRecentTransactions(app.globalData.state), error: app.globalData.storageError || '' });
  },
});
