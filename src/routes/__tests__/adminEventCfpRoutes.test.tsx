// Trasy grupy „Nabór prelegentów" studia wydarzenia (`/admin/events/<id>/cfp/*`).
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. ADRES GRUPY PROWADZI NIE TAM. `/cfp` przekierowuje na pierwszą podstronę;
//      rozjazd z `defaultSection` grupy w `eventStudioNav.ts` daje klik w nagłówek
//      grupy i wklejony link, które lądują na dwóch różnych ekranach.
//   2. EKRAN GUBI PARAMETR. Trasa czyta `$eventId` ze ścieżki; zgubiony parametr
//      nie wywraca ekranu, tylko pokazuje dane cudzego wydarzenia.
//   3. TYTUŁ ROZJEŻDŻA SIĘ Z SIDEBAREM. Ekran ma nosić ten sam klucz, co pozycja
//      w pasie - inaczej ta sama podstrona ma dwie nazwy.
//   4. STUDIO WCHODZI DO WYSZUKIWARKI - `noindex, nofollow` na każdej trasie.
//
// Właściciel ekranów (funkcja naboru prelegentów) rozszerza ten plik o treść
// swoich organizmów; wspólny kontrakt trasy mieszka w
// `src/test/events/studioSectionRouteCases.tsx`.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import {
  describeStudioSectionRoute,
  STUDIO_ROUTE_EVENT_ID,
} from "@/test/events/studioSectionRouteCases";
import { EVENT_STUDIO_NAV, EVENT_STUDIO_ROUTES } from "@/lib/events/eventStudioNav";

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

function stub(): SupabaseRpcStub {
  if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
  return h.rpc;
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});

const { Route: CfpIndexRoute } = await import("@/routes/admin.events_.$eventId.cfp.index");
const { Route: CfpSettingsRoute } = await import("@/routes/admin.events_.$eventId.cfp.settings");
const { Route: CfpFormRoute } = await import("@/routes/admin.events_.$eventId.cfp.form");
const { Route: CfpSubmissionsRoute } =
  await import("@/routes/admin.events_.$eventId.cfp.submissions");
const { Route: CfpReviewersRoute } = await import("@/routes/admin.events_.$eventId.cfp.reviewers");

/** STRAZNIK, nie rzutowanie - bez niego wywolanie idzie po typie `Function`. */
function isBeforeLoad(
  value: unknown,
): value is (ctx: { params: Record<string, string> }) => unknown {
  return typeof value === "function";
}

describe("/admin/events/$eventId/cfp - adres grupy", () => {
  it("przekierowuje (307) na pozycje domyslna grupy `cfp`, z identyfikatorem wydarzenia", () => {
    const cfp = EVENT_STUDIO_NAV.find((node) => node.key === "cfp");
    if (cfp === undefined || cfp.kind !== "group") throw new Error("test: brak grupy cfp");

    const beforeLoad: unknown = CfpIndexRoute.options.beforeLoad;
    if (!isBeforeLoad(beforeLoad)) throw new Error("test: trasa grupy nie ma beforeLoad");
    let rzut: unknown = null;
    try {
      beforeLoad({ params: { eventId: STUDIO_ROUTE_EVENT_ID } });
    } catch (error) {
      rzut = error;
    }

    expect(rzut).toMatchObject({
      status: 307,
      options: {
        to: EVENT_STUDIO_ROUTES[cfp.defaultSection],
        params: { eventId: STUDIO_ROUTE_EVENT_ID },
      },
    });
  });
});

describeStudioSectionRoute({
  route: CfpSettingsRoute,
  path: "/admin/events/$eventId/cfp/settings",
  sectionKey: "cfpSettings",
  documentTitle: "Call for speakers · Settings · Event · Admin",
  rpc: stub,
});

describeStudioSectionRoute({
  route: CfpFormRoute,
  path: "/admin/events/$eventId/cfp/form",
  sectionKey: "cfpForm",
  documentTitle: "Call for speakers · Submission form · Event · Admin",
  rpc: stub,
});

describeStudioSectionRoute({
  route: CfpSubmissionsRoute,
  path: "/admin/events/$eventId/cfp/submissions",
  sectionKey: "cfpSubmissions",
  documentTitle: "Call for speakers · Submissions · Event · Admin",
  rpc: stub,
});

describeStudioSectionRoute({
  route: CfpReviewersRoute,
  path: "/admin/events/$eventId/cfp/reviewers",
  sectionKey: "cfpReviewers",
  documentTitle: "Call for speakers · Reviewers · Event · Admin",
  rpc: stub,
});
