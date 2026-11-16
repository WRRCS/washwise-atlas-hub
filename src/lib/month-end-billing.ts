/** Month-end-only clients get one invoice per month and no "cleaning complete" draft after each visit. */
export function wantsPerVisitClientDraft(client: { bill_monthly?: boolean | null } | null | undefined): boolean {
  return !client?.bill_monthly;
}
