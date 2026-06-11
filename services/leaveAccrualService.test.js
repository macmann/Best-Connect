const { test } = require('node:test');
const assert = require('assert');
const Module = require('module');

const originalLoad = Module._load;
Module._load = function loadWithMongoStub(request, parent, isMain) {
  if (request === 'mongodb') {
    return {
      MongoClient: class MongoClientStub {
        connect() { return Promise.resolve(); }
        db() { return {}; }
      }
    };
  }
  return originalLoad.apply(this, arguments);
};

const {
  buildEmployeeLeaveState,
  getCurrentCycleRange,
  normalizeLeaveBalanceEntry,
  roundToOneDecimal,
  DEFAULT_LEAVE_BALANCES,
  getNegativeBalanceLimit
} = require('./leaveAccrualService');

function createEmployee(startDate, endDate) {
  return {
    id: 1,
    internshipStartDate: startDate,
    endDate
  };
}

function runState(employee, applications, asOfDate) {
  const cycleRange = getCurrentCycleRange(asOfDate);
  const { balances } = buildEmployeeLeaveState(employee, applications, {
    asOfDate,
    cycleRange,
    holidays: []
  });
  return balances;
}

function leaveApplication(employeeId, type, from, to) {
  return { employeeId, type, from, to, status: 'approved' };
}

test('Full cycle accrual without leave produces full entitlement', () => {
  const asOfDate = new Date('2025-06-30');
  const employee = createEmployee(new Date('2020-01-01'));
  const balances = runState(employee, [], asOfDate);

  assert.equal(balances.annual.balance, 10);
  assert.equal(balances.casual.balance, 5);
  assert.equal(balances.medical.balance, 14);
});

test('Overrides to yearly allocations are reflected in accrual totals', () => {
  const asOfDate = new Date('2025-06-30');
  const employee = {
    ...createEmployee(new Date('2020-01-01')),
    leaveBalances: {
      annual: { yearlyAllocation: 15 },
      casual: { yearlyAllocation: 6 },
      medical: { yearlyAllocation: 12 }
    }
  };
  const balances = runState(employee, [], asOfDate);

  assert.equal(balances.annual.balance, 15);
  assert.equal(balances.casual.balance, 6);
  assert.equal(balances.medical.balance, 12);
});

test('Full cycle accrual with taken leave reduces balances', () => {
  const asOfDate = new Date('2025-06-30');
  const employee = createEmployee(new Date('2020-01-01'));
  const apps = [
    leaveApplication(employee.id, 'annual', '2024-10-07', '2024-10-08'),
    leaveApplication(employee.id, 'casual', '2025-03-10', '2025-03-10')
  ];

  const balances = runState(employee, apps, asOfDate);

  assert.equal(balances.annual.balance, 8);
  assert.equal(balances.casual.balance, 4);
  assert.equal(balances.medical.balance, 14);
});

test('Taken leave calculation supports mixed-case leave types', () => {
  const asOfDate = new Date('2025-06-30');
  const employee = createEmployee(new Date('2020-01-01'));
  const apps = [leaveApplication(employee.id, 'Annual', '2024-10-07', '2024-10-08')];

  const balances = runState(employee, apps, asOfDate);

  assert.equal(balances.annual.taken, 2);
  assert.equal(balances.annual.balance, 8);
});

test('Mid-cycle joining prorates from the actual start date', () => {
  const asOfDate = new Date('2025-06-30');
  const employee = createEmployee(new Date('2024-11-15'));
  const balances = runState(employee, [], asOfDate);

  const proratedMonths = (16 / 30) + 7;
  assert.equal(balances.annual.balance, roundToOneDecimal((10 / 12) * proratedMonths));
  assert.equal(balances.casual.balance, roundToOneDecimal((5 / 12) * proratedMonths));
  assert.equal(balances.medical.balance, roundToOneDecimal((14 / 12) * proratedMonths));
});

test('Mid-cycle departure stops accrual after exit month', () => {
  const asOfDate = new Date('2025-03-01');
  const employee = createEmployee(new Date('2024-07-01'), new Date('2025-01-10'));
  const balances = runState(employee, [], asOfDate);

  const proratedMonths = 6 + (10 / 31);
  assert.equal(balances.annual.balance, roundToOneDecimal((10 / 12) * proratedMonths));
  assert.equal(balances.casual.balance, roundToOneDecimal((5 / 12) * proratedMonths));
  assert.equal(balances.medical.balance, roundToOneDecimal((14 / 12) * proratedMonths));
});

test('Negative balances are produced when leave exceeds accrual', () => {
  const asOfDate = new Date('2024-12-31');
  const employee = createEmployee(new Date('2024-07-01'));
  const apps = [leaveApplication(employee.id, 'annual', '2024-09-02', '2024-09-09')];

  const balances = runState(employee, apps, asOfDate);

  assert(balances.annual.balance < 0);
});

test('Recalculation is idempotent for the same inputs', () => {
  const asOfDate = new Date('2025-06-30');
  const employee = createEmployee(new Date('2024-07-01'));
  const balancesFirst = runState(employee, [], asOfDate);
  const balancesSecond = runState(employee, [], asOfDate);

  assert.deepStrictEqual(balancesFirst, balancesSecond);
});

test('Accrued balances are capped at the yearly allocation', () => {
  const asOfDate = new Date('2025-07-31');
  const cycleRange = {
    start: new Date('2024-07-01'),
    end: new Date('2025-07-31')
  };
  const employee = createEmployee(new Date('2020-01-01'));
  const { balances } = buildEmployeeLeaveState(employee, [], { cycleRange, asOfDate, holidays: [] });

  assert.equal(balances.annual.balance, 10);
  assert.equal(balances.casual.balance, 5);
  assert.equal(balances.medical.balance, 14);
});


test('Manual leave adjustments increase or decrease computed balances', () => {
  const asOfDate = new Date('2025-06-30');
  const employee = {
    ...createEmployee(new Date('2020-01-01')),
    leaveBalances: {
      annual: { manualAdjustment: 1.5 },
      casual: { manualAdjustment: -1 },
      medical: { manualAdjustment: 0 }
    }
  };
  const balances = runState(employee, [], asOfDate);

  assert.equal(balances.annual.balance, 11.5);
  assert.equal(balances.annual.manualAdjustment, 1.5);
  assert.equal(balances.casual.balance, 4);
  assert.equal(balances.casual.manualAdjustment, -1);
});

test('Normalization caps stored balances and accrued values at allocations', () => {
  const defaults = DEFAULT_LEAVE_BALANCES.annual;
  const normalized = normalizeLeaveBalanceEntry({ balance: 10.8, accrued: 10.8 }, defaults);

  assert.equal(normalized.balance, defaults.yearlyAllocation);
  assert.equal(normalized.accrued, defaults.yearlyAllocation);
});


test('Six month leave cycles use Jan-Jun and Jul-Dec boundaries', () => {
  const firstHalf = getCurrentCycleRange(new Date('2026-03-15'), { durationMonths: 6 });
  assert.equal(firstHalf.start.toISOString().slice(0, 10), '2026-01-01');
  assert.equal(firstHalf.end.toISOString().slice(0, 10), '2026-06-30');

  const secondHalf = getCurrentCycleRange(new Date('2026-07-01'), { durationMonths: 6 });
  assert.equal(secondHalf.start.toISOString().slice(0, 10), '2026-07-01');
  assert.equal(secondHalf.end.toISOString().slice(0, 10), '2026-12-31');
});

test('Negative balance limits are configured per leave type', () => {
  assert.equal(getNegativeBalanceLimit('annual'), 2);
  assert.equal(getNegativeBalanceLimit('medical'), 2);
  assert.equal(getNegativeBalanceLimit('casual'), 1);
});
