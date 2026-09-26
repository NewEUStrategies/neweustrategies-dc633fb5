// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW:
//
// Stan faktury przy bilecie w "Moich zgloszeniach": jedno zdanie z odnosnikiem
// do profilu faktur, albo nic (brak danych, brak platnosci, po terminie).
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { INVOICE_IDS, myInvoiceSourceRow } from "@/test/events/invoiceFixtures";

const h = vi.hoisted(() => ({ session: { user: { id: "u" } } as { user: { id: string } } | null }));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ session: h.session }) }));
const api = vi.hoisted(() => ({
  fetchMyInvoiceSources: vi.fn(),
  fetchMyInvoices: vi.fn(),
  saveInvoiceRequest: vi.fn(),
  cancelInvoiceRequest: vi.fn(),
}));
vi.mock("@/lib/events/myEventInvoicesApi", () => api);

const { EventInvoiceTicketStatus } =
  await import("@/components/events/invoices/atoms/EventInvoiceTicketStatus");

function renderTwo(ids: string[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      {ids.map((id) => (
        <EventInvoiceTicketStatus key={id} registrationId={id} />
      ))}
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  h.session = { user: { id: "u" } };
  api.fetchMyInvoiceSources.mockReset();
});

describe("EventInvoiceTicketStatus", () => {
  it("wystawiona, prosba, mozna poprosic - jedno zapytanie na wiele biletow", async () => {
    api.fetchMyInvoiceSources.mockResolvedValue([
      myInvoiceSourceRow({ source_id: "a", invoice_number: "FV/2026/09/0001", invoice_id: "i" }),
      myInvoiceSourceRow({ source_id: "b", request_status: "pending", request_id: "r" }),
      myInvoiceSourceRow({ source_id: "c" }),
      myInvoiceSourceRow({ source_id: "d", payment_state: "unpaid" }),
      myInvoiceSourceRow({ source_id: "e", can_request: false }),
      myInvoiceSourceRow({ source_id: "f", source_kind: "package_order" }),
    ]);
    renderTwo(["a", "b", "c", "d", "e", "f", "brak"]);
    await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(3));
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "eventInvoices.ticket.invoiced(number=FV/2026/09/0001)",
      "eventInvoices.ticket.requested",
      "eventInvoices.ticket.requestable",
    ]);
    expect(links[0].getAttribute("href")).toBe("/profile/invoices");
    expect(api.fetchMyInvoiceSources).toHaveBeenCalledTimes(1);
  });

  it("bez sesji nic nie pyta i nic nie rysuje", () => {
    h.session = null;
    const { container } = renderTwo([INVOICE_IDS.registration]);
    expect(container.textContent).toBe("");
    expect(api.fetchMyInvoiceSources).not.toHaveBeenCalled();
  });
});
