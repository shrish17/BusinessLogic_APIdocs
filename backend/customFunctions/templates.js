/* backend/customFunctions/templates.js */

const templates = {
    "cross-collection-lookup": {
        name: "Cross-Collection Lookup",
        description: "Lookup a related record from another collection.",
        code: `// Wrap execution inside custom logic
const employeeId = req.body.employeeId;
if (!employeeId) {
    return { error: 'employeeId is required in request body' };
}

// Fetch employee details
const employees = await helpers.db.get('employees', { _id: employeeId });
if (!employees || employees.length === 0) {
    return { error: 'Employee not found' };
}
const employee = employees[0];

// Fetch department using the reference ID
let departmentName = 'None';
if (employee.department) {
    const depts = await helpers.db.get('departments', { _id: employee.department });
    if (depts && depts.length > 0) {
        departmentName = depts[0].name;
    }
}

return {
    employeeName: employee.name,
    employeeEmail: employee.email,
    departmentName
};`
    },
    "create-log": {
        name: "Create and Log",
        description: "Create a new log entry in database dynamically.",
        code: `const action = req.body.action || 'system_event';
const details = req.body.details || {};

const logRecord = {
    action,
    details,
    timestamp: new Date().toISOString()
};

const result = await helpers.db.create('logs', logRecord);
return {
    success: true,
    message: 'Log record created successfully',
    insertedId: result.insertedId
};`
    },
    "basic-passthrough": {
        name: "Basic Passthrough",
        description: "Simple echo template returning query params and request body.",
        code: `return {
    message: "Execution active!",
    receivedBody: req.body,
    receivedQuery: req.query,
    timestamp: new Date().toISOString()
};`
    }
};

module.exports = templates;
