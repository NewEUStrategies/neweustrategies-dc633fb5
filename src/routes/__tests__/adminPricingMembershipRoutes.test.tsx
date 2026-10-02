// Trasy `/admin/pricing` i `/admin/membership` - CIENKIE OPAKOWANIA dwóch
// paneli monetyzacji: rejestracja słowników w chunku trasy + kompozycja.
// Do dziś: 0 funkcji, 0 instrukcji w obu plikach tras.
//
// PO CO TEN PLIK. Testy organizmów (`AdminPricingWorkspace.test.tsx`,
// `AdminMembershipWorkspace.test.tsx`) renderują panele wprost, z atrapą
// słownika echującą klucze - więc nie dowodzą dwóch rzeczy, które mieszkają
// WYŁĄCZNIE w plikach tras:
//
//   1. SKLEJENIE ADRESU Z PANELEM. Pod `/admin/pricing` redakcja ustawia, co
//      klient widzi na cenniku (segmenty, karty warstw, FAQ, retencja), a pod
//      `/admin/membership` - co klient DOSTAJE (rangi, bramki, mapowanie planu
//      na warstwę, nadania). Zamiana albo zgubienie panelu pod adresem to
//      edycja oferty w złym miejscu.
//   2. SŁOWNIK W CHUNKU TRASY. Panele mają własne nakładki i18n (`i18n-admin-*`)
//      rejestrowane w trasie, nie w wejściu aplikacji. Bez rejestracji panel
//      pokazuje surowe klucze (`adminPricing.tabs.tiers`) w obu językach.
//
// ATRAPOWANE SĄ WYŁĄCZNIE GRANICE: klient Supabase (`from` + `rpc`), toasty
// i kurs walut NBP (sieć).
// Router (prawdziwy, pamięciowy), słowniki (prawdziwa instancja i18next),
// zakładki Radiksa i oba panele biegną PRAWDZIWE.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  ensurePricing: vi.fn(),
  ensureMembership: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, ok } = await import("@/test/supabase/chain");
  const { supabaseRpcStub } = await import("@/test/supabase/rpc");
  const { membershipTier, pricingAudience, pricingFaqItem } =
    await import("@/test/admin/pricingFixtures");
  const { accessPlan, retentionSettings } = await import("@/test/billing/fixtures");
  const from = supabaseFromStub();
  from.setResponse("pricing_audiences", ok([pricingAudience()]));
  from.setResponse("membership_tiers", ok([membershipTier()]));
  from.setResponse("pricing_faq_items", ok([pricingFaqItem()]));
  from.setResponse("retention_settings", ok(retentionSettings()));
  from.setResponse("retention_reasons", ok([]));
  from.setResponse("retention_feedback", ok([]));
  from.setResponse("access_plans", ok([accessPlan()]));
  const rpc = supabaseRpcStub();
  rpc.setData("admin_list_membership_grants", []);
  return { supabase: { from: from.from, rpc: rpc.rpc } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// GRANICA SIECI: moduł kursu walut przy pierwszym imporcie w przeglądarce sam
// wychodzi do NBP (fire and forget). Bez tej atrapy plik wysyłał PRAWDZIWE
// żądanie do api.nbp.pl - test zależny od sieci i od odpowiedzi zewnętrznej.
vi.mock("@/lib/billing/fxRate", () => ({
  getEurPlnRate: () => 4,
  ensureFxRateLoaded: async () => 4,
  forceRefreshFxRate: async () => 4,
  getFxState: () => ({ eurPln: 4, source: "nbp" as const }),
  setEurPlnRateForTests: () => {},
}));
// Rejestracja słowników zostaje PRAWDZIWA - szpieg tylko liczy wywołania,
// żeby dało się dowieść, że to trasa ją woła przy renderze.
vi.mock("@/lib/i18n-admin-pricing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/i18n-admin-pricing")>();
  h.ensurePricing.mockImplementation(actual.ensureI18n);
  return { ...actual, ensureI18n: h.ensurePricing };
});
vi.mock("@/lib/i18n-admin-membership", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/i18n-admin-membership")>();
  h.ensureMembership.mockImplementation(actual.ensureI18n);
  return { ...actual, ensureI18n: h.ensureMembership };
});

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { renderRoute } from "@/test/routeHarness";
import { Route as AdminPricingRoute } from "@/routes/admin.pricing";
import { Route as AdminMembershipRoute } from "@/routes/admin.membership";

function mountPricing() {
  return renderRoute({
    route: AdminPricingRoute,
    path: "/admin/pricing",
    initialEntry: "/admin/pricing",
  });
}

function mountMembership() {
  return renderRoute({
    route: AdminMembershipRoute,
    path: "/admin/membership",
    initialEntry: "/admin/membership",
  });
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.ensurePricing.mockClear();
  h.ensureMembership.mockClear();
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
});

describe("trasa /admin/pricing - panel Cennika pod swoim adresem", () => {
  it("montuje panel cennika z PRAWDZIWYM słownikiem, nie surowymi kluczami", async () => {
    const view = await mountPricing();

    expect(view.currentPath()).toBe("/admin/pricing");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Cennik i segmenty" }),
    ).toBeInTheDocument();
    for (const tab of ["Segmenty", "Warstwy i benefity", "FAQ", "Retencja"]) {
      expect(screen.getByRole("tab", { name: tab })).toBeInTheDocument();
    }
    expect(document.body.textContent).not.toContain("adminPricing.");
  });

  it("rejestruje słownik panelu w trakcie renderu trasy", async () => {
    await mountPricing();

    await screen.findByRole("heading", { level: 1, name: "Cennik i segmenty" });
    expect(h.ensurePricing).toHaveBeenCalled();
    expect(h.ensureMembership).not.toHaveBeenCalled();
  });

  it("po angielsku ten sam adres mówi po angielsku (zarejestrowane OBA języki)", async () => {
    await i18n.changeLanguage("en");

    await mountPricing();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Pricing & segments" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Tiers & benefits" })).toBeInTheDocument();
  });

  it("pod tym adresem NIE stoi panel członkostwa (rangi i bramki są gdzie indziej)", async () => {
    await mountPricing();

    await screen.findByRole("heading", { level: 1, name: "Cennik i segmenty" });
    expect(screen.queryByRole("heading", { name: "Warstwy członkostwa" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /^Mapowanie planów/ })).not.toBeInTheDocument();
  });
});

describe("trasa /admin/membership - panel warstw pod swoim adresem", () => {
  it("montuje panel członkostwa z PRAWDZIWYM słownikiem, nie surowymi kluczami", async () => {
    const view = await mountMembership();

    expect(view.currentPath()).toBe("/admin/membership");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Warstwy członkostwa" }),
    ).toBeInTheDocument();
    // Zakładki niosą licznik obok nazwy („Warstwy 1") - stąd dopasowanie początku.
    for (const tab of ["Warstwy", "Mapowanie planów", "Nadania", "Organizacje"]) {
      expect(screen.getByRole("tab", { name: new RegExp(`^${tab}`) })).toBeInTheDocument();
    }
    // Katalog warstw dojechał przez trasę: licznik zakładki to liczba wierszy z bazy.
    expect(await screen.findByRole("tab", { name: "Warstwy 1" })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("adminMembership.");
  });

  it("rejestruje słownik panelu członkostwa w trakcie renderu trasy", async () => {
    await mountMembership();

    await screen.findByRole("heading", { level: 1, name: "Warstwy członkostwa" });
    expect(h.ensureMembership).toHaveBeenCalled();
  });

  it("po angielsku panel członkostwa mówi po angielsku", async () => {
    await i18n.changeLanguage("en");

    await mountMembership();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Membership tiers" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^Plan mapping/ })).toBeInTheDocument();
  });

  it("pod tym adresem NIE stoi panel cennika (marketing warstw jest gdzie indziej)", async () => {
    await mountMembership();

    await screen.findByRole("heading", { level: 1, name: "Warstwy członkostwa" });
    expect(screen.queryByRole("heading", { name: "Cennik i segmenty" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Retencja" })).not.toBeInTheDocument();
  });
});
