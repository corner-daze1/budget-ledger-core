import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addAssetAccount,
  createTransactionsCsvExport,
  getBillAnalysisModel,
  getTransactionDetailModel,
  initializeState,
  listRecentTransactions,
  modifyTransactionEntry,
  recordEntry,
  refundTransactionEntry,
  revokeRefundEntry,
  revokeTransactionEntry,
  settleCurrentPeriod,
} from '../src/application/app-core.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function baseState(date = '2026-07-15') {
  return initializeState({
    monthlyBudgetYuan: '3000',
    startDay: 1,
    nowDate: date,
    accounts: [{ id: 'cash', name: '现金', type: 'cash', balanceYuan: '10000' }],
  });
}

function expense(state = baseState(), input = {}) {
  return recordEntry(state, {
    amountYuan: input.amountYuan || '100',
    date: input.date || '2026-07-15',
    accountId: input.accountId || 'cash',
    categoryLevel1: input.categoryLevel1 || '餐饮',
    categoryLevel2: input.categoryLevel2 || '午餐',
    note: input.note || '',
    includeControlledBudget: input.includeControlledBudget !== false,
  });
}

function latestId(state) {
  return state.transactions.find((item) => !item.technical)?.logicalTransactionId;
}

test('应用层修改入口把人民币表单转换为整数分并返回新版本候选态', () => {
  const original = expense();
  const logicalTransactionId = latestId(original);
  const candidate = modifyTransactionEntry(original, {
    logicalTransactionId,
    changes: { amountYuan: '125.67', note: '改后备注' },
    requestId: 'ui-modify-1',
    today: '2026-07-20',
  });
  assert.equal(candidate.accounts[0].balanceCents, original.accounts[0].balanceCents - 2567);
  const detail = getTransactionDetailModel(candidate, logicalTransactionId);
  assert.equal(detail.amountCents, 12567);
  assert.equal(detail.note, '改后备注');
  assert.equal(detail.version, 2);
});

test('应用层退款入口支持多次部分退款且详情准确显示剩余可退金额', () => {
  let state = expense();
  const logicalTransactionId = latestId(state);
  state = refundTransactionEntry(state, {
    logicalTransactionId,
    amountYuan: '30',
    date: '2026-07-16',
    destinationAccountId: 'cash',
    requestId: 'ui-refund-1',
    today: '2026-07-20',
  });
  state = refundTransactionEntry(state, {
    logicalTransactionId,
    amountYuan: '20',
    date: '2026-07-17',
    destinationAccountId: 'cash',
    requestId: 'ui-refund-2',
    today: '2026-07-20',
  });
  const detail = getTransactionDetailModel(state, logicalTransactionId);
  assert.equal(detail.refundedCents, 5000);
  assert.equal(detail.remainingRefundableCents, 5000);
  assert.deepEqual(detail.refunds.map((item) => item.amountCents), [3000, 2000]);
});

test('存在退款时应用层仍允许只改分类和备注而不重复改预算', () => {
  let state = expense();
  const logicalTransactionId = latestId(state);
  state = refundTransactionEntry(state, {
    logicalTransactionId,
    amountYuan: '20',
    date: '2026-07-16',
    requestId: 'category-only-refund',
    today: '2026-07-20',
  });
  const candidate = modifyTransactionEntry(state, {
    logicalTransactionId,
    changes: { categoryLevel1: '购物', categoryLevel2: '日用品', note: '仅改分类' },
    requestId: 'category-only-modify',
    today: '2026-07-20',
  });
  assert.equal(candidate.budgetPeriods[0].netBudgetSpendCents, 8000);
  assert.equal(getTransactionDetailModel(candidate, logicalTransactionId).category, '购物 · 日用品');
});

test('应用层可撤销单笔退款并恢复原账剩余可退金额', () => {
  let state = expense();
  const originalId = latestId(state);
  state = refundTransactionEntry(state, {
    logicalTransactionId: originalId,
    amountYuan: '30',
    date: '2026-07-16',
    requestId: 'ui-refund-revoke-source',
    today: '2026-07-20',
  });
  const refundId = state.transactions.find((item) => item.kind === 'refund').logicalTransactionId;
  state = revokeRefundEntry(state, {
    logicalTransactionId: refundId,
    requestId: 'ui-refund-revoke',
    date: '2026-07-18',
    today: '2026-07-20',
  });
  assert.equal(getTransactionDetailModel(state, originalId).remainingRefundableCents, 10000);
  assert.equal(getTransactionDetailModel(state, refundId).status, 'revoked');
});

test('应用层撤销入口保留账单审计但恢复账户与预算', () => {
  const original = expense();
  const logicalTransactionId = latestId(original);
  const candidate = revokeTransactionEntry(original, {
    logicalTransactionId,
    requestId: 'ui-revoke-1',
    date: '2026-07-18',
    today: '2026-07-20',
  });
  assert.equal(candidate.accounts[0].balanceCents, 1000000);
  assert.equal(candidate.budgetPeriods[0].netBudgetSpendCents, 0);
  assert.equal(getTransactionDetailModel(candidate, logicalTransactionId).status, 'revoked');
});

test('账单详情始终读取逻辑账单最新版本并提供账户预算影响', () => {
  let state = expense();
  const logicalTransactionId = latestId(state);
  state = modifyTransactionEntry(state, {
    logicalTransactionId,
    changes: { amountYuan: '120', categoryLevel2: '晚餐' },
    requestId: 'detail-latest',
    today: '2026-07-20',
  });
  const detail = getTransactionDetailModel(state, logicalTransactionId);
  assert.equal(detail.id, state.transactions.find((item) => item.status === 'active' && item.version === 2).id);
  assert.equal(detail.category, '餐饮 · 晚餐');
  assert.equal(detail.accountImpacts[0].accountName, '现金');
  assert.equal(detail.budgetImpactCents, 12000);
  assert.equal(detail.changeHistory.length, 2);
});

test('普通列表只保留最新有效版本并隐藏技术冲正', () => {
  let state = expense();
  const logicalTransactionId = latestId(state);
  state = modifyTransactionEntry(state, {
    logicalTransactionId,
    changes: { amountYuan: '80' },
    requestId: 'list-latest',
    today: '2026-07-20',
  });
  const rows = listRecentTransactions(state);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amountCents, 8000);
  assert.equal(rows[0].statusBadge, '已修改');
  assert.equal(rows.some((item) => item.kind === 'technical_reversal'), false);
});

test('原支出在部分退款与全额退款后分别显示明确状态且退款不算收入', () => {
  let state = expense();
  const logicalTransactionId = latestId(state);
  state = refundTransactionEntry(state, {
    logicalTransactionId,
    amountYuan: '40',
    date: '2026-07-16',
    requestId: 'list-refund-1',
    today: '2026-07-20',
  });
  let rows = listRecentTransactions(state);
  assert.equal(rows.find((item) => item.logicalTransactionId === logicalTransactionId).statusBadge, '部分退款');
  assert.equal(rows.find((item) => item.kind === 'refund').isIncome, false);
  state = refundTransactionEntry(state, {
    logicalTransactionId,
    amountYuan: '60',
    date: '2026-07-17',
    requestId: 'list-refund-2',
    today: '2026-07-20',
  });
  rows = listRecentTransactions(state);
  assert.equal(rows.find((item) => item.logicalTransactionId === logicalTransactionId).statusBadge, '已退款');
});

test('已撤销账单只出现在已撤销筛选而不混入日常流水', () => {
  let state = expense();
  const logicalTransactionId = latestId(state);
  state = revokeTransactionEntry(state, {
    logicalTransactionId,
    requestId: 'filter-revoked',
    date: '2026-07-18',
    today: '2026-07-20',
  });
  assert.equal(listRecentTransactions(state).length, 0);
  const revoked = listRecentTransactions(state, { status: 'revoked' });
  assert.equal(revoked.length, 1);
  assert.equal(revoked[0].statusBadge, '已撤销');
});

test('分析只统计修改后的历史事实而不重复统计旧版本和技术冲正', () => {
  let state = expense(baseState(), { amountYuan: '100', date: '2026-07-05' });
  const logicalTransactionId = latestId(state);
  state = modifyTransactionEntry(state, {
    logicalTransactionId,
    changes: { amountYuan: '60', date: '2026-07-06' },
    requestId: 'analysis-latest',
    today: '2026-07-20',
  });
  const analysis = getBillAnalysisModel(state, { today: '2026-07-20', scope: 'all' });
  assert.equal(analysis.daily.totalCents, 6000);
  assert.equal(analysis.daily.points[4].amountCents, 0);
  assert.equal(analysis.daily.points[5].amountCents, 6000);
});

test('已结算历史调整可读但不进入收入支出或分类统计', () => {
  let state = expense(baseState('2026-06-15'), { amountYuan: '100', date: '2026-06-15' });
  const logicalTransactionId = latestId(state);
  state = settleCurrentPeriod(state, '2026-07-01', { decision: 'carry' });
  state = modifyTransactionEntry(state, {
    logicalTransactionId,
    changes: { amountYuan: '80' },
    requestId: 'closed-readable',
    today: '2026-07-10',
  });
  const adjustment = listRecentTransactions(state).find((item) => item.kind === 'historical_adjustment');
  assert.ok(adjustment);
  assert.equal(adjustment.canSwipe, false);
  assert.match(adjustment.category, /历史账单调整/);
  assert.match(adjustment.note, /账户影响/);
  assert.equal(getBillAnalysisModel(state, { today: '2026-07-10', scope: 'all' }).daily.totalCents, 0);
});

test('CSV只导出用户可读的最新有效业务记录而不包含技术冲正或被替代版本', () => {
  let state = expense();
  const logicalTransactionId = latestId(state);
  state = modifyTransactionEntry(state, {
    logicalTransactionId,
    changes: { amountYuan: '75' },
    requestId: 'csv-latest',
    today: '2026-07-20',
  });
  const csv = createTransactionsCsvExport(state, new Date(2026, 6, 20)).content;
  assert.match(csv, /logicalTransactionId/);
  assert.match(csv, /,7500,/);
  assert.doesNotMatch(csv, /technical_reversal/);
  assert.doesNotMatch(csv, /,10000,/);
});

test('app配置把唯一详情页追加为第五页且不加入TabBar', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/app.json'), 'utf8'));
  assert.deepEqual(config.pages, [
    'pages/home/home',
    'pages/settings/settings',
    'pages/entry/entry',
    'pages/bills/bills',
    'pages/transaction-detail/transaction-detail',
  ]);
  assert.equal(config.tabBar.list.some((item) => item.pagePath.includes('transaction-detail')), false);
});

test('首页完整账本按退款修改撤销顺序提供左滑动作并带方向锁', () => {
  const js = fs.readFileSync(path.join(root, 'miniprogram/pages/home/home.js'), 'utf8');
  const wxml = fs.readFileSync(path.join(root, 'miniprogram/pages/home/home.wxml'), 'utf8');
  assert.match(js, /swipeAxis/);
  assert.match(js, /openLogicalTransactionId/);
  assert.match(js, /mode=\$\{mode\}/);
  assert.match(wxml, /退款[\s\S]*修改[\s\S]*撤销/);
  assert.match(wxml, /transaction\.actions\.refund/);
  assert.match(wxml, /transaction\.actions\.modify/);
  assert.match(wxml, /transaction\.actions\.revoke/);
});

test('账单分析完整流水支持同一动作顺序并在滚动时关闭已开行', () => {
  const js = fs.readFileSync(path.join(root, 'miniprogram/pages/bills/bills.js'), 'utf8');
  const wxml = fs.readFileSync(path.join(root, 'miniprogram/pages/bills/bills.wxml'), 'utf8');
  assert.match(js, /onPageScroll/);
  assert.match(js, /openLogicalTransactionId/);
  assert.match(wxml, /退款[\s\S]*修改[\s\S]*撤销/);
});

test('账单分析页提供当前有效与已撤销筛选且默认不展示撤销记录', () => {
  const js = fs.readFileSync(path.join(root, 'miniprogram/pages/bills/bills.js'), 'utf8');
  const wxml = fs.readFileSync(path.join(root, 'miniprogram/pages/bills/bills.wxml'), 'utf8');
  assert.match(js, /listRecentTransactions\(app\.globalData\.state, \{ status: this\.data\.status \}\)/);
  assert.match(js, /onStatusTap/);
  assert.match(wxml, /当前有效/);
  assert.match(wxml, /已撤销/);
});

test('详情页按逻辑账单ID重读状态并有只读修改退款撤销模式', () => {
  const js = fs.readFileSync(path.join(root, 'miniprogram/pages/transaction-detail/transaction-detail.js'), 'utf8');
  const wxml = fs.readFileSync(path.join(root, 'miniprogram/pages/transaction-detail/transaction-detail.wxml'), 'utf8');
  assert.match(js, /getTransactionDetailModel/);
  assert.match(js, /logicalTransactionId/);
  assert.match(js, /modifyTransactionEntry/);
  assert.match(js, /refundTransactionEntry/);
  assert.match(js, /revokeTransactionEntry/);
  assert.match(js, /revokeRefundEntry/);
  assert.match(wxml, /账户影响/);
  assert.match(wxml, /预算影响/);
  assert.match(wxml, /退款明细/);
  assert.match(wxml, /变更记录/);
});

test('详情页所有财务动作先预览确认并使用忙锁与原子提交', () => {
  const js = fs.readFileSync(path.join(root, 'miniprogram/pages/transaction-detail/transaction-detail.js'), 'utf8');
  assert.match(js, /busy/);
  assert.match(js, /showModal/);
  assert.match(js, /buildStateImpactPreview/);
  assert.match(js, /commitState/);
  assert.match(js, /enableAlertBeforeUnload/);
  assert.match(js, /disableAlertBeforeUnload/);
});

test('小程序原子提交只有保存与读回成功后才替换内存状态', () => {
  const js = fs.readFileSync(path.join(root, 'miniprogram/app.js'), 'utf8');
  assert.match(js, /commitPreparedState/);
  assert.match(js, /commitState\s*\(/);
  assert.match(js, /if\s*\(!result\.ok\)/);
  assert.match(js, /this\.globalData\.state\s*=\s*result\.state/);
});

test('小程序静态检查器精确验证五页和详情页生成边界', () => {
  const checker = fs.readFileSync(path.join(root, 'scripts/check-miniprogram.js'), 'utf8');
  assert.match(checker, /transaction-detail/);
  assert.match(checker, /five pages/);
  assert.match(checker, /ledger-first five-page order/);
});
