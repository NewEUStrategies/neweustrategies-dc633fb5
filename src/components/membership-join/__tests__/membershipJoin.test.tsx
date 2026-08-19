// Strona „Dołącz do nas" (/membership-join) - 0% pokrycia do 18.08.2026,
// najgorszy wynik w całym module monetyzacji przy DZIEWIĘCIU plikach.
//
// To publiczna strona wejścia do członkostwa: pierwsza rzecz, jaką widzi osoba,
// która jeszcze nic nie kupiła. Wszystko, co tu sprawdzamy, sprowadza się do
// jednego pytania: czy ktoś, kto CHCE zostać członkiem, ma gdzie kliknąć.
//
// Kluczowa reguła: CTA zależy od stanu sesji. Zalogowany członek nie może
// dostać przycisku rejestracji („zarejestruj się" dla kogoś, kto jest
// zalogowany, to ślepa uliczka), a niezalogowany musi go dostać.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import {
  membershipTier,
  pricingAudience,
  radixSelectStub,
  reactI18nextStub,
} from "@/test/admin/pricingFixtures";
import { accessPlan, moneyPattern } from "@/test/billing/fixtures";
import { RouterLinkStub } from "@/test/routerLinkStub";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

let lang = "pl";
const h = {
  audiences: [] as ReturnType<typeof pricingAudience>[],
  tiers: [] as ReturnType<typeof membershipTier>[],
  plans: [] as ReturnType<typeof accessPlan>[],
  session: null as { user: { id: string } } | null,
  currentTier: null as { key: string } | null,
};

vi.mock("react-i18next", () => reactI18nextStub(() => lang));
vi.mock("@tanstack/react-router", () => ({ Link: RouterLinkStub }));
vi.mock("@/components/ui/select", async () => radixSelectStub(await import("react")));
vi.mock("@/lib/analytics/track", () => ({ trackCta: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ session: h.session }) }));
vi.mock("@/lib/pricing/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pricing/queries")>()),
  usePricingAudiences: () => ({ data: h.audiences, isLoading: false }),
}));
vi.mock("@/lib/billing/tiers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/tiers")>()),
  useMembershipTiers: () => ({ data: h.tiers, isLoading: false }),
  useCurrentTier: () => ({ data: h.currentTier }),
}));
vi.mock("@/lib/billing/queries", () => ({
  fetchActivePlans: () => Promise.resolve(h.plans),
  fetchMySubscription: () => Promise.resolve(null),
}));

const { JoinHero } = await import("@/components/membership-join/organisms/JoinHero");
const { JoinClosing } = await import("@/components/membership-join/organisms/JoinClosing");
const { JoinPillars } = await import("@/components/membership-join/organisms/JoinPillars");
const { JoinPath } = await import("@/components/membership-join/organisms/JoinPath");
const { JoinAudience } = await import("@/components/membership-join/organisms/JoinAudience");
const { JoinTiers } = await import("@/components/membership-join/organisms/JoinTiers");
const { JoinStat } = await import("@/components/membership-join/atoms/JoinStat");

beforeEach(() => {
  lang = "pl";
  h.audiences = [];
  h.tiers = [];
  h.plans = [];
  h.session = null;
  h.currentTier = null;
});

describe("JoinHero - jedyny H1 strony i wejście do rejestracji", () => {
  it("nagłówek strony jest DOKŁADNIE JEDEN i pierwszego poziomu", () => {
    render(<JoinHero isAuthenticated={false} />);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("membershipJoin.title");
  });

  it("NIEZALOGOWANY dostaje przycisk rejestracji członkowskiej", () => {
    render(<JoinHero isAuthenticated={false} />);

    expect(screen.getByRole("link", { name: /ctaPrimary/ })).toHaveAttribute(
      "href",
      "/membership-registration",
    );
  });

  it("ZALOGOWANY nie dostaje rejestracji, tylko skrót do profilu", () => {
    // „Zarejestruj się" dla kogoś zalogowanego to ślepa uliczka.
    render(<JoinHero isAuthenticated />);

    expect(screen.queryByRole("link", { name: /ctaPrimary/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ctaMember/ })).toHaveAttribute("href", "/profile");
  });

  it("obie wersje prowadzą też do pełnego cennika", () => {
    render(<JoinHero isAuthenticated={false} />);

    expect(screen.getByRole("link", { name: /ctaSecondary/ })).toHaveAttribute("href", "/pricing");
  });

  it("zdanie o zaufaniu pokazuje się TYLKO niezalogowanym", () => {
    render(<JoinHero isAuthenticated={false} />);
    expect(screen.getByText("membershipJoin.trust")).toBeInTheDocument();

    render(<JoinHero isAuthenticated />);
    expect(screen.getAllByText("membershipJoin.trust")).toHaveLength(1);
  });

  it("cztery liczby dowodowe są parami opis-wartość", () => {
    render(<JoinHero isAuthenticated={false} />);

    expect(screen.getAllByText(/membershipJoin\.stats\..*\.value/)).toHaveLength(4);
    expect(screen.getAllByText(/membershipJoin\.stats\..*\.label/)).toHaveLength(4);
  });
});

describe("JoinStat - liczba dowodowa", () => {
  it("pokazuje wartość i podpis", () => {
    render(<JoinStat value="1200+" label="Analiz" />);

    expect(screen.getByText("1200+")).toBeInTheDocument();
    expect(screen.getByText("Analiz")).toBeInTheDocument();
  });
});

describe("JoinClosing - ostatnie wezwanie", () => {
  it("NIEZALOGOWANY dostaje rejestrację", () => {
    render(<JoinClosing isAuthenticated={false} />);

    expect(screen.getByRole("link", { name: /closing\.cta/ })).toHaveAttribute(
      "href",
      "/membership-registration",
    );
  });

  it("ZALOGOWANY jest kierowany do cennika, nie do rejestracji", () => {
    render(<JoinClosing isAuthenticated />);

    expect(screen.queryByRole("link", { name: /closing\.cta/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ctaSecondary/ })).toHaveAttribute("href", "/pricing");
  });

  it("obie wersje mają wyjście na kontakt", () => {
    render(<JoinClosing isAuthenticated />);

    expect(screen.getByRole("link", { name: /closing\.secondary/ })).toBeInTheDocument();
  });

  it("sekcja ma nagłówek powiązany z jej etykietą", () => {
    render(<JoinClosing isAuthenticated={false} />);

    expect(screen.getByRole("heading", { level: 2 })).toHaveAttribute("id", "join-closing");
  });
});

describe("JoinPillars, JoinPath, JoinAudience - treść sprzedażowa", () => {
  it("filary pokazują cztery karty korzyści", () => {
    render(<JoinPillars />);

    expect(screen.getAllByText(/pillars\.items\..*\.title/)).toHaveLength(4);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("pillars.title");
  });

  it("ścieżka dołączenia to lista UPORZĄDKOWANA - kolejność niesie znaczenie", () => {
    render(<JoinPath />);

    expect(screen.getByRole("list").tagName).toBe("OL");
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("kroki są ponumerowane od jednego", () => {
    render(<JoinPath />);

    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("segmenty odbiorców pokazują trzy karty", () => {
    render(<JoinAudience />);

    expect(screen.getAllByText(/audience\.items\..*\.title/)).toHaveLength(3);
  });
});

describe("JoinTiers - oferta 1:1 z cennikiem", () => {
  const individual = pricingAudience({ key: "individual" });
  const member = membershipTier({ id: "t-member", key: "member", audience_key: "individual" });
  const monthly = accessPlan({
    id: "plan-month",
    tier_key: "member",
    interval: "month",
    price_cents: 4900,
  });

  it("pokazuje karty warstw z kwotą planu", async () => {
    h.audiences = [individual];
    h.tiers = [member];
    h.plans = [monthly];
    renderWithQueryClient(<JoinTiers isAuthenticated={false} />);

    await waitFor(() => expect(screen.getByText(moneyPattern(4900))).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "pricing.choose" })).toHaveAttribute(
      "href",
      "/checkout/plan-month",
    );
  });

  it("BRAK warstw pokazuje pusty stan, nie pustą sekcję", async () => {
    renderWithQueryClient(<JoinTiers isAuthenticated={false} />);

    await waitFor(() => expect(screen.getByText("membershipJoin.tiers.empty")).toBeInTheDocument());
  });

  it("warstwa WSPIERAJĄCA nie jest kartą w drabince - stoi osobno", async () => {
    // Paradoks wyboru: karty decyzyjne osobno, wsparcie misji spokojną ścieżką.
    h.audiences = [individual];
    h.tiers = [
      member,
      membershipTier({ id: "t-sup", key: "supporter", audience_key: "individual", rank: 1 }),
    ];
    h.plans = [monthly];
    renderWithQueryClient(<JoinTiers isAuthenticated={false} />);

    await waitFor(() => expect(screen.getByText(moneyPattern(4900))).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /supporterCta/ })).toHaveAttribute("href", "/support");
  });

  it("przełącznik segmentów pokazuje się TYLKO przy więcej niż jednym segmencie", async () => {
    h.audiences = [individual];
    h.tiers = [member];
    h.plans = [monthly];
    renderWithQueryClient(<JoinTiers isAuthenticated={false} />);

    await waitFor(() => expect(screen.getByText(moneyPattern(4900))).toBeInTheDocument());
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("przy dwóch segmentach pojawia się przełącznik i panel z etykietą", async () => {
    h.audiences = [individual, pricingAudience({ id: "a2", key: "b2b", name_pl: "Firmy" })];
    h.tiers = [member];
    h.plans = [monthly];
    renderWithQueryClient(<JoinTiers isAuthenticated={false} />);

    await waitFor(() => expect(screen.getByRole("tablist")).toBeInTheDocument());
    // Panel kart pojawia się po wczytaniu planów - przełącznik stoi wyżej i jest
    // widoczny od razu, więc czekamy osobno.
    await waitFor(() => expect(screen.getByRole("tabpanel")).toBeInTheDocument());
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });

  it("sekcja prowadzi do PEŁNEGO cennika, żeby oferta się nie rozjeżdżała", async () => {
    renderWithQueryClient(<JoinTiers isAuthenticated={false} />);

    await waitFor(() =>
      expect(screen.getByRole("link", { name: /tiers\.allPlans/ })).toHaveAttribute(
        "href",
        "/pricing",
      ),
    );
  });

  it("tagline i zdanie zaufania segmentu pokazują się nad kartami", async () => {
    h.audiences = [
      pricingAudience({
        key: "individual",
        tagline_pl: "Dla czytających codziennie",
        trust_pl: "Faktura · Umowa roczna",
      }),
    ];
    h.tiers = [member];
    h.plans = [monthly];
    renderWithQueryClient(<JoinTiers isAuthenticated={false} />);

    await waitFor(() => expect(screen.getByText("Dla czytających codziennie")).toBeInTheDocument());
    expect(screen.getByText("Faktura · Umowa roczna")).toBeInTheDocument();
  });

  it("OBECNA warstwa klienta jest oznaczona, a jej przycisk wyłączony", async () => {
    h.audiences = [individual];
    h.tiers = [member];
    h.plans = [monthly];
    h.currentTier = { key: "member" };
    renderWithQueryClient(<JoinTiers isAuthenticated />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "pricing.currentTier" })).toBeDisabled(),
    );
    expect(screen.queryByRole("link", { name: "pricing.choose" })).not.toBeInTheDocument();
  });

  it("przełącznik cyklu pojawia się tylko, gdy segment ma WIĘCEJ niż jeden okres", async () => {
    h.audiences = [individual];
    h.tiers = [member];
    h.plans = [monthly];
    renderWithQueryClient(<JoinTiers isAuthenticated={false} />);

    await waitFor(() => expect(screen.getByText(moneyPattern(4900))).toBeInTheDocument());
    expect(screen.queryByRole("group", { name: "pricing.intervalAria" })).not.toBeInTheDocument();
  });

  it("przy dwóch okresach przełącznik cyklu jest dostępny", async () => {
    h.audiences = [individual];
    h.tiers = [member];
    h.plans = [
      monthly,
      accessPlan({ id: "plan-year", tier_key: "member", interval: "year", price_cents: 49000 }),
    ];
    renderWithQueryClient(<JoinTiers isAuthenticated={false} />);

    await waitFor(() =>
      expect(screen.getByRole("group", { name: "pricing.intervalAria" })).toBeInTheDocument(),
    );
  });
});
