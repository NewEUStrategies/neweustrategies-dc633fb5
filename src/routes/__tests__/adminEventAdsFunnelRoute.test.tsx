// Trasa „Lejek Google Ads" studia wydarzenia (`/admin/events/<id>/ads-funnel`).
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. EKRAN GUBI PARAMETR - pokazuje lejek cudzego wydarzenia.
//   2. TYTUŁ ROZJEŻDŻA SIĘ Z SIDEBAREM - ta sama pozycja ma dwie nazwy.
//   3. STUDIO WCHODZI DO WYSZUKIWARKI - `noindex, nofollow`.
//
// Właściciel ekranu (funkcja lejka Google Ads) rozszerza ten plik o treść
// swojego organizmu; wspólny kontrakt trasy mieszka w
// `src/test/events/studioSectionRouteCases.tsx`.
import { beforeEach, vi } from "vitest";

import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import { describeStudioSectionRoute } from "@/test/events/studioSectionRouteCases";

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

const { Route } = await import("@/routes/admin.events_.$eventId.ads-funnel");

describeStudioSectionRoute({
  route: Route,
  path: "/admin/events/$eventId/ads-funnel",
  sectionKey: "adsFunnel",
  documentTitle: "Google Ads funnel · Event · Admin",
  rpc: stub,
});
