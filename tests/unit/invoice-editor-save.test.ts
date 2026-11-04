import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const mocks = vi.hoisted(() => ({
  update: vi.fn(), create: vi.fn(), navigate: vi.fn(), invalidate: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useEffect: () => {},
  useMemo: (fn: () => unknown) => fn(),
  useState: (value: unknown) => [value, vi.fn()],
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: [] }),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../../src/lib/entities.functions", () => ({ listClients: vi.fn() }));
vi.mock("../../src/lib/client-properties.functions", () => ({ listClientProperties: vi.fn() }));
vi.mock("../../src/lib/invoices.functions", () => ({
  updateInvoice: mocks.update, createInvoice: mocks.create, getInvoiceEditorDefaults: vi.fn(),
}));

import { InvoiceEditor, type InvoiceEditorInitial } from "../../src/components/invoice-editor";

const initial: InvoiceEditorInitial = {
  id: "draft-123", client_id: "client-123", property_id: null, subject: "Saved subject",
  issue_date: "2026-11-04", payment_terms_days: 14, discount_cents: 0, tax_rate_bp: 0,
  client_message: "", terms_text: "", allow_card: true, allow_venmo: true, card_surcharge: false,
  line_items: [{ description: "Cleaning", details: "", quantity: 1, unitPriceStr: "45", service_date: "2026-11-04" }],
};
type Action = ReactElement<{ onClick?: () => Promise<void>; children?: unknown }>;
function actions(node: unknown): Action[] {
  if (Array.isArray(node)) return node.flatMap(actions);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Action;
  return [...(element.props.onClick ? [element] : []), ...actions(element.props.children)];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.update.mockResolvedValue({});
  mocks.create.mockResolvedValue({ id: "new-123" });
  mocks.invalidate.mockResolvedValue(undefined);
});

describe("existing draft save completion", () => {
  it.each([false, true])("exits the editor after persistence before navigation (send=%s)", async (thenSend) => {
    const onSaved = vi.fn();
    const tree = InvoiceEditor({ initial, onCancel: vi.fn(), onSaved });
    const saveActions = actions(tree).slice(-2);
    await saveActions[thenSend ? 1 : 0].props.onClick?.();
    expect(mocks.update).toHaveBeenCalledWith({ data: expect.objectContaining({ id: "draft-123", subject: "Saved subject" }) });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/invoices/$invoiceId", params: { invoiceId: "draft-123" }, search: thenSend ? { send: true } : {} });
    expect(onSaved.mock.invocationCallOrder[0]).toBeLessThan(mocks.navigate.mock.invocationCallOrder[0]);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("keeps edits open and does not navigate when saving fails", async () => {
    mocks.update.mockRejectedValueOnce(new Error("Save failed"));
    const onSaved = vi.fn();
    const tree = InvoiceEditor({ initial, onCancel: vi.fn(), onSaved });
    await actions(tree).at(-1)?.props.onClick?.();
    expect(onSaved).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});