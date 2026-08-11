const core = require('../../lib/application.js');

function requestId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function optionValues(field) {
  return (field.options || []).map((item) => item.value);
}

function formFromFields(fields) {
  return fields.reduce((result, field) => ({ ...result, [field.key]: field.value }), {});
}

function yuan(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
}

Page({
  data: {
    logicalTransactionId: '',
    model: null,
    mode: 'view',
    form: {},
    refundForm: { amountYuan: '', date: '', destinationAccountId: '', note: '' },
    refundAccountIndex: 0,
    refundAccountLabels: [],
    historyExpanded: false,
    busy: false,
    dirty: false,
    error: '',
    selectedRefundLogicalId: '',
  },

  onLoad(options = {}) {
    const logicalTransactionId = decodeURIComponent(options.id || '');
    this.setData({
      logicalTransactionId,
      mode: options.mode || 'view',
      selectedRefundLogicalId: options.refundId || '',
    });
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const app = getApp();
    if (!app.globalData.state) {
      this.setData({ error: '账本尚未完成首次设置' });
      return;
    }
    try {
      const model = core.getTransactionDetailModel(app.globalData.state, this.data.logicalTransactionId);
      const requestedMode = this.data.mode;
      const allowed = requestedMode === 'view'
        || (requestedMode === 'modify' && model.actions.modify)
        || (requestedMode === 'refund' && model.actions.refund)
        || (requestedMode === 'revoke' && model.actions.revoke)
        || (requestedMode === 'revoke-refund' && model.actions.revoke);
      const mode = allowed ? requestedMode : 'view';
      const fields = model.editableFields || [];
      const accountOptions = model.refundAccountOptions || [];
      const originalAccountIndex = Math.max(0, accountOptions.findIndex((item) => item.value === model.accountId));
      const selectedRefund = model.refunds.find((item) => item.logicalTransactionId === this.data.selectedRefundLogicalId);
      this.setData({
        model,
        mode,
        form: formFromFields(fields),
        refundAccountIndex: originalAccountIndex,
        refundAccountLabels: accountOptions.map((item) => item.label),
        refundForm: {
          amountYuan: yuan(model.remainingRefundableCents),
          date: core.todayIso(),
          destinationAccountId: accountOptions[originalAccountIndex]?.value || '',
          note: '',
        },
        selectedRefundLogicalId: selectedRefund?.logicalTransactionId || this.data.selectedRefundLogicalId || '',
        error: allowed ? (app.globalData.storageError || '') : '该操作当前不可用',
      });
    } catch (error) {
      this.setData({ model: null, error: error.message });
    }
  },

  setDirty(dirty) {
    this.setData({ dirty });
    if (dirty && typeof wx.enableAlertBeforeUnload === 'function') {
      wx.enableAlertBeforeUnload({ message: '放弃本次修改？' });
    } else if (!dirty && typeof wx.disableAlertBeforeUnload === 'function') {
      wx.disableAlertBeforeUnload();
    }
  },

  onUnload() {
    if (typeof wx.disableAlertBeforeUnload === 'function') wx.disableAlertBeforeUnload();
  },

  startAction(event) {
    const mode = event.currentTarget.dataset.mode;
    if (!mode || !this.data.model?.actions?.[mode]) return;
    this.setData({ mode, error: '', dirty: false });
  },

  showHistory() {
    this.setData({ historyExpanded: !this.data.historyExpanded });
  },

  onEditInput(event) {
    const key = event.currentTarget.dataset.key;
    this.setData({ [`form.${key}`]: event.detail.value });
    this.setDirty(true);
  },

  onEditDateChange(event) {
    this.setData({ 'form.date': event.detail.value });
    this.setDirty(true);
  },

  onEditPickerChange(event) {
    const key = event.currentTarget.dataset.key;
    const index = Number(event.detail.value);
    const field = (this.data.model?.editableFields || []).find((item) => item.key === key);
    const values = optionValues(field || {});
    this.setData({ [`form.${key}`]: values[index] || '' });
    this.setDirty(true);
  },

  onRefundInput(event) {
    const key = event.currentTarget.dataset.key;
    this.setData({ [`refundForm.${key}`]: event.detail.value });
    this.setDirty(true);
  },

  onRefundDateChange(event) {
    this.setData({ 'refundForm.date': event.detail.value });
    this.setDirty(true);
  },

  onRefundAccountChange(event) {
    const index = Number(event.detail.value);
    const option = (this.data.model?.refundAccountOptions || [])[index];
    this.setData({
      refundAccountIndex: index,
      'refundForm.destinationAccountId': option?.value || '',
    });
    this.setDirty(true);
  },

  startRefundRevoke(event) {
    const refundId = event.currentTarget.dataset.id;
    this.setData({ mode: 'revoke-refund', selectedRefundLogicalId: refundId, error: '', dirty: false });
  },

  targetLogicalId() {
    return this.data.mode === 'revoke-refund' ? this.data.selectedRefundLogicalId : this.data.logicalTransactionId;
  },

  buildStateImpactPreview(currentState, candidateState) {
    return core.buildStateImpactPreview(currentState, candidateState);
  },

  buildCandidate() {
    const app = getApp();
    const today = core.todayIso();
    const targetLogicalId = this.targetLogicalId();
    if (this.data.mode === 'modify') {
      return core.modifyTransactionEntry(app.globalData.state, {
        logicalTransactionId: targetLogicalId,
        changes: this.data.form,
        requestId: requestId('modify'),
        today,
      });
    }
    if (this.data.mode === 'refund') {
      return core.refundTransactionEntry(app.globalData.state, {
        logicalTransactionId: targetLogicalId,
        amountYuan: this.data.refundForm.amountYuan,
        date: this.data.refundForm.date,
        destinationAccountId: this.data.refundForm.destinationAccountId,
        note: this.data.refundForm.note,
        requestId: requestId('refund'),
        today,
      });
    }
    if (this.data.mode === 'revoke-refund') {
      return core.revokeRefundEntry(app.globalData.state, {
        logicalTransactionId: targetLogicalId,
        requestId: requestId('revoke-refund'),
        date: today,
        today,
      });
    }
    return core.revokeTransactionEntry(app.globalData.state, {
      logicalTransactionId: targetLogicalId,
      requestId: requestId('revoke'),
      date: today,
      today,
    });
  },

  actionTitle() {
    return {
      modify: '确认修改',
      refund: '确认退款',
      revoke: '确认撤销',
      'revoke-refund': '确认撤销退款',
    }[this.data.mode] || '';
  },

  confirmAction() {
    if (this.data.busy || this.data.mode === 'view') return;
    this.setData({ busy: true, error: '' });
    try {
      const app = getApp();
      const candidate = this.buildCandidate();
      const impact = this.buildStateImpactPreview(app.globalData.state, candidate);
      wx.showModal({
        title: this.actionTitle(),
        content: impact.summary,
        confirmText: '确认执行',
        cancelText: '再看看',
        success: (result) => {
          if (!result.confirm) {
            this.setData({ busy: false });
            return;
          }
          try {
            app.commitState(candidate);
            this.setDirty(false);
            this.setData({ busy: false });
            wx.navigateBack({ delta: 1 });
          } catch (error) {
            this.setData({ busy: false, error: error.message });
          }
        },
        fail: (error) => this.setData({ busy: false, error: error.errMsg || '确认框打开失败' }),
      });
    } catch (error) {
      this.setData({ busy: false, error: error.message });
    }
  },

  goBack() {
    if (this.data.dirty) {
      wx.showModal({
        title: '放弃本次修改？',
        content: '尚未保存的修改会丢失。',
        confirmText: '放弃',
        success: (result) => { if (result.confirm) wx.navigateBack({ delta: 1 }); },
      });
      return;
    }
    wx.navigateBack({ delta: 1 });
  },
});
