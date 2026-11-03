import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PageHeader } from "@/components/app-shell";
import { InvoiceEditor } from "@/components/invoice-editor";

export const Route = createFileRoute("/_authenticated/invoices/new")({
  head: () => ({ meta: [{ title: "New invoice | WRRCS" }, { name: "description", content: "Create an invoice with line items, discount, tax, and payment options." }, { property: "og:title", content: "New invoice | WRRCS" }, { property: "og:description", content: "Create an invoice with line items, discount, tax, and payment options." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: NewInvoicePage,
  errorComponent: ({ error }) => <div className="p-8 text-sm text-destructive">{(error as Error).message}</div>,
});

function NewInvoicePage() {
  const navigate = useNavigate();
  return (
    <>
      <PageHeader title="New invoice" subtitle="Build the invoice your client will receive." />
      <div className="max-w-4xl mx-auto w-full px-6 md:px-8 py-6">
        <InvoiceEditor onCancel={() => navigate({ to: "/invoices" })} />
      </div>
    </>
  );
}
