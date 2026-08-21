import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getBusinessProfile } from "@/lib/business-profile.functions";
import { DEFAULT_TZ } from "@/lib/tz";

/** The business timezone from Business profile; falls back to America/New_York. */
export function useBusinessTz(): string {
  const fn = useServerFn(getBusinessProfile);
  const { data } = useQuery({
    queryKey: ["business-profile"],
    queryFn: () => fn(),
    staleTime: 5 * 60_000,
  });
  return (data as any)?.timezone || DEFAULT_TZ;
}
