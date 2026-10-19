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
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

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
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
// Mutatory S1 biorą najemcę z sesji - bez montowania uwierzytelniania.
vi.mock("@/lib/tenant", () => ({ useCurrentTenantId: () => "tenant-test" }));
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

function mountPricing(search = "") {
  return renderRoute({
    route: AdminPricingRoute,
    path: "/admin/pricing",
    initialEntry: `/admin/pricing${search}`,
  });
}

function mountMembership(search = "") {
  return renderRoute({
    route: AdminMembershipRoute,
    path: "/admin/membership",
    initialEntry: `/admin/membership${search}`,
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

// KONTRAKT ADRESU I NAGŁÓWKA (S1, SPEC §2.6, AGENTS: sekcyjne `adminPageHead`).
// Hub „Przychód i lejek" linkuje prosto do zakładki cennika i do edytora
// warstwy; odświeżenie strony ma zostać tam, gdzie admin był.
describe("trasa /admin/pricing - adres i nagłówek strony", () => {
  it("publikuje SEKCYJNY tytuł strony, nie ogólny tytuł panelu", async () => {
    const view = await mountPricing();

    await screen.findByRole("heading", { level: 1, name: "Cennik i segmenty" });
    expect(view.meta()).toContainEqual({ title: "Cennik i segmenty | New European Strategies" });
    expect(view.meta()).toContainEqual({ name: "robots", content: "noindex, nofollow" });
  });

  it("`?tab=retention` ląduje na zakładce retencji", async () => {
    await mountPricing("?tab=retention");

    expect(await screen.findByRole("tab", { name: "Retencja" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("nieznana zakładka wraca do domyślnej zamiast strony błędu", async () => {
    const view = await mountPricing("?tab=cennik");

    expect(await screen.findByRole("tab", { name: "Segmenty" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(view.search().tab).toBeUndefined();
  });

  it("wybór zakładki zapisuje `?tab=` w adresie", async () => {
    const view = await mountPricing();

    // Radix aktywuje zakładkę wciśnięciem przycisku myszy, nie samym `click`.
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "FAQ" }), { button: 0 });

    await waitFor(() => expect(view.search().tab).toBe("faq"));
  });
});

describe("trasa /admin/membership - adres i nagłówek strony", () => {
  it("publikuje SEKCYJNY tytuł strony", async () => {
    const view = await mountMembership();

    await screen.findByRole("heading", { level: 1, name: "Warstwy członkostwa" });
    expect(view.meta()).toContainEqual({ title: "Warstwy członkostwa | New European Strategies" });
  });

  it("`?tab=mapping` ląduje na mapowaniu planów", async () => {
    await mountMembership("?tab=mapping");

    expect(await screen.findByRole("tab", { name: /^Mapowanie planów/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("`?tier=<key>` otwiera edytor warstwy; zamknięcie czyści parametr", async () => {
    const view = await mountMembership("?tier=member");

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Warstwa: Członek")).toBeInTheDocument();
    // Marketing warstwy jest tu tylko do odczytu, z odnośnikiem do Cennika (def. 11).
    expect(
      within(dialog)
        .getAllByRole("link")
        .some((a) => a.getAttribute("href")?.includes("/admin/pricing")),
    ).toBe(true);

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(view.search().tier).toBeUndefined());
  });

  it("kliknięcie kafla warstwy zapisuje `?tier=` w adresie", async () => {
    const view = await mountMembership();

    fireEvent.click(await screen.findByRole("button", { name: /Członek/ }));

    await waitFor(() => expect(view.search().tier).toBe("member"));
  });
});
