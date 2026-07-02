import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { listEmployees, setRole } from "@/lib/entities.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/employees")({
  component: Employees,
  errorComponent: ({ error }) => <div className="p-8 text-sm text-destructive">{error.message}</div>,
});

function Employees() {
  const qc = useQueryClient();
  const listFn = useServerFn(listEmployees);
  const roleFn = useServerFn(setRole);
  const { data = [] } = useQuery({ queryKey: ["employees"], queryFn: () => listFn({}) });

  const toggle = async (user_id: string, current: string) => {
    const next = current === "owner" ? "employee" : "owner";
    try {
      await roleFn({ data: { user_id, role: next } });
      toast.success(`Set to ${next}`);
      qc.invalidateQueries({ queryKey: ["employees"] });
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
  };

  return (
    <>
      <PageHeader title="Employees" subtitle="Cleaners and owners. New signups arrive here as cleaners." />
      <div className="max-w-5xl mx-auto w-full px-6 md:px-8 py-8">
        <div className="grid gap-3">
          {data.map((p) => (
            <div key={p.id} className="bg-card p-5 rounded-xl ring-1 ring-black/5 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-full bg-clay-200 grid place-items-center font-medium">{(p.full_name ?? p.email ?? "?").slice(0,1).toUpperCase()}</div>
                <div>
                  <p className="text-base font-medium">{p.full_name ?? "—"}</p>
                  <p className="text-sm text-muted-foreground">{p.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-xs uppercase tracking-wider ${p.role === "owner" ? "text-brand" : "text-muted-foreground"}`}>{p.role}</span>
                <Button size="sm" variant="outline" onClick={() => toggle(p.id, p.role)}>
                  {p.role === "owner" ? "Demote to cleaner" : "Promote to owner"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
