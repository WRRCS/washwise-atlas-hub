export function ownSopConfirmation(rows: { job_id: string; employee_id: string; confirmed_at: string }[], jobId: string, cleanerId: string) {
  return rows.find((row) => row.job_id === jobId && row.employee_id === cleanerId)?.confirmed_at ?? null;
}