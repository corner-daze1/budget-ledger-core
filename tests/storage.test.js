import test from 'node:test';
import assert from 'node:assert/strict';
import { createLedger, recordIncome } from '../src/domain/ledger.js';
import { CURRENT_SCHEMA_VERSION, exportTransactionsCsv, restoreBackup, serializeBackup } from '../src/domain/storage.js';

function savedState() {
  return recordIncome(createLedger({ accounts: [{ id: 'cash', name: '现金', type: 'cash', balanceCents: 1000 }], budgetPeriods: [{ id: 'p1', startDate: '2028-01-01', endDate: '2028-01-30', baseBudgetCents: 3000 }] }), { id: 'income-1', date: '2028-01-02', accountId: 'cash', amountCents: 200, source: 'bank,import' });
}

test('CURRENT_SCHEMA_VERSION is explicitly version three', () => assert.equal(CURRENT_SCHEMA_VERSION, 3));
test('serializeBackup emits a versioned complete JSON snapshot', () => assert.equal(JSON.parse(serializeBackup(savedState())).schemaVersion, 3));
test('restoreBackup round trips account balances, dates and transaction relations exactly', () => {
  const original = savedState();
  const restored = restoreBackup(serializeBackup(original));
  assert.equal(restored.ok, true);
  assert.deepEqual(restored.data, original);
});
test('restoreBackup returns malformed raw data instead of silently clearing it', () => {
  const raw = '{broken';
  const result = restoreBackup(raw);
  assert.equal(result.ok, false);
  assert.equal(result.rawData, raw);
  assert.match(result.error, /restore failed/);
});
test('restoreBackup returns a clear error for an unsupported schema version and preserves raw data', () => {
  const raw = JSON.stringify({ schemaVersion: 99 });
  const result = restoreBackup(raw);
  assert.equal(result.ok, false);
  assert.equal(result.rawData, raw);
  assert.match(result.error, /unsupported schema/);
});
test('restoreBackup returns a clear error when required arrays are missing', () => {
  const raw = JSON.stringify({ schemaVersion: 3, currency: 'CNY' });
  const result = restoreBackup(raw);
  assert.equal(result.ok, false);
  assert.match(result.error, /must be an array/);
});
test('restoreBackup rejects a non-string backup without inventing an empty ledger', () => {
  const result = restoreBackup(null);
  assert.equal(result.ok, false);
  assert.equal(result.rawData, null);
  assert.match(result.error, /string/);
});
for (const schemaVersion of [0, 1, 2]) {
  test(`restoreBackup rejects obsolete schema version ${schemaVersion} without migration`, () => {
    const raw = JSON.stringify({ schemaVersion });
    const result = restoreBackup(raw);
    assert.equal(result.ok, false);
    assert.equal(result.rawData, raw);
    assert.match(result.error, /unsupported schema/);
  });
}
test('restoreBackup rejects an invalid current-version balance', () => {
  const result = restoreBackup(JSON.stringify({ schemaVersion: 3, currency: 'CNY', accounts: [{ id: 'cash', type: 'cash', balanceCents: -1 }], budgetPeriods: [], transactions: [], plans: [], pendingItems: [] }));
  assert.equal(result.ok, false);
  assert.match(result.error, /invalid balance/);
});
test('serializeBackup rejects a ledger with an unsupported currency', () => assert.throws(() => serializeBackup({ ...savedState(), currency: 'USD' }), /CNY/));
test('restoreBackup rejects the removed reward balance field while preserving raw data', () => {
  const raw = JSON.stringify({ ...savedState(), rewardBalanceCents: 1 });
  const result = restoreBackup(raw);
  assert.equal(result.ok, false);
  assert.equal(result.rawData, raw);
  assert.match(result.error, /removed field/);
});
test('restoreBackup rejects the removed reward transaction field while preserving raw data', () => {
  const state = savedState();
  state.transactions[0].rewardImpactCents = 1;
  const raw = JSON.stringify(state);
  const result = restoreBackup(raw);
  assert.equal(result.ok, false);
  assert.equal(result.rawData, raw);
  assert.match(result.error, /removed field/);
});
test('CSV export includes a stable latest-business header for bill transactions', () => assert.match(exportTransactionsCsv(savedState()), /^logicalTransactionId,id,date,kind,businessKind,status,version,accountId/));
test('CSV export preserves cents and source values', () => {
  const csv = exportTransactionsCsv(savedState());
  assert.match(csv, /income-1/);
  assert.match(csv, /200/);
  assert.match(csv, /"bank,import"/);
});
test('CSV export escapes embedded quotes in source metadata', () => {
  const state = recordIncome(createLedger({ accounts: [{ id: 'cash', name: '现金', type: 'cash', balanceCents: 1000 }], budgetPeriods: [] }), { id: 'quoted', date: '2028-01-02', accountId: 'cash', amountCents: 100, source: 'say "yes"' });
  assert.match(exportTransactionsCsv(state), /"say ""yes"""/);
});
test('CSV export emits one final newline for portable file handoff', () => assert.ok(exportTransactionsCsv(savedState()).endsWith('\n')));
test('restoreBackup preserves linked transaction ids through a full backup cycle', () => {
  const original = savedState();
  original.transactions[0].relatedTransactionId = 'source-1';
  const restored = restoreBackup(serializeBackup(original));
  assert.equal(restored.data.transactions[0].relatedTransactionId, 'source-1');
});
