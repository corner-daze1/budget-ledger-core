const core = require('./lib/application.js');

App({
  globalData: {
    state: null,
    storageError: null,
    ready: false,
    planRunSummary: null,
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
    if (this.globalData.state) this.runDuePlans();
  },

  onShow() {
    if (this.globalData.ready && this.globalData.state) this.runDuePlans();
  },

  runDuePlans() {
    try {
      const result = core.processDuePlans(this.globalData.state, core.todayIso());
      if (result.changed) {
        this.globalData.state = result.state;
        this.saveState();
      }
      if (result.summary.executed.length || result.summary.pending.length || result.summary.legacy.length) {
        this.globalData.planRunSummary = result.summary;
      } else if (this.globalData.planRunSummary?.date !== result.summary.date) {
        this.globalData.planRunSummary = null;
      }
      return result.summary;
    } catch (error) {
      this.globalData.storageError = `计划自动处理失败：${error.message}`;
      return null;
    }
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

  storageAdapter() {
    return {
      get: (key) => wx.getStorageSync(key),
      set: (key, value) => wx.setStorageSync(key, value),
      remove: (key) => wx.removeStorageSync(key),
    };
  },

  applyRestoredState(state) {
    this.globalData.state = state;
    this.globalData.storageError = null;
    this.globalData.planRunSummary = null;
  },
});
