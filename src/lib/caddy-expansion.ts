export function toggleCaddyEmployee(expanded: ReadonlySet<string>, employeeId: string) {
  const next = new Set(expanded);
  if (next.has(employeeId)) next.delete(employeeId);
  else next.add(employeeId);
  return next;
}

export function uniqueCaddyEmployees<T extends { id: string }>(employees: T[]) {
  return [...new Map(employees.map((employee) => [employee.id, employee])).values()];
}