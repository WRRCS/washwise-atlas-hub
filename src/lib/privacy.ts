/**
 * Helpers for permission-gated private data (CPNI).
 *
 * Client email / phone / billing address and employee email / phone / wages are
 * NOT readable through the Data API by signed-in users — column privileges were
 * revoked. The only way to read them is through the permission-checked
 * SECURITY DEFINER functions below, which return nothing (or nulls) unless the
 * caller is an owner or has been granted the matching permission flag.
 */

export type ClientContact = {
  id: string;
  email: string | null;
  phone: string | null;
  billing_address: string | null;
  client_sop: string | null;
};

const EMPTY: ClientContact = { id: "", email: null, phone: null, billing_address: null, client_sop: null };

/** Map of client_id -> contact info. Empty when the caller lacks CPNI access. */
export async function clientContactMap(
  supabase: any,
  ids?: (string | null | undefined)[],
): Promise<Map<string, ClientContact>> {
  const clean = (ids ?? []).filter((v): v is string => !!v);
  if (ids && clean.length === 0) return new Map();
  const { data } = await supabase.rpc(
    "client_contact_info",
    clean.length ? { _ids: clean } : {},
  );
  return new Map<string, ClientContact>(
    (data ?? []).map((r: ClientContact) => [r.id, r]),
  );
}

/** Contact info for one client, all-null when the caller lacks CPNI access. */
export async function clientContact(supabase: any, id: string): Promise<ClientContact> {
  const map = await clientContactMap(supabase, [id]);
  return map.get(id) ?? { ...EMPTY, id };
}

export type StaffMember = {
  id: string;
  tenant_id: string;
  full_name: string | null;
  avatar_url: string | null;
  is_active: boolean | null;
  email: string | null;
  phone: string | null;
  hourly_rate_cents: number | null;
};

/**
 * Tenant roster. Email/phone are null unless the viewer is an owner or has
 * can_view_employee_contacts; wages are null unless owner or can_view_wages.
 * Your own row always includes your own details.
 */
export async function staffDirectory(supabase: any): Promise<StaffMember[]> {
  const { data, error } = await supabase.rpc("staff_directory");
  if (error) throw new Error(error.message);
  return (data ?? []) as StaffMember[];
}
