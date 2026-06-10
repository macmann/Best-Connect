const { db } = require('../db');
const { getCurrentCycleRange, getLeaveCycleSettings, roundToOneDecimal } = require('../services/leaveAccrualService');

const DEFAULT_ENTITLEMENTS = {
  annual: 10,
  casual: 5,
  medical: 14
};

const SUPPORTED_LEAVE_TYPES = ['annual', 'casual', 'medical'];

function toDateOrNull(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? new Date(value) : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfDay(date) {
  if (!(date instanceof Date)) return null;
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function getCurrentLeaveCycle(dateNow = new Date(), settings = {}) {
  const cycle = getCurrentCycleRange(dateNow, getLeaveCycleSettings(settings));
  const yearLabel = cycle.durationMonths === 6
    ? `${cycle.start.getFullYear()}-${String(cycle.start.getMonth() + 1).padStart(2, '0')}`
    : `${cycle.start.getFullYear()}-${cycle.end.getFullYear()}`;
  return {
    cycleStart: cycle.start,
    cycleEnd: cycle.end,
    yearLabel,
    durationMonths: cycle.durationMonths
  };
}

function daysInclusive(start, end) {
  const startDate = startOfDay(start);
  const endDate = startOfDay(end);
  if (!startDate || !endDate || endDate < startDate) return 0;
  return Math.floor((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
}

function computeMonthsServedInCycle(employee, dateNow = new Date(), settings = {}) {
  const { cycleStart, cycleEnd } = getCurrentLeaveCycle(dateNow, settings);
  const now = startOfDay(new Date(dateNow));
  const primaryStart = toDateOrNull(employee?.internshipStartDate);
  const secondaryStart = toDateOrNull(employee?.fullTimeStartDate);
  const effectiveStartDate = primaryStart || secondaryStart || cycleStart;
  const effectiveStartForCycle = effectiveStartDate > cycleStart ? effectiveStartDate : cycleStart;
  const accrualEnd = cycleEnd < now ? cycleEnd : now;
  if (effectiveStartForCycle > accrualEnd) return 0;

  let monthEquivalents = 0;
  let cursor = new Date(effectiveStartForCycle.getFullYear(), effectiveStartForCycle.getMonth(), 1);
  while (cursor <= accrualEnd) {
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const activeStart = cursor < effectiveStartForCycle ? effectiveStartForCycle : cursor;
    const activeEnd = monthEnd > accrualEnd ? accrualEnd : monthEnd;
    const monthDays = daysInclusive(cursor, monthEnd);
    const activeDays = daysInclusive(activeStart, activeEnd);
    if (monthDays > 0 && activeDays > 0) monthEquivalents += activeDays / monthDays;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }

  const maxMonths = getLeaveCycleSettings(settings).durationMonths;
  if (!Number.isFinite(monthEquivalents) || monthEquivalents < 0) return 0;
  return Math.min(monthEquivalents, maxMonths);
}

function computeAccruedLeaveBalance({ yearEntitlement, monthsServedInCycle, totalLeaveTaken }) {
  const earned = roundToOneDecimal(yearEntitlement * (monthsServedInCycle / 12));
  const balance = roundToOneDecimal(earned - (totalLeaveTaken || 0));
  return { earned, balance };
}

function buildHolidaySet(holidays = []) {
  return new Set(
    (holidays || [])
      .map(entry => (typeof entry === 'string' ? entry : entry?.date))
      .filter(Boolean)
  );
}

function calculateLeaveDaysWithinRange(app, rangeStart, rangeEnd, holidaySet = new Set()) {
  const from = new Date(app.from);
  const to = new Date(app.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;

  const start = from < rangeStart ? new Date(rangeStart) : from;
  const end = to > rangeEnd ? new Date(rangeEnd) : to;
  if (end < start) return 0;

  if (app.halfDay) {
    if (from < rangeStart || from > rangeEnd) return 0;
    const day = from.getDay();
    const iso = from.toISOString().split('T')[0];
    return day === 0 || day === 6 || holidaySet.has(iso) ? 0 : 0.5;
  }

  let days = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    const day = cursor.getDay();
    const iso = cursor.toISOString().split('T')[0];
    if (day !== 0 && day !== 6 && !holidaySet.has(iso)) {
      days += 1;
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

async function computeAllLeaveBalances(employee, { dateNow = new Date(), applications, holidays, settings } = {}) {
  const { cycleStart, cycleEnd } = getCurrentLeaveCycle(dateNow, settings);
  const rangeStart = startOfDay(cycleStart);
  const today = startOfDay(dateNow);
  const rangeEnd = today && cycleEnd < today ? cycleEnd : today;

  if (!applications || !Array.isArray(applications)) {
    await db.read();
    applications = Array.isArray(db.data?.applications) ? db.data.applications : [];
    if (!holidays && Array.isArray(db.data?.holidays)) {
      holidays = db.data.holidays;
    }
    if (!settings && db.data?.settings) {
      settings = db.data.settings;
    }
  }

  const holidaySet = buildHolidaySet(holidays);
  const monthsServedInCycle = computeMonthsServedInCycle(employee, dateNow, settings);

  const totals = { annual: 0, casual: 0, medical: 0 };
  (applications || []).forEach(app => {
    if (!app || app.employeeId != employee?.id) return;
    const status = String(app.status || '').toLowerCase();
    if (status !== 'approved') return;
    const type = String(app.type || '').toLowerCase();
    if (!SUPPORTED_LEAVE_TYPES.includes(type)) return;
    const days = calculateLeaveDaysWithinRange(app, rangeStart, rangeEnd, holidaySet);
    totals[type] += days;
  });

  const balances = {};
  SUPPORTED_LEAVE_TYPES.forEach(type => {
    const overrideValue = Number(employee?.leaveBalances?.[type]?.yearlyAllocation);
    const entitlementValue = Number(employee?.[`${type}LeaveEntitlement`]);
    const yearEntitlement = Number.isFinite(overrideValue)
      ? overrideValue
      : Number.isFinite(entitlementValue)
        ? entitlementValue
        : DEFAULT_ENTITLEMENTS[type];
    const { earned: accruedEarned, balance: accruedBalance } = computeAccruedLeaveBalance({
      yearEntitlement,
      monthsServedInCycle,
      totalLeaveTaken: totals[type]
    });

    balances[type] = {
      entitlement: yearEntitlement,
      earned: accruedEarned,
      taken: roundToOneDecimal(totals[type] || 0),
      balance: accruedBalance
    };
  });

  return balances;
}

module.exports = {
  computeAccruedLeaveBalance,
  computeAllLeaveBalances,
  computeMonthsServedInCycle,
  getCurrentLeaveCycle,
  DEFAULT_ENTITLEMENTS,
  SUPPORTED_LEAVE_TYPES
};
