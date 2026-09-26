// Trasa „Faktury" studia wydarzenia (`/admin/events/<id>/registration/invoices`).
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. EKRAN GUBI PARAMETR - pokazuje faktury cudzego wydarzenia.
//   2. TYTUŁ ROZJEŻDŻA SIĘ Z SIDEBAREM - ta sama podstrona ma dwie nazwy.
//   3. STUDIO WCHODZI DO WYSZUKIWARKI - `noindex, nofollow`.
//
//   4. EKRAN DOSTAJE CUDZE WYDARZENIE - organizm faktur musi dostac `eventId`
//      z wiersza ramy, bo po nim filtruje zamowienia i dokumenty.
//
// Wspolny kontrakt trasy mieszka w `src/test/events/studioSectionRouteCases.tsx`;
// organizm ma wlasne testy (tu jest atrapa z identyfikatorem wydarzenia).
import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderRoute } from "@/test/routeHarness";

import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import {
  describeStudioSectionRoute,
  STUDIO_ROUTE_EVENT_ID,
} from "@/test/events/studioSectionRouteCases";

const h = vi.hoisted(() => ({ rpc: null as SupabaseRpcStub | null }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
      return h.rpc.rpc(name, args);
    },
  },
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-events", () => ({ ensureI18n: () => undefined }));
vi.mock("@/components/admin/events/organisms/EventInvoicesPanel", () => ({
  EventInvoicesPanel: ({ eventId }: { eventId: string }) => (
    <div data-testid="invoices-panel">{eventId}</div>
  ),
}));

function stub(): SupabaseRpcStub {
  if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
  return h.rpc;
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});

const { Route } = await import("@/routes/admin.events_.$eventId.registration.invoices");

describeStudioSectionRoute({
  route: Route,
  path: "/admin/events/$eventId/registration/invoices",
  sectionKey: "registrationInvoices",
  documentTitle: "Invoices · Event · Admin",
  rpc: stub,
});

describe("/admin/events/$eventId/registration/invoices - tresc ekranu", () => {
  it("rysuje organizm faktur dla wydarzenia z wiersza ramy studia", async () => {
    stub().setData("admin_event_detail", [
      { id: STUDIO_ROUTE_EVENT_ID, title_pl: "Kongres", title_en: "Congress" },
    ]);
    await renderRoute({
      route: Route,
      path: "/admin/events/$eventId/registration/invoices",
      initialEntry: `/admin/events/${STUDIO_ROUTE_EVENT_ID}/registration/invoices`,
    });
    await waitFor(() =>
      expect(screen.getByTestId("invoices-panel")).toHaveTextContent(STUDIO_ROUTE_EVENT_ID),
    );
  });
});
