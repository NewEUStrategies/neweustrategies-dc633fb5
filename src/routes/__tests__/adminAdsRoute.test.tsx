// TRASA `/admin/ads` (807 linii i 71 funkcji przed ekstrakcją, 0% pokrycia) -
// panel, z którego redakcja steruje TYM, CO ŁADUJE SIĘ CZYTELNIKOWI: kreacjami
// stron trzecich, ich rozmieszczeniem i wymogiem zgody marketingowej.
//
// CO TEN PLIK DOWODZI - I DLACZEGO NIE JEST FARMĄ POKRYCIA.
// `adminRouteAuthority.gate.test.ts` argumentuje wprost, że render-testowanie
// tras panelu DLA POKRYCIA jest farmą: ryzyko w trasie panelu to DOSTĘP,
// egzekwowany w trzech miejscach (layout `/admin`, sama trasa, RLS/RPC).
// Tutaj przedmiotem dowodu jest coś innego i renderu wymaga: SKLEJENIE trasy.
// Po ekstrakcji trasa jest KOMPOZYCJĄ trzech organizmów, więc jedyne, co może
// się w niej zepsuć, to właśnie sklejenie:
//   1. KTÓRY PANEL JEST W OGÓLE ZAMONTOWANY. Zakładki Radiksa montują dokładnie
//      jedną zawartość, więc wejście na „Statystyki" jest MOMENTEM, w którym
//      odpala się N+1 zapytań liczących. Gdyby wszystkie trzy panele montowały
//      się naraz, samo otwarcie panelu reklam biłoby w `ad_events` przy każdym
//      wejściu - i nikt by tego nie zobaczył poza rachunkiem za bazę.
//   2. SŁOWNIK REJESTRUJE SIĘ PRZED PIERWSZYM ZAPYTANIEM. `ensureAdsAdminI18n()`
//      jest pierwszą instrukcją komponentu trasy (nazwane wiązanie, nie import
//      side-effectowy - dzięki temu splitter trzyma słownik w chunku trasy,
//      a anonimowy czytelnik go nie pobiera). Brak rejestracji = panel z gołymi
//      kluczami zamiast napisów.
//   3. TRASA NIE DEKLARUJE WŁASNEGO `head()`. `robots: noindex, nofollow`
//      przychodzi z RODZICA (`routes/admin.tsx`) i scala się w dół po
//      dopasowanym łańcuchu tras - jedno miejsce dla wszystkich tras panelu.
//      Test mówi to WPROST, zamiast asertować nagłówek na dziecku: dowód ma
//      opisywać mechanizm, który naprawdę chroni panel przed indeksowaniem.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Całe zachowanie paneli (ładunki zapisu, dialogi,
// stany awarii, liczniki) ma testy przy organizmach:
// `AdSlotsPanel.test.tsx`, `AdPlacementsPanel.test.tsx`, `AdStatsPanel.test.tsx`,
// a widoki - przy molekułach i atomach. Tutaj asercje dotyczą WYŁĄCZNIE tego,
// czego nie widać z poziomu organizmu.
//
// CZEGO TEN PLIK NIE DOWODZI (i nie udaje, że dowodzi). Autorytetu dostępu:
// `/admin/ads` jest chroniona bramką `isStaff` w layoucie `/admin` oraz RLS na
// `ad_slots` / `ad_placements` / `ad_events`. Harness montuje trasę pod
// zastępczym korzeniem, więc ani layout, ani RLS nie biorą w tym udziału -
// autorytet zostaje przy pgTAP i bramce `check:authz-snapshot`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { SupabaseFromStub } from "@/test/supabase";

const h = vi.hoisted(() => ({
  db: null as SupabaseFromStub | null,
  /** Ile razy trasa zarejestrowała swój słownik. */
  i18nRegistrations: 0,
  /** Stan licznika rejestracji w chwili PIERWSZEGO zapytania do bazy. */
  registrationsAtFirstQuery: -1,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-ads-admin", () => ({
  ensureI18n: () => {
    h.i18nRegistrations += 1;
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock("@/lib/adminToasts", () => ({
  adminToast: { saved: () => "adminToasts.saved", deleted: () => "adminToasts.deleted" },
}));
vi.mock("@/lib/appDialogs", () => ({ confirmDialog: () => Promise.resolve(false) }));
vi.mock("@/hooks/useInterests", () => ({
  useInterestCatalog: () => ({ data: { categories: [], tags: [] } }),
}));
// AdminShell ciągnie useAuth + ustawienia witryny + liczniki klubów (655 linii,
// własny <main>) - w teście sklejenia trasy jest wyłącznie szumem.
vi.mock("@/components/admin/AdminShell", () => ({
  AdminShell: ({ children }: { children?: React.ReactNode }) => children,
}));
vi.mock("@/components/ui/select", async () =>
  (await import("@/test/reactStubs")).radixSelectStub(await import("react")),
);
vi.mock("@/components/ui/switch", async () =>
  (await import("@/test/reactStubs")).radixSwitchStub(await import("react")),
);
vi.mock("@/components/ui/tabs", async () =>
  (await import("@/test/reactStubs")).radixTabsStub(await import("react")),
);
vi.mock("@/components/ui/datetime-picker", async () => {
  const react = await import("react");
  return {
    DateTimePicker: (p: { placeholder?: string }) =>
      react.createElement("button", { type: "button" }, p.placeholder),
  };
});
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabase");
  const db = supabaseFromStub();
  h.db = db;
  return {
    supabase: {
      from: (table: string) => {
        if (h.registrationsAtFirstQuery === -1) {
          h.registrationsAtFirstQuery = h.i18nRegistrations;
        }
        return db.from(table);
      },
    },
  };
});

import { Route } from "@/routes/admin.ads";
import { Route as AdminRoute } from "@/routes/admin";
import { renderRoute, routeMeta } from "@/test/routeHarness";
import { ok, okCount } from "@/test/supabase";
import type { AdSlot } from "@/lib/ads/types";

const SLOTS = [
  { id: "s1", name: "Baner góra" },
  { id: "s2", name: "Sidebar" },
] as AdSlot[];

function mount() {
  return renderRoute({ route: Route, path: "/admin/ads", initialEntry: "/admin/ads" });
}

beforeEach(() => {
  h.db?.reset();
  h.i18nRegistrations = 0;
  h.registrationsAtFirstQuery = -1;
  h.db?.setResponse("ad_slots", () => ok(SLOTS));
  h.db?.setResponse("ad_placements", () => ok([]));
  h.db?.setResponse("ad_events", () => okCount(0));
});

describe("trasa /admin/ads: sklejenie panelu", () => {
  it("nagłówek i trzy zakładki jadą z kluczy słownika", async () => {
    await mount();

    expect(screen.getByText("adsAdmin.title")).toBeTruthy();
    expect(screen.getByText("adsAdmin.subtitle")).toBeTruthy();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "adsAdmin.tabs.slots",
      "adsAdmin.tabs.placements",
      "adsAdmin.tabs.stats",
    ]);
  });

  it("startowo wybrana jest zakładka slotów - i tylko ona", async () => {
    await mount();

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
    expect(screen.getAllByRole("tabpanel").length).toBe(1);
  });

  it("wejście na panel NIE pyta o zdarzenia reklamowe - statystyki nie są zamontowane", async () => {
    await mount();
    await waitFor(() => expect(h.db!.chainsFor("ad_slots").length).toBeGreaterThan(0));

    expect(h.db!.chainsFor("ad_events")).toEqual([]);
    expect(h.db!.chainsFor("ad_placements")).toEqual([]);
  });

  it("dopiero zakładka 'Statystyki' odpala liczenie - po dwa zapytania na slot", async () => {
    await mount();
    await waitFor(() => expect(h.db!.chainsFor("ad_slots").length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole("tab", { name: "adsAdmin.tabs.stats" }));

    await waitFor(() => expect(h.db!.chainsFor("ad_events").length).toBe(4));
    expect(screen.getByText("adsAdmin.stats.impressions")).toBeTruthy();
  });

  it("zakładka 'Rozmieszczenie' montuje SWÓJ panel i odmontowuje poprzedni", async () => {
    await mount();
    await waitFor(() => expect(h.db!.chainsFor("ad_slots").length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole("tab", { name: "adsAdmin.tabs.placements" }));

    await waitFor(() => expect(h.db!.chainsFor("ad_placements").length).toBe(1));
    expect(screen.getByText("Brak pozycji.")).toBeTruthy();
    // Formularz slotu zniknął razem ze swoją zakładką.
    expect(screen.queryByText("adsAdmin.slots.addTitle")).toBeNull();
  });

  it("słownik rejestruje się PRZED pierwszym zapytaniem do bazy", async () => {
    await mount();
    await waitFor(() => expect(h.registrationsAtFirstQuery).toBeGreaterThan(-1));

    expect(h.registrationsAtFirstQuery).toBeGreaterThan(0);
  });
});

describe("trasa /admin/ads: nagłówek dokumentu", () => {
  it("trasa NIE deklaruje własnego head() - ani tytułu, ani robots", async () => {
    expect(Route.options.head).toBeUndefined();
    expect(await routeMeta(Route)).toEqual([]);
  });

  it("noindex przychodzi z RODZICA /admin i obowiązuje CAŁY panel", async () => {
    // Meta dopasowanych tras scalają się w dół, więc `/admin/ads` jest wyłączona
    // z indeksowania przez layout - nie przez własną deklarację. Trasa panelu
    // wystawiona POZA `/admin` straciłaby tę ochronę bez żadnego sygnału.
    const meta = await routeMeta(AdminRoute);
    expect(meta).toEqual(
      expect.arrayContaining([{ name: "robots", content: "noindex, nofollow" }]),
    );
  });

  it("trasa nie ma loadera ani walidacji adresu - cały stan powstaje po stronie klienta", () => {
    expect(Route.options.loader).toBeUndefined();
    expect(Route.options.validateSearch).toBeUndefined();
  });
});
