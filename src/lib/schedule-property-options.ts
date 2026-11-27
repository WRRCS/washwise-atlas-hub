export type SchedulePropertyClient = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  service_address?: string | null;
};

export type SchedulePropertyLocation = {
  client_id: string;
  property_id: string;
  label: string;
  client_name: string;
  address: string;
};

export type SchedulePropertyOption = {
  clientId: string;
  propertyId: string;
  label: string;
  address: string;
  clientName: string;
};

function clientName(client: SchedulePropertyClient): string {
  return client.company_name?.trim()
    || [client.first_name, client.last_name].filter(Boolean).join(" ").trim()
    || "Client";
}

export function schedulePropertyValue(clientId: string, propertyId: string): string {
  return `${clientId}|${propertyId}`;
}

/** Property-first choices for New Job, retaining eligible client main addresses. */
export function schedulePropertyOptions(
  clients: SchedulePropertyClient[],
  locations: SchedulePropertyLocation[],
): SchedulePropertyOption[] {
  const options: SchedulePropertyOption[] = locations.map((location) => ({
    clientId: location.client_id,
    propertyId: location.property_id,
    label: location.label,
    address: location.address,
    clientName: location.client_name,
  }));

  for (const client of clients) {
    const address = client.service_address?.trim();
    if (!address) continue;
    const alreadyListed = locations.some(
      (location) => location.client_id === client.id && location.address.trim() === address,
    );
    if (alreadyListed) continue;
    options.push({
      clientId: client.id,
      propertyId: "__main",
      label: "Main address",
      address,
      clientName: clientName(client),
    });
  }

  return options.sort((a, b) =>
    a.clientName.localeCompare(b.clientName)
    || a.label.localeCompare(b.label)
    || a.address.localeCompare(b.address));
}

/** A property choice is authoritative for its client, including a main-address choice. */
export function schedulePropertySelection(
  options: SchedulePropertyOption[],
  value: string,
): Pick<SchedulePropertyOption, "clientId" | "propertyId"> | null {
  const selected = options.find((option) => schedulePropertyValue(option.clientId, option.propertyId) === value);
  return selected ? { clientId: selected.clientId, propertyId: selected.propertyId } : null;
}
