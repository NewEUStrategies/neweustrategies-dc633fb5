// Trasa „Lejek Google Ads" studia wydarzenia (`/admin/events/<id>/ads-funnel`).
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. EKRAN GUBI PARAMETR - pokazuje lejek cudzego wydarzenia.
//   2. TYTUŁ ROZJEŻDŻA SIĘ Z SIDEBAREM - ta sama pozycja ma dwie nazwy.
//   3. STUDIO WCHODZI DO WYSZUKIWARKI - `noindex, nofollow`.
//
//   4. EKRAN NIE DOSTAJE WIERSZA WYDARZENIA - organizm lejka liczy okres,
//      kampanie i eksport dla `row.id`; trasa ma mu oddac TEN wiersz, ktory
//      wczytala rama.
//
// Wspolny kontrakt trasy mieszka w `src/test/events/studioSectionRouteCases.tsx`;
// tresc ekranu testuje `EventAdsFunnelPanel.test.tsx`.
import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import {
  describeStudioSectionRoute,
  STUDIO_ROUTE_EVENT_ID,
} from "@/test/events/studioSectionRouteCases";
import { renderRoute } from "@/test/routeHarness";

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
vi.mock("@/lib/i18n-admin-event-ads-funnel", () => ({ ensureAdsFunnelI18n: () => undefined }));
vi.mock("@/components/admin/events/organisms/EventAdsFunnelPanel", () => ({
  EventAdsFunnelPanel: ({ row }: { row: { id: string; slug: string } }) => (
    <div data-testid="ads-funnel-panel">{`${row.id}|${row.slug}`}</div>
  ),
}));

function stub(): SupabaseRpcStub {
  if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
  return h.rpc;
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});

const { Route } = await import("@/routes/admin.events_.$eventId.ads-funnel");

describeStudioSectionRoute({
  route: Route,
  path: "/admin/events/$eventId/ads-funnel",
  sectionKey: "adsFunnel",
  documentTitle: "Google Ads funnel · Event · Admin",
  rpc: stub,
});

describe("/admin/events/$eventId/ads-funnel - tresc ekranu", () => {
  it("organizm lejka dostaje wiersz wydarzenia ze sciezki, a naglowek - opis ekranu", async () => {
    stub().setData("admin_event_detail", [
      {
        id: STUDIO_ROUTE_EVENT_ID,
        slug: "kongres-2026",
        title_pl: "Kongres",
        title_en: "Congress",
      },
    ]);
    await renderRoute({
      route: Route,
      path: "/admin/events/$eventId/ads-funnel",
      initialEntry: `/admin/events/${STUDIO_ROUTE_EVENT_ID}/ads-funnel`,
    });
    await waitFor(() =>
      expect(screen.getByTestId("ads-funnel-panel").textContent).toBe(
        `${STUDIO_ROUTE_EVENT_ID}|kongres-2026`,
      ),
    );
    expect(screen.getByText("adminEventAdsFunnel.description")).toBeInTheDocument();
  });
});
