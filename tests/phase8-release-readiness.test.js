import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);

function read(relativePath) {
  return fs.readFileSync(new URL(relativePath, root), 'utf8');
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function loadSettingsPage(options = {}) {
  const calls = {
    core: [],
    save: 0,
    files: [],
  };
  const settingsModel = {
    currentBaseBudget: '¥3000.00',
    defaultBudget: '¥3000.00',
    startDay: 1,
    pendingStartDay: null,
    plans: [{ id: 'plan-1', active: true }],
    pendingPlanItems: [{ id: 'pending-1' }],
    assets: {
      totalAssets: '¥5700.00',
      totalLiabilities: '¥4020.00',
      netAssets: '¥1680.00',
      rewardBalance: '¥0.00',
      accounts: [],
    },
  };
  const core = new Proxy({
    MAX_BACKUP_BYTES: 5 * 1024 * 1024,
    todayIso: () => '2026-07-30',
    getSettingsModel: () => settingsModel,
    createBackupExport: () => ({
      filename: 'yongdu-backup-20260730-120000.json',
      content: '{}',
      sizeBytes: 2,
    }),
    createTransactionsCsvExport: () => ({
      filename: 'yongdu-transactions-20260730-120000.csv',
      content: 'id\n',
      sizeBytes: 3,
    }),
    previewStartDayChange: () => ({ mode: 'pending', explanation: '预览' }),
    ...options.core,
  }, {
    get(target, property) {
      if (property in target) {
        const value = target[property];
        if (typeof value !== 'function') return value;
        return (...args) => {
          calls.core.push(String(property));
          return value(...args);
        };
      }
      return (...args) => {
        calls.core.push(String(property));
        return args[0];
      };
    },
  });
  const dataFiles = {
    async writeGeneratedFile(file) {
      calls.files.push('writeGeneratedFile');
      return { ...file, filePath: `/wx-user/${file.filename}` };
    },
    async chooseBackupText() {
      calls.files.push('chooseBackupText');
      return { cancelled: true };
    },
    async shareFile() {
      calls.files.push('shareFile');
    },
    async copyText() {
      calls.files.push('copyText');
    },
    async removeGeneratedFiles() {
      calls.files.push('removeGeneratedFiles');
    },
    ...options.dataFiles,
  };
  const app = {
    globalData: {
      state: options.state === undefined ? { accounts: [], plans: [] } : options.state,
      storageError: null,
    },
    saveState() {
      calls.save += 1;
    },
    storageAdapter: () => ({}),
    applyRestoredState() {},
    ...options.app,
  };
  const wx = {
    showActionSheet() {},
    showModal() {},
    navigateTo() {},
    redirectTo() {},
    reLaunch() {},
    ...options.wx,
  };
  let definition;
  vm.runInNewContext(read('miniprogram/pages/settings/settings.js'), {
    module: { exports: {} },
    exports: {},
    require(request) {
      if (request.includes('application.js')) return core;
      if (request.includes('data-files.js')) return { createDataFiles: () => dataFiles };
      throw new Error(`unexpected require: ${request}`);
    },
    Page(config) {
      definition = config;
    },
    getApp: () => app,
    wx,
  }, { filename: 'settings.js' });
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(update) {
      Object.assign(this.data, update);
    },
  };
  page._dataFiles = dataFiles;
  return { page, calls, app, core, settingsModel };
}

test('initialized settings defaults to the budget section and exposes four summary values', () => {
  const { page } = loadSettingsPage();
  assert.equal(page.data.expandedSection, 'budget');
  assert.deepEqual(
    [page.data.budgetSummary, page.data.planSummary, page.data.assetSummary, page.data.dataSummary],
    ['', '', '', '数据仅存本机'],
  );
});

test('section title opens a collapsed section through the real page handler', () => {
  const { page } = loadSettingsPage();
  page.data.expandedSection = '';
  page.toggleSection({ currentTarget: { dataset: { section: 'plan' } } });
  assert.equal(page.data.expandedSection, 'plan');
});

test('clicking the expanded section title collapses all sections', () => {
  const { page } = loadSettingsPage();
  page.toggleSection({ currentTarget: { dataset: { section: 'budget' } } });
  assert.equal(page.data.expandedSection, '');
});

test('switching sections keeps only one open and never saves or invokes business functions', () => {
  const { page, calls } = loadSettingsPage();
  page.toggleSection({ currentTarget: { dataset: { section: 'plan' } } });
  page.toggleSection({ currentTarget: { dataset: { section: 'assets' } } });
  assert.equal(page.data.expandedSection, 'assets');
  assert.equal(calls.save, 0);
  assert.deepEqual(calls.core, []);
});

test('refresh derives all four section summaries from the real settings model', () => {
  const { page } = loadSettingsPage();
  page.refreshAssetCenter();
  assert.equal(page.data.budgetSummary, '¥3000.00 · 每月 1 日');
  assert.equal(page.data.planSummary, '1 个启用计划 · 1 项待处理');
  assert.equal(page.data.assetSummary, '资产 ¥5700.00 · 负债 ¥4020.00 · 净资产 ¥1680.00');
  assert.equal(page.data.dataSummary, '数据仅存本机');
});

test('asset operation error opens the asset section and places feedback there', () => {
  const { page } = loadSettingsPage({
    core: { addAssetAccount: () => { throw new Error('账户名称过长'); } },
  });
  page.data.expandedSection = 'budget';
  page.addAssetAccount();
  assert.equal(page.data.expandedSection, 'assets');
  assert.equal(page.data.feedbackSection, 'assets');
  assert.equal(page.data.error, '账户名称过长');
});

test('plan form error opens the plan section through the real submit handler', () => {
  const { page } = loadSettingsPage();
  page.data.expandedSection = 'budget';
  page.data.planSourceAccounts = [];
  page.submitScheduledPlan();
  assert.equal(page.data.expandedSection, 'plan');
  assert.equal(page.data.feedbackSection, 'plan');
  assert.match(page.data.error, /资金账户/);
});

test('budget preview error opens the budget section through the real preview handler', () => {
  const { page } = loadSettingsPage({
    core: { previewStartDayChange: () => { throw new Error('日期无效'); } },
  });
  page.data.expandedSection = 'data';
  page.previewStartDayChange();
  assert.equal(page.data.expandedSection, 'budget');
  assert.equal(page.data.feedbackSection, 'budget');
  assert.equal(page.data.error, '日期无效');
});

test('backup generation busy lock accepts one trigger and releases after success', async () => {
  const pending = deferred();
  let writes = 0;
  const { page } = loadSettingsPage({
    dataFiles: {
      writeGeneratedFile(file) {
        writes += 1;
        return pending.promise.then(() => ({ ...file, filePath: `/wx-user/${file.filename}` }));
      },
    },
  });
  const first = page.exportBackup();
  const second = page.exportBackup();
  await Promise.resolve();
  assert.equal(writes, 1);
  assert.equal(page.data.busyAction, 'export-backup');
  pending.resolve();
  await Promise.all([first, second]);
  assert.equal(page.data.busyAction, '');
});

test('file selection busy lock accepts one trigger and preserves input after failure', async () => {
  const pending = deferred();
  let selections = 0;
  const { page } = loadSettingsPage({
    dataFiles: {
      chooseBackupText() {
        selections += 1;
        return pending.promise;
      },
    },
  });
  page.data.pastedBackupText = '保留输入';
  page.data.backupPreview = { fileName: '保留预览' };
  const first = page.chooseBackupFile();
  const second = page.chooseBackupFile();
  await Promise.resolve();
  assert.equal(selections, 1);
  pending.reject(new Error('选择失败'));
  await Promise.all([first, second]);
  assert.equal(page.data.busyAction, '');
  assert.equal(page.data.pastedBackupText, '保留输入');
  assert.deepEqual(page.data.backupPreview, { fileName: '保留预览' });
  assert.equal(page.data.expandedSection, 'data');
});

test('editing a plan automatically opens the plan section without saving', () => {
  const { page, calls, app } = loadSettingsPage({
    state: {
      accounts: [{ id: 'cash', type: 'cash', name: '现金' }],
      plans: [{ id: 'p1', type: 'fixed_expense', name: '房租', accountId: 'cash', reminderDays: [1, 0] }],
    },
  });
  app.globalData.state = {
    accounts: [{ id: 'cash', type: 'cash', name: '现金' }],
    plans: [{ id: 'p1', type: 'fixed_expense', name: '房租', accountId: 'cash', reminderDays: [1, 0] }],
  };
  page.editScheduledPlan({ currentTarget: { dataset: { id: 'p1' } } });
  assert.equal(page.data.expandedSection, 'plan');
  assert.equal(calls.save, 0);
});

test('backup preview automatically opens data section and removes raw pasted text', () => {
  const { page } = loadSettingsPage({
    core: {
      previewBackupRestore: () => ({
        ok: true,
        candidate: { safe: true },
        preview: {
          sizeBytes: 2,
          fileName: 'backup.json',
        },
      }),
    },
  });
  page.data.pastedBackupText = '{}';
  page.previewBackupText('{}', { fileName: 'backup.json' });
  assert.equal(page.data.expandedSection, 'data');
  assert.equal(page.data.pastedBackupText, '');
  assert.equal(page.data.backupPreview.fileName, 'backup.json');
});

test('settings markup has four initialized accordion sections with real summaries', () => {
  const wxml = read('miniprogram/pages/settings/settings.wxml');
  for (const title of ['预算与周期', '计划提醒', '资产账户', '数据与隐私']) assert.ok(wxml.includes(title));
  for (const summary of ['budgetSummary', 'planSummary', 'assetSummary', 'dataSummary']) assert.ok(wxml.includes(summary));
  assert.match(wxml, /expandedSection === 'budget'/);
  assert.match(wxml, /expandedSection === 'plan'/);
  assert.match(wxml, /expandedSection === 'assets'/);
  assert.match(wxml, /expandedSection === 'data'/);
});

test('empty account plan and bill states explain a real next step without demo data', () => {
  const settings = read('miniprogram/pages/settings/settings.wxml');
  const home = read('miniprogram/pages/home/home.wxml');
  const entry = read('miniprogram/pages/entry/entry.wxml');
  const bills = read('miniprogram/pages/bills/bills.wxml');
  assert.match(settings, /暂无账户.*添加/);
  assert.match(settings, /暂无计划.*创建/);
  assert.match(home, /暂无计划提醒或待处理项.*设置/);
  assert.match(entry, /暂无可用账户.*设置/);
  assert.match(bills, /没有.*先.*记/);
  for (const source of [settings, home, entry, bills]) assert.doesNotMatch(source, /演示数据|示例账单/);
});

test('global and page styles protect safe area small screens buttons and horizontal width', () => {
  const styles = [
    read('miniprogram/app.wxss'),
    read('miniprogram/pages/settings/settings.wxss'),
    read('miniprogram/pages/home/home.wxss'),
    read('miniprogram/pages/entry/entry.wxss'),
    read('miniprogram/pages/bills/bills.wxss'),
  ].join('\n');
  assert.match(styles, /env\(safe-area-inset-bottom\)/);
  assert.match(styles, /@media\s*\(max-width:\s*320px\)/);
  assert.match(styles, /min-height:\s*88rpx/);
  assert.match(styles, /overflow-x:\s*hidden/);
  assert.match(styles, /flex-direction:\s*column/);
  assert.match(styles, /overflow-wrap:\s*anywhere/);
});

test('README and product spec describe current capabilities and exclude only unbuilt features', () => {
  const readme = read('README.md');
  const spec = read('docs/PRODUCT_SPEC.md');
  const checklist = read('docs/PHASE8_RELEASE_CHECKLIST.md');
  for (const source of [readme, spec]) {
    assert.doesNotMatch(source, /不包含小程序界面/);
    assert.doesNotMatch(source, /不提供[^。]*图表或真实提醒/);
    for (const capability of ['动态累计预算', '六类账户', '小程序内提醒', '三张分析图', 'JSON', 'CSV']) assert.ok(source.includes(capability));
    for (const exclusion of ['AI分析', '云同步', '行情', '汇率', '会员', '后台定时通知']) assert.ok(source.includes(exclusion));
  }
  for (const path of ['首次设置', '支出、收入与转账', '预算结算', '资产、债务与投资', '计划提醒与待处理', '两种分析口径', '备份预检与取消', '关闭并重开持久化']) {
    assert.ok(checklist.includes(path));
  }
  assert.match(checklist, /恢复成功路径：只由自动化测试覆盖/);
  assert.match(checklist, /清除成功路径：只由自动化测试覆盖/);
});
