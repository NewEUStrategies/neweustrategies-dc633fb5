// Trzy trasy sekcji Kupony B2B: UKŁAD `/admin/coupons` oraz dwa cienkie
// opakowania - `/admin/coupons/` (lista) i `/admin/coupons/campaigns`.
// Do dziś: wszystkie trzy na zerze.
//
// PO CO TEN PLIK. Kupon B2B to zobowiązanie finansowe - każdy kod obniża
// fakturę albo nadaje abonament. Organizmy pod tymi trasami mają własne,
// wyczerpujące testy (`CouponsListPage.test.tsx`, `CampaignsPage.test.tsx`),
// ale żaden z nich nie dotyka plików tras. A trasy niosą trzy rzeczy:
//
//   1. UKŁAD MUSI RENDEROWAĆ `<Outlet />`. W TanStack Router `Match`
//      renderuje ALBO własny komponent trasy, ALBO `<Outlet />` - nigdy oba.
//      Rodzic z własnym komponentem, który zapomni `<Outlet />`, montuje sam
//      siebie i na tym kończy: wszystkie cztery podstrony kuponów (lista,
//      kampanie, realizacje, analityka) stają się NIEOSIĄGALNE z przeglądarki,
//      a ich testy nadal są zielone. To nie hipoteza - dokładnie tak padło
//      `/events` (patrz `parentRoutesRenderOutlet.gate.test.ts`).
//   2. ZAKŁADKA MUSI WSKAZYWAĆ BIEŻĄCĄ PODSTRONĘ. „Kupony" dopasowuje się
//      DOKŁADNIE (`pathname === "/admin/coupons"`), reszta PREFIKSEM. Zamiana
//      tego warunku daje pasek, na którym pierwsza zakładka świeci się zawsze -
//      czyli nawigację, która nie mówi, gdzie się jest.
//   3. SKLEJENIE ADRESU Z ORGANIZMEM. Cztery trasy tego modułu różnią się
//      jednym importem; podmiana daje kampanie pod adresem listy (albo
//      odwrotnie) bez jednego czerwonego testu w testach komponentów.
//
// DZIECI UKŁADU SĄ TU ATRAPAMI (`PODSTRONA: ...`) - i to jest świadome:
// przedmiotem dowodu jest UKŁAD, czyli że dziecko w ogóle dostaje miejsce na
// ekranie i że zakładki reagują na adres. Prawdziwe panele biegną w testach
// swoich własnych tras (niżej w tym pliku oraz w plikach realizacji
// i analityki). Ten sam wzorzec stoi w `adminCrmLayoutRoutes.test.tsx`.
//
// ZMIANY ŚWIADOME (S1):
//   * napisy układu idą ze słownika `adminCoupons.layout.*` (był bliźniak
//     `L(pl, en)` w komponencie) - atrapa i18n oddaje KLUCZE, więc asercje
//     zakładek mierzą klucze, a parytet PL/EN pilnuje bramka słowników;
//   * każda trasa ma SEKCYJNE `adminPageHead` (D14) - dawne przypadki „nie
//     wnosi własnego head()" opisywały brak, który był defektem;
//   * trasy listy i kampanii są cienkimi opakowaniami czytającymi `?code=`
//     i `?id=` (SPEC §2.6), więc dowód sklejenia idzie przez render, nie przez
//     tożsamość `options.component`.
//
// GRANICE vs SĄSIEDZI: organizmy z `@/components/admin/coupons/**` biegną
// PRAWDZIWE (razem z `Stat` i dialogami). Atrapowane są wyłącznie granice:
// klient Supabase, toasty, i18n oraz prymitywy Radiksa, których happy-dom nie
// otwiera. ZERO SIECI, ZERO danych osobowych.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoute, type AnyRoute } from "@tanstack/react-router";
import { ok, type SupabaseFromStub } from "@/test/supabaseChain";
import { axeViolations, summarize } from "@/test/axe";

const h = vi.hoisted(() => ({
  from: null as unknown,
  rpc: vi.fn(),
  ensureI18n: vi.fn(),
  /** Język interfejsu widziany przez atrapę i18n. */
  lang: "pl",
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/i18n-admin-coupons", () => ({ ensureI18n: h.ensureI18n }));
vi.mock("@/lib/i18n-admin-paywall-sync", () => ({ ensureI18n: () => undefined }));
vi.mock("@/hooks/useNewsletterSettings", () => ({
  useNewsletterSettings: () => ({ data: { popup_mailing_lists: [] } }),
}));
vi.mock("@/lib/newsletter-campaigns.functions", () => ({ createCouponNewsletterCampaign: {} }));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  h.from = from;
  return { supabase: { from: from.from, rpc: h.rpc } };
});

vi.mock("@/components/ui/select", async () =>
  (await import("@/test/reactStubs")).radixSelectStub(await import("react")),
);
vi.mock("@/components/ui/switch", async () =>
  (await import("@/test/reactStubs")).radixSwitchStub(await import("react")),
);
// Radiksowy Dialog montuje treść w portalu i domyka fokus - pod happy-dom
// zostaje zamknięty. Atrapa renderuje wyłącznie wyzwalacz, bo w tym pliku
// nikt dialogu nie otwiera (ma własny plik testowy).
vi.mock("@/components/ui/dialog", async () => {
  const React = await import("react");
  return {
    Dialog: ({ children }: { children?: ReactNode }) => React.createElement("div", null, children),
    DialogTrigger: ({ children }: { children?: ReactNode }) =>
      React.createElement("div", null, children),
    DialogContent: () => null,
    DialogHeader: () => null,
    DialogTitle: () => null,
    DialogDescription: () => null,
    DialogFooter: () => null,
  };
});

import { renderRoute } from "@/test/routeHarness";
import { CouponsListPage } from "@/components/admin/coupons/organisms/CouponsListPage";
import { Route as CouponsLayoutRoute } from "@/routes/admin.coupons";
import { Route as CouponsIndexRoute } from "@/routes/admin.coupons.index";
import { Route as CouponsCampaignsRoute } from "@/routes/admin.coupons.campaigns";

const UKLAD = "/admin/coupons";
const db = () => h.from as SupabaseFromStub;

/** Wiersz kuponu w kształcie odczytu listy. */
const kuponTestowy = {
  id: "k-0",
  code: "NES-0000",
  name: null,
  description: null,
  discount_kind: "percent",
  discount_percent: 10,
  discount_cents: null,
  currency: null,
  active: true,
  max_redemptions: null,
  redemptions_count: 0,
  valid_from: null,
  valid_until: null,
  plan_ids: null,
  organization_id: null,
  metadata: {},
  created_at: "2026-10-01T10:00:00.000Z",
  updated_at: "2026-10-01T10:00:00.000Z",
  campaign_id: null,
  grants_tier_key: null,
  grants_duration_days: null,
  assigned_company_id: null,
  assigned_lead_id: null,
};

/** Wiersz kampanii kuponowej w kształcie odczytu listy (z tokenem `updated_at`). */
const kampaniaTestowa = {
  id: "k",
  name: "Kampania",
  prefix: "NES-",
  code_count: 10,
  generated_count: 0,
  discount_kind: "percent",
  discount_percent: 10,
  discount_cents: null,
  currency: null,
  valid_until: null,
  grants_tier_key: null,
  grants_duration_days: null,
  newsletter_segment: null,
  newsletter_campaign_id: null,
  status: "draft",
  created_at: "2026-10-01T10:00:00.000Z",
  updated_at: "2026-10-01T10:00:00.000Z",
};

function ZKlientem({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Układ z ATRAPAMI podstron - dowód dotyczy miejsca dla dziecka, nie dziecka. */
async function zamontujUklad(entry: string) {
  const uklad: AnyRoute = CouponsLayoutRoute;
  uklad.addChildren([
    createRoute({
      getParentRoute: () => uklad,
      path: "/",
      component: () => <div>PODSTRONA: lista</div>,
    }),
    createRoute({
      getParentRoute: () => uklad,
      path: "campaigns",
      component: () => <div>PODSTRONA: kampanie</div>,
    }),
    createRoute({
      getParentRoute: () => uklad,
      path: "redemptions",
      component: () => <div>PODSTRONA: realizacje</div>,
    }),
    createRoute({
      getParentRoute: () => uklad,
      path: "analytics",
      component: () => <div>PODSTRONA: analityka</div>,
    }),
  ]);
  return renderRoute({ route: uklad, path: UKLAD, initialEntry: entry });
}

/** Etykiety zakładek (klucze słownika - atrapa i18n oddaje je bez tłumaczenia). */
const ZAKLADKI = {
  lista: "adminCoupons.layout.tabs.list",
  kampanie: "adminCoupons.layout.tabs.campaigns",
  realizacje: "adminCoupons.layout.tabs.redemptions",
  analityka: "adminCoupons.layout.tabs.analytics",
} as const;

/** Zakładka paska nawigacji układu - po widocznej etykiecie. */
function zakladka(nazwa: string): HTMLElement {
  return screen.getByRole("tab", { name: nazwa });
}

beforeEach(() => {
  db().reset();
  h.rpc.mockReset().mockResolvedValue({ data: null, error: null });
  h.ensureI18n.mockClear();
  h.lang = "pl";
});

describe("układ /admin/coupons - miejsce dla podstron", () => {
  it("renderuje PODSTRONĘ w `<Outlet />`, a nie samego siebie", async () => {
    // Gdyby układ zgubił `<Outlet />`, ten test byłby jedynym miejscem
    // w repo, które by to zauważyło: panel kuponów wyglądałby poprawnie
    // (nagłówek + zakładki), a wszystkie cztery podstrony zniknęłyby.
    const view = await zamontujUklad(UKLAD);
    expect(view.currentPath()).toBe(UKLAD);
    expect(screen.getByText("PODSTRONA: lista")).toBeInTheDocument();
    cleanup();
  });

  it("pokazuje nagłówek sekcji i CZTERY zakładki podstron", async () => {
    await zamontujUklad(UKLAD);
    expect(
      screen.getByRole("heading", { name: /adminCoupons\.layout\.title/ }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      ZAKLADKI.lista,
      ZAKLADKI.kampanie,
      ZAKLADKI.realizacje,
      ZAKLADKI.analityka,
    ]);
    // Słownik kuponów rejestruje się w komponencie układu (chunk trasy).
    expect(h.ensureI18n).toHaveBeenCalled();
    cleanup();
  });

  it("pod adresem kampanii montuje kampanie - i NIE listę", async () => {
    await zamontujUklad("/admin/coupons/campaigns");
    expect(screen.getByText("PODSTRONA: kampanie")).toBeInTheDocument();
    expect(screen.queryByText("PODSTRONA: lista")).toBeNull();
    cleanup();
  });

  it("zakładka listy dopasowuje się DOKŁADNIE, nie prefiksem", async () => {
    // To jest cała różnica między paskiem, który mówi „jesteś w Kampaniach",
    // a paskiem, na którym zakładka listy świeci się pod każdym adresem sekcji.
    await zamontujUklad("/admin/coupons/campaigns");
    expect(zakladka(ZAKLADKI.lista)).toHaveAttribute("aria-selected", "false");
    expect(zakladka(ZAKLADKI.kampanie)).toHaveAttribute("aria-selected", "true");
    cleanup();
  });

  it("pod adresem sekcji wybrana jest zakładka listy, a reszta nie", async () => {
    await zamontujUklad(UKLAD);
    expect(zakladka(ZAKLADKI.lista)).toHaveAttribute("aria-selected", "true");
    expect(zakladka(ZAKLADKI.kampanie)).toHaveAttribute("aria-selected", "false");
    expect(zakladka(ZAKLADKI.realizacje)).toHaveAttribute("aria-selected", "false");
    expect(zakladka(ZAKLADKI.analityka)).toHaveAttribute("aria-selected", "false");
    cleanup();
  });

  it("kliknięcie zakładki PRZENOSI pod jej adres i wymienia treść pod paskiem", async () => {
    // Zakładki to `<Link>`, więc dowód musi przejść przez router: sam atrybut
    // `href` nie mówi, że nawigacja kończy się właściwym dopasowaniem.
    const view = await zamontujUklad(UKLAD);
    fireEvent.click(zakladka(ZAKLADKI.analityka));
    await waitFor(() => expect(view.currentPath()).toBe("/admin/coupons/analytics"));
    expect(screen.getByText("PODSTRONA: analityka")).toBeInTheDocument();
    expect(zakladka(ZAKLADKI.analityka)).toHaveAttribute("aria-selected", "true");
    cleanup();
  });

  it("pasek zakładek ma nazwę ze słownika (nie stały napis w jednym języku)", async () => {
    // Dawniej napisy układu stały w komponencie jako bliźniak `L(pl, en)`;
    // teraz idą ze słownika, a parytet PL/EN pilnuje bramka słowników.
    await zamontujUklad(UKLAD);
    expect(screen.getByRole("tablist", { name: "adminCoupons.layout.tabsLabel" })).toBeTruthy();
    cleanup();
  });

  it("układ ma SEKCYJNY tytuł karty i jest wyłączony z indeksu (D14)", () => {
    // Nagłówek układu czytamy wprost z opcji - harness oddaje `meta` LIŚCIA,
    // a dzieci układu są tu atrapami bez `head()`.
    const head = CouponsLayoutRoute.options.head as unknown as () => {
      meta: Record<string, unknown>[];
    };
    const meta = head().meta;
    expect(meta).toContainEqual({ title: "Kupony B2B | New European Strategies" });
    expect(meta).toContainEqual({ name: "robots", content: "noindex, nofollow" });
  });

  it("`?code=` przechodzi walidację, a śmieci są odrzucane bez wywrotki", async () => {
    // Deep link z huba (SPEC §2.6). Walidator stoi w pliku trasy, bo jedzie
    // w chunku wejściowym - bez importów i bez przycinania wartości.
    const ok1 = await zamontujUklad("/admin/coupons?code=NES-AB12");
    expect(ok1.search()).toEqual({ code: "NES-AB12" });
    cleanup();
    const zle = await zamontujUklad("/admin/coupons?code=%3Cscript%3E");
    expect(zle.search()).toEqual({});
    cleanup();
  });

  it("pasek zakładek nie ma naruszeń dostępności", async () => {
    const view = await zamontujUklad(UKLAD);
    const naruszenia = await axeViolations(view.container);
    expect(summarize(naruszenia)).toBe("");
    cleanup();
  });
});

describe("trasa /admin/coupons/ - lista kuponów", () => {
  const PATH = "/admin/coupons";

  function pustaBaza(): void {
    db().setResponse("b2b_coupons", ok([]));
    db().setResponse("access_plans", ok([]));
    db().setResponse("membership_tiers", ok([]));
  }

  it("montuje się POD SWOIM ADRESEM i pokazuje listę kuponów", async () => {
    pustaBaza();
    const view = await renderRoute({ route: CouponsIndexRoute, path: PATH, initialEntry: PATH });
    expect(view.currentPath()).toBe(PATH);
    expect(screen.getByText("adminCoupons.couponList")).toBeInTheDocument();
    // Dowód, że przez trasę przeszedł CAŁY organizm: odczyt katalogu kuponów
    // ruszył, a nie tylko wyrenderował się nagłówek karty.
    await waitFor(() => expect(db().chainsFor("b2b_coupons").length).toBe(1));
    cleanup();
  });

  it("pod adresem listy montuje organizm LISTY, a nie panel kampanii", async () => {
    pustaBaza();
    await renderRoute({ route: CouponsIndexRoute, path: PATH, initialEntry: PATH });
    expect(screen.getByText("adminCoupons.couponList")).toBeInTheDocument();
    expect(screen.queryByText("adminCoupons.campaigns")).toBeNull();
    cleanup();
  });

  it("ma SEKCYJNY `head()` - tytuł listy kodów i `noindex` (D14)", async () => {
    pustaBaza();
    const view = await renderRoute({ route: CouponsIndexRoute, path: PATH, initialEntry: PATH });
    expect(view.meta()).toContainEqual({
      title: "Kupony B2B - lista kodów | New European Strategies",
    });
    expect(view.meta()).toContainEqual({ name: "robots", content: "noindex, nofollow" });
    cleanup();
  });
});

describe("`/admin/coupons?code=` - lista zawężona z adresu", () => {
  it("kod z adresu staje się filtrem listy (deep link z huba)", async () => {
    db().setResponse(
      "b2b_coupons",
      ok([
        { ...kuponTestowy, id: "k-1", code: "NES-AB12" },
        { ...kuponTestowy, id: "k-2", code: "NES-ZZ99" },
      ]),
    );
    db().setResponse("access_plans", ok([]));
    db().setResponse("membership_tiers", ok([]));
    // Lista czyta `code` z zapytania rodzica (układ waliduje parametr).
    render(<CouponsListPage code="NES-AB12" />, { wrapper: ZKlientem });
    expect(await screen.findByText("NES-AB12")).toBeInTheDocument();
    expect(screen.queryByText("NES-ZZ99")).toBeNull();
    expect(screen.getByDisplayValue("NES-AB12")).toBeInTheDocument();
    cleanup();
  });
});

describe("trasa /admin/coupons/campaigns - kampanie kuponowe", () => {
  const PATH = "/admin/coupons/campaigns";

  function pustaBaza(): void {
    db().setResponse("b2b_coupon_campaigns", ok([]));
    db().setResponse("membership_tiers", ok([]));
    db().setResponse("b2b_coupons", ok([]));
    db().setResponse("newsletter_campaigns", ok([]));
  }

  it("montuje się POD SWOIM ADRESEM i pokazuje panel kampanii", async () => {
    pustaBaza();
    const view = await renderRoute({
      route: CouponsCampaignsRoute,
      path: PATH,
      initialEntry: PATH,
    });
    expect(view.currentPath()).toBe(PATH);
    expect(screen.getByText("adminCoupons.campaigns")).toBeInTheDocument();
    await waitFor(() => expect(db().chainsFor("b2b_coupon_campaigns").length).toBe(1));
    cleanup();
  });

  it("pod adresem kampanii montuje organizm KAMPANII, a nie listę kuponów", async () => {
    // Najdroższa pomyłka w tym module: jedno kliknięcie „Generuj" na ekranie
    // kampanii zakłada nawet 10 000 działających kodów rabatowych. Trasa
    // wskazująca nie ten organizm to ekran, który robi co innego, niż mówi
    // adres i zakładka.
    pustaBaza();
    await renderRoute({ route: CouponsCampaignsRoute, path: PATH, initialEntry: PATH });
    expect(screen.getByText("adminCoupons.campaigns")).toBeInTheDocument();
    expect(screen.queryByText("adminCoupons.couponList")).toBeNull();
    cleanup();
  });

  it("ma SEKCYJNY `head()` - tytuł kampanii kuponowych i `noindex` (D14)", async () => {
    pustaBaza();
    const view = await renderRoute({
      route: CouponsCampaignsRoute,
      path: PATH,
      initialEntry: PATH,
    });
    expect(view.meta()).toContainEqual({ title: "Kampanie kuponowe | New European Strategies" });
    expect(view.meta()).toContainEqual({ name: "robots", content: "noindex, nofollow" });
    cleanup();
  });

  it("`?id=<uuid>` WYRÓŻNIA wskazaną kampanię; nie-UUID jest odrzucany", async () => {
    const ID = "cccccccc-1111-4111-8111-cccccccccccc";
    db().setResponse(
      "b2b_coupon_campaigns",
      ok([
        { ...kampaniaTestowa, id: ID, name: "Wskazana" },
        { ...kampaniaTestowa, id: "dddddddd-1111-4111-8111-dddddddddddd", name: "Inna" },
      ]),
    );
    db().setResponse("membership_tiers", ok([]));
    const view = await renderRoute({
      route: CouponsCampaignsRoute,
      path: PATH,
      initialEntry: `${PATH}?id=${ID.toUpperCase()}`,
    });
    expect(view.search()).toEqual({ id: ID });
    const wskazana = (await screen.findByText("Wskazana")).closest("tr");
    expect(wskazana).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("Inna").closest("tr")).not.toHaveAttribute("aria-current");
    cleanup();

    const zle = await renderRoute({
      route: CouponsCampaignsRoute,
      path: PATH,
      initialEntry: `${PATH}?id=nie-uuid`,
    });
    expect(zle.search()).toEqual({});
    cleanup();
  });
});
