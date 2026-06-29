const { db } = require('../db');
const {
  DEFAULT_LEAVE_BALANCES,
  SUPPORTED_LEAVE_TYPES,
  cloneDefaultLeaveBalances,
  getLeaveCycleSettings
} = require('../services/leaveAccrualService');

async function cleanLeaveTableForReset() {
  await db.read();
  db.data = db.data || {};
  db.data.applications = Array.isArray(db.data.applications) ? db.data.applications : [];
  db.data.employees = Array.isArray(db.data.employees) ? db.data.employees : [];
  db.data.settings = db.data.settings && typeof db.data.settings === 'object' ? db.data.settings : {};

  const removedApplications = db.data.applications.length;
  db.data.applications = [];

  const resetTimestamp = new Date().toISOString();
  let updatedEmployees = 0;

  db.data.employees.forEach(employee => {
    if (!employee || typeof employee !== 'object') return;

    const balances = cloneDefaultLeaveBalances();
    SUPPORTED_LEAVE_TYPES.forEach(type => {
      const previous = employee.leaveBalances?.[type] && typeof employee.leaveBalances[type] === 'object'
        ? employee.leaveBalances[type]
        : {};
      const yearlyAllocation = Number.isFinite(Number(previous.yearlyAllocation))
        ? Number(previous.yearlyAllocation)
        : DEFAULT_LEAVE_BALANCES[type].yearlyAllocation;

      balances[type] = {
        ...DEFAULT_LEAVE_BALANCES[type],
        yearlyAllocation,
        monthlyAccrual: yearlyAllocation / 12,
        accrued: 0,
        taken: 0,
        balance: 0,
        manualAdjustment: 0
      };
    });

    balances.cycleStart = employee.leaveBalances?.cycleStart || null;
    balances.cycleEnd = employee.leaveBalances?.cycleEnd || null;
    balances.lastAccrualRun = null;
    balances.lastManualResetAt = resetTimestamp;
    balances.cycleDurationMonths = employee.leaveBalances?.cycleDurationMonths || getLeaveCycleSettings(db.data.settings?.leaveCycle).durationMonths;

    const changed = JSON.stringify(employee.leaveBalances || {}) !== JSON.stringify(balances);
    employee.leaveBalances = balances;
    if (changed) updatedEmployees += 1;
  });

  db.data.settings.leaveCycle = db.data.settings.leaveCycle && typeof db.data.settings.leaveCycle === 'object'
    ? { ...db.data.settings.leaveCycle, lastManualResetAt: resetTimestamp }
    : { lastManualResetAt: resetTimestamp };

  await db.write();

  return {
    removedApplications,
    updatedEmployees,
    processedEmployees: db.data.employees.length,
    resetTimestamp
  };
}

module.exports = { cleanLeaveTableForReset };

if (require.main === module) {
  cleanLeaveTableForReset()
    .then(result => {
      console.log(`Leave table cleaned: removed ${result.removedApplications} leave rows and reset ${result.updatedEmployees}/${result.processedEmployees} employees to 0 / 0 / 0.`);
      process.exit(0);
    })
    .catch(error => {
      console.error('Failed to clean leave table for reset:', error);
      process.exit(1);
    });
}
