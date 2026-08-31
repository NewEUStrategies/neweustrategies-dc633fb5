// Trasa /membership-join - publiczna strona wejścia do członkostwa. Do dziś:
// 0 z 8 funkcji, 0 instrukcji, mimo że sześć organizmów pod nią ma własne testy.
//
// CZEGO NIE DOWODZI TEST KOMPONENTÓW. `membershipJoin.test.tsx` renderuje
// organizmy pojedynczo, więc mija DOKŁADNIE tę warstwę, w której mieszkają
// błędy tej trasy: loader (cztery prefetche, każdy degradujący niezależnie),
// `head()` (tytuł i opis redagowane w /admin/pages, adres kanoniczny, `noindex`)
// oraz `errorComponent`. Ten plik montuje PRAWDZIWĄ trasę w routerze
// pamięciowym, więc przechodzi tę samą drogą, co czytelnik wchodzący z
// wyszukiwarki.
//
// TRZY REGUŁY, KTÓRYCH ZŁAMANIA NIE WIDAĆ NA PIERWSZY RZUT OKA:
//
//   1. STRONA WSTAJE TAKŻE BEZ OFERTY. Każde źródło loadera ma własny `catch`,
//      bo niedostępny cennik nie może zabrać całej strony wejścia - to jedyna
//      publiczna ścieżka do zostania członkiem.
//   2. NAGŁÓWEK JEST REDAGOWANY, NIE ZAKODOWANY. Tytuł i opis pochodzą z
//      /admin/pages, a zapasowe teksty są tylko wtedy, gdy strony tam nie ma.
//      Zignorowany wiersz redakcyjny to strona, której nikt nie umie poprawić.
//   3. CTA ZALEŻY OD SESJI. „Zarejestruj się" pokazane zalogowanemu członkowi
//      to ślepa uliczka na końcu jedynej ścieżki zakupowej.
//
// UWAGA O ZAKRESIE. Ta trasa NIE MA ścieżki zaproszeń (token, wygaśnięcie,
// brak zaproszenia) - to osobne trasy `club.join.$token` i
// `events_.invite.$token`, poza zakresem tej pracy. Tutaj odpowiednikiem tych
// przypadków są: wejście gościa, wejście zalogowanego członka, oferta
// niedostępna i awaria renderu.
//
// ATRAPOWANE SĄ WYŁĄCZNIE GRANICE: klient Supabase, sesja i telemetria.
// Organizmy, selektory cennika i słowniki biegną prawdziwe.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";

import type { MembershipTierRow } from "@/lib/billing/tiers";
import type { PricingAudienceRow } from "@/lib/pricing/queries";
import type { AccessPlan } from "@/lib/billing/types";
import type { StaticPageSeo } from "@/lib/queries/staticPageSeo";

const h = vi.hoisted(() => ({
  seo: null as unknown,
  audiences: [] as unknown[],
  tiers: [] as unknown[],
  plans: [] as unknown[],
  subscriptions: [] as unknown[],
  currentTier: null as unknown,
  session: null as { user: { id: string } } | null,
  /** Tabele, które mają odpowiedzieć BŁĘDEM PostgREST (odmowa RLS, błąd SQL). */
  broken: new Set<string>(),
  /**
   * Tabele, których odczyt WYWRACA SIĘ NA TRANSPORCIE (sieć padła, brama
   * odcięła). To inny kształt awarii niż `broken`: warstwa danych strony
   * redakcyjnej połyka błąd PostgREST i zwraca `null`, więc tylko wyjątek
   * transportu dochodzi do `catch` w loaderze.
   */
  offline: new Set<string>(),
  /** Wymusza wyjątek w renderze komponentu - jedyna droga do `errorComponent`. */
  authThrows: null as Error | null,
  /**
   * Adres żądania, z którego `head()` wyprowadza język strony. W teście to
   * GRANICA: `getRequestUrl()` czyta żądanie serwera albo `window.location`,
   * a trasa /membership-join nie ma parametru języka - o wersji językowej
   * nagłówka rozstrzyga wyłącznie prefiks ścieżki (`/en/...`).
   */
  requestUrl: "https://example.com/membership-join",
  trackCta: vi.fn(),
}));

// GRANICA DANYCH: klient Supabase. Warstwa zapytań (`fetchActivePlans`,
// `fetchMembershipTiers`, `pricingAudiencesQueryOptions`, `staticPageSeo`)
// biegnie PRAWDZIWA - to ona składa wiersze w kształt, który czyta strona.
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
  answer("pricing_faq_items", () => []);
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
// GRANICA TOŻSAMOŚCI.
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => {
    if (h.authThrows) throw h.authThrows;
    return {
      session: h.session,
      user: h.session?.user ?? null,
      roles: [],
      tenantId: null,
      loading: false,
      isStaff: false,
      isAdmin: false,
      isSuperAdmin: false,
      signOut: async () => {},
    };
  },
}));
// GRANICA TELEMETRII - żaden test nie wysyła zdarzenia produktowego.
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
import { membershipTier, pricingAudience } from "@/test/admin/pricingFixtures";
import { accessPlan } from "@/test/billing/fixtures";
import { Route as JoinRoute } from "@/routes/membership-join";

const PATH = "/membership-join";

/** Redagowany wiersz strony z /admin/pages - źródło nagłówka tej trasy. */
function seoRow(overrides: Partial<NonNullable<StaticPageSeo>> = {}): NonNullable<StaticPageSeo> {
  return {
    slug: "membership-join",
    title_pl: "Dołącz do NES",
    title_en: "Join NES",
    excerpt_pl: "Członkostwo, które daje wpływ na agendę.",
    excerpt_en: "Membership with real agenda influence.",
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

/** Komplet oferty: jeden segment, dwie warstwy, plan miesięczny i roczny. */
function fullOffer(): {
  audiences: PricingAudienceRow[];
  tiers: MembershipTierRow[];
  plans: AccessPlan[];
} {
  return {
    audiences: [pricingAudience()],
    tiers: [
      membershipTier(),
      membershipTier({
        id: "tier-pro",
        key: "pro",
        name_pl: "Pro",
        name_en: "Pro",
        rank: 20,
        benefits: [
          { pl: "Poranny briefing", en: "Morning briefing" },
          { pl: "Zamknięte debaty", en: "Closed-door debates" },
        ],
      }),
    ],
    plans: [
      accessPlan({ id: "plan-member", tier_key: "member" }),
      accessPlan({
        id: "plan-pro-year",
        tier_key: "pro",
        interval: "year",
        name_pl: "Pro rocznie",
        name_en: "Pro yearly",
        price_cents: 99900,
      }),
    ],
  };
}

async function mount() {
  return renderRoute({ route: JoinRoute, path: PATH, initialEntry: PATH });
}

/** Podpisuje sesję czytelnika po OBU stronach granicy (hook i klient bazy). */
function signIn(): void {
  h.session = { user: { id: "user-me" } };
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  setClientLang("pl");
  h.requestUrl = "https://example.com/membership-join";
  h.seo = null;
  h.audiences = [];
  h.tiers = [];
  h.plans = [];
  h.subscriptions = [];
  h.currentTier = null;
  h.session = null;
  h.broken = new Set<string>();
  h.offline = new Set<string>();
  h.authThrows = null;
  h.trackCta.mockReset();
});

afterEach(async () => {
  cleanup();
  setClientLang("pl");
  await i18n.changeLanguage("pl");
  vi.restoreAllMocks();
});

describe("trasa /membership-join - ścieżka dołączenia", () => {
  it("prowadzi gościa do rejestracji i do cennika z jednego ekranu", async () => {
    // To jedyna publiczna strona, na której ktoś bez konta ma się dowiedzieć,
    // po co miałby zostać członkiem, i mieć gdzie kliknąć. Brak przycisku
    // rejestracji na tej stronie zamyka JEDYNĄ ścieżkę wejścia.
    const offer = fullOffer();
    h.audiences = offer.audiences;
    h.tiers = offer.tiers;
    h.plans = offer.plans;
    const view = await mount();

    expect(view.currentPath()).toBe(PATH);
    const heading = screen.getAllByRole("heading", { level: 1 });
    // Jedyny H1 strony siedzi w nagłówku - dwa H1 to strona bez tematu dla
    // czytnika ekranu i dla wyszukiwarki.
    expect(heading).toHaveLength(1);

    const register = screen.getAllByRole("link", { name: "Załóż konto" });
    expect(register.length).toBeGreaterThan(0);
    expect(register[0]).toHaveAttribute("href", "/membership-registration");
    expect(screen.getByRole("link", { name: "Zobacz plany i ceny" })).toHaveAttribute(
      "href",
      "/pricing",
    );
  });

  it("pokazuje warstwy członkostwa z bazy, a nie zaszyte w kodzie", async () => {
    // Oferta na tej stronie i na /pricing pochodzi z JEDNEGO źródła. Gdyby
    // strona wejścia rysowała własną listę, czytelnik zobaczyłby inną ofertę,
    // niż kupi dwa kliknięcia dalej.
    const offer = fullOffer();
    h.audiences = offer.audiences;
    h.tiers = offer.tiers;
    h.plans = offer.plans;
    await mount();

    expect(await screen.findByText("Członek")).toBeInTheDocument();
    expect(screen.getByText("Pro")).toBeInTheDocument();
    expect(screen.getByText("Zamknięte debaty")).toBeInTheDocument();
  });

  it("dane oferty są w cache PRZED renderem, bo pobrał je loader", async () => {
    // Prefetch w loaderze to warunek SSR bez migotania: gdyby warstwy i plany
    // dociągały się dopiero z komponentu, robot wyszukiwarki dostałby stronę
    // bez oferty, a czytelnik - skok układu.
    const offer = fullOffer();
    h.audiences = offer.audiences;
    h.tiers = offer.tiers;
    h.plans = offer.plans;
    const view = await mount();

    // Cztery klucze, o które pyta loader - stan „success" znaczy, że dane były
    // w cache, ZANIM komponent zdążył o nie poprosić.
    const statusOf = (key: string) =>
      view.queryClient
        .getQueryCache()
        .getAll()
        .find((entry) => JSON.stringify(entry.queryKey).includes(key))?.state.status;

    expect(statusOf("static-page-seo")).toBe("success");
    expect(statusOf("pricing-audiences")).toBe("success");
    expect(statusOf("membership-tiers")).toBe("success");
    expect(statusOf("plans-active")).toBe("success");
  });

  it("nie zostawia strony wejścia z wadami dostępności", async () => {
    // Reguła `definition-list` jest tu wyłączona ŚWIADOMIE - opisuje ją osobny
    // `it.fails` niżej, razem z powodem, dla którego nie naprawiam jej w tej
    // pracy. Wyłączenie jest wąskie, więc reszta reguł (nazwy odnośników,
    // kolejność nagłówków, poprawność ARIA) nadal pilnuje tej strony.
    const offer = fullOffer();
    h.audiences = offer.audiences;
    h.tiers = offer.tiers;
    h.plans = offer.plans;
    const view = await mount();
    await screen.findByText("Członek");

    const violations = await axeViolations(view.container, {
      "definition-list": { enabled: false },
    });
    expect(violations, summarize(violations)).toEqual([]);
  });

  it.fails("lista liczb dowodowych w nagłówku nie jest poprawną listą definicji", async () => {
    // CO JEST ZŁE. `JoinHero` opakowuje liczby dowodowe w `<dl>`, ale każdy
    // wpis renderuje `JoinStat`, czyli `<div><p/><p/></div>` - bez `<dt>` i
    // `<dd>`. Znacznik `<dl>` obiecuje czytnikowi ekranu listę par
    // „termin - definicja", a dostarcza dwa akapity w pudełku.
    //
    // DLACZEGO TO RYZYKO. Czytnik ekranu zapowiada „lista definicji, 0
    // elementów" i przechodzi dalej, więc cztery liczby, które mają przekonać
    // czytelnika do członkostwa, znikają z odsłuchu strony wejścia. To
    // jednocześnie naruszenie WCAG 1.3.1 (info i relacje) na stronie
    // publicznej.
    //
    // DLACZEGO NADAL NIE NAPRAWIONE.
    //
    // PRÓBA NAPRAWY (praca „napraw defekty modułu 13"). Naprawa jest znana
    // i jednoznaczna: `JoinStat` ma renderować `<dt>` (etykieta) i `<dd>`
    // (liczba) zamiast dwóch `<p>` w `<div>`, a `JoinHero` ma zawinąć każdą
    // parę w `<div>` dopuszczony przez regułę `definition-list` (albo zejść
    // z `<dl>` na zwykłą listę `<ul>`). Obie zmiany leżą w
    // `src/components/membership-join/atoms/JoinStat.tsx` i
    // `src/components/membership-join/organisms/JoinHero.tsx` - czyli POZA
    // listą plików produkcyjnych, które ta praca może zmieniać (trasa
    // `membership-join.tsx` renderuje `JoinHero` i nie ma jak wpłynąć na jego
    // znaczniki). `JoinStat` jest w dodatku atomem pisanym z myślą o użyciu
    // w dowolnym module (patrz jego nagłówek), więc wybór między `<dt>/<dd>`
    // a rezygnacją z `<dl>` jest decyzją właściciela modułu, nie skutkiem
    // ubocznym naprawy trasy.
    //
    // ASERCJA DOCELOWA: strona bez naruszeń reguły `definition-list`.
    const offer = fullOffer();
    h.audiences = offer.audiences;
    h.tiers = offer.tiers;
    h.plans = offer.plans;
    const view = await mount();
    await screen.findByText("Członek");

    const violations = await axeViolations(view.container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("trasa /membership-join - czytelnik już zalogowany", () => {
  it("nie proponuje rejestracji komuś, kto ma już konto", async () => {
    // „Zarejestruj się" pokazane zalogowanemu to ślepa uliczka: klik prowadzi
    // do formularza, którego ta osoba nie ma jak wypełnić.
    signIn();
    const offer = fullOffer();
    h.audiences = offer.audiences;
    h.tiers = offer.tiers;
    h.plans = offer.plans;
    await mount();

    expect(screen.queryByRole("link", { name: "Załóż konto" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Przejdź do swojego profilu" })).toHaveAttribute(
      "href",
      "/profile",
    );
  });

  it("czyta subskrypcję zalogowanego, żeby oznaczyć jego bieżący plan", async () => {
    // Karta planu, który czytelnik już opłaca, nie może zapraszać do zakupu
    // tego samego planu drugi raz - to najczęstsza droga do podwójnej
    // płatności i do zgłoszenia reklamacyjnego.
    signIn();
    const offer = fullOffer();
    h.audiences = offer.audiences;
    h.tiers = offer.tiers;
    h.plans = offer.plans;
    h.currentTier = {
      key: "member",
      rank: 10,
      name_pl: "Członek",
      name_en: "Member",
      features: {},
    };
    h.subscriptions = [
      {
        id: "sub-1",
        user_id: "user-me",
        plan_id: "plan-member",
        status: "active",
        started_at: "2026-08-01T00:00:00.000Z",
        current_period_end: "2026-09-01T00:00:00.000Z",
        canceled_at: null,
        plan: null,
      },
    ];
    await mount();

    expect(await screen.findByText("Członek")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Twoje członkostwo")).toBeInTheDocument());
  });

  it("gość nie odpytuje o cudzą subskrypcję", async () => {
    // Zapytanie o subskrypcję ma `enabled: !!session`. Odpalone dla anonima
    // byłoby zapytaniem bez właściciela - koszt bez odpowiedzi, a przy błędzie
    // konfiguracji RLS także ryzyko odczytu nie swojego wiersza.
    const offer = fullOffer();
    h.audiences = offer.audiences;
    h.tiers = offer.tiers;
    h.plans = offer.plans;
    const view = await mount();
    await screen.findByText("Członek");

    // Wpis w cache POWSTAJE (obserwator rejestruje klucz), ale zapytanie nigdy
    // nie rusza: `fetchStatus` zostaje bezczynny, a danych nie ma.
    const entry = view.queryClient
      .getQueryCache()
      .getAll()
      .find((item) => JSON.stringify(item.queryKey).includes("my-subscription"));
    expect(entry?.state.fetchStatus ?? "idle").toBe("idle");
    expect(entry?.state.data).toBeUndefined();
  });
});

describe("trasa /membership-join - oferta niedostępna", () => {
  it("strona wstaje, gdy warstwy i plany nie wracają z bazy", async () => {
    // Każde źródło loadera ma własny `catch`, żeby awaria cennika nie zabrała
    // JEDYNEJ publicznej ścieżki do członkostwa. Bez tego czytelnik dostaje
    // granicę błędu zamiast strony z przyciskiem rejestracji.
    h.broken = new Set(["membership_tiers", "access_plans", "pricing_audiences"]);
    await mount();

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: "Załóż konto" })[0]).toHaveAttribute(
      "href",
      "/membership-registration",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("strona wstaje, gdy nie ma redakcyjnego wiersza w /admin/pages", async () => {
    // Wiersz SEO jest opcjonalny - strona istnieje w kodzie, nie w CMS-ie.
    h.broken = new Set(["pages"]);
    await mount();

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("strona wstaje, gdy odczyt danych redakcyjnych wywraca się na transporcie", async () => {
    // To INNY kształt awarii niż odmowa bazy: warstwa `staticPageSeo` połyka
    // błąd PostgREST i oddaje `null`, więc do `catch` w loaderze dochodzi
    // wyłącznie wyjątek transportu (padnięta sieć, odcięta brama). Bez tego
    // `catch` cała trasa oblewa się na etapie loadera i czytelnik dostaje
    // granicę błędu zamiast strony wejścia - z powodu, który dotyczy WYŁĄCZNIE
    // metadanych nagłówka.
    h.offline = new Set(["pages"]);
    const offer = fullOffer();
    h.audiences = offer.audiences;
    h.tiers = offer.tiers;
    h.plans = offer.plans;
    await mount();

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(await screen.findByText("Członek")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("pusta oferta nie udaje, że warstwy są - i nie wysypuje sekcji", async () => {
    // Zero warstw to stan przejściowy (migracja tenanta, wyłączony cennik).
    // Sekcja ma zostać pusta, a reszta strony sprzedażowej ma działać.
    await mount();

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.queryByText("Członek")).not.toBeInTheDocument();
  });
});

describe("trasa /membership-join - awaria renderu", () => {
  it("wyjątek w renderze pokazuje komunikat, a nie białą stronę", async () => {
    // `errorComponent` trasy jest ostatnią siatką bezpieczeństwa publicznej
    // strony wejścia. Biała strona w tym miejscu to utracone wejście z
    // wyszukiwarki bez śladu w żadnym logu produktowym.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.authThrows = new Error("brak kontekstu tożsamości");
    await mount();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("brak kontekstu tożsamości");
    consoleError.mockRestore();
  });
});

describe("trasa /membership-join - nagłówek strony", () => {
  it("bez wiersza redakcyjnego używa zapasowego tytułu i opisu po polsku", async () => {
    // Zapasowe teksty są jedynym, co zobaczy wyszukiwarka, dopóki redakcja nie
    // opisze strony w /admin/pages. Pusty `title` to wynik bez nazwy.
    const head = routeHead(JoinRoute, { loaderData: { seo: null } });

    expect(head.meta).toContainEqual({
      title: "Dołącz do nas - członkostwo New European Strategies",
    });
    expect(head.meta).toContainEqual(
      expect.objectContaining({ name: "description", content: expect.stringContaining("Zostań") }),
    );
    expect(head.meta).toContainEqual({ property: "og:type", content: "website" });
    expect(head.meta).toContainEqual({ name: "twitter:card", content: "summary_large_image" });
    expect(head.links).toEqual([]);
  });

  it("wiersz z /admin/pages wygrywa z tekstem zapasowym", async () => {
    // To cała umowa z redakcją: tytuł i zajawka strony są edytowalne bez
    // wdrożenia. Zignorowany wiersz oznacza stronę, której nikt nie poprawi.
    const head = routeHead(JoinRoute, { loaderData: { seo: seoRow() } });

    expect(head.meta).toContainEqual({ title: "Dołącz do NES" });
    expect(head.meta).toContainEqual({
      name: "description",
      content: "Członkostwo, które daje wpływ na agendę.",
    });
    expect(head.meta).toContainEqual({ property: "og:title", content: "Dołącz do NES" });
  });

  it("adres kanoniczny i obraz społecznościowy jadą z wiersza redakcyjnego", async () => {
    // Kanoniczny adres rozstrzyga, która kopia strony liczy się w indeksie;
    // obraz decyduje o tym, jak wygląda udostępnienie w serwisie społecznym.
    const head = routeHead(JoinRoute, {
      loaderData: {
        seo: seoRow({
          seo_canonical_url: "https://example.com/membership-join",
          seo_og_image_url: "https://example.com/og.png",
        }),
      },
    });

    expect(head.links).toContainEqual({
      rel: "canonical",
      href: "https://example.com/membership-join",
    });
    expect(head.meta).toContainEqual({
      property: "og:image",
      content: "https://example.com/og.png",
    });
    expect(head.meta).toContainEqual({
      name: "twitter:image",
      content: "https://example.com/og.png",
    });
  });

  it("redakcyjny `noindex` wyprowadza stronę z indeksu", async () => {
    // Strona wejścia bywa czasowo wyłączana (przebudowa oferty). Bez tego
    // znacznika zostaje w indeksie z nieaktualną obietnicą.
    const head = routeHead(JoinRoute, { loaderData: { seo: seoRow({ seo_noindex: true }) } });

    expect(head.meta).toContainEqual({ name: "robots", content: "noindex,nofollow" });
  });

  it("bez `noindex` strona zostaje w indeksie", async () => {
    const head = routeHead(JoinRoute, { loaderData: { seo: seoRow() } });

    expect((head.meta ?? []).map((entry) => entry.name)).not.toContain("robots");
  });

  it("po angielsku nagłówek jest angielski, także w wersji zapasowej", async () => {
    // Trasa nie ma prefiksu językowego, więc język nagłówka rozstrzyga
    // `currentLang()`. Pomyłka na tym poziomie daje polski tytuł na
    // anglojęzycznej wersji strony - i taki właśnie trafia do indeksu.
    h.requestUrl = "https://example.com/en/membership-join";

    const fallback = routeHead(JoinRoute, { loaderData: { seo: null } });
    expect(fallback.meta).toContainEqual({
      title: "Join us - New European Strategies membership",
    });

    const edited = routeHead(JoinRoute, { loaderData: { seo: seoRow() } });
    expect(edited.meta).toContainEqual({ title: "Join NES" });
    expect(edited.meta).toContainEqual({
      name: "description",
      content: "Membership with real agenda influence.",
    });
  });

  it("bez adresu żądania nagłówek nadal zna swoją ścieżkę", async () => {
    // `getRequestUrl()` zwraca pusty napis, gdy żądanie nie niesie nagłówka
    // `host` (przebieg poza serwerem HTTP, wywołanie wewnętrzne). Bez zapasowej
    // ścieżki `activeLang` dostałoby pusty adres, a `new URL("")` rzuca -
    // czyli nagłówek strony wywracałby cały dokument zamiast spaść na polski.
    h.requestUrl = "";

    const head = routeHead(JoinRoute, { loaderData: { seo: null } });

    expect(head.meta).toContainEqual({
      title: "Dołącz do nas - członkostwo New European Strategies",
    });
  });

  it("nagłówek nie wysypuje się, gdy loader nie zdążył nic zwrócić", async () => {
    // `head()` bywa wołane bez danych loadera (przerwana nawigacja, granica
    // błędu). Wyjątek w tym miejscu wywraca cały dokument, nie tylko meta.
    const head = routeHead(JoinRoute, {});

    expect(head.meta).toContainEqual({
      title: "Dołącz do nas - członkostwo New European Strategies",
    });
  });
});
