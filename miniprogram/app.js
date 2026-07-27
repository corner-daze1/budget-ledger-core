const core = require('./lib/application.js');

App({
  globalData: {
    state: null,
    storageError: null,
    ready: false,
  },

  onLaunch() {
    try {
      const loaded = core.loadPersisted({ get: (key) => wx.getStorageSync(key) });
      if (loaded.ok) this.globalData.state = loaded.state;
      else this.globalData.storageError = loaded.error;
    } catch (error) {
      this.globalData.storageError = `本地数据读取失败：${error.message}`;
    }
    this.globalData.ready = true;
  },

  saveState() {
    try {
      if (!this.globalData.state) throw new Error('尚未完成首次设置');
      const saved = core.savePersisted({ set: (key, value) => wx.setStorageSync(key, value) }, this.globalData.state);
      this.globalData.storageError = null;
      return saved;
    } catch (error) {
      this.globalData.storageError = `本地数据保存失败：${error.message}`;
      throw error;
    }
  },
});
