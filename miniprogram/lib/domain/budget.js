// GENERATED FILE. Run npm run build:mini.
function integer(value, label) {
  if (!Number.isInteger(value)) throw new TypeError(`${label} must be an integer`);
  return value;
}

function nonNegativeInteger(value, label) {
  integer(value, label);
  if (value < 0) throw new RangeError(`${label} must not be negative`);
  return value;
}

function daysInMonth(year, month) {
  integer(year, 'year');
  integer(month, 'month');
  if (month < 1 || month > 12) throw new RangeError('month must be between 1 and 12');
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function parseDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new TypeError('date must be YYYY-MM-DD');
  const [year, month, day] = date.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) throw new RangeError(`invalid date: ${date}`);
  return { year, month, day };
}

function formatDate({ year, month, day }) {
  return [year, month, day].map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0')).join('-');
}

function addDays(date, amount) {
  parseDate(date);
  integer(amount, 'amount');
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return formatDate({ year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() });
}

function dateDistance(startDate, endDate) {
  const start = new Date(`${parseDate(startDate) && startDate}T00:00:00Z`);
  const end = new Date(`${parseDate(endDate) && endDate}T00:00:00Z`);
  return Math.round((end - start) / 86400000);
}

function normalizedStartDay(year, month, startDay) {
  integer(startDay, 'startDay');
  if (startDay < 1 || startDay > 31) throw new RangeError('startDay must be between 1 and 31');
  return Math.min(startDay, daysInMonth(year, month));
}

function cycleForMonth(year, month, startDay, baseBudgetCents = 0, kind = 'regular') {
  const day = normalizedStartDay(year, month, startDay);
  const startDate = formatDate({ year, month, day });
  const nextMonth = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  const nextDay = normalizedStartDay(nextMonth.year, nextMonth.month, startDay);
  const nextStartDate = formatDate({ year: nextMonth.year, month: nextMonth.month, day: nextDay });
  return { startDate, endDate: addDays(nextStartDate, -1), totalDays: dateDistance(startDate, nextStartDate), baseBudgetCents: nonNegativeInteger(baseBudgetCents, 'baseBudgetCents'), kind };
}

function cycleForDate(date, startDay, baseBudgetCents = 0) {
  const point = parseDate(date);
  const candidate = cycleForMonth(point.year, point.month, startDay, baseBudgetCents);
  if (date >= candidate.startDate) return candidate;
  const previous = point.month === 1 ? { year: point.year - 1, month: 12 } : { year: point.year, month: point.month - 1 };
  return cycleForMonth(previous.year, previous.month, startDay, baseBudgetCents);
}

function nextCycleStartOnOrAfter(date, startDay) {
  const point = parseDate(date);
  const candidate = cycleForMonth(point.year, point.month, startDay).startDate;
  if (candidate >= date) return candidate;
  const next = point.month === 12 ? { year: point.year + 1, month: 1 } : { year: point.year, month: point.month + 1 };
  return cycleForMonth(next.year, next.month, startDay).startDate;
}

function planStartDayChange({ currentDate, oldStartDay, newStartDay, defaultMonthlyBudgetCents }) {
  nonNegativeInteger(defaultMonthlyBudgetCents, 'defaultMonthlyBudgetCents');
  const oldCycle = cycleForDate(currentDate, oldStartDay, defaultMonthlyBudgetCents);
  const transitionStartDate = addDays(oldCycle.endDate, 1);
  const newCycleStartDate = nextCycleStartOnOrAfter(transitionStartDate, newStartDay);
  const transitionEndDate = addDays(newCycleStartDate, -1);
  const transitionDays = dateDistance(transitionStartDate, newCycleStartDate);
  const transitionMonth = parseDate(transitionStartDate);
  const transitionBudgetCents = Math.floor(defaultMonthlyBudgetCents * transitionDays / daysInMonth(transitionMonth.year, transitionMonth.month));
  const nextCycle = cycleForDate(newCycleStartDate, newStartDay, defaultMonthlyBudgetCents);
  return {
    oldCycle,
    transition: { startDate: transitionStartDate, endDate: transitionEndDate, totalDays: transitionDays, baseBudgetCents: transitionBudgetCents, kind: 'transition' },
    nextCycle: { ...nextCycle, startDate: newCycleStartDate, kind: 'regular' },
  };
}

function releasedCents(totalBudgetCents, elapsedDays, totalDays) {
  nonNegativeInteger(totalBudgetCents, 'totalBudgetCents');
  nonNegativeInteger(elapsedDays, 'elapsedDays');
  positiveDays(totalDays);
  if (elapsedDays > totalDays) throw new RangeError('elapsedDays must not exceed totalDays');
  return Math.floor(totalBudgetCents * elapsedDays / totalDays);
}

function positiveDays(totalDays) {
  integer(totalDays, 'totalDays');
  if (totalDays < 1) throw new RangeError('totalDays must be positive');
}

function releaseSchedule(totalBudgetCents, totalDays) {
  nonNegativeInteger(totalBudgetCents, 'totalBudgetCents');
  positiveDays(totalDays);
  return Array.from({ length: totalDays }, (_, index) => releasedCents(totalBudgetCents, index + 1, totalDays) - releasedCents(totalBudgetCents, index, totalDays));
}

function budgetSnapshot({ actualBudgetCents, elapsedDays, totalDays, netBudgetSpendCents, startDate = null }) {
  integer(actualBudgetCents, 'actualBudgetCents');
  nonNegativeInteger(elapsedDays, 'elapsedDays');
  positiveDays(totalDays);
  integer(netBudgetSpendCents, 'netBudgetSpendCents');
  const usableBudgetCents = Math.max(0, actualBudgetCents);
  const budgetDebtCents = Math.min(0, actualBudgetCents);
  const released = releasedCents(usableBudgetCents, elapsedDays, totalDays);
  const fullSingleDayQuotaCents = Math.ceil(usableBudgetCents / totalDays);
  const todayAvailableCents = Math.max(0, released - netBudgetSpendCents);
  const prepaidCents = Math.max(0, netBudgetSpendCents - released);
  let recoveryDay = null;
  if (prepaidCents > 0) {
    for (let day = elapsedDays; day <= totalDays; day += 1) {
      if (releasedCents(usableBudgetCents, day, totalDays) - netBudgetSpendCents >= fullSingleDayQuotaCents) {
        recoveryDay = day;
        break;
      }
    }
  }
  return {
    actualBudgetCents,
    usableBudgetCents,
    budgetDebtCents,
    releasedCents: released,
    netBudgetSpendCents,
    todayAvailableCents,
    prepaidCents,
    fullSingleDayQuotaCents,
    earliestRecoveryDay: recoveryDay,
    earliestRecoveryDate: recoveryDay === null || startDate === null ? null : addDays(startDate, recoveryDay - 1),
  };
}

function actualBudgetCents(baseBudgetCents, carryCents) {
  nonNegativeInteger(baseBudgetCents, 'baseBudgetCents');
  integer(carryCents, 'carryCents');
  return Math.max(0, baseBudgetCents + carryCents);
}

function budgetDebtCents(baseBudgetCents, carryCents) {
  nonNegativeInteger(baseBudgetCents, 'baseBudgetCents');
  integer(carryCents, 'carryCents');
  return Math.min(0, baseBudgetCents + carryCents);
}

function applyBudgetChange({ currentBudgetCents, defaultBudgetCents, newBudgetCents, scope }) {
  nonNegativeInteger(currentBudgetCents, 'currentBudgetCents');
  nonNegativeInteger(defaultBudgetCents, 'defaultBudgetCents');
  nonNegativeInteger(newBudgetCents, 'newBudgetCents');
  if (!['only_current', 'current_and_future', 'next_and_future'].includes(scope)) throw new RangeError('unknown budget change scope');
  return {
    currentBudgetCents: scope === 'next_and_future' ? currentBudgetCents : newBudgetCents,
    defaultBudgetCents: scope === 'only_current' ? defaultBudgetCents : newBudgetCents,
    scope,
  };
}

function settleBudgetCycle({ baseBudgetCents, carryCents, netBudgetSpendCents, positiveMode = 'carry', overspendMode = 'carry', rewardBalanceCents = 0, rewardOffsetCents = 0 }) {
  nonNegativeInteger(baseBudgetCents, 'baseBudgetCents');
  integer(carryCents, 'carryCents');
  const rawActual = baseBudgetCents + carryCents;
  const actual = Math.max(0, rawActual);
  integer(netBudgetSpendCents, 'netBudgetSpendCents');
  nonNegativeInteger(rewardBalanceCents, 'rewardBalanceCents');
  nonNegativeInteger(rewardOffsetCents, 'rewardOffsetCents');
  if (!['carry', 'reward'].includes(positiveMode) || !['carry', 'reward'].includes(overspendMode)) throw new RangeError('unknown settlement mode');
  const usable = Math.max(0, actual);
  const difference = usable - netBudgetSpendCents;
  const positiveSurplus = Math.max(0, difference);
  const inheritedDebt = Math.max(0, -rawActual);
  const grossDebt = Math.max(0, -difference) + inheritedDebt;
  const rewardUsed = Math.min(rewardOffsetCents, rewardBalanceCents, grossDebt);
  const remainingDebt = grossDebt - rewardUsed;
  return {
    actualBudgetCents: actual,
    budgetDebtCents: -inheritedDebt,
    positiveSurplusCents: positiveSurplus,
    grossDebtCents: grossDebt,
    rewardUsedCents: rewardUsed,
    remainingDebtCents: remainingDebt,
    nextCarryCents: positiveSurplus > 0 && positiveMode === 'carry' ? positiveSurplus : (remainingDebt > 0 && overspendMode === 'carry' ? -remainingDebt : 0),
    rewardAddedCents: positiveSurplus > 0 && positiveMode === 'reward' ? positiveSurplus : 0,
    rewardBalanceAfterCents: rewardBalanceCents - rewardUsed + (positiveSurplus > 0 && positiveMode === 'reward' ? positiveSurplus : 0),
  };
}

module.exports = { daysInMonth, parseDate, formatDate, addDays, dateDistance, normalizedStartDay, cycleForMonth, cycleForDate, planStartDayChange, releasedCents, releaseSchedule, budgetSnapshot, actualBudgetCents, budgetDebtCents, applyBudgetChange, settleBudgetCycle };
