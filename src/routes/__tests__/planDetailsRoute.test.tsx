// Trasa /plans/$planId - szczegóły pojedynczego planu. Do dziś: 0 z 12 funkcji,
// 0 instrukcji.
//
// CZEGO NIE DOWODZI RENDER SAMEGO KOMPONENTU. Ta strona jest linkowalna i
// SSR-owalna: wchodzi się na nią z wyszukiwarki, z newslettera i z
// udostępnionego adresu. Cała reguła „czy ten adres w ogóle istnieje" mieszka
// w LOADERZE (`notFound()` przy planie, którego nie ma w aktywnym katalogu
// tenanta), a nie w komponencie - a `Route.useParams()`, loader i `head()` nie
// istnieją, dopóki trasa nie jest sklejona z drzewem. Dlatego wszystko poniżej
// biegnie przez `renderRoute`, czyli przez prawdziwy router pamięciowy.
//
// TRZY REGUŁY, KTÓRYCH ZŁAMANIE KOSZTUJE:
//
//   1. NIEISTNIEJĄCY PLAN TO 404, NIE PUSTA KARTA. Strona z ceną i przyciskiem
//      „Wybieram", zbudowana wokół planu, którego nie ma w katalogu, prowadzi
//      wprost do checkoutu bez planu.
//   2. IZOLACJA TENANTA JEST PO STRONIE BAZY. Odczyt idzie przez politykę
//      publiczną (`public_tenant_id()`), więc plan innego obszaru roboczego
//      NIE WRACA z zapytania - i trasa musi z tego zrobić 404, a nie pustkę.
//   3. NAGŁÓWEK NIESIE NAZWĘ PLANU. To on decyduje, jak ten adres wygląda w
//      wynikach wyszukiwania i w udostępnieniu; wersja bez danych loadera musi
//      wyjść z indeksu, zamiast zostawić w nim pusty tytuł.
//
// ATRAPOWANE SĄ WYŁĄCZNIE GRANICE: klient Supabase, sesja i telemetria.
// Warstwa zapytań, selektory cennika, matryca porównania i słowniki biegną
// prawdziwe.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";

import type { MembershipTierRow } from "@/lib/billing/tiers";
import type { AccessPlan } from "@/lib/billing/types";

const PLAN_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER_PLAN_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const h = vi.hoisted(() => ({
  /**
   * Kolejne odpowiedzi tabeli `access_plans`. Pierwsza obsługuje loader,
   * druga - odświeżenie z komponentu. Rozdzielenie ich jest konieczne, bo to
   * jedyny sposób odtworzenia realnego przypadku „plan wycofany ze sprzedaży,
   * gdy strona była już otwarta".
   */
  planResponses: [] as unknown[][],
  tiers: [] as unknown[],
  currentTier: null as unknown,
  session: null as { user: { id: string } } | null,
  broken: new Set<string>(),
  /**
   * Adres żądania, po którym `head()` rozpoznaje wersję językową. To GRANICA:
   * trasa nie ma parametru języka, więc o języku nagłówka rozstrzyga wyłącznie
   * prefiks ścieżki (`/en/plans/...`).
   */
  requestUrl: "https://example.com/plans/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  trackCta: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, ok, fail } = await import("@/test/supabaseChain");
  const stub = supabaseFromStub();
  stub.setResponse("access_plans", () => {
    if (h.broken.has("access_plans")) return fail("test: tabela access_plans niedostępna");
    // Ostatnia zaplanowana odpowiedź obowiązuje dla wszystkich dalszych
    // odczytów - test planuje tyle wariantów, ile naprawdę potrzebuje.
    const next = h.planResponses.length > 1 ? h.planResponses.shift() : h.planResponses[0];
    return ok(next ?? []);
  });
  stub.setResponse("membership_tiers", () =>
    h.broken.has("membership_tiers")
      ? fail("test: tabela membership_tiers niedostępna")
      : ok(h.tiers),
  );
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
// GRANICA ŻĄDANIA: adres, po którym `head()` rozpoznaje wersję językową.
vi.mock("@/lib/seo/request", () => ({
  getRequestUrl: () => h.requestUrl,
  getOrigin: () => "https://example.com",
}));

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { setClientLang } from "@/lib/i18n/localeRuntime";
import { renderRoute, routeHead } from "@/test/routeHarness";
import { axeViolations, summarize } from "@/test/axe";
import { membershipTier } from "@/test/admin/pricingFixtures";
import { accessPlan, moneyPattern } from "@/test/billing/fixtures";
import { Route as PlanRoute } from "@/routes/plans.$planId";

const PATH = "/plans/$planId";

function plan(overrides: Partial<AccessPlan> = {}): AccessPlan {
  return accessPlan({
    id: PLAN_ID,
    tier_key: "member",
    name_pl: "Członek",
    name_en: "Member",
    description_pl: "Pełny dostęp do analiz i klubów.",
    description_en: "Full access to analyses and clubs.",
    price_cents: 4900,
    features_pl: [],
    features_en: [],
    ...overrides,
  });
}

function tierLadder(): MembershipTierRow[] {
  return [
    membershipTier({
      id: "tier-member",
      key: "member",
      rank: 10,
      audience_key: "individual",
      benefits: [
        { pl: "Poranny briefing", en: "Morning briefing" },
        { pl: "Archiwum analiz", en: "Analyses archive" },
      ],
      features: { briefings: true },
    }),
    membershipTier({
      id: "tier-pro",
      key: "pro",
      name_pl: "Pro",
      name_en: "Pro",
      rank: 20,
      audience_key: "individual",
      benefits: [{ pl: "Zamknięte debaty", en: "Closed-door debates" }],
      features: { briefings: true, debates: true },
    }),
  ];
}

async function mount(planId = PLAN_ID) {
  return renderRoute({ route: PlanRoute, path: PATH, initialEntry: `/plans/${planId}` });
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  setClientLang("pl");
  h.planResponses = [[plan()]];
  h.tiers = tierLadder();
  h.currentTier = null;
  h.session = null;
  h.broken = new Set<string>();
  h.requestUrl = `https://example.com/plans/${PLAN_ID}`;
  h.trackCta.mockReset();
});

afterEach(async () => {
  cleanup();
  setClientLang("pl");
  await i18n.changeLanguage("pl");
  vi.restoreAllMocks();
});

describe("trasa /plans/$planId - parametr ścieżki i sklejenie", () => {
  it("czyta identyfikator planu ze ŚCIEŻKI i pokazuje ten właśnie plan", async () => {
    // Adres jest jedynym wejściem do tej strony. Parametr odczytany z innego
    // miejsca (albo zignorowany) daje stronę, która dla każdego adresu
    // pokazuje pierwszy plan z katalogu - a więc mylną cenę pod właściwym URL.
    h.planResponses = [
      [plan({ id: OTHER_PLAN_ID, name_pl: "Zespół", name_en: "Team", tier_key: "pro" }), plan()],
    ];
    const view = await mount(OTHER_PLAN_ID);

    expect(view.currentPath()).toBe(`/plans/${OTHER_PLAN_ID}`);
    expect(screen.getByRole("heading", { level: 1, name: "Zespół" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "Członek" })).not.toBeInTheDocument();
  });

  it("prowadzi do checkoutu TEGO planu, nie do ogólnego cennika", async () => {
    // Przycisk zakupu jest końcem tej strony. Adres bez identyfikatora planu
    // wysyła kupującego z powrotem do wyboru, który już zrobił.
    await mount();

    expect(screen.getByRole("link", { name: /Wybieram|Wybierz/ })).toHaveAttribute(
      "href",
      `/checkout/${PLAN_ID}`,
    );
  });

  it("daje wyjście z powrotem do cennika w dwóch miejscach", async () => {
    // Strona szczegółów jest ślepą uliczką, jeśli jedynym wyjściem jest
    // przycisk „wstecz" przeglądarki - a wchodzi się na nią z zewnątrz.
    await mount();

    const backLinks = screen.getAllByRole("link", { name: /Wróć do cennika|Porównaj/ });
    expect(backLinks.length).toBeGreaterThanOrEqual(2);
    backLinks.forEach((link) => expect(link).toHaveAttribute("href", "/pricing"));
  });

  it("nie zostawia strony planu z wadami dostępności", async () => {
    const view = await mount();
    await screen.findByRole("heading", { level: 1, name: "Członek" });

    const violations = await axeViolations(view.container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("trasa /plans/$planId - plan, którego nie ma", () => {
  it("nieistniejący identyfikator kończy się 404, a nie pustą kartą zakupu", async () => {
    // `notFound()` w loaderze jest jedyną rzeczą, która trzyma ten adres poza
    // lejkiem zakupu. Bez niej strona zbudowałaby się wokół `undefined` i
    // pokazała przycisk płatności bez planu.
    const view = await mount("cccccccc-cccc-cccc-cccc-cccccccccccc");

    expect(screen.queryByRole("heading", { level: 1, name: "Członek" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Wybieram|Wybierz/ })).not.toBeInTheDocument();
    expect(view.container.textContent).not.toMatch(moneyPattern(4900));
  });

  it("plan spoza przeglądanego obszaru roboczego w ogóle nie wraca z odczytu", async () => {
    // Autorytetem jest polityka `plans public read`: odczyt idzie przez
    // `public_tenant_id()`, czyli tenanta PRZEGLĄDANEJ domeny, więc plan
    // innego obszaru po prostu nie ma prawa pojawić się w wyniku. Trasa nie
    // ma własnego porównania tenantów i mieć go nie powinna - ten test pilnuje
    // skutku: cudzy plan to 404, a nie jego nazwa i cena na ekranie.
    h.planResponses = [[]];
    const view = await mount();

    expect(view.container.textContent).not.toContain("Członek");
    expect(screen.queryByRole("link", { name: /Wybieram|Wybierz/ })).not.toBeInTheDocument();
  });

  it("plan nieaktywny nie ma własnej strony sprzedażowej", async () => {
    // `fetchActivePlans` czyta wyłącznie `active = true`, więc wycofany plan
    // znika z katalogu razem ze swoim adresem. Gdyby zostawał, wyszukiwarka
    // dalej wysyłałaby ludzi na ofertę, której nie da się kupić.
    h.planResponses = [[]];
    const view = await mount();

    expect(screen.queryByRole("link", { name: /Wybieram|Wybierz/ })).not.toBeInTheDocument();
    expect(view.currentPath()).toBe(`/plans/${PLAN_ID}`);
  });

  it("awaria odczytu katalogu też kończy się 404, a nie białą stroną", async () => {
    // `ensureQueryData(...).catch(() => null)` degraduje odczyt do pustego
    // katalogu; loader ma z tego zrobić 404. Wyjątek przepuszczony wyżej
    // wywróciłby całą trasę razem z nagłówkiem.
    h.broken = new Set(["access_plans", "membership_tiers"]);
    await mount();

    expect(screen.queryByRole("heading", { level: 1, name: "Członek" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Wybieram|Wybierz/ })).not.toBeInTheDocument();
  });

  it("plan wycofany przy otwartej stronie zamienia się w komunikat z drogą powrotu", async () => {
    // Loader zdążył pobrać plan, a odświeżenie z komponentu zastaje katalog
    // już bez niego (redakcja wyłączyła plan w trakcie sesji czytelnika). To
    // JEDYNA droga do gałęzi „nie znaleziono planu" w komponencie i zarazem
    // realny przebieg: kupujący nie może zostać z przyciskiem płatności
    // prowadzącym do planu, którego katalog już nie zna.
    h.planResponses = [[plan()], []];
    await mount();

    expect(
      await screen.findByText("Nie znaleziono takiego planu - mógł zostać wycofany ze sprzedaży."),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: /Wybieram|Wybierz/ })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("link", { name: "Wróć do cennika" })).toHaveAttribute(
      "href",
      "/pricing",
    );
  });
});

describe("trasa /plans/$planId - treść oferty", () => {
  it("składa nagłówek planu z nazwy, opisu, ceny i cyklu", async () => {
    // To jest cała obietnica handlowa tej strony. Zgubiony cykl przy cenie
    // rocznej („999 zł" zamiast „999 zł rocznie") to najkosztowniejsza
    // pomyłka, jaką ta strona może zrobić.
    h.planResponses = [
      [plan({ interval: "year", price_cents: 99900, name_pl: "Pro rocznie", tier_key: "pro" })],
    ];
    await mount();

    expect(screen.getByRole("heading", { level: 1, name: "Pro rocznie" })).toBeInTheDocument();
    expect(screen.getByText("Pełny dostęp do analiz i klubów.")).toBeInTheDocument();
    expect(screen.getByText(moneyPattern(99900))).toBeInTheDocument();
    expect(screen.getByText("/ rok")).toBeInTheDocument();
  });

  it("odznaka planu pokazuje się tylko wtedy, gdy redakcja ją nadała", async () => {
    h.planResponses = [[plan({ badge_pl: "Najczęściej wybierany", badge_en: "Most popular" })]];
    await mount();
    expect(screen.getByText("Najczęściej wybierany")).toBeInTheDocument();

    cleanup();
    h.planResponses = [[plan()]];
    await mount();
    expect(screen.queryByText("Najczęściej wybierany")).not.toBeInTheDocument();
  });

  it("okres próbny ogłasza się tylko wtedy, gdy plan go ma", async () => {
    // Obietnica darmowych dni musi wynikać z planu, nie z układu strony:
    // pokazana bez pokrycia jest obietnicą handlową, której nikt nie spełni.
    h.planResponses = [[plan({ trial_days: 14 })]];
    await mount();
    expect(screen.getByText(/14 dni/)).toBeInTheDocument();

    cleanup();
    h.planResponses = [[plan({ trial_days: 0 })]];
    await mount();
    expect(screen.queryByText(/dni za darmo|dni bezpłatnie/)).not.toBeInTheDocument();
  });

  it("plan bez własnych benefitów dziedziczy je po swojej warstwie", async () => {
    // Plan podpięty pod warstwę NIGDY nie świeci pustą listą - inaczej strona
    // szczegółów mówi mniej niż karta w cenniku, z której czytelnik przyszedł.
    h.planResponses = [[plan({ features_pl: [], features_en: [] })]];
    await mount();

    expect(screen.getByText("Co obejmuje ten plan")).toBeInTheDocument();
    expect(screen.getByText("Poranny briefing")).toBeInTheDocument();
    expect(screen.getByText("Archiwum analiz")).toBeInTheDocument();
  });

  it("własne benefity planu mają pierwszeństwo przed benefitami warstwy", async () => {
    // Kolejność jest regułą: plan promocyjny opisuje SIEBIE, a nie próg, pod
    // który jest podpięty.
    h.planResponses = [
      [plan({ features_pl: ["Konsultacja wdrożeniowa"], features_en: ["Onboarding call"] })],
    ];
    await mount();

    expect(screen.getByText("Konsultacja wdrożeniowa")).toBeInTheDocument();
    expect(screen.queryByText("Poranny briefing")).not.toBeInTheDocument();
  });

  it("plan bez benefitów i bez warstwy nie rysuje pustej karty", async () => {
    // Pusta karta „Co obejmuje ten plan" jest gorsza niż jej brak: czyta się
    // jak plan, który nie obejmuje niczego.
    h.planResponses = [[plan({ tier_key: null, features_pl: [], features_en: [] })]];
    await mount();

    expect(screen.queryByText("Co obejmuje ten plan")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Członek" })).toBeInTheDocument();
  });

  it("plan wskazujący na skasowaną warstwę nie wysypuje strony", async () => {
    // `tier_key` jest tekstem, nie kluczem obcym z kaskadą - warstwa usunięta w
    // panelu zostawia plany wskazujące na nieistniejący klucz. Strona ma wtedy
    // pokazać własne benefity planu i zwykłą matrycę, a nie paść na `find()`
    // zwracającym `undefined`.
    h.planResponses = [
      [
        plan({
          tier_key: "warstwa-ktorej-nie-ma",
          features_pl: ["Dostęp do analiz"],
          features_en: ["Access"],
        }),
      ],
    ];
    await mount();

    expect(screen.getByRole("heading", { level: 1, name: "Członek" })).toBeInTheDocument();
    expect(screen.getByText("Dostęp do analiz")).toBeInTheDocument();
    expect(screen.getByText("Limity i porównanie")).toBeInTheDocument();
  });

  it("warstwa bez segmentu liczy się jako indywidualna, a nie znika z porównania", async () => {
    // Segment jest polem opcjonalnym (warstwy sprzed Cennika 2.0 mają `null`).
    // Pominięte w matrycy zostawiłyby czytelnika bez drabinki, na którą
    // właśnie patrzy - a jego własna warstwa mogłaby być tą pominiętą.
    h.tiers = [
      membershipTier({ id: "tier-legacy", key: "member", rank: 10, audience_key: null }),
      membershipTier({
        id: "tier-legacy-pro",
        key: "pro",
        name_pl: "Pro",
        name_en: "Pro",
        rank: 20,
        audience_key: null,
      }),
    ];
    h.planResponses = [
      [plan({ tier_key: null, features_pl: ["Dostęp"], features_en: ["Access"] })],
    ];
    await mount();

    expect(screen.getAllByText("Członek").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Pro").length).toBeGreaterThan(0);
  });

  it("warstwy o równej randze ustawia kolejność redakcyjna, a nie przypadek", async () => {
    // Ranga bywa równa w katalogu (Plus, Student i Kadra akademicka mają
    // wszystkie rangę 10). Bez rozstrzygnięcia po `sort_order` kolumny matrycy
    // ustawiałaby kolejność wierszy z bazy - a ta nie jest gwarantowana, więc
    // czytelnik dostawałby raz jedną, raz drugą drabinkę i nie miałby jak
    // porównać jej z tym, co widział na cenniku.
    h.tiers = [
      membershipTier({
        id: "tier-member",
        key: "member",
        rank: 10,
        sort_order: 20,
        audience_key: "individual",
      }),
      membershipTier({
        id: "tier-reader",
        key: "reader",
        name_pl: "Czytelnik",
        name_en: "Reader",
        rank: 10,
        sort_order: 10,
        audience_key: "individual",
      }),
    ];
    await mount();

    const headers = screen.getAllByRole("columnheader").map((cell) => cell.textContent ?? "");
    const readerAt = headers.findIndex((text) => text.includes("Czytelnik"));
    const memberAt = headers.findIndex((text) => text.includes("Członek"));
    expect(readerAt).toBeGreaterThanOrEqual(0);
    expect(memberAt).toBeGreaterThan(readerAt);
  });

  it("porównanie pokazuje warstwy TEGO segmentu, bez progu darowizny", async () => {
    // Matryca ma odpowiadać na pytanie „co dostanę wyżej, a co niżej" w tym
    // samym segmencie. Warstwa Supportera to osobna ścieżka (darowizna), więc
    // w drabince cenowej byłaby fałszywym progiem.
    h.tiers = [
      ...tierLadder(),
      membershipTier({
        id: "tier-supporter",
        key: "supporter",
        name_pl: "Wspierający",
        name_en: "Supporter",
        rank: 5,
        audience_key: "individual",
      }),
      membershipTier({
        id: "tier-business",
        key: "business",
        name_pl: "Firma",
        name_en: "Business",
        rank: 30,
        audience_key: "business",
      }),
    ];
    await mount();

    expect(screen.getByText("Limity i porównanie")).toBeInTheDocument();
    expect(screen.queryByText("Wspierający")).not.toBeInTheDocument();
    expect(screen.queryByText("Firma")).not.toBeInTheDocument();
  });

  it("plan bez warstwy porównuje się w segmencie indywidualnym", async () => {
    // Brak `tier_key` to nie brak kontekstu: plan luzem należy do oferty
    // indywidualnej, więc matryca ma pokazać tę drabinkę, a nie pustkę.
    h.planResponses = [
      [plan({ tier_key: null, features_pl: ["Dostęp"], features_en: ["Access"] })],
    ];
    await mount();

    expect(screen.getByText("Limity i porównanie")).toBeInTheDocument();
    expect(screen.getAllByText("Członek").length).toBeGreaterThan(0);
  });

  it("gwarancja zwrotu i bezpieczeństwa płatności stoi przy planie", async () => {
    // To ostatnie zdanie przed decyzją o zapłacie - jego brak zdejmuje ze
    // strony jedyną informację o tym, że subskrypcję da się anulować.
    await mount();

    expect(screen.getByText(/Płatność zabezpieczona/)).toBeInTheDocument();
  });
});

describe("trasa /plans/$planId - wersja angielska", () => {
  it("po angielsku bierze angielskie pola planu i warstwy", async () => {
    // Plan ma nazwę i opis w obu językach. Wersja angielska pokazująca polskie
    // pole to strona, której anglojęzyczny czytelnik nie kupi.
    await i18n.changeLanguage("en");
    h.planResponses = [[plan({ features_pl: [], features_en: [] })]];
    await mount();

    expect(screen.getByRole("heading", { level: 1, name: "Member" })).toBeInTheDocument();
    expect(screen.getByText("Full access to analyses and clubs.")).toBeInTheDocument();
    expect(screen.getByText("Morning briefing")).toBeInTheDocument();
    expect(screen.getByText("What this plan includes")).toBeInTheDocument();
  });
});

describe("trasa /plans/$planId - nagłówek dokumentu", () => {
  it("tytuł niesie nazwę planu, a opis pochodzi z jego opisu", async () => {
    // Ten tytuł jest tym, co widać w wyniku wyszukiwania i w udostępnieniu.
    // Wspólny tytuł dla wszystkich planów zlewa całą ofertę w jeden wynik.
    const head = routeHead(PlanRoute, { loaderData: { plan: plan() } });

    expect(head.meta).toContainEqual({ title: "Członek - szczegóły planu" });
    expect(head.meta).toContainEqual({
      name: "description",
      content: "Pełny dostęp do analiz i klubów.",
    });
    expect(head.meta).toContainEqual({ property: "og:type", content: "website" });
    expect(head.meta).toContainEqual({ name: "twitter:card", content: "summary" });
  });

  it("plan bez opisu dostaje zdanie zapasowe z własną nazwą", async () => {
    // Pusty `description` w wyniku wyszukiwania to wynik bez zajawki - a
    // zajawka decyduje o tym, czy ktoś w ten wynik kliknie.
    const head = routeHead(PlanRoute, {
      loaderData: { plan: plan({ description_pl: null, description_en: null }) },
    });

    expect(head.meta).toContainEqual({
      name: "description",
      content: "Zakres, limity i cena planu Członek.",
    });
  });

  it("po angielsku tytuł i zdanie zapasowe są angielskie", async () => {
    h.requestUrl = `https://example.com/en/plans/${PLAN_ID}`;

    const head = routeHead(PlanRoute, {
      loaderData: { plan: plan({ description_pl: null, description_en: null }) },
    });

    expect(head.meta).toContainEqual({ title: "Member - plan details" });
    expect(head.meta).toContainEqual({
      name: "description",
      content: "Benefits, limits and pricing of the Member plan.",
    });
  });

  it("bez danych loadera nagłówek wychodzi z indeksu zamiast zostawiać pusty tytuł", async () => {
    // `head()` bywa wołane bez ładunku loadera (przerwana nawigacja, 404).
    // Strona bez planu nie ma czego obiecywać, więc nie może zostać w indeksie
    // z pustą albo mylącą nazwą.
    const head = routeHead(PlanRoute, {});

    expect(head.meta).toContainEqual({ title: "Plan niedostępny" });
    expect(head.meta).toContainEqual({ name: "robots", content: "noindex" });
  });

  it("po angielsku wersja bez danych też mówi po angielsku", async () => {
    h.requestUrl = `https://example.com/en/plans/${PLAN_ID}`;

    const head = routeHead(PlanRoute, {});

    expect(head.meta).toContainEqual({ title: "Plan unavailable" });
    expect(head.meta).toContainEqual({ name: "robots", content: "noindex" });
  });
});
