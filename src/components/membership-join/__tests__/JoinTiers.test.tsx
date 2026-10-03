// Poziomy członkostwa na stronie „Dołącz do nas" - stany, których nie
// pokrywa `membershipJoin.test.tsx`: wczytywanie katalogu, zmiana segmentu
// przez czytelnika, kontakt w sprawie warstwy bez planu i siatka 3/4 kart.
//
// RYZYKO. Ta sekcja ma być 1:1 z cennikiem - to obietnica, że oferta nie
// rozjedzie się między stronami. Trzy rzeczy kosztują tu realnie:
//
//   1. FAŁSZYWA PUSTKA. Dopóki katalog się wczytuje, sekcja NIE MOŻE mówić
//      „brak poziomów członkostwa" - czytelnik wychodzi ze strony wejścia do
//      członkostwa przekonany, że nie ma czego kupić.
//   2. SEGMENT. Kliknięta zakładka (np. „Firmy") ma pokazać warstwy TEGO
//      segmentu - warstwa firmowa pod zakładką indywidualną to cena per
//      miejsce pokazana osobie prywatnej.
//   3. WARSTWA BEZ PLANU W SPRZEDAŻY nie jest ślepą uliczką: przycisk kontaktu
//      otwiera formularz z NAZWĄ warstwy w temacie (lead bez nazwy oferty nie
//      trafi do właściwej osoby w dziale sprzedaży).
//
// Atrapowane są wyłącznie granice: klient Supabase (`from` + `rpc`), sesja,
// telemetria, kurs walutowy (moduł sam wychodzi do NBP przy imporcie),
// funkcja serwerowa Contact Center i `Link` routera. Zapytania, selektory
// cennika, karta warstwy i okno kontaktu biegną PRAWDZIWE.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import { membershipTier, pricingAudience, reactI18nextStub } from "@/test/admin/pricingFixtures";
import {
  ok,
  supabaseFromStub,
  type SupabaseFromStub,
  type SupabaseResult,
} from "@/test/supabase/chain";
import { accessPlan } from "@/test/billing/fixtures";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import { RouterLinkStub } from "@/test/routerLinkStub";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const h = vi.hoisted(() => ({
  chain: null as unknown as SupabaseFromStub,
  rpc: null as unknown as SupabaseRpcStub,
  trackCta: vi.fn(),
  submit: vi.fn(),
}));

vi.mock("react-i18next", () => reactI18nextStub());
vi.mock("@tanstack/react-router", () => ({ Link: RouterLinkStub }));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => h.submit,
}));
vi.mock("@/lib/contact.functions", () => ({ submitContactMessage: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ session: null, user: null }) }));
vi.mock("@/lib/analytics/track", () => ({ trackCta: h.trackCta }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => h.chain.from(table),
    rpc: (name: string, args?: Record<string, unknown>) => h.rpc.rpc(name, args),
  },
}));
vi.mock("@/lib/billing/fxRate", () => ({
  getEurPlnRate: () => 4,
  ensureFxRateLoaded: async () => 4,
  forceRefreshFxRate: async () => 4,
  getFxState: () => ({ eurPln: 4, source: "nbp" as const }),
  setEurPlnRateForTests: () => {},
}));

const { JoinTiers } = await import("@/components/membership-join/organisms/JoinTiers");

const INDIVIDUAL = pricingAudience({ id: "aud-ind", key: "individual", sort_order: 0 });
const BUSINESS = pricingAudience({
  id: "aud-biz",
  key: "business",
  name_pl: "Firmy",
  name_en: "Business",
  sort_order: 10,
});

function planFor(tierKey: string, id: string) {
  return accessPlan({ id, tier_key: tierKey, interval: "month", price_cents: 4900 });
}

function catalogue(rows: { audiences?: unknown[]; tiers?: unknown[]; plans?: unknown[] }): void {
  h.chain.setResponse("pricing_audiences", ok(rows.audiences ?? [INDIVIDUAL]));
  h.chain.setResponse("membership_tiers", ok(rows.tiers ?? []));
  h.chain.setResponse("access_plans", ok(rows.plans ?? []));
}

function renderTiers() {
  return renderWithQueryClient(<JoinTiers isAuthenticated={false} />);
}

/** Siatka kart warstw - jedyny element sekcji z klasą zaczynającą się od `mt-10 `. */
function tierGrid(): HTMLElement {
  const grid = document.querySelector<HTMLElement>("div[class^='mt-10 ']");
  if (!grid) throw new Error("test: siatka kart warstw nie została wyrenderowana");
  return grid;
}

function tierNames(): string[] {
  return within(tierGrid())
    .getAllByRole("heading", { level: 3 })
    .map((node) => node.textContent ?? "");
}

beforeEach(() => {
  h.chain = supabaseFromStub();
  h.rpc = supabaseRpcStub();
  h.rpc.setData("current_membership_tier", []);
  h.trackCta.mockReset();
  h.submit.mockReset().mockResolvedValue(undefined);
});

describe("JoinTiers - wczytywanie katalogu", () => {
  it("w trakcie wczytywania pokazuje szkielet ukryty przed czytnikiem, NIE „brak warstw”", () => {
    catalogue({});
    // Katalog warstw jeszcze nie odpowiedział (wolna sieć).
    h.chain.setResponse("membership_tiers", () => new Promise<SupabaseResult>(() => {}));

    const { container } = renderTiers();

    expect(screen.queryByText("membershipJoin.tiers.empty")).not.toBeInTheDocument();
    const skeleton = container.querySelector<HTMLElement>("[aria-hidden='true'].grid");
    expect(skeleton).not.toBeNull();
    expect(skeleton!.querySelectorAll(".animate-pulse")).toHaveLength(3);
    // Wyjście do pełnego cennika jest dostępne od pierwszej chwili.
    expect(screen.getByRole("link", { name: /tiers\.allPlans/ })).toHaveAttribute(
      "href",
      "/pricing",
    );
  });

  it("katalog czyta wyłącznie AKTYWNE segmenty, warstwy i plany", async () => {
    catalogue({ tiers: [membershipTier({ audience_key: "individual" })] });

    renderTiers();

    await screen.findByRole("heading", { level: 3, name: "Członek" });
    for (const table of ["pricing_audiences", "membership_tiers", "access_plans"]) {
      expect(h.chain.lastChain(table)!.argsOf("eq")).toEqual(["active", true]);
    }
  });
});

describe("JoinTiers - zmiana segmentu przez czytelnika", () => {
  it("kliknięta zakładka pokazuje warstwy TEGO segmentu i chowa poprzednie", async () => {
    catalogue({
      audiences: [INDIVIDUAL, BUSINESS],
      tiers: [
        membershipTier({ id: "t-member", key: "member", audience_key: "individual" }),
        membershipTier({
          id: "t-corp",
          key: "corporate",
          name_pl: "Korporacyjny",
          name_en: "Corporate",
          rank: 30,
          audience_key: "business",
        }),
      ],
      plans: [planFor("member", "plan-member"), planFor("corporate", "plan-corp")],
    });
    renderTiers();
    await waitFor(() => expect(tierNames()).toEqual(["Członek"]));

    fireEvent.click(screen.getByRole("tab", { name: "Firmy" }));

    await waitFor(() => expect(tierNames()).toEqual(["Korporacyjny"]));
    const tab = screen.getByRole("tab", { name: "Firmy" });
    expect(tab).toHaveAttribute("aria-selected", "true");
    // Panel kart jest opisany WYBRANĄ zakładką - czytnik ogłasza właściwy segment.
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", tab.id);
  });

  it("powrót na pierwszą zakładkę przywraca drabinkę indywidualną", async () => {
    catalogue({
      audiences: [INDIVIDUAL, BUSINESS],
      tiers: [
        membershipTier({ id: "t-member", key: "member", audience_key: "individual" }),
        membershipTier({
          id: "t-corp",
          key: "corporate",
          name_pl: "Korporacyjny",
          rank: 30,
          audience_key: "business",
        }),
      ],
    });
    renderTiers();
    await waitFor(() => expect(tierNames()).toEqual(["Członek"]));

    fireEvent.click(screen.getByRole("tab", { name: "Firmy" }));
    await waitFor(() => expect(tierNames()).toEqual(["Korporacyjny"]));
    fireEvent.click(screen.getByRole("tab", { name: "Osoba prywatna" }));

    await waitFor(() => expect(tierNames()).toEqual(["Członek"]));
  });
});

describe("JoinTiers - warstwa bez planu w sprzedaży", () => {
  it("przycisk kontaktu otwiera formularz z NAZWĄ warstwy w temacie", async () => {
    catalogue({
      tiers: [
        membershipTier({
          id: "t-inst",
          key: "institution",
          name_pl: "Instytucja",
          name_en: "Institution",
          audience_key: "individual",
          contact_url: null,
        }),
      ],
      plans: [],
    });
    renderTiers();

    const card = await screen.findByRole("heading", { level: 3, name: "Instytucja" });
    expect(screen.queryByRole("link", { name: "pricing.choose" })).not.toBeInTheDocument();
    expect(card).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /pricing\.contactCta/ }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/contactDialog\.subject/)).toHaveTextContent("Instytucja");
    expect(h.trackCta).toHaveBeenCalledWith(
      "pricing_contact_click",
      expect.objectContaining({ tier_key: "institution", target: "dialog" }),
    );
    expect(h.submit).not.toHaveBeenCalled();
  });
});

describe("JoinTiers - siatka kart (ta sama reguła co na /pricing)", () => {
  function ladder(count: number) {
    const keys = ["reader", "member", "pro", "patron"].slice(0, count);
    return keys.map((key, index) =>
      membershipTier({
        id: `t-${key}`,
        key,
        name_pl: `Warstwa ${index + 1}`,
        rank: (index + 1) * 10,
        audience_key: "individual",
      }),
    );
  }

  it("dwie warstwy stają obok siebie od najmniejszego punktu łamania", async () => {
    catalogue({ tiers: ladder(2) });
    renderTiers();

    await waitFor(() => expect(tierNames()).toEqual(["Warstwa 1", "Warstwa 2"]));
    expect(tierGrid().className).toContain("sm:grid-cols-2");
    expect(tierGrid().className).toContain("max-w-3xl");
  });

  it("trzy warstwy układają się w trzy kolumny dopiero na dużym ekranie", async () => {
    catalogue({ tiers: ladder(3) });
    renderTiers();

    await waitFor(() => expect(tierNames()).toEqual(["Warstwa 1", "Warstwa 2", "Warstwa 3"]));
    expect(tierGrid().className).toContain("lg:grid-cols-3");
    expect(tierGrid().className).not.toContain("xl:grid-cols-4");
  });

  it("cztery warstwy dostają czwartą kolumnę, żeby nie zostawiać sieroty w drugim rzędzie", async () => {
    catalogue({ tiers: ladder(4) });
    renderTiers();

    await waitFor(() => expect(tierNames()).toHaveLength(4));
    expect(tierGrid().className).toContain("xl:grid-cols-4");
  });
});
