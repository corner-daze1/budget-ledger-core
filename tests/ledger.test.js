import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addAccount,
  addBudgetPeriod,
  budgetForPeriod,
  closeBudgetPeriod,
  createFixedPlan,
  createLedger,
  executeFixedPlan,
  recordBorrowing,
  recordCreditCardRepayment,
  recordExpense,
  recordFixedExpense,
  recordIncome,
  recordInvestmentTrade,
  recordLoanInterestAccrual,
  recordLoanInterestPayment,
  recordLoanPrincipalRepayment,
  recordRefund,
  recordRewardPayment,
  recordTransfer,
  revokeFixedPlan,
  setInvestmentValue,
  totals,
} from '../src/domain/ledger.js';

function freshLedger() {
  return createLedger({
    accounts: [
      { id: 'cash', name: '现金', type: 'cash', balanceCents: 100000 },
      { id: 'bank', name: '储蓄卡', type: 'bank', balanceCents: 0 },
      { id: 'wallet', name: '电子钱包', type: 'wallet', balanceCents: 20000 },
      { id: 'card', name: '信用卡', type: 'credit_card', balanceCents: 0 },
      { id: 'loan', name: '借贷', type: 'loan', balanceCents: 0 },
      { id: 'fund', name: '投资', type: 'investment', balanceCents: 50000, costBasisCents: 50000 },
    ],
    budgetPeriods: [{ id: 'p1', startDate: '2028-01-01', endDate: '2028-01-30', baseBudgetCents: 300000 }],
    rewardBalanceCents: 10000,
  });
}

test('createLedger starts with CNY and separate account and budget collections', () => {
  const state = createLedger({ defaultBudgetCents: 300000 });
  assert.equal(state.currency, 'CNY');
  assert.equal(state.accounts.length, 0);
  assert.equal(state.transactions.length, 0);
  assert.equal(state.defaultBudgetCents, 300000);
});
test('addAccount creates a wallet with an integer balance', () => assert.equal(addAccount(freshLedger(), { id: 'new-wallet', name: '新钱包', type: 'wallet', balanceCents: 123 }).accounts.at(-1).balanceCents, 123));
test('addAccount rejects duplicate account ids', () => assert.throws(() => addAccount(freshLedger(), { id: 'cash', type: 'cash' }), /duplicate/));
test('addBudgetPeriod creates an open period with zero net spend', () => assert.equal(addBudgetPeriod(freshLedger(), { id: 'p2', startDate: '2028-02-01', endDate: '2028-02-29', baseBudgetCents: 280000 }).budgetPeriods.at(-1).netBudgetSpendCents, 0));
test('recordIncome increases assets without increasing budget spend', () => {
  const state = recordIncome(freshLedger(), { id: 'income-1', date: '2028-01-01', accountId: 'cash', amountCents: 5000, source: 'salary' });
  assert.equal(state.accounts.find((item) => item.id === 'cash').balanceCents, 105000);
  assert.equal(state.budgetPeriods[0].netBudgetSpendCents, 0);
});
test('recordExpense reduces cash and increases controlled budget spend', () => {
  const state = recordExpense(freshLedger(), { id: 'expense-1', date: '2028-01-02', accountId: 'cash', amountCents: 5000, budgetPeriodId: 'p1', categoryLevel1: '餐饮' });
  assert.equal(state.accounts.find((item) => item.id === 'cash').balanceCents, 95000);
  assert.equal(state.budgetPeriods[0].netBudgetSpendCents, 5000);
});
test('recordFixedExpense reduces cash without touching controlled budget spend', () => {
  const state = recordFixedExpense(freshLedger(), { id: 'fixed-1', date: '2028-01-02', accountId: 'cash', amountCents: 5000, categoryLevel1: '房租' });
  assert.equal(state.accounts.find((item) => item.id === 'cash').balanceCents, 95000);
  assert.equal(state.budgetPeriods[0].netBudgetSpendCents, 0);
});
test('recordTransfer preserves total assets while moving money between asset accounts', () => {
  const before = totals(freshLedger());
  const after = totals(recordTransfer(freshLedger(), { id: 'transfer-1', date: '2028-01-02', fromAccountId: 'cash', toAccountId: 'bank', amountCents: 5000 }));
  assert.deepEqual(after, before);
});
test('recordCreditCardExpense increases card liability and controlled spend', () => {
  const state = recordExpense(freshLedger(), { id: 'card-expense', date: '2028-01-03', accountId: 'card', amountCents: 7000, budgetPeriodId: 'p1', categoryLevel1: '交通' });
  assert.equal(state.accounts.find((item) => item.id === 'card').balanceCents, 7000);
  assert.equal(state.budgetPeriods[0].netBudgetSpendCents, 7000);
});
test('recordCreditCardRepayment decreases both asset and card liability without budget impact', () => {
  const spent = recordExpense(freshLedger(), { id: 'card-expense', date: '2028-01-03', accountId: 'card', amountCents: 7000, budgetPeriodId: 'p1', categoryLevel1: '交通' });
  const paid = recordCreditCardRepayment(spent, { id: 'card-pay', date: '2028-01-04', fromAccountId: 'cash', creditCardAccountId: 'card', amountCents: 7000 });
  assert.equal(paid.accounts.find((item) => item.id === 'cash').balanceCents, 93000);
  assert.equal(paid.accounts.find((item) => item.id === 'card').balanceCents, 0);
  assert.equal(paid.budgetPeriods[0].netBudgetSpendCents, 7000);
  assert.equal(paid.transactions.at(-1).budgetImpactCents, 0);
});
test('recordBorrowing increases cash and debt by the same amount', () => {
  const state = recordBorrowing(freshLedger(), { id: 'borrow', date: '2028-01-05', cashAccountId: 'cash', loanAccountId: 'loan', amountCents: 20000 });
  assert.equal(state.accounts.find((item) => item.id === 'cash').balanceCents, 120000);
  assert.equal(state.accounts.find((item) => item.id === 'loan').balanceCents, 20000);
  assert.equal(totals(state).netAssetsCents, totals(freshLedger()).netAssetsCents);
});
test('recordLoanPrincipalRepayment reduces cash and principal together', () => {
  const borrowed = recordBorrowing(freshLedger(), { id: 'borrow', date: '2028-01-05', cashAccountId: 'cash', loanAccountId: 'loan', amountCents: 20000 });
  const repaid = recordLoanPrincipalRepayment(borrowed, { id: 'principal', date: '2028-01-06', cashAccountId: 'cash', loanAccountId: 'loan', amountCents: 5000 });
  assert.equal(repaid.accounts.find((item) => item.id === 'cash').balanceCents, 115000);
  assert.equal(repaid.accounts.find((item) => item.id === 'loan').balanceCents, 15000);
});
test('recordLoanInterestPayment is fixed expense and does not consume controlled budget', () => {
  const state = recordLoanInterestPayment(freshLedger(), { id: 'interest', date: '2028-01-07', cashAccountId: 'cash', loanAccountId: 'loan', amountCents: 1000 });
  assert.equal(state.accounts.find((item) => item.id === 'cash').balanceCents, 99000);
  assert.equal(state.budgetPeriods[0].netBudgetSpendCents, 0);
  assert.equal(state.transactions.at(-1).expenseKind, 'fixed');
});
test('recordLoanInterestAccrual increases loan liability as a fixed interest event', () => {
  const state = recordLoanInterestAccrual(freshLedger(), { id: 'interest-accrued', date: '2028-01-07', loanAccountId: 'loan', amountCents: 1000 });
  assert.equal(state.accounts.find((item) => item.id === 'loan').balanceCents, 1000);
  assert.equal(state.transactions.at(-1).expenseKind, 'fixed');
});
test('recordInvestmentBuy converts cash into investment value without changing net assets', () => {
  const before = totals(freshLedger());
  const state = recordInvestmentTrade(freshLedger(), { id: 'buy', date: '2028-01-08', side: 'buy', cashAccountId: 'cash', investmentAccountId: 'fund', amountCents: 5000 });
  assert.deepEqual(totals(state), before);
  assert.equal(state.accounts.find((item) => item.id === 'fund').costBasisCents, 55000);
});
test('recordInvestmentSell converts investment value back to cash without budget impact', () => {
  const state = recordInvestmentTrade(freshLedger(), { id: 'sell', date: '2028-01-08', side: 'sell', cashAccountId: 'cash', investmentAccountId: 'fund', amountCents: 5000 });
  assert.equal(state.accounts.find((item) => item.id === 'cash').balanceCents, 105000);
  assert.equal(state.accounts.find((item) => item.id === 'fund').balanceCents, 45000);
  assert.equal(state.budgetPeriods[0].netBudgetSpendCents, 0);
});
test('setInvestmentValue accepts a manual current value without a market lookup', () => assert.equal(setInvestmentValue(freshLedger(), { id: 'valuation', date: '2028-01-09', investmentAccountId: 'fund', currentValueCents: 60000 }).accounts.find((item) => item.id === 'fund').balanceCents, 60000));
test('recordRewardPayment decreases reward balance and cash but not budget', () => {
  const state = recordRewardPayment(freshLedger(), { id: 'reward-pay', date: '2028-01-10', accountId: 'cash', amountCents: 3000 });
  assert.equal(state.rewardBalanceCents, 7000);
  assert.equal(state.accounts.find((item) => item.id === 'cash').balanceCents, 97000);
  assert.equal(state.budgetPeriods[0].netBudgetSpendCents, 0);
});
test('recordExpense can partially use reward balance without charging that part to budget', () => {
  const state = recordExpense(freshLedger(), { id: 'reward-offset', date: '2028-01-10', accountId: 'cash', amountCents: 3000, rewardOffsetCents: 1000, budgetPeriodId: 'p1', categoryLevel1: '奖励抵扣' });
  assert.equal(state.rewardBalanceCents, 9000);
  assert.equal(state.budgetPeriods[0].netBudgetSpendCents, 2000);
  assert.equal(state.transactions.at(-1).budgetImpactCents, 2000);
});
test('recordRewardPayment rejects a payment larger than reward balance', () => assert.throws(() => recordRewardPayment(freshLedger(), { id: 'too-much', date: '2028-01-10', accountId: 'cash', amountCents: 10001 }), /reward balance/));
test('recordRefund restores an open ordinary expense to the same budget period', () => {
  const spent = recordExpense(freshLedger(), { id: 'ordinary', date: '2028-01-11', accountId: 'cash', amountCents: 3000, budgetPeriodId: 'p1', categoryLevel1: '购物' });
  const refunded = recordRefund(spent, { id: 'refund', date: '2028-01-12', originalTransactionId: 'ordinary', amountCents: 3000 });
  assert.equal(refunded.budgetPeriods[0].netBudgetSpendCents, 0);
  assert.equal(refunded.rewardBalanceCents, 10000);
  assert.equal(refunded.accounts.find((item) => item.id === 'cash').balanceCents, 100000);
});
test('recordRefund of a closed ordinary period enters reward balance', () => {
  const spent = recordExpense(freshLedger(), { id: 'ordinary', date: '2028-01-11', accountId: 'cash', amountCents: 3000, budgetPeriodId: 'p1', categoryLevel1: '购物' });
  const closed = closeBudgetPeriod(spent, 'p1');
  const refunded = recordRefund(closed, { id: 'refund', date: '2028-02-01', originalTransactionId: 'ordinary', amountCents: 3000 });
  assert.equal(refunded.budgetPeriods[0].netBudgetSpendCents, 3000);
  assert.equal(refunded.rewardBalanceCents, 13000);
});
test('recordRefund of reward payment restores reward balance', () => {
  const paid = recordRewardPayment(freshLedger(), { id: 'reward-pay', date: '2028-01-10', accountId: 'cash', amountCents: 3000 });
  const refunded = recordRefund(paid, { id: 'reward-refund', date: '2028-01-11', originalTransactionId: 'reward-pay', amountCents: 3000 });
  assert.equal(refunded.rewardBalanceCents, 10000);
});
test('recordRefund of credit card expense reduces the liability', () => {
  const spent = recordExpense(freshLedger(), { id: 'card-spend', date: '2028-01-12', accountId: 'card', amountCents: 2000, budgetPeriodId: 'p1', categoryLevel1: '交通' });
  const refunded = recordRefund(spent, { id: 'card-refund', date: '2028-01-13', originalTransactionId: 'card-spend', amountCents: 2000 });
  assert.equal(refunded.accounts.find((item) => item.id === 'card').balanceCents, 0);
  assert.equal(refunded.budgetPeriods[0].netBudgetSpendCents, 0);
});
test('recordRefund fully restores a mixed budget and reward expense in one refund', () => {
  const spent = recordExpense(freshLedger(), { id: 'mixed-full', date: '2028-01-12', accountId: 'cash', amountCents: 10000, rewardOffsetCents: 3000, budgetPeriodId: 'p1', categoryLevel1: '混合支付' });
  const refunded = recordRefund(spent, { id: 'mixed-full-refund', date: '2028-01-13', originalTransactionId: 'mixed-full', amountCents: 10000 });
  assert.equal(refunded.budgetPeriods[0].netBudgetSpendCents, 0);
  assert.equal(refunded.rewardBalanceCents, 10000);
  assert.equal(refunded.transactions.at(-1).budgetImpactCents, -7000);
  assert.equal(refunded.transactions.at(-1).rewardImpactCents, 3000);
});
test('recordRefund restores two mixed partial refunds to exactly the original budget and reward amounts', () => {
  const spent = recordExpense(freshLedger(), { id: 'mixed-parts', date: '2028-01-12', accountId: 'cash', amountCents: 10000, rewardOffsetCents: 3000, budgetPeriodId: 'p1', categoryLevel1: '混合支付' });
  const first = recordRefund(spent, { id: 'mixed-parts-refund-1', date: '2028-01-13', originalTransactionId: 'mixed-parts', amountCents: 4000 });
  const second = recordRefund(first, { id: 'mixed-parts-refund-2', date: '2028-01-14', originalTransactionId: 'mixed-parts', amountCents: 6000 });
  assert.equal(second.budgetPeriods[0].netBudgetSpendCents, 0);
  assert.equal(second.rewardBalanceCents, 10000);
  assert.equal(second.transactions.filter((item) => item.relatedTransactionId === 'mixed-parts').reduce((sum, item) => sum - item.budgetImpactCents, 0), 7000);
  assert.equal(second.transactions.filter((item) => item.relatedTransactionId === 'mixed-parts').reduce((sum, item) => sum + item.rewardImpactCents, 0), 3000);
});
test('recordRefund allocates mixed refunds consistently when the larger refund arrives first', () => {
  const spent = recordExpense(freshLedger(), { id: 'mixed-order', date: '2028-01-12', accountId: 'cash', amountCents: 10000, rewardOffsetCents: 3000, budgetPeriodId: 'p1', categoryLevel1: '混合支付' });
  const first = recordRefund(spent, { id: 'mixed-order-refund-1', date: '2028-01-13', originalTransactionId: 'mixed-order', amountCents: 6000 });
  const second = recordRefund(first, { id: 'mixed-order-refund-2', date: '2028-01-14', originalTransactionId: 'mixed-order', amountCents: 4000 });
  assert.equal(second.budgetPeriods[0].netBudgetSpendCents, 0);
  assert.equal(second.rewardBalanceCents, 10000);
  assert.deepEqual(second.transactions.slice(-2).map((item) => [item.budgetImpactCents, item.rewardImpactCents]), [[-6000, 0], [-1000, 3000]]);
});
test('recordRefund keeps cumulative budget restoration capped in an open mixed expense', () => {
  const spent = recordExpense(freshLedger(), { id: 'mixed-cap', date: '2028-01-12', accountId: 'cash', amountCents: 10000, rewardOffsetCents: 3000, budgetPeriodId: 'p1', categoryLevel1: '混合支付' });
  const first = recordRefund(spent, { id: 'mixed-cap-refund-1', date: '2028-01-13', originalTransactionId: 'mixed-cap', amountCents: 8000 });
  const second = recordRefund(first, { id: 'mixed-cap-refund-2', date: '2028-01-14', originalTransactionId: 'mixed-cap', amountCents: 2000 });
  assert.equal(second.transactions.filter((item) => item.relatedTransactionId === 'mixed-cap').reduce((sum, item) => sum - item.budgetImpactCents, 0), 7000);
  assert.equal(second.transactions.filter((item) => item.relatedTransactionId === 'mixed-cap').reduce((sum, item) => sum + item.rewardImpactCents, 0), 3000);
});
test('recordRefund of a closed mixed expense follows the closed-period reward rule without changing budget spend', () => {
  const spent = recordExpense(freshLedger(), { id: 'mixed-closed', date: '2028-01-12', accountId: 'cash', amountCents: 10000, rewardOffsetCents: 3000, budgetPeriodId: 'p1', categoryLevel1: '混合支付' });
  const closed = closeBudgetPeriod(spent, 'p1');
  const first = recordRefund(closed, { id: 'mixed-closed-refund-1', date: '2028-02-01', originalTransactionId: 'mixed-closed', amountCents: 4000 });
  const second = recordRefund(first, { id: 'mixed-closed-refund-2', date: '2028-02-02', originalTransactionId: 'mixed-closed', amountCents: 6000 });
  assert.equal(second.budgetPeriods[0].netBudgetSpendCents, 7000);
  assert.equal(second.rewardBalanceCents, 17000);
});
test('recordRefund of a mixed credit card expense restores the card liability and split impacts', () => {
  const spent = recordExpense(freshLedger(), { id: 'mixed-card', date: '2028-01-12', accountId: 'card', amountCents: 10000, rewardOffsetCents: 3000, budgetPeriodId: 'p1', categoryLevel1: '混合支付' });
  const first = recordRefund(spent, { id: 'mixed-card-refund-1', date: '2028-01-13', originalTransactionId: 'mixed-card', amountCents: 6000 });
  const second = recordRefund(first, { id: 'mixed-card-refund-2', date: '2028-01-14', originalTransactionId: 'mixed-card', amountCents: 4000 });
  assert.equal(second.accounts.find((item) => item.id === 'card').balanceCents, 0);
  assert.equal(second.budgetPeriods[0].netBudgetSpendCents, 0);
  assert.equal(second.rewardBalanceCents, 10000);
});
test('recordRefund rejects more than the unrefunded original amount', () => {
  const spent = recordExpense(freshLedger(), { id: 'ordinary', date: '2028-01-11', accountId: 'cash', amountCents: 3000, budgetPeriodId: 'p1', categoryLevel1: '购物' });
  assert.throws(() => recordRefund(spent, { id: 'refund', date: '2028-01-12', originalTransactionId: 'ordinary', amountCents: 3001 }), /exceeds/);
});
test('createFixedPlan stores a revocable account-bound source', () => {
  const state = createFixedPlan(freshLedger(), { id: 'rent', name: '固定房租', amountCents: 5000, accountId: 'cash', categoryLevel1: '住房', source: 'manual plan' });
  assert.deepEqual(state.plans[0], { id: 'rent', name: '固定房租', amountCents: 5000, accountId: 'cash', categoryLevel1: '住房', source: 'manual plan', active: true });
});
test('executeFixedPlan posts a fixed expense with its plan source', () => {
  const planned = createFixedPlan(freshLedger(), { id: 'rent', amountCents: 5000, accountId: 'cash', categoryLevel1: '住房' });
  const state = executeFixedPlan(planned, { planId: 'rent', date: '2028-01-14' });
  assert.equal(state.accounts.find((item) => item.id === 'cash').balanceCents, 95000);
  assert.equal(state.transactions.at(-1).source, 'plan:rent');
  assert.equal(state.budgetPeriods[0].netBudgetSpendCents, 0);
});
test('executeFixedPlan creates a pending item when amount is not set', () => {
  const planned = createFixedPlan(freshLedger(), { id: 'variable', amountCents: null, accountId: 'cash', categoryLevel1: '账单' });
  const state = executeFixedPlan(planned, { planId: 'variable', date: '2028-01-14' });
  assert.equal(state.pendingItems[0].reason, 'amount_required');
  assert.equal(state.accounts.find((item) => item.id === 'cash').balanceCents, 100000);
});
test('executeFixedPlan creates a pending item when account balance is insufficient', () => {
  const planned = createFixedPlan(freshLedger(), { id: 'large', amountCents: 200000, accountId: 'cash', categoryLevel1: '账单' });
  const state = executeFixedPlan(planned, { planId: 'large', date: '2028-01-14' });
  assert.equal(state.pendingItems[0].reason, 'insufficient_balance');
  assert.equal(state.transactions.length, 0);
});
test('revokeFixedPlan prevents a revoked plan from posting', () => {
  const planned = createFixedPlan(freshLedger(), { id: 'rent', amountCents: 5000, accountId: 'cash', categoryLevel1: '住房' });
  const revoked = revokeFixedPlan(planned, 'rent');
  assert.equal(revoked.plans[0].active, false);
  assert.throws(() => executeFixedPlan(revoked, { planId: 'rent', date: '2028-01-14' }), /revoked/);
});
test('closeBudgetPeriod prevents later controlled expenses from rewriting the period', () => {
  const closed = closeBudgetPeriod(freshLedger(), 'p1');
  assert.equal(closed.budgetPeriods[0].status, 'closed');
  assert.throws(() => recordExpense(closed, { id: 'late', date: '2028-02-01', accountId: 'cash', amountCents: 100, budgetPeriodId: 'p1', categoryLevel1: '晚记' }), /closed/);
});
test('budgetForPeriod preserves signed carry in the actual budget calculation', () => {
  const state = addBudgetPeriod(freshLedger(), { id: 'debt', startDate: '2028-02-01', endDate: '2028-02-29', baseBudgetCents: 300000, carryCents: -350000 });
  assert.deepEqual(budgetForPeriod(state, 'debt'), { actualBudgetCents: 0, budgetDebtCents: -50000 });
});
test('totals keep assets, liabilities, net assets and reward balance separate', () => {
  const state = recordBorrowing(freshLedger(), { id: 'borrow', date: '2028-01-15', cashAccountId: 'cash', loanAccountId: 'loan', amountCents: 20000 });
  const result = totals(state);
  assert.equal(result.totalAssetsCents, 190000);
  assert.equal(result.totalLiabilitiesCents, 20000);
  assert.equal(result.netAssetsCents, 170000);
  assert.equal(result.rewardBalanceCents, 10000);
});
test('recordExpense rejects an asset payment that would make the account negative', () => assert.throws(() => recordExpense(freshLedger(), { id: 'too-much', date: '2028-01-15', accountId: 'cash', amountCents: 100001, budgetPeriodId: 'p1', categoryLevel1: '超支' }), /insufficient/));
test('recordTransfer rejects a self transfer instead of inventing a transaction', () => assert.throws(() => recordTransfer(freshLedger(), { id: 'self', date: '2028-01-15', fromAccountId: 'cash', toAccountId: 'cash', amountCents: 1 }), /differ/));
test('recordCreditCardRepayment rejects a payment larger than card liability', () => assert.throws(() => recordCreditCardRepayment(freshLedger(), { id: 'pay', date: '2028-01-15', fromAccountId: 'cash', creditCardAccountId: 'card', amountCents: 1 }), /exceeds/));
test('recordLoanPrincipalRepayment rejects a payment larger than loan liability', () => assert.throws(() => recordLoanPrincipalRepayment(freshLedger(), { id: 'pay', date: '2028-01-15', cashAccountId: 'cash', loanAccountId: 'loan', amountCents: 1 }), /exceeds/));
test('recordInvestmentTrade rejects selling more than current investment value', () => assert.throws(() => recordInvestmentTrade(freshLedger(), { id: 'sell', date: '2028-01-15', side: 'sell', cashAccountId: 'cash', investmentAccountId: 'fund', amountCents: 50001 }), /insufficient/));
test('recordExpense cannot use more reward offset than the expense', () => assert.throws(() => recordExpense(freshLedger(), { id: 'bad-offset', date: '2028-01-15', accountId: 'cash', amountCents: 100, rewardOffsetCents: 101, budgetPeriodId: 'p1', categoryLevel1: '奖励' }), /offset/));
test('recordExpense cannot spend reward balance that is not available', () => assert.throws(() => recordExpense(freshLedger(), { id: 'bad-reward', date: '2028-01-15', accountId: 'cash', amountCents: 100, rewardOffsetCents: 10001, budgetPeriodId: 'p1', categoryLevel1: '奖励' }), /offset/));
test('recordLoanInterestPayment keeps the related loan optional for a fixed interest bill', () => assert.equal(recordLoanInterestPayment(freshLedger(), { id: 'interest', date: '2028-01-15', cashAccountId: 'cash', amountCents: 100 }).transactions.at(-1).kind, 'fixed_expense'));
