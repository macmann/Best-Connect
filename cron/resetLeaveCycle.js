const cron = require('node-cron');
const { db } = require('../db');
const {
  DEFAULT_LEAVE_BALANCES,
  SUPPORTED_LEAVE_TYPES,
  getCurrentCycleRange,
  cloneDefaultLeaveBalances,
  getLeaveCycleSettings
} = require('../services/leaveAccrualService');

async function resetLeaveCycle(now = new Date()) {
  await db.read();

  db.data = db.data || {};
  db.data.employees = Array.isArray(db.data.employees) ? db.data.employees : [];

  const employees = db.data.employees;
  let updatedCount = 0;

  db.data.settings = db.data.settings && typeof db.data.settings === 'object' ? db.data.settings : {};
  const settings = getLeaveCycleSettings(db.data.settings);
  const cycle = getCurrentCycleRange(now, settings);
  const today = new Date(now);
  if (
    today.getFullYear() !== cycle.start.getFullYear() ||
    today.getMonth() !== cycle.start.getMonth() ||
    today.getDate() !== cycle.start.getDate()
  ) {
    return { processed: employees.length, updated: 0, skipped: true };
  }

  employees.forEach(emp => {
    if (!emp || typeof emp !== 'object') return;

    const balances = cloneDefaultLeaveBalances();
    SUPPORTED_LEAVE_TYPES.forEach(type => {
      const defaults = DEFAULT_LEAVE_BALANCES[type];
      balances[type] = { ...defaults, balance: 0, accrued: 0, taken: 0 };
    });

    balances.cycleStart = cycle.start;
    balances.cycleEnd = cycle.end;
    balances.lastAccrualRun = null;
    balances.cycleDurationMonths = cycle.durationMonths;

    const hasChanges = JSON.stringify(emp.leaveBalances || {}) !== JSON.stringify(balances);
    emp.leaveBalances = balances;
    if (hasChanges) {
      updatedCount += 1;
    }
  });

  if (updatedCount > 0) {
    await db.write();
  }

  return { processed: employees.length, updated: updatedCount };
}

const resetLeaveCycleJob = cron.schedule('0 1 1 1,7 *', async () => {
  console.log('[CRON] Starting leave cycle reset job');
  try {
    const result = await resetLeaveCycle();
    console.log('[CRON] Leave cycle reset completed', result);
  } catch (error) {
    console.error('[CRON] Leave cycle reset failed', error);
  }
});

module.exports = resetLeaveCycleJob;
