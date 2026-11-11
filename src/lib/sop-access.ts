// Everyone on the team can read active SOPs; only these roles can see drafts
// or add, edit, duplicate, import or delete SOPs.
const SOP_MANAGER_ROLES = ["owner", "manager", "super_admin"];

export function canManageSops(roles: readonly string[]): boolean {
  return roles.some((r) => SOP_MANAGER_ROLES.includes(r));
}
