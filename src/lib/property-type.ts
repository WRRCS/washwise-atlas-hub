export type PropertyTypeDraft = { key: string; value: string };

export function selectedPropertyType(key: string, saved: string | null | undefined, draft: PropertyTypeDraft) {
  return saved?.trim() || (draft.key === key ? draft.value : "");
}

export function requirePropertyType(saved: string | null | undefined, supplied?: string | null) {
  const value = saved?.trim() || supplied?.trim();
  if (!value) throw new Error("Enter this property's type before saving; it will be remembered for future appointments");
  if (value.length > 60) throw new Error("Property type must be 60 characters or fewer");
  return value;
}

export type PropertyDefaults = {
  property_type?: string | null;
  default_service_type_id?: string | null;
};

/** The service saved on the property, or "" when none is saved yet. */
export function defaultServiceTypeId(property: PropertyDefaults | null | undefined) {
  return property?.default_service_type_id ?? "";
}

/** True when the chosen service differs from the property's saved default.
 *  A property with no saved default yet is not an override — the first
 *  successful appointment saves it automatically. */
export function serviceDefaultOverridden(property: PropertyDefaults | null | undefined, serviceTypeId: string) {
  const saved = defaultServiceTypeId(property);
  if (!saved || !serviceTypeId) return false;
  return serviceTypeId !== saved;
}