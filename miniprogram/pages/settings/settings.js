const core = require('../../lib/application.js');
const { createDataFiles } = require('../../utils/data-files.js');

const OPERATION_LABELS = ['信用卡还款', '借款', '归还本金', '支付利息', '投资买入', '投资卖出', '手工估值'];
const BUDGET_SCOPE_LABELS = ['仅本周期', '本周期及以后', '下周期及以后'];
const BUDGET_SCOPE_VALUES = ['only_current', 'current_and_future', 'next_and_future'];

Page({
  data: {
    initialized: false,
    monthlyBudgetYuan: '3000',
    startDay: '1',
    accountTypes: ['现金', '储蓄卡', '电子钱包'],
    accountTypeValues: ['cash', 'bank', 'wallet'],
    accounts: [{ name: '现金', typeIndex: 0, balanceYuan: '0' }],
    settings: null,
    assets: null,
    budgetEditYuan: '',
    budgetScopeLabels: BUDGET_SCOPE_LABELS,
    startDayEdit: '',
    startDayPreview: null,
    allAccountTypeLabels: ['现金', '储蓄卡', '电子钱包', '信用卡', '借贷', '投资'],
    allAccountTypeValues: ['cash', 'bank', 'wallet', 'credit_card', 'loan', 'investment'],
    newAccountName: '',
    newAccountTypeIndex: 0,
    newAccountBalanceYuan: '0',
    newAccountCostBasisYuan: '0',
    operationLabels: OPERATION_LABELS,
    operationIndex: 0,
    operationAmountYuan: '',
    sourceAccounts: [],
    targetAccounts: [],
    sourceIndex: 0,
    targetIndex: 0,
    operationNeedsSource: true,
    operationValueLabel: '金额',
    planTypeLabels: ['固定支出', '信用卡还款', '贷款还款'],
    planTypeValues: ['fixed_expense', 'credit_card_repayment', 'loan_repayment'],
    planTypeIndex: 0,
    planRecurrenceLabels: ['单次', '每月', '每年'],
    planRecurrenceValues: ['one_time', 'monthly', 'yearly'],
    planRecurrenceIndex: 1,
    planEditId: '',
    planName: '',
    planAmountYuan: '',
    planPrincipalYuan: '',
    planInterestYuan: '',
    planNextDueDate: '',
    planReminderEnabled: false,
    planReminderDays: ['1', '0'],
    planReminder3Checked: false,
    planReminder1Checked: true,
    planReminder0Checked: true,
    planSourceAccounts: [],
    planTargetAccounts: [],
    planSourceIndex: 0,
    planTargetIndex: 0,
    error: '',
    notice: '',
    backupPreview: null,
    restorePhrase: '',
    clearPhrase: '',
    pastedBackupText: '',
    generatedFileName: '',
    generatedFileSize: '',
    generatedFileKind: '',
    generatedFileType: '',
    canShareGeneratedFile: false,
    canCopyGeneratedText: false,
    expandedSection: 'budget',
    feedbackSection: 'budget',
    budgetSummary: '',
    planSummary: '',
    assetSummary: '',
    dataSummary: '数据仅存本机',
    busyAction: '',
  },

  onShow() {
    const app = getApp();
    if (app.globalData.storageError) this.showSectionFeedback('data', { error: app.globalData.storageError });
    if (app.globalData.state) {
      this.setData({ initialized: true });
      this.refreshAssetCenter();
    }
  },

  toggleSection(event) {
    const section = event.currentTarget.dataset.section;
    this.setData({
      expandedSection: this.data.expandedSection === section ? '' : section,
    });
  },

  showSectionFeedback(section, { error = '', notice = '' }) {
    this.setData({
      expandedSection: section,
      feedbackSection: section,
      error,
      notice,
    });
  },

  startBusy(action, section) {
    if (this.data.busyAction) return false;
    this.setData({ busyAction: action, expandedSection: section });
    return true;
  },

  finishBusy(action) {
    if (this.data.busyAction === action) this.setData({ busyAction: '' });
  },

  refreshAssetCenter() {
    const state = getApp().globalData.state;
    const settings = core.getSettingsModel(state, core.todayIso());
    const activePlanCount = settings.plans.filter((item) => item.active).length;
    const pendingPlanCount = settings.pendingPlanItems.length;
    this.setData({
      settings,
      assets: settings.assets,
      budgetEditYuan: this.data.budgetEditYuan || String(settings.defaultBudgetCents / 100),
      startDayEdit: this.data.startDayEdit || String(settings.pendingStartDay || settings.startDay),
      budgetSummary: `${settings.currentBaseBudget} · 每月 ${settings.startDay} 日`,
      planSummary: `${activePlanCount} 个启用计划 · ${pendingPlanCount} 项待处理`,
      assetSummary: `资产 ${settings.assets.totalAssets} · 负债 ${settings.assets.totalLiabilities} · 净资产 ${settings.assets.netAssets}`,
      dataSummary: '数据仅存本机',
      error: '',
    });
    this.refreshOperationAccounts(this.data.operationIndex);
    this.refreshPlanAccounts(this.data.planTypeIndex);
  },

  refreshPlanAccounts(planTypeIndex) {
    const accounts = getApp().globalData.state.accounts;
    const liquid = accounts.filter((item) => ['cash', 'bank', 'wallet'].includes(item.type));
    const targetType = planTypeIndex === 1 ? 'credit_card' : (planTypeIndex === 2 ? 'loan' : null);
    this.setData({
      planSourceAccounts: liquid,
      planTargetAccounts: targetType ? accounts.filter((item) => item.type === targetType) : [],
      planSourceIndex: 0,
      planTargetIndex: 0,
    });
  },

  refreshOperationAccounts(operationIndex) {
    const accounts = getApp().globalData.state.accounts;
    const liquid = accounts.filter((item) => ['cash', 'bank', 'wallet'].includes(item.type));
    const cards = accounts.filter((item) => item.type === 'credit_card');
    const loans = accounts.filter((item) => item.type === 'loan');
    const investments = accounts.filter((item) => item.type === 'investment');
    const configs = [
      { source: liquid, target: cards, needsSource: true, valueLabel: '还款金额' },
      { source: liquid, target: loans, needsSource: true, valueLabel: '借款金额' },
      { source: liquid, target: loans, needsSource: true, valueLabel: '还本金额' },
      { source: liquid, target: loans, needsSource: true, valueLabel: '利息金额' },
      { source: liquid, target: investments, needsSource: true, valueLabel: '买入金额' },
      { source: liquid, target: investments, needsSource: true, valueLabel: '卖出金额' },
      { source: [], target: investments, needsSource: false, valueLabel: '当前现值' },
    ];
    const config = configs[operationIndex];
    this.setData({
      sourceAccounts: config.source,
      targetAccounts: config.target,
      sourceIndex: 0,
      targetIndex: 0,
      operationNeedsSource: config.needsSource,
      operationValueLabel: config.valueLabel,
    });
  },

  onBudgetInput(event) { this.setData({ monthlyBudgetYuan: event.detail.value }); },
  onStartDayInput(event) { this.setData({ startDay: event.detail.value }); },
  onBudgetEditInput(event) { this.setData({ budgetEditYuan: event.detail.value }); },
  chooseBudgetScope() {
    wx.showActionSheet({
      itemList: BUDGET_SCOPE_LABELS,
      success: ({ tapIndex }) => {
        const scope = BUDGET_SCOPE_VALUES[tapIndex];
        const label = BUDGET_SCOPE_LABELS[tapIndex];
        if (this.data.settings.needsSettlement && scope !== 'next_and_future') {
          this.showSectionFeedback('budget', { error: '本期待结算，只能修改下周期及以后的默认预算' });
          return;
        }
        wx.showModal({
          title: '确认修改预算',
          content: `新预算 ${this.data.budgetEditYuan || '未填写'} 元，范围：${label}。历史流水和已发生消费不会改变。`,
          confirmText: '确认修改',
          success: ({ confirm }) => {
            if (!confirm) return;
            try {
              const app = getApp();
              app.globalData.state = core.changeBudgetSettings(app.globalData.state, {
                newBudgetYuan: this.data.budgetEditYuan,
                scope,
                date: core.todayIso(),
              });
              app.saveState();
              this.showSectionFeedback('budget', { notice: `预算已按“${label}”更新` });
              this.refreshAssetCenter();
            } catch (error) {
              this.showSectionFeedback('budget', { error: error.message });
            }
          },
        });
      },
    });
  },
  onStartDayEditInput(event) {
    this.setData({ startDayEdit: event.detail.value, startDayPreview: null });
  },
  previewStartDayChange() {
    try {
      const preview = core.previewStartDayChange(getApp().globalData.state, {
        newStartDay: Number(this.data.startDayEdit),
        date: core.todayIso(),
      });
      this.setData({ startDayPreview: preview });
      this.showSectionFeedback('budget', {});
    } catch (error) {
      this.setData({ startDayPreview: null });
      this.showSectionFeedback('budget', { error: error.message });
    }
  },
  confirmStartDayChange() {
    const preview = this.data.startDayPreview;
    if (!preview) {
      this.showSectionFeedback('budget', { error: '请先预览起始日变更' });
      return;
    }
    wx.showModal({
      title: preview.mode === 'immediate' ? '确认立即调整' : '确认待生效规则',
      content: `${preview.explanation}。历史账单不会移动。`,
      confirmText: '确认设置',
      success: ({ confirm }) => {
        if (!confirm) return;
        try {
          const app = getApp();
          app.globalData.state = core.changeStartDay(app.globalData.state, {
            newStartDay: Number(this.data.startDayEdit),
            date: core.todayIso(),
          });
          app.saveState();
          this.setData({ startDayPreview: null });
          this.showSectionFeedback('budget', { notice: preview.mode === 'immediate' ? '空周期已立即调整' : '待生效起始日已保存' });
          this.refreshAssetCenter();
        } catch (error) {
          this.showSectionFeedback('budget', { error: error.message });
        }
      },
    });
  },
  cancelPendingStartDayChange() {
    wx.showModal({
      title: '取消待生效规则',
      content: '取消后继续沿用当前周期起始日，历史账单不受影响。',
      confirmText: '确认取消',
      success: ({ confirm }) => {
        if (!confirm) return;
        try {
          const app = getApp();
          app.globalData.state = core.cancelPendingStartDayChange(app.globalData.state, { date: core.todayIso() });
          app.saveState();
          this.setData({ startDayPreview: null, startDayEdit: String(app.globalData.state.appSettings.startDay) });
          this.showSectionFeedback('budget', { notice: '待生效起始日已取消' });
          this.refreshAssetCenter();
        } catch (error) {
          this.showSectionFeedback('budget', { error: error.message });
        }
      },
    });
  },
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
  addInitialAccount() {
    const accounts = this.data.accounts.concat([{ name: `账户${this.data.accounts.length + 1}`, typeIndex: 1, balanceYuan: '0' }]);
    this.setData({ accounts });
  },
  removeAccount(event) {
    if (this.data.accounts.length === 1) return;
    const accounts = this.data.accounts.slice();
    accounts.splice(Number(event.currentTarget.dataset.index), 1);
    this.setData({ accounts });
  },
  onNewAccountNameInput(event) { this.setData({ newAccountName: event.detail.value }); },
  onNewAccountTypeChange(event) { this.setData({ newAccountTypeIndex: Number(event.detail.value) }); },
  onNewAccountBalanceInput(event) { this.setData({ newAccountBalanceYuan: event.detail.value }); },
  onNewAccountCostInput(event) { this.setData({ newAccountCostBasisYuan: event.detail.value }); },
  addAssetAccount() {
    try {
      const app = getApp();
      app.globalData.state = core.addAssetAccount(app.globalData.state, {
        name: this.data.newAccountName,
        type: this.data.allAccountTypeValues[this.data.newAccountTypeIndex],
        balanceYuan: this.data.newAccountBalanceYuan,
        costBasisYuan: this.data.newAccountCostBasisYuan,
      });
      app.saveState();
      this.setData({
        newAccountName: '',
        newAccountBalanceYuan: '0',
        newAccountCostBasisYuan: '0',
      });
      this.showSectionFeedback('assets', { notice: '账户已添加' });
      this.refreshAssetCenter();
    } catch (error) {
      this.showSectionFeedback('assets', { error: error.message });
    }
  },
  onOperationChange(event) {
    const operationIndex = Number(event.detail.value);
    this.setData({ operationIndex, operationAmountYuan: '', notice: '', error: '' });
    this.refreshOperationAccounts(operationIndex);
  },
  onOperationAmountInput(event) { this.setData({ operationAmountYuan: event.detail.value }); },
  onSourceChange(event) { this.setData({ sourceIndex: Number(event.detail.value) }); },
  onTargetChange(event) { this.setData({ targetIndex: Number(event.detail.value) }); },
  performOperation() {
    try {
      const app = getApp();
      const state = app.globalData.state;
      const source = this.data.sourceAccounts[this.data.sourceIndex];
      const target = this.data.targetAccounts[this.data.targetIndex];
      if (!target || (this.data.operationNeedsSource && !source)) throw new Error('请先创建对应的账户');
      const common = { amountYuan: this.data.operationAmountYuan, date: core.todayIso() };
      const operations = [
        () => core.repayCreditCard(state, { ...common, fromAccountId: source.id, creditCardAccountId: target.id }),
        () => core.borrowLoan(state, { ...common, cashAccountId: source.id, loanAccountId: target.id }),
        () => core.repayLoanPrincipal(state, { ...common, cashAccountId: source.id, loanAccountId: target.id }),
        () => core.payLoanInterest(state, { ...common, cashAccountId: source.id, loanAccountId: target.id }),
        () => core.buyInvestment(state, { ...common, cashAccountId: source.id, investmentAccountId: target.id }),
        () => core.sellInvestment(state, { ...common, cashAccountId: source.id, investmentAccountId: target.id }),
        () => core.updateInvestmentValue(state, { currentValueYuan: this.data.operationAmountYuan, date: common.date, investmentAccountId: target.id }),
      ];
      app.globalData.state = operations[this.data.operationIndex]();
      app.saveState();
      this.setData({ operationAmountYuan: '' });
      this.showSectionFeedback('assets', { notice: `${OPERATION_LABELS[this.data.operationIndex]}已记录` });
      this.refreshAssetCenter();
    } catch (error) {
      this.showSectionFeedback('assets', { error: error.message });
    }
  },
  onPlanTypeChange(event) {
    const planTypeIndex = Number(event.detail.value);
    this.setData({ planTypeIndex });
    this.refreshPlanAccounts(planTypeIndex);
  },
  onPlanRecurrenceChange(event) { this.setData({ planRecurrenceIndex: Number(event.detail.value) }); },
  onPlanSourceChange(event) { this.setData({ planSourceIndex: Number(event.detail.value) }); },
  onPlanTargetChange(event) { this.setData({ planTargetIndex: Number(event.detail.value) }); },
  onPlanNameInput(event) { this.setData({ planName: event.detail.value }); },
  onPlanAmountInput(event) { this.setData({ planAmountYuan: event.detail.value }); },
  onPlanPrincipalInput(event) { this.setData({ planPrincipalYuan: event.detail.value }); },
  onPlanInterestInput(event) { this.setData({ planInterestYuan: event.detail.value }); },
  onPlanDueDateInput(event) { this.setData({ planNextDueDate: event.detail.value }); },
  onPlanReminderChange(event) { this.setData({ planReminderEnabled: event.detail.value }); },
  onPlanReminderDaysChange(event) {
    const planReminderDays = event.detail.value;
    this.setData({
      planReminderDays,
      planReminder3Checked: planReminderDays.includes('3'),
      planReminder1Checked: planReminderDays.includes('1'),
      planReminder0Checked: planReminderDays.includes('0'),
    });
  },
  resetPlanForm() {
    this.setData({
      planEditId: '',
      planName: '',
      planTypeIndex: 0,
      planAmountYuan: '',
      planPrincipalYuan: '',
      planInterestYuan: '',
      planNextDueDate: '',
      planRecurrenceIndex: 1,
      planReminderEnabled: false,
      planReminderDays: ['1', '0'],
      planReminder3Checked: false,
      planReminder1Checked: true,
      planReminder0Checked: true,
    });
    this.refreshPlanAccounts(0);
  },
  submitScheduledPlan() {
    try {
      const app = getApp();
      const source = this.data.planSourceAccounts[this.data.planSourceIndex];
      const target = this.data.planTargetAccounts[this.data.planTargetIndex];
      const type = this.data.planTypeValues[this.data.planTypeIndex];
      if (!source) throw new Error('请先创建可用的资金账户');
      if (type !== 'fixed_expense' && !target) throw new Error('请先创建对应的负债账户');
      const details = {
        name: this.data.planName,
        type,
        accountId: source.id,
        targetLiabilityAccountId: target?.id || null,
        amountYuan: this.data.planAmountYuan,
        principalYuan: this.data.planPrincipalYuan,
        interestYuan: this.data.planInterestYuan,
        categoryLevel1: type === 'fixed_expense' ? '固定支出' : (type === 'credit_card_repayment' ? '信用卡还款' : '贷款还款'),
        recurrence: this.data.planRecurrenceValues[this.data.planRecurrenceIndex],
        nextDueDate: this.data.planNextDueDate,
        reminderEnabled: this.data.planReminderEnabled,
        reminderDays: this.data.planReminderDays.map(Number),
      };
      app.globalData.state = this.data.planEditId
        ? core.editScheduledPlan(app.globalData.state, { planId: this.data.planEditId, ...details })
        : core.createScheduledPlan(app.globalData.state, details);
      app.saveState();
      this.showSectionFeedback('plan', { notice: this.data.planEditId ? '未来计划已更新，历史流水未改变' : '计划已创建' });
      this.resetPlanForm();
      this.refreshAssetCenter();
    } catch (error) {
      this.showSectionFeedback('plan', { error: error.message });
    }
  },
  editScheduledPlan(event) {
    const plan = getApp().globalData.state.plans.find((item) => item.id === event.currentTarget.dataset.id);
    if (!plan) return;
    const planTypeIndex = Math.max(0, this.data.planTypeValues.indexOf(plan.type || 'fixed_expense'));
    this.setData({
      planEditId: plan.id,
      planName: plan.name || '',
      planTypeIndex,
      planAmountYuan: plan.amountCents === null || plan.amountCents === undefined ? '' : String(plan.amountCents / 100),
      planPrincipalYuan: plan.principalCents === null || plan.principalCents === undefined ? '' : String(plan.principalCents / 100),
      planInterestYuan: plan.interestCents === null || plan.interestCents === undefined ? '' : String(plan.interestCents / 100),
      planNextDueDate: plan.nextDueDate || '',
      planRecurrenceIndex: Math.max(0, this.data.planRecurrenceValues.indexOf(plan.recurrence || 'one_time')),
      planReminderEnabled: Boolean(plan.reminderEnabled),
      planReminderDays: (plan.reminderDays || [1, 0]).map(String),
      planReminder3Checked: (plan.reminderDays || [1, 0]).includes(3),
      planReminder1Checked: (plan.reminderDays || [1, 0]).includes(1),
      planReminder0Checked: (plan.reminderDays || [1, 0]).includes(0),
      expandedSection: 'plan',
      feedbackSection: 'plan',
      notice: '正在编辑未来计划',
      error: '',
    });
    this.refreshPlanAccounts(planTypeIndex);
    const sourceIndex = this.data.planSourceAccounts.findIndex((item) => item.id === plan.accountId);
    const targetIndex = this.data.planTargetAccounts.findIndex((item) => item.id === plan.targetLiabilityAccountId);
    this.setData({ planSourceIndex: Math.max(0, sourceIndex), planTargetIndex: Math.max(0, targetIndex) });
  },
  disableScheduledPlan(event) {
    const planId = event.currentTarget.dataset.id;
    wx.showModal({
      title: '停用计划',
      content: '停用只影响未来发生期，已经执行的流水不会改变。',
      confirmText: '确认停用',
      success: ({ confirm }) => {
        if (!confirm) return;
        try {
          const app = getApp();
          app.globalData.state = core.disableScheduledPlan(app.globalData.state, planId);
          app.saveState();
          this.showSectionFeedback('plan', { notice: '计划已停用' });
          this.refreshAssetCenter();
        } catch (error) {
          this.showSectionFeedback('plan', { error: error.message });
        }
      },
    });
  },
  dataFiles() {
    if (!this._dataFiles) this._dataFiles = createDataFiles(wx);
    return this._dataFiles;
  },
  formatFileSize(sizeBytes) {
    return sizeBytes < 1024 ? `${sizeBytes} B` : `${(sizeBytes / 1024).toFixed(1)} KiB`;
  },
  async exportData(kind) {
    const action = kind === 'backup' ? 'export-backup' : 'export-csv';
    if (!this.startBusy(action, 'data')) return false;
    let generated = null;
    try {
      const state = getApp().globalData.state;
      if (!state) throw new Error('当前没有可导出的账本');
      generated = kind === 'backup'
        ? core.createBackupExport(state)
        : core.createTransactionsCsvExport(state);
      this._generatedFile = generated;
      const file = await this.dataFiles().writeGeneratedFile(generated);
      this._generatedFile = file;
      this.setData({
        generatedFileName: file.filename,
        generatedFileSize: this.formatFileSize(file.sizeBytes),
        generatedFileKind: kind === 'backup' ? 'JSON 完整备份，可用于恢复' : 'CSV 账单，仅供查看，不能恢复',
        generatedFileType: kind,
        canShareGeneratedFile: true,
        canCopyGeneratedText: true,
      });
      this.showSectionFeedback('data', { notice: `已生成 ${file.filename}，仅在你主动操作时分享或复制` });
    } catch (error) {
      this.setData({
        canShareGeneratedFile: false,
        canCopyGeneratedText: Boolean(generated?.content),
        generatedFileName: generated ? `${generated.filename}（未写入文件）` : '',
        generatedFileSize: generated ? this.formatFileSize(generated.sizeBytes) : '',
        generatedFileKind: generated ? (kind === 'backup' ? 'JSON 完整备份，可复制后保存并用于恢复' : 'CSV 账单，可复制后保存，仅供查看') : '',
        generatedFileType: generated ? kind : '',
      });
      this.showSectionFeedback('data', { error: `${error.message}；如平台不支持文件，可使用下方手动复制` });
    } finally {
      this.finishBusy(action);
    }
    return true;
  },
  exportBackup() { return this.exportData('backup'); },
  exportCsv() { return this.exportData('csv'); },
  async shareGeneratedFile() {
    if (!this.startBusy('share-file', 'data')) return false;
    if (!this._generatedFile?.filePath) {
      this.showSectionFeedback('data', { error: '请先生成文件' });
      this.finishBusy('share-file');
      return false;
    }
    try {
      await this.dataFiles().shareFile(this._generatedFile.filePath);
      this.showSectionFeedback('data', { notice: '已交给微信分享面板；是否发送由你决定' });
    } catch (error) {
      this.showSectionFeedback('data', { error: `${error.message}；可改用手动复制` });
    } finally {
      this.finishBusy('share-file');
    }
    return true;
  },
  async copyGeneratedText() {
    if (!this.startBusy('copy-file', 'data')) return false;
    if (!this._generatedFile?.content) {
      this.showSectionFeedback('data', { error: '请先生成 JSON 或 CSV' });
      this.finishBusy('copy-file');
      return false;
    }
    try {
      await this.dataFiles().copyText(this._generatedFile.content);
      this.showSectionFeedback('data', { notice: '已按你的操作复制内容，请自行选择存放位置' });
    } catch (error) {
      this.showSectionFeedback('data', { error: error.message });
    } finally {
      this.finishBusy('copy-file');
    }
    return true;
  },
  onPastedBackupInput(event) {
    this.setData({ pastedBackupText: event.detail.value, backupPreview: null, restorePhrase: '' });
    this._restoreCandidate = null;
  },
  previewBackupText(text, metadata) {
    const result = core.previewBackupRestore(text, metadata);
    if (!result.ok) {
      this._restoreCandidate = null;
      this.setData({ backupPreview: null });
      this.showSectionFeedback('data', { error: result.error });
      return;
    }
    this._restoreCandidate = result.candidate;
    this.setData({
      backupPreview: {
        ...result.preview,
        displaySize: this.formatFileSize(result.preview.sizeBytes),
      },
      pastedBackupText: '',
      restorePhrase: '',
    });
    this.showSectionFeedback('data', { notice: '预检通过；尚未写入，恢复前还需输入确认词并确认弹窗' });
  },
  previewPastedBackup() {
    this.previewBackupText(this.data.pastedBackupText, { fileName: '粘贴的 JSON' });
  },
  async chooseBackupFile() {
    if (!this.startBusy('choose-backup', 'data')) return false;
    try {
      const chosen = await this.dataFiles().chooseBackupText(core.MAX_BACKUP_BYTES);
      if (chosen.cancelled) {
        this.showSectionFeedback('data', { notice: '已取消选择，现有数据未改变' });
        return true;
      }
      this.previewBackupText(chosen.text, { fileName: chosen.fileName, sizeBytes: chosen.sizeBytes });
    } catch (error) {
      this.showSectionFeedback('data', { error: error.message });
    } finally {
      this.finishBusy('choose-backup');
    }
    return true;
  },
  onRestorePhraseInput(event) { this.setData({ restorePhrase: event.detail.value }); },
  requestRestore() {
    if (!this._restoreCandidate) {
      this.showSectionFeedback('data', { error: '请先选择或粘贴 JSON 并通过预检' });
      return;
    }
    if (this.data.restorePhrase !== '恢复') {
      this.showSectionFeedback('data', { error: '请输入“恢复”后再继续' });
      return;
    }
    wx.showModal({
      title: '最终确认恢复',
      content: '恢复将替换当前本地账本。已预检的备份会经过临时写入和主数据写后读校验；取消则不做任何修改。',
      confirmText: '确认恢复',
      success: ({ confirm }) => {
        if (!confirm) {
          this.showSectionFeedback('data', { notice: '已取消恢复，现有数据未改变' });
          return;
        }
        const result = core.commitBackupRestore(getApp().storageAdapter(), this._restoreCandidate, {
          phrase: this.data.restorePhrase,
          confirmed: true,
        });
        if (!result.ok) {
          this.showSectionFeedback('data', { error: result.error });
          return;
        }
        getApp().applyRestoredState(result.state);
        this._restoreCandidate = null;
        this.setData({ pastedBackupText: '', backupPreview: null, restorePhrase: '', notice: '恢复成功', error: '' });
        wx.switchTab({ url: '/pages/home/home' });
      },
    });
  },
  onClearPhraseInput(event) { this.setData({ clearPhrase: event.detail.value }); },
  requestClearData() {
    if (this.data.clearPhrase !== '清除') {
      this.showSectionFeedback('data', { error: '请输入“清除”后再继续' });
      return;
    }
    wx.showModal({
      title: '最终确认清除',
      content: '只会清除用度主数据、恢复临时数据和本应用生成的备份/CSV 文件；其他微信存储不会被触碰。',
      confirmText: '确认清除',
      confirmColor: '#9b4d3a',
      success: async ({ confirm }) => {
        if (!confirm) {
          this.showSectionFeedback('data', { notice: '已取消清除，现有数据未改变' });
          return;
        }
        if (!this.startBusy('clear-data', 'data')) return;
        try {
          await this.dataFiles().removeGeneratedFiles();
          const result = core.clearLocalLedger(getApp().storageAdapter(), { phrase: '清除', confirmed: true });
          if (!result.ok) throw new Error(result.error);
          getApp().globalData.state = null;
          getApp().globalData.storageError = null;
          getApp().globalData.planRunSummary = null;
          wx.switchTab({ url: '/pages/settings/settings' });
        } catch (error) {
          this.showSectionFeedback('data', { error: error.message });
        } finally {
          this.finishBusy('clear-data');
        }
      },
    });
  },
  submit() {
    if (this.data.initialized) {
      wx.switchTab({ url: '/pages/home/home' });
      return;
    }
    try {
      const app = getApp();
      const accounts = this.data.accounts.map((item) => ({
        name: item.name,
        type: this.data.accountTypeValues[item.typeIndex],
        balanceYuan: item.balanceYuan,
      }));
      app.globalData.state = core.initializeState({
        monthlyBudgetYuan: this.data.monthlyBudgetYuan,
        startDay: Number(this.data.startDay),
        nowDate: core.todayIso(),
        accounts,
      });
      app.saveState();
      wx.switchTab({ url: '/pages/home/home' });
    } catch (error) {
      this.setData({ error: error.message });
    }
  },
});
