// import.js
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { db, init } = require('./db');

(async () => {
  await init();
  await db.read();
  if (!db.data) db.data = { employees: [], applications: [], users: [] };

  const csvPath = path.join(__dirname, 'BrillarEmployees.csv');
  const csvText = fs.readFileSync(csvPath, 'utf-8');
  const rows = parse(csvText, { columns: true, skip_empty_lines: true });
  const start = Date.now();

  rows.forEach((row, i) => {
    const id = start + i;
    const employee = {
      id,
      name: row['Name'],
      status: row.Status?.toLowerCase() === 'inactive' ? 'inactive' : 'active',
      leaveBalances: {
        annual: {
          balance: Number(row['Annual Leave'] ?? 10),
          yearlyAllocation: 10,
          monthlyAccrual: 10 / 12
        },
        casual: {
          balance: Number(row['Casual Leave'] ?? 5),
          yearlyAllocation: 5,
          monthlyAccrual: 5 / 12
        },
        medical: {
          balance: Number(row['Medical Leave'] ?? 14),
          yearlyAllocation: 14,
          monthlyAccrual: 14 / 12
        },
        accrualStartDate: null,
        nextAccrualMonth: null
      },
      ...row
    };
    delete employee._id;
    db.data.employees.push(employee);
    db.data.users.push({
      id,
      email: row['Email'],
      password: 'brillar',
      role: row['Role']?.toLowerCase() === 'manager' ? 'manager' : 'employee',
      employeeId: id
    });
  });

  await db.write();
  console.log(`Imported ${rows.length} employees`);
})();
