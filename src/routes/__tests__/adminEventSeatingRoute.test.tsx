// Trasa „Plan sali" studia wydarzenia (`/admin/events/<id>/registration/seating`).
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. EKRAN GUBI PARAMETR - pokazuje plan sali cudzego wydarzenia.
//   2. TYTUŁ ROZJEŻDŻA SIĘ Z SIDEBAREM - ta sama podstrona ma dwie nazwy.
//   3. STUDIO WCHODZI DO WYSZUKIWARKI - `noindex, nofollow`.
//   4. OTWARTY PLAN GUBI ADRES - `?map=<id>` nie dochodzi do panelu albo
//      „otwórz” / „wstecz” nie zmienia adresu, więc linku do planu nie da się
//      wysłać, a „wstecz” w przeglądarce nie wraca do listy.
//
// Wspólny kontrakt trasy mieszka w `src/test/events/studioSectionRouteCases.tsx`;
// organizm planu sali ma własne pliki - tutaj jest ATRAPĄ oddającą propsy.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import { renderRoute, routeSearchValidator } from "@/test/routeHarness";
import {
  STUDIO_ROUTE_EVENT_ID,
  describeStudioSectionRoute,
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
vi.mock("@/lib/i18n-admin-event-seating", () => ({ ensureSeatingI18n: () => undefined }));
vi.mock("@/components/admin/events/organisms/SeatingPanel", () => ({
  SeatingPanel: (props: {
    eventId: string;
    eventSlug: string;
    eventTitle: string;
    mapId: string | null;
    onOpenMap: (mapId: string | null) => void;
  }) => (
    <div data-testid="panel-planu">
      <span>{`wydarzenie:${props.eventId}|${props.eventSlug}|${props.eventTitle}`}</span>
      <span>{`plan:${props.mapId ?? "lista"}`}</span>
      <button type="button" onClick={() => props.onOpenMap("m-2")}>
        otworz
      </button>
      <button type="button" onClick={() => props.onOpenMap(null)}>
        wstecz
      </button>
    </div>
  ),
}));

function stub(): SupabaseRpcStub {
  if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
  return h.rpc;
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});

const { Route } = await import("@/routes/admin.events_.$eventId.registration.seating");

describeStudioSectionRoute({
  route: Route,
  path: "/admin/events/$eventId/registration/seating",
  sectionKey: "registrationSeating",
  documentTitle: "Seating plan · Event · Admin",
  rpc: stub,
});

describe("/admin/events/$eventId/registration/seating - otwarty plan w adresie", () => {
  const PATH = "/admin/events/$eventId/registration/seating";
  const ENTRY = PATH.replace("$eventId", STUDIO_ROUTE_EVENT_ID);

  function wydarzenie() {
    stub().setData("admin_event_detail", [
      {
        id: STUDIO_ROUTE_EVENT_ID,
        slug: "kongres",
        title_pl: "Kongres Energetyczny",
        title_en: "Energy Congress",
      },
    ]);
  }

  it("walidator adresu przepuszcza tylko niepusty identyfikator planu", () => {
    const validate = routeSearchValidator(Route);
    expect(validate({ map: "m-1" })).toEqual({ map: "m-1" });
    expect(validate({ map: "" })).toEqual({});
    expect(validate({ map: 42 })).toEqual({});
    expect(validate({})).toEqual({});
  });

  it("bez `?map=` panel pokazuje listę planów wydarzenia ze ścieżki", async () => {
    wydarzenie();
    await renderRoute({ route: Route, path: PATH, initialEntry: ENTRY });

    await waitFor(() => expect(screen.getByText("plan:lista")).toBeTruthy());
    expect(
      screen.getByText(`wydarzenie:${STUDIO_ROUTE_EVENT_ID}|kongres|Kongres Energetyczny`),
    ).toBeTruthy();
  });

  it("`?map=` otwiera plan, a „otwórz” i „wstecz” zmieniają adres", async () => {
    wydarzenie();
    const view = await renderRoute({ route: Route, path: PATH, initialEntry: `${ENTRY}?map=m-1` });

    await waitFor(() => expect(screen.getByText("plan:m-1")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "otworz" }));
    await waitFor(() => expect(view.search()).toEqual({ map: "m-2" }));
    expect(view.currentPath()).toBe(ENTRY);
    await waitFor(() => expect(screen.getByText("plan:m-2")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "wstecz" }));
    await waitFor(() => expect(view.search()).toEqual({}));
    await waitFor(() => expect(screen.getByText("plan:lista")).toBeTruthy());
  });
});
