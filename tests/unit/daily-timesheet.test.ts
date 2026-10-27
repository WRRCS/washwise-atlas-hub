import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const builder = { middleware: () => builder, inputValidator: () => builder, handler: (handler: unknown) => handler };
    return builder;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
import { listDailyTimesheet } from "../../src/lib/visits.functions";

describe("daily timesheet editable clock records", () => {
  it.each([null, "2026-10-26T09:00:00Z"])("retains the original overnight start and end %s on both days", async (ended_at) => {
    const stored = { id: "entry", user_id: "employee", started_at: "2026-10-26T06:00:00Z", ended_at };
    const supabase = {
      rpc: async (name: string) => ({ data: name === "staff_directory" ? [{ id: "employee", full_name: "Test Cleaner" }] : true }),
      from: (table: string) => {
        const query: any = { then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data: table === "time_entries" ? [stored] : [], error: null }).then(resolve) };
        for (const method of ["select", "lt", "or", "gte", "neq", "eq"]) query[method] = () => query;
        return query;
      },
    };
    // Mocked builder exposes the real handler to test its returned editor data.
    const handler = listDailyTimesheet as unknown as (input: unknown) => Promise<any>;
    for (const [from, to] of [["2026-10-25T07:00:00Z", "2026-10-26T07:00:00Z"], ["2026-10-26T07:00:00Z", "2026-10-27T07:00:00Z"]]) {
      const result = await handler({ data: { from, to }, context: { supabase, userId: "employee" } });
      expect(result.entries[0].started_at).toBe("2026-10-26T06:00:00Z");
      expect(result.entries[0].ended_at).toBe(ended_at);
      expect({ from: result.from, to: result.to }).toEqual({ from, to });
    }
  });
});