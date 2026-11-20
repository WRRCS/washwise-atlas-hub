// Pure rule for what archiving a team member does to their sign-in.
// Owners are never blocked here so the business can't lock itself out of its
// own account; the same exemption already guards invite revocation.

export type StaffAccessChange = "block" | "restore" | "none";

export function signInAccessChange(input: {
  is_active: boolean | undefined;
  is_owner: boolean;
}): StaffAccessChange {
  if (input.is_active === undefined) return "none";
  if (input.is_active) return "restore";
  return input.is_owner ? "none" : "block";
}
