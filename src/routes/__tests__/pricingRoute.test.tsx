// Trasa /pricing - Cennik 2.0. Do dziś: 0 z 41 funkcji, 0 instrukcji, mimo że
// molekuły i organizmy pod nią mają własne testy.
//
// CZEGO NIE DOWODZĄ TESTY KOMPONENTÓW. `pricingControls.test.tsx` i
// `TierCard.test.tsx` sprawdzają POJEDYNCZE elementy z podanymi wprost
// właściwościami. Cała reguła, o którą tu chodzi, mieszka POMIĘDZY nimi: to
// trasa decyduje, KTÓRE warstwy trafiają do której karty, KTÓRE cykle w ogóle
// zobaczy przełącznik, KTÓRY plan jest „twój", CZY sekcje przepustek i planów
// bez warstwy się pokażą, i CO robi `?audience=` z adresu. Dodatkowo
// `validateSearch`, `loader` i `head()` nie istnieją, dopóki trasa nie jest
// sklejona z drzewem - dlatego wszystko poniżej biegnie przez `renderRoute`.
//
// CZTERY REGUŁY, KTÓRYCH ZŁAMANIE KOSZTUJE PRZYCHÓD:
//
//   1. OFERTA NIGDY NIE ZNIKA. Warstwa bez segmentu ląduje w pierwszym
//      segmencie, a plan cykliczny bez warstwy dostaje własną sekcję. Rozjazd
//      danych redakcyjnych nie może chować rzeczy, które są na sprzedaż.
//   2. PRZEŁĄCZNIK CYKLU POKAZUJE TYLKO CYKLE, KTÓRE ISTNIEJĄ W SEGMENCIE.
//      Wybór „rocznie" w segmencie bez planów rocznych to cena, której nikt nie
//      sprzeda - dlatego spada na najdłuższy dostępny cykl.
//   3. NIE SPRZEDAJEMY DRUGI RAZ TEGO SAMEGO. Warstwa i plan, które czytelnik
//      już ma, mają przycisk WYŁĄCZONY - inaczej to prosta droga do podwójnej
//      płatności i reklamacji.
//   4. WERSJA ANGIELSKA ROZLICZA W EURO. Ta sama funkcja liczy kwotę w cenniku
//      i w checkoucie, więc cennik pokazujący złotówki anglojęzycznemu
//      czytelnikowi obiecywałby inną kwotę niż ta, którą pobierze operator.
//
// ATRAPOWANE SĄ WYŁĄCZNIE GRANICE: klient Supabase, sesja, telemetria, adres
// żądania i kurs walutowy (moduł kursu sam wychodzi do api.nbp.pl przy
// imporcie - w teście stały kurs 4,00 daje jawne przeliczenie). Selektory
// cennika, model karty, organizmy i słowniki biegną PRAWDZIWE.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

import type { MembershipTierRow } from "@/lib/billing/tiers";
import type { PricingAudienceRow } from "@/lib/pricing/queries";
import type { AccessPlan } from "@/lib/billing/types";
import type { StaticPageSeo } from "@/lib/queries/staticPageSeo";

const h = vi.hoisted(() => ({
  seo: null as unknown,
  audiences: [] as unknown[],
  faq: [] as unknown[],
  tiers: [] as unknown[],
  plans: [] as unknown[],
  subscriptions: [] as unknown[],
  currentTier: null as unknown,
  session: null as { user: { id: string } } | null,
  /** Tabele odpowiadające BŁĘDEM PostgREST (odmowa RLS, błąd SQL). */
  broken: new Set<string>(),
  /**
   * Tabele, których odczyt WYWRACA SIĘ NA TRANSPORCIE. To inny kształt awarii
   * niż `broken`: warstwa danych strony redakcyjnej połyka błąd PostgREST i
   * zwraca `null`, więc do `catch` w loaderze dochodzi wyłącznie wyjątek
   * transportu (padnięta sieć, odcięta brama).
   */
  offline: new Set<string>(),
  requestUrl: "https://example.com/pricing",
  trackCta: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, ok, fail } = await import("@/test/supabaseChain");
  const stub = supabaseFromStub();
  const answer = (table: string, rows: () => unknown) => {
    stub.setResponse(table, () => {
      if (h.offline.has(table)) throw new Error(`test: transport padł na tabeli ${table}`);
      return h.broken.has(table) ? fail(`test: tabela ${table} niedostępna`) : ok(rows());
    });
  };
  answer("pages", () => h.seo);
  answer("pricing_audiences", () => h.audiences);
  answer("pricing_faq_items", () => h.faq);
  answer("membership_tiers", () => h.tiers);
  answer("access_plans", () => h.plans);
  answer("user_subscriptions", () => h.subscriptions);
  return {
    supabase: {
      from: stub.from,
      auth: { getSession: async () => ({ data: { session: h.session } }) },
      rpc: async () => ({ data: h.currentTier === null ? [] : [h.currentTier], error: null }),
    },
  };
});
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    session: h.session,
    user: h.session?.user ?? null,
    roles: [],
    tenantId: null,
    loading: false,
    isStaff: false,
    isAdmin: false,
    isSuperAdmin: false,
    signOut: async () => {},
  }),
}));
vi.mock("@/lib/analytics/track", () => ({ trackCta: h.trackCta }));
vi.mock("@/lib/seo/request", () => ({
  getRequestUrl: () => h.requestUrl,
  getOrigin: () => "https://example.com",
}));
// GRANICA KURSU WALUTOWEGO. Moduł `fxRate` sam strzela do api.nbp.pl przy
// imporcie w przeglądarce - test ma być deterministyczny i BEZ sieci. Stały
// kurs 4,00 daje jawne przeliczenie 49,00 PLN -> 12,25 EUR.
vi.mock("@/lib/billing/fxRate", () => ({
  getEurPlnRate: () => 4,
  ensureFxRateLoaded: async () => 4,
  forceRefreshFxRate: async () => 4,
  getFxState: () => ({ eurPln: 4, source: "nbp" as const }),
  setEurPlnRateForTests: () => {},
}));

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { renderRoute, routeHead, routeSearchValidator } from "@/test/routeHarness";
import { axeViolations, summarize } from "@/test/axe";
import { membershipTier, pricingAudience, pricingFaqItem } from "@/test/admin/pricingFixtures";
import { accessPlan, moneyPattern } from "@/test/billing/fixtures";
import { Route as PricingRoute } from "@/routes/pricing";

const PATH = "/pricing";

/** Trzy segmenty: indywidualny (domyślny), firmowy i zespołowy. */
function audiences(): PricingAudienceRow[] {
  return [
    pricingAudience({ id: "aud-individual", key: "individual", sort_order: 0 }),
    pricingAudience({
      id: "aud-business",
      key: "business",
      name_pl: "Dla firm",
      name_en: "For business",
      tagline_pl: "Dla zespołów decyzyjnych",
      tagline_en: "For decision teams",
      trust_pl: "Faktura · Umowa roczna",
      trust_en: "Invoice · Annual contract",
      icon: "building",
      sort_order: 10,
    }),
    pricingAudience({
      id: "aud-team",
      key: "team",
      name_pl: "Dla zespołów",
      name_en: "For teams",
      tagline_pl: null,
      tagline_en: null,
      icon: "users",
      sort_order: 20,
    }),
  ];
}

function tiers(): MembershipTierRow[] {
  return [
    membershipTier({
      id: "tier-supporter",
      key: "supporter",
      name_pl: "Wspierający",
      name_en: "Supporter",
      rank: 5,
      audience_key: "individual",
      benefits: [{ pl: "Podziękowanie", en: "Thank you" }],
    }),
    membershipTier({
      id: "tier-member",
      key: "member",
      rank: 10,
      audience_key: "individual",
      benefits: [{ pl: "Poranny briefing", en: "Morning briefing" }],
    }),
    membershipTier({
      id: "tier-pro",
      key: "pro",
      name_pl: "Pro",
      name_en: "Pro",
      rank: 20,
      audience_key: "individual",
      highlight: true,
      benefits: [
        { pl: "Poranny briefing", en: "Morning briefing" },
        { pl: "Zamknięte debaty", en: "Closed-door debates" },
      ],
    }),
    membershipTier({
      id: "tier-corporate",
      key: "corporate",
      name_pl: "Firma",
      name_en: "Business",
      rank: 30,
      audience_key: "business",
      cta_mode: "contact",
      benefits: [{ pl: "Opiekun wdrożenia", en: "Onboarding manager" }],
    }),
    membershipTier({
      id: "tier-team",
      key: "team",
      name_pl: "Zespół",
      name_en: "Team",
      rank: 25,
      audience_key: "team",
      benefits: [{ pl: "Panel miejsc", en: "Seats panel" }],
    }),
  ];
}

function plans(): AccessPlan[] {
  return [
    accessPlan({ id: "plan-member-month", tier_key: "member", price_cents: 4900 }),
    accessPlan({
      id: "plan-member-year",
      tier_key: "member",
      interval: "year",
      price_cents: 49000,
      name_pl: "Członek rocznie",
      name_en: "Member yearly",
    }),
    accessPlan({
      id: "plan-pro-month",
      tier_key: "pro",
      price_cents: 9900,
      name_pl: "Pro",
      name_en: "Pro",
    }),
    accessPlan({
      id: "plan-pro-year",
      tier_key: "pro",
      interval: "year",
      price_cents: 99900,
      name_pl: "Pro rocznie",
      name_en: "Pro yearly",
    }),
    accessPlan({
      id: "plan-team-quarter",
      tier_key: "team",
      interval: "quarter",
      price_cents: 29900,
      name_pl: "Zespół kwartalnie",
      name_en: "Team quarterly",
    }),
  ];
}

/** Wiersz redakcyjny strony cennika z /admin/pages. */
function seoRow(overrides: Partial<NonNullable<StaticPageSeo>> = {}): NonNullable<StaticPageSeo> {
  return {
    slug: "pricing",
    title_pl: "Cennik NES",
    title_en: "NES pricing",
    excerpt_pl: "Plany członkostwa i przepustki.",
    excerpt_en: "Membership plans and passes.",
    seo_title_pl: null,
    seo_title_en: null,
    seo_description_pl: null,
    seo_description_en: null,
    seo_canonical_url: null,
    seo_noindex: null,
    seo_og_image_url: null,
    og_image_generated_url: null,
    ...overrides,
  };
}

async function mount(entry = PATH) {
  return renderRoute({ route: PricingRoute, path: PATH, initialEntry: entry });
}

/** Pełna oferta - domyślny stan „cennik ma co pokazać". */
function fullCatalogue(): void {
  h.audiences = audiences();
  h.tiers = tiers();
  h.plans = plans();
}

/**
 * Siatka kart warstw. Zawężenie jest konieczne: nagłówki trzeciego poziomu są
 * na tej stronie także w sekcji planów luzem, w przepustkach i w rozwijanym
 * FAQ (Radix opakowuje pytanie w `h3`), więc zapytanie „wszystkie h3"
 * mieszałoby drabinkę cen z pytaniami i odpowiedziami.
 */
function tierGrid(): HTMLElement {
  const grid = document.querySelector<HTMLElement>("div[class^='mt-10 ']");
  if (!grid) throw new Error("test: siatka kart warstw nie została wyrenderowana");
  return grid;
}

/** Czy cennik w ogóle narysował siatkę kart (odróżnia pustkę od oferty). */
function hasTierGrid(): boolean {
  return document.querySelector("div[class^='mt-10 ']") !== null;
}

/** Nazwy warstw w kolejności, w jakiej stoją w siatce. */
function tierNames(): string[] {
  return within(tierGrid())
    .getAllByRole("heading", { level: 3 })
    .map((node) => node.textContent ?? "");
}

/** Karta warstwy po jej widocznej nazwie. */
function tierCard(name: string): HTMLElement {
  const heading = within(tierGrid()).getByRole("heading", { level: 3, name });
  return heading.closest("div[class*='flex h-full flex-col']") as HTMLElement;
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.seo = null;
  h.audiences = [];
  h.faq = [];
  h.tiers = [];
  h.plans = [];
  h.subscriptions = [];
  h.currentTier = null;
  h.session = null;
  h.broken = new Set<string>();
  h.offline = new Set<string>();
  h.requestUrl = "https://example.com/pricing";
  h.trackCta.mockReset();
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
  vi.restoreAllMocks();
});

describe("trasa /pricing - kontrakt adresu", () => {
  it("przyjmuje wyłącznie segment o poprawnym formacie klucza", async () => {
    // `?audience=` to deep-link do segmentu, używany w kampaniach i w
    // cross-sellu. Wartość spoza formatu klucza nie może wejść do stanu
    // trasy - stamtąd trafia do `id`/`aria-controls` panelu kart.
    const validate = routeSearchValidator(PricingRoute);

    expect(validate({ audience: "business" })).toEqual({ audience: "business" });
    expect(validate({ audience: "<script>" })).toEqual({});
    expect(validate({ audience: 42 })).toEqual({});
    expect(validate({})).toEqual({});
  });

  it("nieznany segment z adresu nie chowa oferty - cennik spada na pierwszy", async () => {
    // Literówka w linku z newslettera nie może skończyć się pustą stroną
    // cennika. Segment nieistniejący degraduje do pierwszego, a nie do zera.
    fullCatalogue();
    await mount("/pricing?audience=nieistniejacy-segment");

    expect(await screen.findByRole("heading", { level: 3, name: "Członek" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Osoba prywatna/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("deep-link do segmentu firmowego otwiera od razu ten segment", async () => {
    // To jest cała wartość parametru: link w ofercie handlowej ma prowadzić
    // wprost do właściwej oferty, a nie do zakładki, którą trzeba doklikać.
    fullCatalogue();
    await mount("/pricing?audience=business");

    expect(await screen.findByRole("heading", { level: 3, name: "Firma" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 3, name: "Członek" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Dla firm/ })).toHaveAttribute("aria-selected", "true");
  });

  it("przełączenie segmentu przepisuje adres, a powrót do pierwszego go czyści", async () => {
    // Adres jest stanem tej strony: musi dać się udostępnić i cofnąć. Segment
    // domyślny NIE zostawia parametru, żeby kanoniczny adres cennika był jeden.
    fullCatalogue();
    const view = await mount();

    fireEvent.click(screen.getByRole("tab", { name: /Dla firm/ }));
    await waitFor(() => expect(view.search()).toEqual({ audience: "business" }));

    fireEvent.click(screen.getByRole("tab", { name: /Osoba prywatna/ }));
    await waitFor(() => expect(view.search()).toEqual({}));
  });
});

describe("trasa /pricing - lista planów", () => {
  it("pusty katalog mówi wprost, że planów nie ma", async () => {
    // Pusta siatka bez zdania czyta się jak awaria strony. Cennik bez ofert
    // musi to powiedzieć, bo to jest odpowiedź, a nie brak odpowiedzi.
    await mount();

    expect(await screen.findByText("Brak dostępnych planów.")).toBeInTheDocument();
    expect(hasTierGrid()).toBe(false);
    expect(screen.queryByRole("link", { name: "Wybierz plan" })).not.toBeInTheDocument();
  });

  it("niepusty katalog pokazuje drabinkę warstw rosnąco, bez progu darowizny", async () => {
    // Kolejność kart jest komunikatem („za co dopłacam"), a Wspierający to
    // osobna ścieżka - w drabince cen byłby fałszywym progiem.
    fullCatalogue();
    await mount();

    expect(tierNames()).toEqual(["Członek", "Pro"]);
    expect(screen.queryByText("Brak dostępnych planów.")).not.toBeInTheDocument();
  });

  it("warstwa bez segmentu ląduje w pierwszym segmencie, zamiast zniknąć", async () => {
    // Redakcyjna literówka albo skasowany segment nie mogą schować warstwy,
    // która jest na sprzedaż. Kierunek degradacji jest jawną regułą cennika.
    h.audiences = audiences();
    h.plans = plans();
    h.tiers = [
      membershipTier({ id: "tier-orphan", key: "member", rank: 10, audience_key: null }),
      membershipTier({
        id: "tier-orphan-2",
        key: "pro",
        name_pl: "Pro",
        name_en: "Pro",
        rank: 20,
        audience_key: "segment-ktorego-nie-ma",
      }),
    ];
    await mount();

    expect(await screen.findByRole("heading", { level: 3, name: "Członek" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Pro" })).toBeInTheDocument();
  });

  it("bez segmentów cennik nadal pokazuje wszystkie warstwy i nie rysuje zakładek", async () => {
    // Tenant sprzed Cennika 2.0 nie ma wierszy `pricing_audiences`. Strona ma
    // wtedy działać jak zwykły cennik, a nie zostać z jedną, pustą zakładką.
    h.tiers = tiers();
    h.plans = plans();
    await mount();

    expect(await screen.findByRole("heading", { level: 3, name: "Członek" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("wyróżniony plan niesie odznakę, pozostałe nie", async () => {
    // Wyróżnienie to kotwica wyboru. Odznaka na każdej karcie (albo na żadnej)
    // odbiera jej całą funkcję.
    fullCatalogue();
    await mount();

    expect(within(tierCard("Pro")).getByText("Najpopularniejszy")).toBeInTheDocument();
    expect(within(tierCard("Członek")).queryByText("Najpopularniejszy")).not.toBeInTheDocument();
  });

  it("pasek Wspierającego stoi obok cennika, a nie w drabince", async () => {
    // Darowizna nie jest progiem członkostwa - to osobna ścieżka, prowadząca
    // pod inny adres niż checkout planu.
    fullCatalogue();
    await mount();

    expect(await screen.findByText("Wspierający")).toBeInTheDocument();
  });

  it("plan cykliczny bez warstwy dostaje własną sekcję zamiast zniknąć", async () => {
    // Plan, którego warstwa została skasowana, nadal jest na sprzedaż -
    // schowany, przestaje zarabiać, a nikt tego nie zauważy w panelu.
    fullCatalogue();
    h.plans = [
      ...plans(),
      accessPlan({
        id: "plan-luzem",
        tier_key: null,
        price_cents: 1900,
        name_pl: "Plan bez warstwy",
        name_en: "Unattached plan",
      }),
    ];
    await mount();

    expect(await screen.findByText("Pozostałe plany")).toBeInTheDocument();
    expect(screen.getByText("Plan bez warstwy")).toBeInTheDocument();
  });

  it("przepustki jednorazowe mają własną sekcję z własnym wyjaśnieniem", async () => {
    // Przepustka to inny produkt niż subskrypcja („bez zobowiązań"). Wrzucona
    // do drabinki byłaby czytana jako najtańszy plan cykliczny.
    fullCatalogue();
    h.plans = [
      ...plans(),
      accessPlan({
        id: "plan-dzien",
        tier_key: null,
        interval: "day",
        price_cents: 900,
        name_pl: "Dostęp jednodniowy",
        name_en: "One-day access",
      }),
    ];
    await mount();

    expect(await screen.findByText("Przepustki i dostęp jednorazowy")).toBeInTheDocument();
    expect(screen.getByText("Dostęp jednodniowy")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Bez zobowiązań: pojedynczy artykuł albo krótki dostęp na czas ważnej decyzji.",
      ),
    ).toBeInTheDocument();
  });

  it("przepustki i plany luzem pokazują się TYLKO w pierwszym segmencie", async () => {
    // Te sekcje są wspólne dla całego cennika. Powtórzone w każdym segmencie
    // sugerowałyby, że przepustka należy do oferty firmowej.
    fullCatalogue();
    h.plans = [
      ...plans(),
      accessPlan({ id: "plan-dzien", tier_key: null, interval: "day", price_cents: 900 }),
    ];
    await mount("/pricing?audience=business");

    expect(await screen.findByRole("heading", { level: 3, name: "Firma" })).toBeInTheDocument();
    expect(screen.queryByText("Przepustki i dostęp jednorazowy")).not.toBeInTheDocument();
    expect(screen.queryByText("Pozostałe plany")).not.toBeInTheDocument();
  });

  // Siatka kart. Ta sama liczba kolumn dla jednej i dla czterech warstw daje
  // albo samotną kartę rozciągniętą na całą szerokość, albo cztery ściśnięte w
  // trzech kolumnach z sierotą w drugim rzędzie. Punkty łamania są tu regułą
  // układu, nie ozdobą - i to TRASA je wybiera na podstawie liczby kart, więc
  // żaden test komponentu ich nie widzi. Każdy wariant montuje się osobno, bo
  // cztery montowania cennika w jednym teście przekraczają limit czasu.
  const individualTiers = (count: number): MembershipTierRow[] =>
    ["member", "pro", "vip", "corporate"].slice(0, count).map((key, index) =>
      membershipTier({
        id: `tier-${key}`,
        key,
        name_pl: `Warstwa ${index + 1}`,
        name_en: `Tier ${index + 1}`,
        rank: (index + 1) * 10,
        audience_key: "individual",
      }),
    );

  /** Wspólne tło dla wariantów siatki - liczy się WYŁĄCZNIE liczba warstw. */
  const mountWithTierCount = async (count: number) => {
    h.audiences = audiences();
    h.plans = plans();
    h.tiers = individualTiers(count);
    await mount();
  };

  it("jedna warstwa dostaje wąską, wyśrodkowaną kartę zamiast pasa na ekran", async () => {
    await mountWithTierCount(1);

    expect(tierGrid().className).toContain("max-w-md");
  });

  it("dwie warstwy stają obok siebie od najmniejszego punktu łamania", async () => {
    await mountWithTierCount(2);

    expect(tierGrid().className).toContain("sm:grid-cols-2");
  });

  it("trzy warstwy układają się w trzy kolumny dopiero na dużym ekranie", async () => {
    await mountWithTierCount(3);

    expect(tierGrid().className).toContain("lg:grid-cols-3");
  });

  it("cztery warstwy dostają czwartą kolumnę, żeby nie zostawiać sieroty", async () => {
    await mountWithTierCount(4);

    expect(tierGrid().className).toContain("xl:grid-cols-4");
  });

  it("nie zostawia cennika z wadami dostępności", async () => {
    // Żadna reguła nie jest tu wyłączona: `heading-order` była wyłączana,
    // dopóki strona skakała z H1 wprost do H3 (opis niżej) - po naprawie
    // sprawdzamy pełny zestaw reguł.
    fullCatalogue();
    const view = await mount();
    await screen.findByRole("heading", { level: 3, name: "Członek" });

    const violations = await axeViolations(view.container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("drabinka cen nie przeskakuje już z nagłówka H1 wprost do H3", async () => {
    // CO BYŁO ZŁE. Struktura strony to `h1` („Cennik"), a zaraz po niej karty
    // warstw z `h3` w nagłówku każdej karty. Poziom `h2` pojawiał się DOPIERO
    // niżej (Pozostałe plany, Przepustki, Pełne porównanie, FAQ), więc od
    // tytułu strony do pierwszej oferty był przeskok o dwa poziomy. Karty nie
    // miały też własnego nagłówka sekcji, który mógłby ten poziom domknąć.
    //
    // DLACZEGO TO BYŁO RYZYKO. Czytnik ekranu nawiguje po tej stronie
    // nagłówkami - to najszybsza droga do porównania ofert. Przeskok poziomu
    // czyta się jak brakująca sekcja, więc użytkownik szukał „zgubionego" H2
    // zamiast czytać ceny. To naruszenie WCAG 1.3.1 na stronie, na której
    // podejmuje się decyzję zakupową - dokładnie tam, gdzie bariera kosztuje
    // najwięcej.
    //
    // JAK NAPRAWIONE. `pricing.tsx` stawia nad siatką kart nagłówek H2
    // („Poziomy członkostwa" / „Membership tiers", klucz `pricing.tiers.heading`
    // istniał już w słowniku PL i EN). Nagłówek jest `sr-only`, czyli poza
    // układem: siatka, odstępy i responsywność zostają bez zmian, a drabinka
    // poziomów jest domknięta. Alternatywa - zejście kart na H4 w `TierCard` -
    // psułaby semantykę karty używanej także poza tą stroną.
    fullCatalogue();
    const view = await mount();
    await screen.findByRole("heading", { level: 3, name: "Członek" });

    expect(screen.getByRole("heading", { level: 2, name: "Poziomy członkostwa" })).toBeVisible();
    const violations = await axeViolations(view.container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("trasa /pricing - przełącznik cyklu rozliczenia", () => {
  it("startuje od rozliczenia rocznego i pokazuje realną oszczędność", async () => {
    // Kotwica roczna jest decyzją produktową, a procent MUSI wynikać z planów
    // (49 000 gr rocznie wobec 12 x 4 900 gr), nie z wpisanej liczby.
    fullCatalogue();
    await mount();

    const yearly = await screen.findByRole("button", { name: /Rocznie/ });
    expect(yearly).toHaveAttribute("aria-pressed", "true");
    expect(within(yearly).getByText(/do -\d+%/)).toBeInTheDocument();
    expect(within(tierCard("Członek")).getByText(moneyPattern(49000))).toBeInTheDocument();
  });

  it("przełączenie na miesięcznie zmienia kwotę na karcie, nie tylko podpis", async () => {
    // To jedyne miejsce, w którym czytelnik porównuje dwa cykle. Kwota, która
    // nie idzie za przełącznikiem, jest po prostu złą ceną.
    fullCatalogue();
    await mount();
    await screen.findByRole("heading", { level: 3, name: "Członek" });

    fireEvent.click(screen.getByRole("button", { name: "Miesięcznie" }));

    await waitFor(() =>
      expect(within(tierCard("Członek")).getByText(moneyPattern(4900))).toBeInTheDocument(),
    );
    expect(within(tierCard("Pro")).getByText(moneyPattern(9900))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Miesięcznie" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("przełącznik pokazuje wyłącznie cykle obecne w segmencie", async () => {
    // Segment zespołowy ma tylko plan kwartalny. Opcja „rocznie" byłaby ceną,
    // której nikt nie sprzeda - i tak spada na najdłuższy dostępny cykl.
    fullCatalogue();
    await mount("/pricing?audience=team");

    await screen.findByRole("heading", { level: 3, name: "Zespół" });
    expect(screen.queryByRole("group", { name: "Cykl rozliczenia" })).not.toBeInTheDocument();
    expect(within(tierCard("Zespół")).getByText(moneyPattern(29900))).toBeInTheDocument();
    expect(within(tierCard("Zespół")).getByText("/ kwartał")).toBeInTheDocument();
  });

  it("segment bez planów w ogóle nie pokazuje przełącznika", async () => {
    // Segment firmowy sprzedaje przez rozmowę. Przełącznik cyklu nad ofertą
    // „na zapytanie" obiecywałby samoobsługowy zakup, którego tam nie ma.
    fullCatalogue();
    await mount("/pricing?audience=business");

    await screen.findByRole("heading", { level: 3, name: "Firma" });
    expect(screen.queryByRole("group", { name: "Cykl rozliczenia" })).not.toBeInTheDocument();
    expect(screen.getByText("Oferta na zapytanie")).toBeInTheDocument();
  });

  it("wybrany cykl przeżywa zmianę segmentu, gdy nowy segment go zna", async () => {
    // Przełącznik jest stanem CZYTELNIKA, nie segmentu. Reset przy każdej
    // zakładce kazałby mu wybierać rozliczenie od nowa przy każdym porównaniu.
    fullCatalogue();
    h.plans = [
      ...plans(),
      accessPlan({ id: "plan-corp-month", tier_key: "corporate", price_cents: 199900 }),
    ];
    await mount();
    await screen.findByRole("heading", { level: 3, name: "Członek" });

    fireEvent.click(screen.getByRole("button", { name: "Miesięcznie" }));
    await waitFor(() =>
      expect(within(tierCard("Członek")).getByText(moneyPattern(4900))).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("tab", { name: /Dla firm/ }));

    await waitFor(() =>
      expect(within(tierCard("Firma")).getByText(moneyPattern(199900))).toBeInTheDocument(),
    );
  });
});

describe("trasa /pricing - przeliczanie waluty", () => {
  it("po angielsku rozlicza w euro po kursie, a nie w złotówkach", async () => {
    // Ta sama funkcja liczy kwotę tutaj i w checkoucie. Cennik w złotówkach
    // dla anglojęzycznego czytelnika obiecywałby inną kwotę niż pobrana.
    await i18n.changeLanguage("en");
    fullCatalogue();
    await mount();

    const card = await screen.findByRole("heading", { level: 3, name: "Member" });
    const memberCard = card.closest("div[class*='rounded']")?.parentElement as HTMLElement;
    // 490,00 PLN po kursie 4,00 -> 122,50 EUR.
    expect(within(memberCard).getByText(moneyPattern(12250))).toBeInTheDocument();
    expect(memberCard.textContent).not.toContain("zł");
  });

  it("po polsku nie przelicza niczego i zostaje przy złotówkach", async () => {
    fullCatalogue();
    await mount();

    const memberCard = tierCard("Członek");
    expect(within(memberCard).getByText(moneyPattern(49000))).toBeInTheDocument();
    expect(memberCard.textContent).not.toContain("€");
  });
});

describe("trasa /pricing - CTA gościa i czytelnika zalogowanego", () => {
  it("gość dostaje na warstwie domyślnej zaproszenie do rejestracji", async () => {
    // Warstwa domyślna jest bezpłatna - jedyne, co gość może z nią zrobić, to
    // założyć konto. Przycisk zakupu byłby tu ślepą uliczką.
    h.audiences = audiences();
    h.plans = plans();
    h.tiers = [
      membershipTier({
        id: "tier-reader",
        key: "reader",
        name_pl: "Czytelnik",
        name_en: "Reader",
        rank: 0,
        is_default: true,
        audience_key: "individual",
      }),
      membershipTier({ id: "tier-member", key: "member", rank: 10, audience_key: "individual" }),
    ];
    await mount();

    const signup = within(tierCard("Czytelnik")).getByRole("link", {
      name: "Załóż bezpłatne konto",
    });
    expect(signup).toHaveAttribute("href", "/login");
    expect(within(tierCard("Czytelnik")).getByText("Bezpłatnie")).toBeInTheDocument();
  });

  it("zalogowany nie dostaje zaproszenia do rejestracji na warstwie, którą już ma", async () => {
    // „Załóż konto" pokazane zalogowanemu to ślepa uliczka na cenniku - i
    // dokładnie ta różnica wynika z przekazania sesji do karty warstwy.
    h.session = { user: { id: "user-me" } };
    h.audiences = audiences();
    h.plans = plans();
    h.tiers = [
      membershipTier({
        id: "tier-reader",
        key: "reader",
        name_pl: "Czytelnik",
        name_en: "Reader",
        rank: 0,
        is_default: true,
        audience_key: "individual",
      }),
      membershipTier({ id: "tier-member", key: "member", rank: 10, audience_key: "individual" }),
    ];
    await mount();

    await screen.findByRole("heading", { level: 3, name: "Czytelnik" });
    expect(screen.queryByRole("link", { name: "Załóż bezpłatne konto" })).not.toBeInTheDocument();
  });

  it("gość może wejść w checkout planu wprost z cennika", async () => {
    // Bramka tożsamości stoi w checkoucie, nie w cenniku - odcięcie gościa od
    // przycisku zakupu zabierałoby najkrótszą drogę do płatności.
    fullCatalogue();
    await mount();

    const choose = within(tierCard("Członek")).getByRole("link", { name: "Wybierz plan" });
    expect(choose).toHaveAttribute("href", "/checkout/plan-member-year");
  });

  it("plan, który czytelnik już opłaca, ma przycisk WYŁĄCZONY", async () => {
    // To jedyna bariera przed kupieniem drugi raz tego samego planu. Bez niej
    // czytelnik płaci dwa razy, a potem składa reklamację.
    h.session = { user: { id: "user-me" } };
    fullCatalogue();
    h.subscriptions = [
      {
        id: "sub-1",
        user_id: "user-me",
        plan_id: "plan-member-year",
        status: "active",
        started_at: "2026-08-01T00:00:00.000Z",
        current_period_end: "2026-09-01T00:00:00.000Z",
        canceled_at: null,
        plan: null,
      },
    ];
    await mount();

    await screen.findByRole("heading", { level: 3, name: "Członek" });
    await waitFor(() =>
      expect(
        within(tierCard("Członek")).getByRole("button", { name: "Aktualny plan" }),
      ).toBeDisabled(),
    );
    expect(within(tierCard("Członek")).queryByRole("link", { name: "Wybierz plan" })).toBeNull();
  });

  it("warstwa, którą czytelnik ma innym planem, też jest niedostępna do zakupu", async () => {
    // Czytelnik z planem miesięcznym nie kupuje rocznego przez cennik, tylko
    // zmienia plan w profilu - inaczej powstaje druga, równoległa subskrypcja.
    h.session = { user: { id: "user-me" } };
    h.currentTier = {
      key: "member",
      rank: 10,
      name_pl: "Członek",
      name_en: "Member",
      features: {},
    };
    fullCatalogue();
    await mount();

    await screen.findByRole("heading", { level: 3, name: "Członek" });
    await waitFor(() =>
      expect(
        within(tierCard("Członek")).getByRole("button", { name: "Twój obecny poziom" }),
      ).toBeDisabled(),
    );
    // Warstwa wyżej pozostaje do kupienia - to jest ścieżka podwyższenia.
    expect(within(tierCard("Pro")).getByRole("link", { name: "Wybierz plan" })).toBeInTheDocument();
  });

  it("warstwa sprzedawana przez rozmowę otwiera formularz zamiast checkoutu", async () => {
    // Sprzedaż per miejsce przez checkout jednego miejsca byłaby nieuczciwa -
    // dlatego tryb `contact` wyprzedza zakup samoobsługowy.
    fullCatalogue();
    await mount("/pricing?audience=business");

    await screen.findByRole("heading", { level: 3, name: "Firma" });
    fireEvent.click(within(tierCard("Firma")).getByRole("button", { name: /Porozmawiajmy/ }));

    expect(await screen.findByRole("dialog")).toHaveTextContent("Porozmawiajmy o ofercie");
  });

  it("pas kontaktowy otwiera ten sam formularz bez wskazanej warstwy", async () => {
    // To wyjście awaryjne dla niezdecydowanych - musi działać także wtedy, gdy
    // czytelnik nie wybrał żadnej karty.
    fullCatalogue();
    await mount();

    const band = (await screen.findByText("Nie wiesz, który plan wybrać?")).closest(
      "section",
    ) as HTMLElement;
    fireEvent.click(within(band).getByRole("button", { name: /Porozmawiajmy/ }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});

describe("trasa /pricing - cross-sell i sekcje segmentu", () => {
  it("segment zespołowy proponuje przejście do oferty firmowej", async () => {
    // Miękka nawigacja zamiast ślepej uliczki: zespół, który urósł, ma gdzie
    // pójść, zamiast wychodzić z cennika.
    fullCatalogue();
    await mount("/pricing?audience=team");

    expect(
      await screen.findByText("Ponad 20 miejsc, procurement lub dedykowany analityk?"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Zobacz ofertę dla firm/ })).toHaveAttribute(
      "href",
      "/pricing?audience=business",
    );
  });

  it("segment firmowy proponuje przejście w drugą stronę", async () => {
    fullCatalogue();
    await mount("/pricing?audience=business");

    expect(
      await screen.findByText(
        "Mniejszy zespół? Wspólny dostęp z panelem miejsc uruchomisz od ręki.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Zobacz plan dla zespołów/ })).toHaveAttribute(
      "href",
      "/pricing?audience=team",
    );
  });

  it("segment indywidualny nie proponuje cross-sellu", async () => {
    fullCatalogue();
    await mount();

    await screen.findByRole("heading", { level: 3, name: "Członek" });
    expect(screen.queryByText(/Ponad 20 miejsc/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Mniejszy zespół/)).not.toBeInTheDocument();
  });

  it("segment pokazuje swoją zajawkę i swój pasek zaufania", async () => {
    // Pasek zaufania („Faktura · Umowa roczna") jest konfigurowany per segment
    // i odpowiada na inne obiekcje niż zajawka - oba muszą dojść do czytelnika.
    fullCatalogue();
    await mount("/pricing?audience=business");

    expect(await screen.findByText("Dla zespołów decyzyjnych")).toBeInTheDocument();
    expect(screen.getByText("Faktura · Umowa roczna")).toBeInTheDocument();
  });

  it("segment bez zajawki nie zostawia pustego akapitu", async () => {
    fullCatalogue();
    await mount("/pricing?audience=team");

    await screen.findByRole("heading", { level: 3, name: "Zespół" });
    expect(screen.queryByText("Dla zespołów decyzyjnych")).not.toBeInTheDocument();
  });
});

describe("trasa /pricing - FAQ", () => {
  it("pytania z bazy wygrywają z zestawem zapasowym", async () => {
    // FAQ jest redagowane w panelu. Zignorowane wiersze oznaczałyby stronę,
    // której redakcja nie umie poprawić bez wdrożenia.
    fullCatalogue();
    h.faq = [
      pricingFaqItem({
        id: "faq-1",
        question_pl: "Czy wystawiacie faktury?",
        answer_pl: "Tak, na dane z profilu.",
      }),
    ];
    await mount();

    expect(await screen.findByText("Czy wystawiacie faktury?")).toBeInTheDocument();
    expect(screen.queryByText("Czy mogę anulować subskrypcję?")).not.toBeInTheDocument();
  });

  it("bez wierszy w bazie pokazuje zestaw zapasowy ze słownika", async () => {
    // Strona nigdy nie zostaje bez sekcji pytań - to stan sprzed migracji
    // treści, a nie awaria.
    fullCatalogue();
    await mount();

    expect(await screen.findByText("Najczęstsze pytania")).toBeInTheDocument();
    expect(screen.getByText("Czy mogę anulować subskrypcję?")).toBeInTheDocument();
  });

  it("uszkodzony zestaw zapasowy w słowniku nie wywraca cennika", async () => {
    // Zapasowe FAQ czytane jest ze słownika przez `returnObjects`. Gdyby
    // nakładka językowa dostarczyła pod tym kluczem cokolwiek innego niż
    // listę (literówka w strukturze, częściowo załadowany chunk), mapowanie po
    // niej wywróciłoby CAŁĄ stronę cennika - z powodu, który dotyczy wyłącznie
    // sekcji pytań. Ta gałąź jest jedyną rzeczą, która trzyma stronę na nogach.
    const original = i18n.getResource("pl", "translation", "pricing.faq");
    try {
      i18n.addResourceBundle(
        "pl",
        "translation",
        { pricing: { faq: "to nie jest lista" } },
        true,
        true,
      );
      fullCatalogue();
      await mount();

      expect(tierNames()).toEqual(["Członek", "Pro"]);
      expect(screen.queryByText("Czy mogę anulować subskrypcję?")).not.toBeInTheDocument();
    } finally {
      i18n.addResourceBundle("pl", "translation", { pricing: { faq: original } }, true, true);
    }
  });

  it("pytanie przypisane do segmentu pokazuje się tylko w swoim segmencie", async () => {
    // Pytanie o procurement w ofercie indywidualnej to szum; brak tego pytania
    // w ofercie firmowej to nieodpowiedziana obiekcja zakupowa.
    fullCatalogue();
    h.faq = [
      pricingFaqItem({ id: "faq-global", question_pl: "Pytanie wspólne", audience_key: null }),
      pricingFaqItem({
        id: "faq-business",
        question_pl: "Czy obsługujecie procurement?",
        audience_key: "business",
        sort_order: 1,
      }),
    ];
    await mount();
    expect(await screen.findByText("Pytanie wspólne")).toBeInTheDocument();
    expect(screen.queryByText("Czy obsługujecie procurement?")).not.toBeInTheDocument();

    cleanup();
    await mount("/pricing?audience=business");
    expect(await screen.findByText("Czy obsługujecie procurement?")).toBeInTheDocument();
  });
});

describe("trasa /pricing - degradacja źródeł", () => {
  it("cennik wstaje, gdy żadne źródło nie odpowiada", async () => {
    // Każde źródło loadera ma własny `catch`. Awaria jednej tabeli nie może
    // zabrać strony, na której klient wydaje pieniądze.
    h.broken = new Set([
      "pages",
      "pricing_audiences",
      "pricing_faq_items",
      "membership_tiers",
      "access_plans",
    ]);
    await mount();

    expect(await screen.findByRole("heading", { level: 1, name: "Cennik" })).toBeInTheDocument();
    expect(await screen.findByText("Brak dostępnych planów.")).toBeInTheDocument();
  });

  it("cennik wstaje, gdy odczyt danych redakcyjnych wywraca się na transporcie", async () => {
    // To INNY kształt awarii niż odmowa bazy: warstwa `staticPageSeo` połyka
    // błąd PostgREST i oddaje `null`, więc do `catch` w loaderze dochodzi
    // wyłącznie wyjątek transportu. Bez tego `catch` cała trasa oblewa się na
    // etapie loadera - i cennik przestaje istnieć z powodu, który dotyczy
    // WYŁĄCZNIE metadanych nagłówka.
    h.offline = new Set(["pages"]);
    fullCatalogue();
    await mount();

    expect(await screen.findByRole("heading", { level: 1, name: "Cennik" })).toBeInTheDocument();
    expect(tierNames()).toEqual(["Członek", "Pro"]);
  });

  it("sygnały zaufania stoją nad ofertą niezależnie od danych", async () => {
    // Te trzy zdania odpowiadają na obiekcje przed zobaczeniem ceny; są w
    // słowniku właśnie po to, żeby nie zależały od stanu bazy.
    await mount();

    expect(screen.getByText("Bezpieczne płatności online")).toBeInTheDocument();
    expect(screen.getByText("Anuluj w każdej chwili")).toBeInTheDocument();
    expect(screen.getByText("Natychmiastowy dostęp po opłaceniu")).toBeInTheDocument();
  });

  it("dane cennika są w cache PRZED renderem, bo pobrał je loader", async () => {
    // Prefetch to warunek SSR bez migotania: bez niego robot wyszukiwarki
    // dostaje cennik bez cen, a czytelnik - skok układu na oczach.
    fullCatalogue();
    const view = await mount();

    const statusOf = (key: string) =>
      view.queryClient
        .getQueryCache()
        .getAll()
        .find((entry) => JSON.stringify(entry.queryKey).includes(key))?.state.status;

    expect(statusOf("static-page-seo")).toBe("success");
    expect(statusOf("pricing-audiences")).toBe("success");
    expect(statusOf("pricing-faq")).toBe("success");
    expect(statusOf("membership-tiers")).toBe("success");
    expect(statusOf("plans-active")).toBe("success");
  });
});

describe("trasa /pricing - nagłówek strony", () => {
  it("bez wiersza redakcyjnego używa zapasowego tytułu i opisu po polsku", async () => {
    const head = routeHead(PricingRoute, { loaderData: { seo: null } });

    expect(head.meta).toContainEqual({ title: "Cennik - Plany subskrypcji" });
    expect(head.meta).toContainEqual({
      name: "description",
      content: "Wybierz plan dopasowany do Twoich potrzeb. Subskrypcje miesięczne i roczne.",
    });
    expect(head.links).toEqual([]);
  });

  it("wiersz z /admin/pages wygrywa z tekstem zapasowym", async () => {
    const head = routeHead(PricingRoute, { loaderData: { seo: seoRow() } });

    expect(head.meta).toContainEqual({ title: "Cennik NES" });
    expect(head.meta).toContainEqual({
      name: "description",
      content: "Plany członkostwa i przepustki.",
    });
    expect(head.meta).toContainEqual({ property: "og:title", content: "Cennik NES" });
  });

  it("adres kanoniczny i obraz społecznościowy jadą z wiersza redakcyjnego", async () => {
    const head = routeHead(PricingRoute, {
      loaderData: {
        seo: seoRow({
          seo_canonical_url: "https://example.com/pricing",
          seo_og_image_url: "https://example.com/og-pricing.png",
        }),
      },
    });

    expect(head.links).toContainEqual({ rel: "canonical", href: "https://example.com/pricing" });
    expect(head.meta).toContainEqual({
      property: "og:image",
      content: "https://example.com/og-pricing.png",
    });
  });

  it("redakcyjny `noindex` wyprowadza cennik z indeksu", async () => {
    const head = routeHead(PricingRoute, { loaderData: { seo: seoRow({ seo_noindex: true }) } });

    expect(head.meta).toContainEqual({ name: "robots", content: "noindex,nofollow" });
  });

  it("bez `noindex` cennik zostaje w indeksie", async () => {
    const head = routeHead(PricingRoute, { loaderData: { seo: seoRow() } });

    expect((head.meta ?? []).map((entry) => entry.name)).not.toContain("robots");
  });

  it("po angielsku nagłówek jest angielski, także w wersji zapasowej", async () => {
    // Cennik nie ma parametru języka - o wersji rozstrzyga prefiks ścieżki.
    h.requestUrl = "https://example.com/en/pricing";

    const fallback = routeHead(PricingRoute, { loaderData: { seo: null } });
    expect(fallback.meta).toContainEqual({ title: "Pricing - Subscription plans" });

    const edited = routeHead(PricingRoute, { loaderData: { seo: seoRow() } });
    expect(edited.meta).toContainEqual({ title: "NES pricing" });
  });

  it("nagłówek nie wysypuje się bez danych loadera ani bez adresu żądania", async () => {
    // `head()` bywa wołane bez ładunku (przerwana nawigacja, granica błędu),
    // a `getRequestUrl()` bywa pusty - wyjątek tutaj wywraca cały dokument.
    h.requestUrl = "";

    const head = routeHead(PricingRoute, {});

    expect(head.meta).toContainEqual({ title: "Cennik - Plany subskrypcji" });
  });
});
