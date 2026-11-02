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