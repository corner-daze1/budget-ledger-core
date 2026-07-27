const core = require('../../lib/application.js');

Page({
  data: { bills: [], error: '' },

  onShow() {
    const app = getApp();
    if (!app.globalData.state) {
      wx.redirectTo({ url: '/pages/settings/settings' });
      return;
    }
    this.setData({ bills: core.listRecentBills(app.globalData.state), error: app.globalData.storageError || '' });
  },
});
