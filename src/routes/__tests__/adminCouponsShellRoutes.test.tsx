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
// GRANICE vs SĄSIEDZI: organizmy z `@/components/admin/coupons/**` biegną
// PRAWDZIWE (razem z `Stat` i dialogami). Atrapowane są wyłącznie granice:
// klient Supabase, toasty, i18n oraz prymitywy Radiksa, których happy-dom nie
// otwiera. ZERO SIECI, ZERO danych osobowych.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createRoute, type AnyRoute } from "@tanstack/react-router";
import { ok, type SupabaseFromStub } from "@/test/supabaseChain";
import { axeViolations, summarize } from "@/test/axe";

const h = vi.hoisted(() => ({
  from: null as unknown,
  rpc: vi.fn(),
  ensureI18n: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/i18n-admin-coupons", () => ({ ensureI18n: h.ensureI18n }));

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
import { CampaignsPage } from "@/components/admin/coupons/organisms/CampaignsPage";
import { Route as CouponsLayoutRoute } from "@/routes/admin.coupons";
import { Route as CouponsIndexRoute } from "@/routes/admin.coupons.index";
import { Route as CouponsCampaignsRoute } from "@/routes/admin.coupons.campaigns";

const UKLAD = "/admin/coupons";
const db = () => h.from as SupabaseFromStub;

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

/** Zakładka paska nawigacji układu - po widocznej etykiecie. */
function zakladka(nazwa: string): HTMLElement {
  return screen.getByRole("tab", { name: nazwa });
}

beforeEach(() => {
  db().reset();
  h.rpc.mockReset().mockResolvedValue({ data: null, error: null });
  h.ensureI18n.mockClear();
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
    expect(screen.getByRole("heading", { name: /Kupony B2B/ })).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Kupony",
      "Kampanie",
      "Realizacje",
      "Analityka",
    ]);
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
    expect(zakladka("Kupony")).toHaveAttribute("aria-selected", "false");
    expect(zakladka("Kampanie")).toHaveAttribute("aria-selected", "true");
    cleanup();
  });

  it("pod adresem sekcji wybrana jest zakładka listy, a reszta nie", async () => {
    await zamontujUklad(UKLAD);
    expect(zakladka("Kupony")).toHaveAttribute("aria-selected", "true");
    expect(zakladka("Kampanie")).toHaveAttribute("aria-selected", "false");
    expect(zakladka("Realizacje")).toHaveAttribute("aria-selected", "false");
    expect(zakladka("Analityka")).toHaveAttribute("aria-selected", "false");
    cleanup();
  });

  it("kliknięcie zakładki PRZENOSI pod jej adres i wymienia treść pod paskiem", async () => {
    // Zakładki to `<Link>`, więc dowód musi przejść przez router: sam atrybut
    // `href` nie mówi, że nawigacja kończy się właściwym dopasowaniem.
    const view = await zamontujUklad(UKLAD);
    fireEvent.click(zakladka("Analityka"));
    await waitFor(() => expect(view.currentPath()).toBe("/admin/coupons/analytics"));
    expect(screen.getByText("PODSTRONA: analityka")).toBeInTheDocument();
    expect(zakladka("Analityka")).toHaveAttribute("aria-selected", "true");
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

  it("wskazuje DOKŁADNIE organizm listy, a nie panel kampanii", async () => {
    expect(CouponsIndexRoute.options.component).toBe(CouponsListPage);
    cleanup();
  });

  it("nie wnosi WŁASNEGO `head()` - bramka `noindex` jest dziedziczona z `/admin`", async () => {
    // Stan faktyczny: cała sekcja kuponów żyje pod layoutem `/admin`, który
    // ustawia `robots: noindex, nofollow`. Jawny wzorzec (własne `head()`
    // w pliku trasy) stoi w `src/routes/admin.donations.tsx`.
    pustaBaza();
    const view = await renderRoute({ route: CouponsIndexRoute, path: PATH, initialEntry: PATH });
    expect(CouponsIndexRoute.options.head).toBeUndefined();
    expect(view.meta()).toEqual([]);
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

  it("wskazuje DOKŁADNIE organizm kampanii, a nie listę kuponów", async () => {
    // Najdroższa pomyłka w tym module: jedno kliknięcie „Generuj" na ekranie
    // kampanii zakłada nawet 10 000 działających kodów rabatowych. Trasa
    // wskazująca nie ten organizm to ekran, który robi co innego, niż mówi
    // adres i zakładka.
    expect(CouponsCampaignsRoute.options.component).toBe(CampaignsPage);
    cleanup();
  });

  it("nie wnosi WŁASNEGO `head()` - bramka `noindex` jest dziedziczona z `/admin`", async () => {
    pustaBaza();
    const view = await renderRoute({
      route: CouponsCampaignsRoute,
      path: PATH,
      initialEntry: PATH,
    });
    expect(CouponsCampaignsRoute.options.head).toBeUndefined();
    expect(view.meta()).toEqual([]);
    cleanup();
  });
});
