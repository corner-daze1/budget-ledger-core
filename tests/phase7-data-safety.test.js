import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {
  MAX_BACKUP_BYTES,
  RESTORE_TEMP_KEY,
  STORAGE_KEY,
  clearLocalLedger,
  commitBackupRestore,
  createBackupExport,
  createTransactionsCsvExport,
  initializeState,
  previewBackupRestore,
  recordEntry,
} from '../src/application/app-core.js';

const dataFilesSource = fs.readFileSync(new URL('../miniprogram/utils/data-files.js', import.meta.url), 'utf8');
const dataFilesModule = { exports: {} };
vm.runInNewContext(dataFilesSource, { module: dataFilesModule, exports: dataFilesModule.exports }, { filename: 'data-files.js' });
const { createDataFiles, GENERATED_FILE_PATTERN } = dataFilesModule.exports;

function stateWithData() {
  const initial = initializeState({
    monthlyBudgetYuan: '3300',
    startDay: 1,
    nowDate: '2028-01-01',
    accounts: [
      { id: 'cash', name: '现金', type: 'cash', balanceYuan: '1000' },
      { id: 'bank', name: '储蓄卡', type: 'bank', balanceYuan: '500' },
    ],
  });
  return recordEntry(initial, {
    amountYuan: '12.34',
    date: '2028-01-02',
    accountId: 'cash',
    categoryLevel1: '餐饮',
    categoryLevel2: '午餐',
    note: '含,逗号',
    includeControlledBudget: true,
  });
}

function storageWith(initial = {}) {
  const values = new Map(Object.entries(initial));
  const calls = [];
  return {
    values,
    calls,
    get(key) {
      calls.push(['get', key]);
      return values.get(key);
    },
    set(key, value) {
      calls.push(['set', key]);
      values.set(key, value);
    },
    remove(key) {
      calls.push(['remove', key]);
      values.delete(key);
    },
  };
}

function stableStorageWith(initial = {}) {
  const storage = storageWith(initial);
  const normalGet = storage.get.bind(storage);
  storage.get = (key) => {
    const value = normalGet(key);
    return value === undefined ? '' : value;
  };
  return storage;
}

function validPreview() {
  const state = stateWithData();
  const result = previewBackupRestore(JSON.stringify(state), { fileName: 'backup.json' });
  assert.equal(result.ok, true);
  return result;
}

function fakeWxBoundary(overrides = {}) {
  const calls = [];
  const files = overrides.files || [];
  const fileSystem = {
    writeFile(options) {
      calls.push(['writeFile', options.filePath, options.data]);
      (overrides.writeFile || ((input) => input.success({})))(options);
    },
    readFile(options) {
      calls.push(['readFile', options.filePath]);
      (overrides.readFile || ((input) => input.success({ data: '{}' })))(options);
    },
    stat(options) {
      calls.push(['stat', options.path]);
      (overrides.stat || ((input) => input.success({ stats: { size: 2 } })))(options);
    },
    readdir(options) {
      calls.push(['readdir', options.dirPath]);
      (overrides.readdir || ((input) => input.success({ files })))(options);
    },
    unlink(options) {
      calls.push(['unlink', options.filePath]);
      (overrides.unlink || ((input) => input.success({})))(options);
    },
  };
  const wxApi = {
    env: { USER_DATA_PATH: '/wx-user' },
    getFileSystemManager: () => fileSystem,
    chooseMessageFile(options) {
      calls.push(['chooseMessageFile', options.count, options.type]);
      (overrides.chooseMessageFile || ((input) => input.success({
        tempFiles: [{ name: 'backup.json', path: '/tmp/backup.json', size: 2 }],
      })))(options);
    },
    shareFileMessage(options) {
      calls.push(['shareFileMessage', options.filePath]);
      (overrides.shareFileMessage || ((input) => input.success({})))(options);
    },
    setClipboardData(options) {
      calls.push(['setClipboardData', options.data]);
      (overrides.setClipboardData || ((input) => input.success({})))(options);
    },
  };
  return { wxApi, calls };
}

test('JSON export uses the required local timestamp filename', () => {
  const result = createBackupExport(stateWithData(), new Date(2028, 0, 2, 3, 4, 5));
  assert.equal(result.filename, 'yongdu-backup-20280102-030405.json');
});

test('JSON export preserves every ledger field through parsing', () => {
  const state = stateWithData();
  assert.deepEqual(JSON.parse(createBackupExport(state).content), state);
});

test('JSON export reports its actual UTF-8 byte size', () => {
  const result = createBackupExport(stateWithData());
  assert.equal(result.sizeBytes, new TextEncoder().encode(result.content).length);
});

test('JSON export declares that it can restore', () => {
  assert.equal(createBackupExport(stateWithData()).canRestore, true);
});

test('CSV export uses the required local timestamp filename', () => {
  const result = createTransactionsCsvExport(stateWithData(), new Date(2028, 10, 9, 8, 7, 6));
  assert.equal(result.filename, 'yongdu-transactions-20281109-080706.csv');
});

test('CSV export retains the existing fixed domain columns', () => {
  const header = createTransactionsCsvExport(stateWithData()).content.split('\n')[0];
  assert.equal(header, 'logicalTransactionId,id,date,kind,businessKind,status,version,accountId,counterpartyAccountId,amountCents,budgetPeriodId,budgetImpactCents,rewardImpactCents,categoryLevel1,categoryLevel2,note,source,refundOfLogicalTransactionId');
});

test('CSV export explicitly declares that it cannot restore', () => {
  const result = createTransactionsCsvExport(stateWithData());
  assert.equal(result.canRestore, false);
  assert.match(result.warning, /不能用于恢复/);
});

test('backup preview rejects a reported file size above 5 MiB before restore', () => {
  const result = previewBackupRestore('{}', { sizeBytes: MAX_BACKUP_BYTES + 1 });
  assert.equal(result.ok, false);
  assert.match(result.error, /5 MiB/);
});

test('backup preview rejects text whose actual UTF-8 size exceeds 5 MiB after read', () => {
  const result = previewBackupRestore('好'.repeat(Math.ceil(MAX_BACKUP_BYTES / 3) + 1));
  assert.equal(result.ok, false);
  assert.match(result.error, /5 MiB/);
});

test('backup preview returns damaged JSON unchanged with a Chinese error', () => {
  const rawData = '{"broken":';
  const result = previewBackupRestore(rawData);
  assert.equal(result.ok, false);
  assert.equal(result.rawData, rawData);
  assert.match(result.error, /JSON 格式损坏/);
});

test('backup preview rejects unsupported future schema versions', () => {
  const raw = JSON.stringify({ ...stateWithData(), schemaVersion: 99 });
  const result = previewBackupRestore(raw);
  assert.equal(result.ok, false);
  assert.match(result.error, /不支持的备份版本/);
});

test('backup preview rejects non-CNY ledgers', () => {
  const raw = JSON.stringify({ ...stateWithData(), currency: 'USD' });
  const result = previewBackupRestore(raw);
  assert.equal(result.ok, false);
  assert.match(result.error, /仅支持人民币 CNY/);
});

test('backup preview rejects a missing required array with a Chinese field error', () => {
  const state = stateWithData();
  delete state.pendingItems;
  const result = previewBackupRestore(JSON.stringify(state));
  assert.equal(result.ok, false);
  assert.match(result.error, /备份缺少或损坏字段：pendingItems/);
});

test('current-schema backup preview rejects missing application settings instead of guessing them', () => {
  const state = stateWithData();
  delete state.appSettings;
  const result = previewBackupRestore(JSON.stringify(state));
  assert.equal(result.ok, false);
  assert.match(result.error, /备份缺少或损坏设置字段/);
});

test('backup preview rejects duplicate budget period identifiers', () => {
  const state = stateWithData();
  state.budgetPeriods.push({ ...state.budgetPeriods[0] });
  const result = previewBackupRestore(JSON.stringify(state));
  assert.equal(result.ok, false);
  assert.match(result.error, /预算周期存在重复标识/);
});

test('backup preview rejects duplicate plan identifiers', () => {
  const state = stateWithData();
  state.plans = [{ id: 'plan-1' }, { id: 'plan-1' }];
  const result = previewBackupRestore(JSON.stringify(state));
  assert.equal(result.ok, false);
  assert.match(result.error, /计划存在重复标识/);
});

test('backup preview rejects duplicate pending-item identifiers', () => {
  const state = stateWithData();
  state.pendingItems = [{ id: 'pending-1' }, { id: 'pending-1' }];
  const result = previewBackupRestore(JSON.stringify(state));
  assert.equal(result.ok, false);
  assert.match(result.error, /待确认项存在重复标识/);
});

test('backup preview rejects a transaction referencing a missing account', () => {
  const state = stateWithData();
  state.transactions[0].accountId = 'missing';
  const result = previewBackupRestore(JSON.stringify(state));
  assert.equal(result.ok, false);
  assert.match(result.error, /不存在的账户/);
});

test('backup preview rejects a transaction referencing a missing budget period', () => {
  const state = stateWithData();
  state.transactions[0].budgetPeriodId = 'missing';
  const result = previewBackupRestore(JSON.stringify(state));
  assert.equal(result.ok, false);
  assert.match(result.error, /不存在的预算周期/);
});

test('backup preview rejects a transaction referencing a missing related transaction', () => {
  const state = stateWithData();
  state.transactions[0].relatedTransactionId = 'missing';
  const result = previewBackupRestore(JSON.stringify(state));
  assert.equal(result.ok, false);
  assert.match(result.error, /不存在的关联流水/);
});

test('backup preview reports file metadata and all required counts', () => {
  const result = validPreview();
  assert.deepEqual({
    fileName: result.preview.fileName,
    accounts: result.preview.accountCount,
    transactions: result.preview.transactionCount,
    periods: result.preview.budgetPeriodCount,
    plans: result.preview.planCount,
    pending: result.preview.pendingItemCount,
  }, {
    fileName: 'backup.json',
    accounts: 2,
    transactions: 1,
    periods: 1,
    plans: 0,
    pending: 0,
  });
});

test('backup preview reports schema, currency, latest transaction date and unknown generated date', () => {
  const preview = validPreview().preview;
  assert.equal(preview.sourceSchemaVersion, 2);
  assert.equal(preview.targetSchemaVersion, 2);
  assert.equal(preview.currency, 'CNY');
  assert.equal(preview.latestTransactionDate, '2028-01-02');
  assert.equal(preview.generatedAt, '未知');
});

test('backup preview rejects obsolete schemas instead of migrating them', () => {
  const result = previewBackupRestore(JSON.stringify({ ...stateWithData(), schemaVersion: 0 }));
  assert.equal(result.ok, false);
  assert.match(result.error, /不支持的备份版本：0/);
});

test('restore with the wrong phrase performs zero storage operations', () => {
  const storage = storageWith();
  const result = commitBackupRestore(storage, validPreview().candidate, { phrase: '恢', confirmed: true });
  assert.equal(result.ok, false);
  assert.deepEqual(storage.calls, []);
});

test('cancelled restore performs zero storage operations', () => {
  const storage = storageWith();
  const result = commitBackupRestore(storage, validPreview().candidate, { phrase: '恢复', confirmed: false });
  assert.equal(result.cancelled, true);
  assert.deepEqual(storage.calls, []);
});

test('invalid restore candidate is rejected before any storage operation', () => {
  const storage = storageWith({ [STORAGE_KEY]: 'original' });
  const candidate = stateWithData();
  delete candidate.pendingItems;
  const result = commitBackupRestore(storage, candidate, { phrase: '恢复', confirmed: true });
  assert.equal(result.ok, false);
  assert.match(result.error, /恢复预检失败/);
  assert.deepEqual(storage.calls, []);
});

test('successful restore verifies temporary and main storage before returning state', () => {
  const storage = storageWith({ [STORAGE_KEY]: createBackupExport(initializeState({
    monthlyBudgetYuan: '1',
    nowDate: '2028-01-01',
    accounts: [{ id: 'old', name: '旧', type: 'cash', balanceYuan: '1' }],
  })).content });
  const candidate = validPreview().candidate;
  const result = commitBackupRestore(storage, candidate, { phrase: '恢复', confirmed: true });
  assert.equal(result.ok, true);
  assert.deepEqual(result.state, candidate);
  assert.equal(storage.values.has(RESTORE_TEMP_KEY), false);
  assert.deepEqual(JSON.parse(storage.values.get(STORAGE_KEY)), candidate);
});

test('successful restore does not execute an overdue plan inside the restore transaction', () => {
  const candidate = validPreview().candidate;
  candidate.plans.push({
    id: 'overdue-plan',
    accountId: 'cash',
    type: 'fixed_expense',
    active: true,
    amountCents: 100,
    nextDueDate: '2020-01-01',
  });
  const storage = storageWith({ [STORAGE_KEY]: createBackupExport(stateWithData()).content });
  const result = commitBackupRestore(storage, candidate, { phrase: '恢复', confirmed: true });
  assert.equal(result.ok, true);
  assert.equal(result.state.transactions.length, candidate.transactions.length);
  assert.deepEqual(result.state.plans, candidate.plans);
});

test('temporary-key write failure retains the original main value', () => {
  const original = '{"original":true}';
  const storage = storageWith({ [STORAGE_KEY]: original });
  const normalSet = storage.set.bind(storage);
  storage.set = (key, value) => {
    if (key === RESTORE_TEMP_KEY) throw new Error('temp write failed');
    normalSet(key, value);
  };
  const result = commitBackupRestore(storage, validPreview().candidate, { phrase: '恢复', confirmed: true });
  assert.equal(result.ok, false);
  assert.equal(storage.values.get(STORAGE_KEY), original);
});

test('original-main read failure never attempts to remove or overwrite the main key', () => {
  const storage = storageWith({ [STORAGE_KEY]: '{"original":true}' });
  storage.get = (key) => {
    storage.calls.push(['get', key]);
    if (key === STORAGE_KEY) throw new Error('main read failed');
    return storage.values.get(key);
  };
  const result = commitBackupRestore(storage, validPreview().candidate, { phrase: '恢复', confirmed: true });
  assert.equal(result.ok, false);
  assert.equal(storage.values.get(STORAGE_KEY), '{"original":true}');
  assert.deepEqual(storage.calls, [['get', STORAGE_KEY]]);
});

test('temporary-key readback mismatch retains the original main value', () => {
  const original = '{"original":true}';
  const storage = storageWith({ [STORAGE_KEY]: original });
  const normalGet = storage.get.bind(storage);
  storage.get = (key) => key === RESTORE_TEMP_KEY ? '{"bad":true}' : normalGet(key);
  const result = commitBackupRestore(storage, validPreview().candidate, { phrase: '恢复', confirmed: true });
  assert.equal(result.ok, false);
  assert.equal(storage.values.get(STORAGE_KEY), original);
});

test('temporary-key readback exception retains the original main value and never writes main', () => {
  const original = '{"original":true}';
  const storage = storageWith({ [STORAGE_KEY]: original });
  const normalGet = storage.get.bind(storage);
  storage.get = (key) => {
    if (key === RESTORE_TEMP_KEY) throw new Error('read failed');
    return normalGet(key);
  };
  const result = commitBackupRestore(storage, validPreview().candidate, { phrase: '恢复', confirmed: true });
  assert.equal(result.ok, false);
  assert.match(result.error, /临时数据读回失败/);
  assert.equal(storage.values.get(STORAGE_KEY), original);
  assert.equal(storage.calls.some(([operation, key]) => operation === 'set' && key === STORAGE_KEY), false);
});

test('main-key write failure retains the original main value', () => {
  const original = '{"original":true}';
  const storage = storageWith({ [STORAGE_KEY]: original });
  const normalSet = storage.set.bind(storage);
  let failed = false;
  storage.set = (key, value) => {
    if (key === STORAGE_KEY && !failed) {
      failed = true;
      throw new Error('main write failed');
    }
    normalSet(key, value);
  };
  const result = commitBackupRestore(storage, validPreview().candidate, { phrase: '恢复', confirmed: true });
  assert.equal(result.ok, false);
  assert.equal(storage.values.get(STORAGE_KEY), original);
  assert.equal(storage.values.has(RESTORE_TEMP_KEY), false);
});

test('main-key readback mismatch rolls back the original main value', () => {
  const original = '{"original":true}';
  const storage = storageWith({ [STORAGE_KEY]: original });
  const normalGet = storage.get.bind(storage);
  let mainReads = 0;
  storage.get = (key) => {
    if (key === STORAGE_KEY) {
      mainReads += 1;
      if (mainReads === 2) return '{"bad":true}';
    }
    return normalGet(key);
  };
  const result = commitBackupRestore(storage, validPreview().candidate, { phrase: '恢复', confirmed: true });
  assert.equal(result.ok, false);
  assert.equal(storage.values.get(STORAGE_KEY), original);
});

test('main-key readback exception rolls back the original main value', () => {
  const original = '{"original":true}';
  const storage = storageWith({ [STORAGE_KEY]: original });
  const normalGet = storage.get.bind(storage);
  let mainReads = 0;
  storage.get = (key) => {
    if (key === STORAGE_KEY) {
      mainReads += 1;
      if (mainReads === 2) throw new Error('read failed');
    }
    return normalGet(key);
  };
  const result = commitBackupRestore(storage, validPreview().candidate, { phrase: '恢复', confirmed: true });
  assert.equal(result.ok, false);
  assert.match(result.error, /主数据读回失败/);
  assert.equal(storage.values.get(STORAGE_KEY), original);
});

test('one rollback write failure is retried and still restores the original main value', () => {
  const original = '{"original":true}';
  const storage = storageWith({ [STORAGE_KEY]: original });
  const normalGet = storage.get.bind(storage);
  const normalSet = storage.set.bind(storage);
  let mainReads = 0;
  let rollbackFailed = false;
  storage.get = (key) => {
    if (key === STORAGE_KEY) {
      mainReads += 1;
      if (mainReads === 2) return '{"bad":true}';
    }
    return normalGet(key);
  };
  storage.set = (key, value) => {
    if (key === STORAGE_KEY && value === original && !rollbackFailed) {
      rollbackFailed = true;
      throw new Error('rollback failed once');
    }
    normalSet(key, value);
  };
  const result = commitBackupRestore(storage, validPreview().candidate, { phrase: '恢复', confirmed: true });
  assert.equal(result.ok, false);
  assert.equal(storage.values.get(STORAGE_KEY), original);
  assert.equal(result.error.includes('原数据回滚失败'), false);
});

test('temporary cleanup failure rolls back main data and retries cleanup', () => {
  const original = '{"original":true}';
  const storage = storageWith({ [STORAGE_KEY]: original });
  const normalRemove = storage.remove.bind(storage);
  let failed = false;
  storage.remove = (key) => {
    if (key === RESTORE_TEMP_KEY && !failed) {
      failed = true;
      throw new Error('cleanup failed');
    }
    normalRemove(key);
  };
  const result = commitBackupRestore(storage, validPreview().candidate, { phrase: '恢复', confirmed: true });
  assert.equal(result.ok, false);
  assert.equal(storage.values.get(STORAGE_KEY), original);
  assert.equal(storage.values.has(RESTORE_TEMP_KEY), false);
});

test('persistent temporary cleanup failure is reported while the original main value is restored', () => {
  const original = '{"original":true}';
  const storage = storageWith({ [STORAGE_KEY]: original });
  storage.remove = (key) => {
    storage.calls.push(['remove', key]);
    if (key === RESTORE_TEMP_KEY) throw new Error('cleanup unavailable');
    storage.values.delete(key);
  };
  const result = commitBackupRestore(storage, validPreview().candidate, { phrase: '恢复', confirmed: true });
  assert.equal(result.ok, false);
  assert.match(result.error, /临时数据清理失败/);
  assert.equal(storage.values.get(STORAGE_KEY), original);
});

test('failed restore removes a newly-created main key when no original existed', () => {
  const storage = storageWith();
  const normalGet = storage.get.bind(storage);
  let mainReads = 0;
  storage.get = (key) => {
    if (key === STORAGE_KEY) {
      mainReads += 1;
      if (mainReads === 2) return '{"bad":true}';
    }
    return normalGet(key);
  };
  const result = commitBackupRestore(storage, validPreview().candidate, { phrase: '恢复', confirmed: true });
  assert.equal(result.ok, false);
  assert.equal(storage.values.has(STORAGE_KEY), false);
});

test('clear with the wrong phrase performs zero storage operations', () => {
  const storage = storageWith({ unrelated: 'keep' });
  const result = clearLocalLedger(storage, { phrase: '删除', confirmed: true });
  assert.equal(result.ok, false);
  assert.deepEqual(storage.calls, []);
});

test('cancelled clear performs zero storage operations', () => {
  const storage = storageWith({ unrelated: 'keep' });
  const result = clearLocalLedger(storage, { phrase: '清除', confirmed: false });
  assert.equal(result.cancelled, true);
  assert.deepEqual(storage.calls, []);
});

test('confirmed clear removes only the main and temporary keys', () => {
  const storage = storageWith({ [STORAGE_KEY]: 'main', [RESTORE_TEMP_KEY]: 'temp', unrelated: 'keep' });
  const result = clearLocalLedger(storage, { phrase: '清除', confirmed: true });
  assert.equal(result.ok, true);
  assert.deepEqual(result.removedKeys, [STORAGE_KEY, RESTORE_TEMP_KEY]);
  assert.equal(storage.values.get('unrelated'), 'keep');
  const mutations = storage.calls.filter(([operation]) => operation === 'set' || operation === 'remove');
  assert.deepEqual(mutations, [['remove', STORAGE_KEY], ['remove', RESTORE_TEMP_KEY]]);
});

test('clear failure on the temporary key rolls back both specified keys and keeps unrelated storage', () => {
  const storage = storageWith({ [STORAGE_KEY]: 'main', [RESTORE_TEMP_KEY]: 'temp', unrelated: 'keep' });
  const normalRemove = storage.remove.bind(storage);
  let failed = false;
  storage.remove = (key) => {
    if (key === RESTORE_TEMP_KEY && !failed) {
      failed = true;
      throw new Error('remove failed');
    }
    normalRemove(key);
  };
  const result = clearLocalLedger(storage, { phrase: '清除', confirmed: true });
  assert.equal(result.ok, false);
  assert.equal(storage.values.get(STORAGE_KEY), 'main');
  assert.equal(storage.values.get(RESTORE_TEMP_KEY), 'temp');
  assert.equal(storage.values.get('unrelated'), 'keep');
});

test('stable missing-key reads let confirmed clear remove existing main and temporary keys', () => {
  const storage = stableStorageWith({ [STORAGE_KEY]: 'main', [RESTORE_TEMP_KEY]: 'temp', unrelated: 'keep' });
  const result = clearLocalLedger(storage, { phrase: '清除', confirmed: true });
  assert.equal(result.ok, true);
  assert.equal(storage.values.has(STORAGE_KEY), false);
  assert.equal(storage.values.has(RESTORE_TEMP_KEY), false);
  assert.equal(storage.values.get('unrelated'), 'keep');
});

test('stable missing keys remain absent after clear without creating empty-string target values', () => {
  const storage = stableStorageWith({ unrelated: 'keep' });
  const result = clearLocalLedger(storage, { phrase: '清除', confirmed: true });
  assert.equal(result.ok, true);
  assert.equal(storage.values.has(STORAGE_KEY), false);
  assert.equal(storage.values.has(RESTORE_TEMP_KEY), false);
  assert.deepEqual(
    storage.calls.filter(([operation]) => operation === 'set' || operation === 'remove'),
    [['remove', STORAGE_KEY], ['remove', RESTORE_TEMP_KEY]],
  );
});

test('stable clear reaches a temporary deletion failure and restores both original keys exactly', () => {
  const storage = stableStorageWith({ [STORAGE_KEY]: 'main', [RESTORE_TEMP_KEY]: 'temp', unrelated: 'keep' });
  const normalRemove = storage.remove.bind(storage);
  const removals = [];
  let failed = false;
  storage.remove = (key) => {
    removals.push(key);
    if (key === RESTORE_TEMP_KEY && !failed) {
      failed = true;
      throw new Error('temporary remove failed');
    }
    normalRemove(key);
  };
  const result = clearLocalLedger(storage, { phrase: '清除', confirmed: true });
  assert.equal(result.ok, false);
  assert.deepEqual(removals, [STORAGE_KEY, RESTORE_TEMP_KEY]);
  assert.equal(storage.values.get(STORAGE_KEY), 'main');
  assert.equal(storage.values.get(RESTORE_TEMP_KEY), 'temp');
  assert.equal(storage.values.get('unrelated'), 'keep');
  assert.doesNotMatch(result.error, /原数据回滚失败/);
});

test('restore rollback keeps a stable missing main key absent without reporting a false rollback failure', () => {
  const storage = stableStorageWith({ unrelated: 'keep' });
  const normalGet = storage.get.bind(storage);
  let mainReads = 0;
  storage.get = (key) => {
    if (key === STORAGE_KEY) {
      mainReads += 1;
      if (mainReads === 2) return '{"bad":true}';
    }
    return normalGet(key);
  };
  const result = commitBackupRestore(storage, validPreview().candidate, { phrase: '恢复', confirmed: true });
  assert.equal(result.ok, false);
  assert.equal(storage.values.has(STORAGE_KEY), false);
  assert.equal(storage.values.has(RESTORE_TEMP_KEY), false);
  assert.equal(storage.values.get('unrelated'), 'keep');
  assert.doesNotMatch(result.error, /原数据回滚失败/);
});

test('stable clear treats whitespace storage values as present while recognizing exact empty readback as missing', () => {
  const storage = stableStorageWith({ [STORAGE_KEY]: '  ', [RESTORE_TEMP_KEY]: '\t', unrelated: 'keep' });
  const normalRemove = storage.remove.bind(storage);
  const removals = [];
  let failed = false;
  storage.remove = (key) => {
    removals.push(key);
    if (key === RESTORE_TEMP_KEY && !failed) {
      failed = true;
      throw new Error('temporary remove failed');
    }
    normalRemove(key);
  };
  const result = clearLocalLedger(storage, { phrase: '清除', confirmed: true });
  assert.equal(result.ok, false);
  assert.deepEqual(removals, [STORAGE_KEY, RESTORE_TEMP_KEY]);
  assert.equal(storage.values.get(STORAGE_KEY), '  ');
  assert.equal(storage.values.get(RESTORE_TEMP_KEY), '\t');
  assert.equal(storage.values.get('unrelated'), 'keep');
});

test('settings page contains five separate data-safety blocks and the required privacy statements', () => {
  const wxml = fs.readFileSync(new URL('../miniprogram/pages/settings/settings.wxml', import.meta.url), 'utf8');
  for (const title of ['1. 完整备份', '2. 恢复预览', '3. CSV 账单', '4. 危险操作', '5. 隐私说明']) assert.ok(wxml.includes(title));
  for (const statement of ['不上传、不用于 AI', '未加密明文', '数据无法恢复', '不代表已完成平台法律合规']) assert.ok(wxml.includes(statement));
});

test('generated-file matcher accepts only the two exact timestamped Yongdu filename families', () => {
  assert.notEqual(GENERATED_FILE_PATTERN.exec('yongdu-backup-20280102-030405.json'), null);
  assert.notEqual(GENERATED_FILE_PATTERN.exec('yongdu-transactions-20280102-030405.csv'), null);
  assert.equal(GENERATED_FILE_PATTERN.exec('other-backup-20280102-030405.json'), null);
  assert.equal(GENERATED_FILE_PATTERN.exec('yongdu-backup-any.json'), null);
});

test('generated-file matcher binds each Yongdu prefix to its required extension', () => {
  assert.notEqual(GENERATED_FILE_PATTERN.exec('yongdu-backup-20280102-030405.json'), null);
  assert.notEqual(GENERATED_FILE_PATTERN.exec('yongdu-transactions-20280102-030405.csv'), null);
  assert.equal(GENERATED_FILE_PATTERN.exec('yongdu-backup-20280102-030405.csv'), null);
  assert.equal(GENERATED_FILE_PATTERN.exec('yongdu-transactions-20280102-030405.json'), null);
});

test('file adapter writes a generated file only inside the mini-program user directory', async () => {
  const boundary = fakeWxBoundary();
  const adapter = createDataFiles(boundary.wxApi);
  const result = await adapter.writeGeneratedFile({ filename: 'yongdu-backup-20280102-030405.json', content: '{}', sizeBytes: 2 });
  assert.equal(result.filePath, '/wx-user/yongdu-backup-20280102-030405.json');
  assert.deepEqual(boundary.calls[0].slice(0, 2), ['writeFile', '/wx-user/yongdu-backup-20280102-030405.json']);
});

test('file adapter refuses both crossed generated extensions before any write', async () => {
  const boundary = fakeWxBoundary();
  const adapter = createDataFiles(boundary.wxApi);
  await assert.rejects(
    adapter.writeGeneratedFile({ filename: 'yongdu-backup-20280102-030405.csv', content: 'x' }),
    /生成文件名不合法/,
  );
  await assert.rejects(
    adapter.writeGeneratedFile({ filename: 'yongdu-transactions-20280102-030405.json', content: '{}' }),
    /生成文件名不合法/,
  );
  assert.equal(boundary.calls.filter(([operation]) => operation === 'writeFile').length, 0);
});

test('file adapter rejects a selected non-JSON file before reading it', async () => {
  const boundary = fakeWxBoundary({
    chooseMessageFile: (options) => options.success({ tempFiles: [{ name: '账单.csv', path: '/tmp/bill.csv', size: 2 }] }),
  });
  const adapter = createDataFiles(boundary.wxApi);
  await assert.rejects(adapter.chooseBackupText(MAX_BACKUP_BYTES), /只支持选择一个 JSON 文件/);
  assert.equal(boundary.calls.some(([operation]) => operation === 'readFile'), false);
});

test('file adapter rejects an oversized selected file before reading it', async () => {
  const boundary = fakeWxBoundary({
    chooseMessageFile: (options) => options.success({ tempFiles: [{ name: 'large.json', path: '/tmp/large.json', size: MAX_BACKUP_BYTES + 1 }] }),
  });
  const adapter = createDataFiles(boundary.wxApi);
  await assert.rejects(adapter.chooseBackupText(MAX_BACKUP_BYTES), /5 MiB/);
  assert.equal(boundary.calls.some(([operation]) => operation === 'readFile'), false);
});

test('file adapter uses stat for the pre-read size check when chooser metadata has no size', async () => {
  const boundary = fakeWxBoundary({
    chooseMessageFile: (options) => options.success({ tempFiles: [{ name: 'backup.json', path: '/tmp/backup.json' }] }),
    stat: (options) => options.success({ stats: { size: 2 } }),
    readFile: (options) => options.success({ data: '{}' }),
  });
  const result = await createDataFiles(boundary.wxApi).chooseBackupText(MAX_BACKUP_BYTES);
  assert.equal(result.ok, true);
  assert.equal(boundary.calls.some(([operation]) => operation === 'stat'), true);
});

test('file adapter rejects content above the limit after reading despite small chooser metadata', async () => {
  const boundary = fakeWxBoundary({
    chooseMessageFile: (options) => options.success({ tempFiles: [{ name: 'backup.json', path: '/tmp/backup.json', size: 2 }] }),
    readFile: (options) => options.success({ data: '好'.repeat(Math.ceil(MAX_BACKUP_BYTES / 3) + 1) }),
  });
  await assert.rejects(createDataFiles(boundary.wxApi).chooseBackupText(MAX_BACKUP_BYTES), /读取后的内容超过 5 MiB/);
});

test('file adapter returns cancellation without reading or reporting a false success', async () => {
  const boundary = fakeWxBoundary({
    chooseMessageFile: (options) => options.fail({ errMsg: 'chooseMessageFile:fail cancel' }),
  });
  const result = await createDataFiles(boundary.wxApi).chooseBackupText(MAX_BACKUP_BYTES);
  assert.deepEqual({ ok: result.ok, cancelled: result.cancelled }, { ok: false, cancelled: true });
  assert.equal(boundary.calls.some(([operation]) => operation === 'readFile'), false);
});

test('file adapter deletes only exact generated filenames and preserves unrelated user files', async () => {
  const boundary = fakeWxBoundary({
    files: [
      'yongdu-backup-20280102-030405.json',
      'yongdu-transactions-20280102-030405.csv',
      'other.json',
      'yongdu-backup-any.json',
    ],
  });
  const removed = await createDataFiles(boundary.wxApi).removeGeneratedFiles();
  assert.deepEqual(Array.from(removed), [
    'yongdu-backup-20280102-030405.json',
    'yongdu-transactions-20280102-030405.csv',
  ]);
  const unlinked = boundary.calls.filter(([operation]) => operation === 'unlink').map(([, path]) => path);
  assert.deepEqual(unlinked, [
    '/wx-user/yongdu-backup-20280102-030405.json',
    '/wx-user/yongdu-transactions-20280102-030405.csv',
  ]);
});

test('file adapter deletes the two canonical files but preserves crossed extensions and ordinary files', async () => {
  const boundary = fakeWxBoundary({
    files: [
      'yongdu-backup-20280102-030405.json',
      'yongdu-transactions-20280102-030405.csv',
      'yongdu-backup-20280102-030405.csv',
      'yongdu-transactions-20280102-030405.json',
      'notes.json',
    ],
  });
  const removed = await createDataFiles(boundary.wxApi).removeGeneratedFiles();
  assert.deepEqual(Array.from(removed), [
    'yongdu-backup-20280102-030405.json',
    'yongdu-transactions-20280102-030405.csv',
  ]);
  const unlinked = boundary.calls.filter(([operation]) => operation === 'unlink').map(([, path]) => path);
  assert.deepEqual(unlinked, [
    '/wx-user/yongdu-backup-20280102-030405.json',
    '/wx-user/yongdu-transactions-20280102-030405.csv',
  ]);
  assert.equal(unlinked.length, 2);
});

test('file adapter invokes sharing and clipboard only after their explicit methods are called', async () => {
  const boundary = fakeWxBoundary();
  const adapter = createDataFiles(boundary.wxApi);
  assert.equal(boundary.calls.length, 0);
  await adapter.shareFile('/wx-user/yongdu-backup-20280102-030405.json');
  await adapter.copyText('backup text');
  assert.deepEqual(boundary.calls, [
    ['shareFileMessage', '/wx-user/yongdu-backup-20280102-030405.json'],
    ['setClipboardData', 'backup text'],
  ]);
});
