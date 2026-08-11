import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actualBudgetCents,
  addDays,
  applyBudgetChange,
  budgetSnapshot,
  budgetDebtCents,
  cycleForDate,
  cycleForMonth,
  dateDistance,
  daysInMonth,
  normalizedStartDay,
  planStartDayChange,
  releaseSchedule,
  releasedCents,
  settleBudgetCycle,
} from '../src/domain/budget.js';

test('daysInMonth returns 29 days for a leap February', () => assert.equal(daysInMonth(2028, 2), 29));
test('daysInMonth rejects a month outside the calendar', () => assert.throws(() => daysInMonth(2028, 13), /month/));
test('normalizedStartDay uses the month end when day 31 is absent', () => assert.equal(normalizedStartDay(2028, 2, 31), 29));
test('cycleForMonth uses a normalized start and exact next start distance', () => {
  const cycle = cycleForMonth(2028, 2, 31, 31000);
  assert.deepEqual(cycle, { startDate: '2028-02-29', endDate: '2028-03-30', totalDays: 31, baseBudgetCents: 31000, kind: 'regular' });
});
test('cycleForDate selects the previous cycle before the monthly start', () => assert.equal(cycleForDate('2028-02-10', 15).startDate, '2028-01-15'));
test('cycleForDate selects the current cycle on its start day', () => assert.equal(cycleForDate('2028-02-15', 15).startDate, '2028-02-15'));
test('addDays crosses a month boundary without changing the date string contract', () => assert.equal(addDays('2028-02-28', 2), '2028-03-01'));
test('dateDistance counts both the start and end through a one-day cycle distance', () => assert.equal(dateDistance('2028-02-29', '2028-03-01'), 1));
test('releasedCents returns zero before the first day', () => assert.equal(releasedCents(300000, 0, 30), 0));
test('releasedCents releases the full budget on the last day', () => assert.equal(releasedCents(330000, 31, 31), 330000));
test('releaseSchedule has the requested number of actual-day releases', () => assert.equal(releaseSchedule(330000, 31).length, 31));
test('releaseSchedule sums exactly to 330000 cents for 3300 yuan over 31 days', () => assert.equal(releaseSchedule(330000, 31).reduce((sum, cents) => sum + cents, 0), 330000));
test('releaseSchedule neighboring releases differ by at most one cent', () => {
  const schedule = releaseSchedule(330000, 31);
  assert.ok(schedule.every((cents, index) => index === 0 || Math.abs(cents - schedule[index - 1]) <= 1));
});
test('budgetSnapshot leaves 50 cents available after 50 cents on day one of a 3000 yuan month', () => {
  const snapshot = budgetSnapshot({ actualBudgetCents: 300000, elapsedDays: 1, totalDays: 30, netBudgetSpendCents: 50 });
  assert.equal(snapshot.todayAvailableCents, 9950);
  assert.equal(snapshot.prepaidCents, 0);
});
test('budgetSnapshot clamps today availability to zero after spending exceeds released budget', () => {
  const snapshot = budgetSnapshot({ actualBudgetCents: 300000, elapsedDays: 2, totalDays: 30, netBudgetSpendCents: 25000 });
  assert.equal(snapshot.todayAvailableCents, 0);
  assert.equal(snapshot.prepaidCents, 5000);
});
test('budgetSnapshot reports day six as recovery after a 500 yuan first-day spend', () => {
  const snapshot = budgetSnapshot({ actualBudgetCents: 300000, elapsedDays: 2, totalDays: 30, netBudgetSpendCents: 50000, startDate: '2028-01-01' });
  assert.equal(snapshot.todayAvailableCents, 0);
  assert.equal(snapshot.prepaidCents, 30000);
  assert.equal(snapshot.earliestRecoveryDay, 6);
  assert.equal(snapshot.earliestRecoveryDate, '2028-01-06');
});
test('budgetSnapshot reports a negative debt when negative carry exceeds the base budget', () => {
  const snapshot = budgetSnapshot({ actualBudgetCents: -100000, elapsedDays: 1, totalDays: 30, netBudgetSpendCents: 0 });
  assert.equal(snapshot.usableBudgetCents, 0);
  assert.equal(snapshot.budgetDebtCents, -100000);
  assert.equal(snapshot.todayAvailableCents, 0);
});
test('actualBudgetCents clamps an over-large negative carry to zero usable budget', () => assert.equal(actualBudgetCents(300000, -350000), 0));
test('budgetDebtCents preserves the unfulfilled negative carry separately', () => assert.equal(budgetDebtCents(300000, -350000), -50000));
test('applyBudgetChange only changes the current cycle for only_current', () => assert.deepEqual(applyBudgetChange({ currentBudgetCents: 300000, defaultBudgetCents: 300000, newBudgetCents: 350000, scope: 'only_current' }), { currentBudgetCents: 350000, defaultBudgetCents: 300000, scope: 'only_current' }));
test('applyBudgetChange changes the current cycle and template for current_and_future', () => assert.equal(applyBudgetChange({ currentBudgetCents: 300000, defaultBudgetCents: 300000, newBudgetCents: 350000, scope: 'current_and_future' }).defaultBudgetCents, 350000));
test('applyBudgetChange preserves the current cycle for next_and_future', () => assert.deepEqual(applyBudgetChange({ currentBudgetCents: 300000, defaultBudgetCents: 300000, newBudgetCents: 350000, scope: 'next_and_future' }), { currentBudgetCents: 300000, defaultBudgetCents: 350000, scope: 'next_and_future' }));
test('settleBudgetCycle does not preselect a decision for a positive surplus', () => {
  const settled = settleBudgetCycle({ baseBudgetCents: 300000, carryCents: 0, netBudgetSpendCents: 250000 });
  assert.equal(settled.positiveSurplusCents, 50000);
  assert.equal(settled.decisionRequired, true);
  assert.equal(settled.nextCarryCents, null);
});
test('settleBudgetCycle carries all positive surplus only after carry is selected', () => assert.equal(settleBudgetCycle({ baseBudgetCents: 300000, carryCents: 0, netBudgetSpendCents: 250000, decision: 'carry' }).nextCarryCents, 50000));
test('settleBudgetCycle discards all positive surplus only after discard is selected', () => assert.equal(settleBudgetCycle({ baseBudgetCents: 300000, carryCents: 0, netBudgetSpendCents: 250000, decision: 'discard' }).nextCarryCents, 0));
test('settleBudgetCycle carries all overspend as signed debt after carry is selected', () => {
  const settled = settleBudgetCycle({ baseBudgetCents: 300000, carryCents: 0, netBudgetSpendCents: 350000, decision: 'carry' });
  assert.equal(settled.grossDebtCents, 50000);
  assert.equal(settled.nextCarryCents, -50000);
});
test('settleBudgetCycle discards overspend debt after the user explicitly chooses discard', () => {
  const settled = settleBudgetCycle({ baseBudgetCents: 300000, carryCents: 0, netBudgetSpendCents: 350000, decision: 'discard' });
  assert.equal(settled.grossDebtCents, 50000);
  assert.equal(settled.nextCarryCents, 0);
});
test('settleBudgetCycle carries inherited debt forward when the zero-budget period has no new spend', () => {
  const settled = settleBudgetCycle({ baseBudgetCents: 300000, carryCents: -350000, netBudgetSpendCents: 0, decision: 'carry' });
  assert.equal(settled.actualBudgetCents, 0);
  assert.equal(settled.budgetDebtCents, -50000);
  assert.equal(settled.nextCarryCents, -50000);
});
test('settleBudgetCycle reports a zero result without requiring a user decision', () => {
  const settled = settleBudgetCycle({ baseBudgetCents: 300000, carryCents: 0, netBudgetSpendCents: 300000 });
  assert.equal(settled.resultCents, 0);
  assert.equal(settled.decisionRequired, false);
  assert.equal(settled.nextCarryCents, 0);
});
test('planStartDayChange closes the old cycle before creating a one-time transition', () => {
  const plan = planStartDayChange({ currentDate: '2028-07-28', oldStartDay: 1, newStartDay: 15, defaultMonthlyBudgetCents: 310000 });
  assert.equal(plan.oldCycle.startDate, '2028-07-01');
  assert.equal(plan.transition.startDate, '2028-08-01');
  assert.equal(plan.transition.endDate, '2028-08-14');
  assert.equal(plan.transition.totalDays, 14);
  assert.equal(plan.transition.baseBudgetCents, Math.floor(310000 * 14 / 31));
  assert.equal(plan.nextCycle.startDate, '2028-08-15');
});
test('planStartDayChange keeps historical old-cycle dates unchanged', () => assert.equal(planStartDayChange({ currentDate: '2028-07-28', oldStartDay: 1, newStartDay: 15, defaultMonthlyBudgetCents: 310000 }).oldCycle.endDate, '2028-07-31'));
test('budgetSnapshot accepts a refund as negative net budget spend', () => assert.equal(budgetSnapshot({ actualBudgetCents: 300000, elapsedDays: 1, totalDays: 30, netBudgetSpendCents: -100 }).todayAvailableCents, 10100));
test('releaseSchedule supports a zero-budget period without division rounding errors', () => assert.deepEqual(releaseSchedule(0, 3), [0, 0, 0]));
