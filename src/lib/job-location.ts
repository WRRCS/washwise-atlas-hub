/** Appointment snapshots are authoritative; never fall back to a client default. */
export function jobLocation(job: {
  service_address?: string | null;
  service_location_label?: string | null;
  location_needs_review?: boolean;
  property?: { label?: string | null; address?: string | null } | null;
}) {
  const address = job.service_address?.trim() || job.property?.address?.trim() || null;
  const label = job.service_location_label?.trim() || job.property?.label?.trim() || null;
  return { address, label, display: address ? [label, address].filter(Boolean).join(" — ") : "Location needs review" };
}