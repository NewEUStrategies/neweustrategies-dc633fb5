// Trasa PUBLICZNA `/experts` - katalog ekspertów. Do dziś: 0 z 39 linii.
//
// CO DOWODZI TEN PLIK.
//
// To strona-wizytówka zespołu: wchodzi się na nią z wyników wyszukiwania, ze
// stopki i z DEEP LINKU z profilu (`?area=<slug>`). Render samego komponentu
// mija dokładnie te warstwy, w których mieszkają skutki: `validateSearch`
// (czy adres z filtrem w ogóle działa), loader (czy blip bazy daje HTTP 200
// zamiast 500 i czy widok wie, że render jest zdegradowany) oraz `head()`,
// który biegnie POZA drzewem Reacta i bierze język z ADRESU. Dlatego wszystko
// niżej idzie przez `renderRoute`, czyli przez prawdziwy router pamięciowy.
//
// CZTERY REGUŁY, KTÓRYCH ZŁAMANIE KOSZTUJE:
//
//   1. AWARIA BACKENDU NIE MOŻE WYGLĄDAĆ JAK PUSTY ZESPÓŁ. To była realna
//      wada tej trasy: loader zwracał `null`, więc flaga `degraded`
//      z `loadResilient` ginęła i blip bazy pokazywał czytelnikowi „Brak
//      ekspertów do wyświetlenia." - zdanie nieprawdziwe i nie do
//      odróżnienia od stanu redakcyjnego. NAPRAWIONE w tej zmianie; poniższy
//      blok przypina naprawę razem z kontrolą dodatnią.
//   2. NAGŁÓWEK NIESIE TYTUŁ I OPIS W OBU JĘZYKACH. Decyduje o tym, jak ten
//      adres wygląda w wyniku wyszukiwania i w udostępnieniu.
//   3. EKSPERT INNEGO OBSZARU ROBOCZEGO NIE POJAWIA SIĘ NA TYM HOŚCIE.
//      Autorytetem jest polityka publiczna (`tenant_id = public_tenant_id()`),
//      więc wiersz obcego tenanta NIE WRACA z odczytu - trasa musi z tego
//      zrobić pustkę, a nie cudzą wizytówkę pod naszą domeną.
//   4. FILTR Z ADRESU MUSI FILTROWAĆ. `?area=` jest linkowane z profilu
//      eksperta; adres, który nic nie robi, wysyła czytelnika na pełną listę.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - `src/lib/experts/directory.ts` biegnie tu PRAWDZIWY (atrapowany jest
//   wyłącznie klient PostgREST), więc klucz cache, fasety i kolejność
//   sortowania są tymi z produkcji.
// - PARYTETU SŁOWNIKA PL/EN: `src/lib/__tests__/i18nExpertsDirectory.test.ts`.
// - KONTRAKTU NAGŁÓWKA `x-tenant-host`:
//   `src/integrations/supabase/__tests__/tenantHostFetch.test.ts`. Tutaj
//   dowodzimy SKUTKU, którego tamten plik nie widzi.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

const h = vi.hoisted(() => ({
  /** Wiersze `profile_badges` ze WSZYSTKICH obszarów roboczych. */
  badges: [] as Record<string, unknown>[],
  /** Wiersze widoku `profiles_public`. */
  profiles: [] as Record<string, unknown>[],
  /** Wiersze widoku `author_profiles_public` (funkcja, firma, is_public). */
  authorProfiles: [] as Record<string, unknown>[],
  /** Wiersze `expert_expertise_areas` z zagnieżdżonym `area`. */
  areaLinks: [] as Record<string, unknown>[],
  /** Wiersze `program_members` z zagnieżdżonym `program`. */
  programLinks: [] as Record<string, unknown>[],
  /** Wiersze `posts` (tylko `author_id`) - licznik publikacji. */
  posts: [] as Record<string, unknown>[],
  /**
   * Tenant PRZEGLĄDANEJ domeny. Atrapa odgrywa rolę polityki
   * `tenant_id = public_tenant_id()`: produkcja wysyła nagłówek
   * `x-tenant-host`, a baza odsiewa wiersze. Trasa własnego porównania
   * tenantów nie ma i mieć nie powinna - modelujemy SKUTEK.
   */
  tenantId: "tenant-a",
  /** `true` = odczyt odznak pada (blip backendu = render zdegradowany). */
  broken: false,
  /** Adres żądania widziany przez `head()` - decyduje o języku i kanonicznym. */
  requestUrl: "https://nes.example.org/experts",
  /** Nagłówki `Cache-Control`, jakie ustawił loader. */
  cacheControl: [] as string[],
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, ok, fail } = await import("@/test/supabase/chain");
  const stub = supabaseFromStub();
  /** Odsiew polityki publicznej: tylko wiersze tenanta przeglądanej domeny. */
  const visible = (rows: Record<string, unknown>[]) =>
    rows.filter((row) => row.tenant_id === undefined || row.tenant_id === h.tenantId);

  stub.setResponse("profile_badges", () => {
    if (h.broken) return fail("test: tabela profile_badges niedostepna");
    return ok(visible(h.badges));
  });
  stub.setResponse("profiles_public", () => ok(visible(h.profiles)));
  stub.setResponse("author_profiles_public", () => ok(visible(h.authorProfiles)));
  stub.setResponse("expert_expertise_areas", () => ok(h.areaLinks));
  stub.setResponse("program_members", () => ok(h.programLinks));
  stub.setResponse("posts", () => ok(visible(h.posts)));
  return { supabase: { from: stub.from } };
});

vi.mock("@/lib/seo/request", () => ({
  getRequestUrl: () => h.requestUrl,
  getOrigin: () => "https://nes.example.org",
}));

vi.mock("@/lib/http/responseHeaders", () => ({
  setCacheControlHeader: (value: string) => void h.cacheControl.push(value),
  appendLinkHeader: () => {},
  readRouteCacheDirective: () => null,
}));

// Radix Select nie otwiera listy pod happy-dom (potrzebuje realnego wskaźnika
// i pomiarów układu), a wybór opcji jest tu przedmiotem dowodu: KTÓRY filtr
// dostaje nową wartość i czy wartość ląduje w ADRESIE.
vi.mock("@/components/ui/select", async () => {
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(await import("react"));
});

import "@/test/i18nReal";
import { QueryClient } from "@tanstack/react-query";
import i18n from "@/lib/i18n";
import { renderRoute, routeHead, routeSearchValidator } from "@/test/routeHarness";
import type { RouteHeadResult } from "@/test/routeHarness";
import { axeViolations, summarize } from "@/test/axe";
import { Route as ExpertsRoute } from "@/routes/experts";

const PATH = "/experts";

const AREA_CLIMATE = { id: "area-1", slug: "klimat", name_pl: "Klimat", name_en: "Climate" };
const AREA_TRADE = { id: "area-2", slug: "handel", name_pl: "Handel", name_en: "Trade" };
const PROGRAM_EAST = { id: "prog-1", name_pl: "Program Wschodni", name_en: "Eastern Programme" };

// ── fixtures (RODO: wszystkie nazwiska i funkcje są ZMYŚLONE) ───────────────

function badge(userId: string, tenantId = "tenant-a"): Record<string, unknown> {
  return { user_id: userId, tenant_id: tenantId, badge: "expert" };
}

function profile(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "u1",
    tenant_id: "tenant-a",
    slug: "zofia-wietrzna",
    display_name: "Zofia Wietrzna",
    avatar_url: null,
    verified_at: null,
    ...patch,
  };
}

function authorProfile(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    user_id: "u1",
    tenant_id: "tenant-a",
    job_title: "Analityczka klimatyczna",
    company: "NES",
    is_public: true,
    ...patch,
  };
}

async function mount(entry = PATH, queryClient?: QueryClient) {
  return renderRoute({ route: ExpertsRoute, path: PATH, initialEntry: entry, queryClient });
}

/** Wartość `content` wpisu meta - z twardym błędem, gdy wpisu nie ma
 *  (test „przechodzący" na brakującym meta nie dowodzi niczego). */
function metaContent(
  head: RouteHeadResult,
  key: "name" | "property" | "httpEquiv",
  value: string,
): string {
  const found = (head.meta ?? []).find((entry) => entry[key] === value);
  const content = found?.content;
  if (typeof content !== "string") throw new Error(`test: brak meta ${key}="${value}"`);
  return content;
}

/**
 * Karta eksperta o danym nazwisku. Sam `screen.getByText` nie wystarcza:
 * nazwa obszaru pada też w opcji filtra, a `getByRole("listitem")` łapie
 * dodatkowo okruszki nawigacji - test „przechodzący" na filtrze nie dowodzi
 * niczego o karcie.
 */
function expertCard(displayName: string): HTMLElement {
  const card = screen.getByText(displayName).closest("li");
  if (!(card instanceof HTMLElement)) throw new Error(`test: brak karty "${displayName}"`);
  return card;
}

/** Tytuł dokumentu z `head()` - z twardym błędem, gdy go nie ma. */
function headTitle(head: RouteHeadResult): string {
  const found = (head.meta ?? []).find((entry) => typeof entry.title === "string");
  if (typeof found?.title !== "string") throw new Error("test: head() nie niesie tytulu");
  return found.title;
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.badges = [badge("u1")];
  h.profiles = [profile()];
  h.authorProfiles = [authorProfile()];
  h.areaLinks = [{ user_id: "u1", sort_order: 0, area: AREA_CLIMATE }];
  h.programLinks = [{ user_id: "u1", sort_order: 0, program: PROGRAM_EAST }];
  h.posts = [{ author_id: "u1", tenant_id: "tenant-a" }];
  h.tenantId = "tenant-a";
  h.broken = false;
  h.requestUrl = "https://nes.example.org/experts";
  h.cacheControl = [];
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
  vi.restoreAllMocks();
});

describe("trasa /experts - karta eksperta", () => {
  it("pokazuje nazwisko, funkcję, obszar i liczbę publikacji z linkiem do huba", async () => {
    // Karta bez linku do `/author/$slug` zamyka jedyną drogę z katalogu do
    // dorobku eksperta - a po to katalog istnieje.
    await mount();

    expect(screen.getByRole("heading", { level: 1, name: "Eksperci" })).toBeInTheDocument();
    expect(screen.getByText("Zofia Wietrzna")).toBeInTheDocument();
    expect(screen.getByText("Analityczka klimatyczna · NES")).toBeInTheDocument();
    // Nazwa obszaru pada w dwóch miejscach (opcja filtra i plakietka karty),
    // więc szukamy jej NA KARCIE - inaczej test przechodziłby na samym filtrze.
    expect(within(expertCard("Zofia Wietrzna")).getByText("Klimat")).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: /Zofia Wietrzna|Zobacz profil/ });
    links.forEach((link) => expect(link).toHaveAttribute("href", "/author/zofia-wietrzna"));
  });

  it("ekspert bez sluga linkuje po identyfikatorze, a nie do adresu z `undefined`", async () => {
    // Slug jest opcjonalny w profilu. Bez zapasu link wychodziłby jako
    // `/author/undefined` i każda taka karta byłaby martwa.
    h.profiles = [profile({ slug: null })];
    await mount();

    expect(screen.getAllByRole("link", { name: /Zobacz profil/ })[0]).toHaveAttribute(
      "href",
      "/author/u1",
    );
  });

  it("licznik publikacji ma POLSKĄ formę dla jednej pozycji", async () => {
    // `{{count}} publikacji` bez form `_one`/`_few` dawało „1 publikacji".
    // To jest widoczne na każdej karcie świeżo dodanego eksperta.
    await mount();

    expect(screen.getByText("1 publikacja")).toBeInTheDocument();
  });

  it("licznik publikacji ma formę mnogą dla 2-4 i dla 5+", async () => {
    h.posts = [1, 2, 3].map(() => ({ author_id: "u1", tenant_id: "tenant-a" }));
    const three = await mount();
    expect(three.container.textContent).toContain("3 publikacje");
    cleanup();

    h.posts = [1, 2, 3, 4, 5].map(() => ({ author_id: "u1", tenant_id: "tenant-a" }));
    const five = await mount(
      PATH,
      new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    );
    expect(five.container.textContent).toContain("5 publikacji");
  });

  it("po angielsku bierze angielskie etykiety i angielską nazwę obszaru", async () => {
    await i18n.changeLanguage("en");
    await mount();

    expect(screen.getByRole("heading", { level: 1, name: "Experts" })).toBeInTheDocument();
    expect(within(expertCard("Zofia Wietrzna")).getByText("Climate")).toBeInTheDocument();
    expect(screen.queryByText("Klimat")).not.toBeInTheDocument();
    expect(screen.getByText("1 publication")).toBeInTheDocument();
  });

  it("ekspert BEZ publicznego profilu autorskiego nie wchodzi do katalogu", async () => {
    // `is_public` jest zgodą eksperta na widoczność. Karta osoby, która jej nie
    // dała, to publikacja danych zawodowych bez podstawy.
    h.authorProfiles = [authorProfile({ is_public: false })];
    await mount();

    expect(screen.queryByText("Zofia Wietrzna")).not.toBeInTheDocument();
    expect(screen.getByText("Brak ekspertów do wyświetlenia.")).toBeInTheDocument();
  });

  it("nie zostawia katalogu z wadami dostępności", async () => {
    const view = await mount();
    await screen.findByRole("heading", { level: 1 });

    const violations = await axeViolations(view.container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("trasa /experts - stan pusty i render zdegradowany", () => {
  it("pusty katalog daje komunikat redakcyjny, a nie pustą siatkę", async () => {
    // Brak ekspertów to legalny stan (nowy obszar roboczy), więc trasa nie ma
    // prawa ani rzucić 404, ani pokazać pustego `<ul>`.
    h.badges = [];
    await mount();

    expect(screen.getByText("Brak ekspertów do wyświetlenia.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Eksperci" })).toBeInTheDocument();
  });

  it("po angielsku komunikat pustki też jest angielski", async () => {
    await i18n.changeLanguage("en");
    h.badges = [];
    await mount();

    expect(screen.getByText("No experts to display.")).toBeInTheDocument();
  });

  it("awaria odczytu NIE wywraca trasy i mówi PRAWDĘ, a nie „brak ekspertów”", async () => {
    // Sedno naprawy: loader zwracał `null`, więc flaga `degraded` ginęła
    // i blip bazy był nie do odróżnienia od pustego zespołu. Teraz widok
    // dostaje uczciwy komunikat degradacji.
    h.broken = true;
    await mount();

    expect(screen.getByText("Nie udało się załadować katalogu ekspertów.")).toBeInTheDocument();
    expect(screen.queryByText("Brak ekspertów do wyświetlenia.")).not.toBeInTheDocument();
  });

  it("po angielsku komunikat degradacji też jest angielski", async () => {
    await i18n.changeLanguage("en");
    h.broken = true;
    await mount();

    expect(screen.getByText("Could not load the experts directory.")).toBeInTheDocument();
  });

  it("KONTROLA DODATNIA: czysty render NIE pokazuje komunikatu degradacji", async () => {
    // Bez tej pary poprzednie testy przechodziłyby też wtedy, gdyby trasa
    // pokazywała komunikat awarii ZAWSZE - a to gorsze niż brak komunikatu.
    await mount();

    expect(screen.queryByText("Nie udało się załadować katalogu ekspertów.")).toBeNull();
    expect(screen.getByText("Zofia Wietrzna")).toBeInTheDocument();
  });

  it("zdegradowany render deklaruje no-store, czysty - politykę treści", async () => {
    // Bez tego rozróżnienia brzeg CDN zapamiętałby pusty katalog na cały okres
    // świeżości i serwował go kolejnym czytelnikom długo po powrocie bazy.
    h.broken = true;
    await mount();
    expect(h.cacheControl.at(-1)).toContain("no-store");

    h.broken = false;
    h.cacheControl = [];
    await mount(PATH, new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    expect(h.cacheControl.at(-1)).toContain("s-maxage=900");
  });
});

describe("trasa /experts - izolacja obszarów roboczych", () => {
  it("ekspert innego obszaru roboczego nie pojawia się na tym hoście", async () => {
    // Autorytetem jest polityka publiczna, więc wiersz obcego tenanta NIE
    // WRACA z odczytu. Ten test pilnuje SKUTKU: trasa robi z tego pustkę,
    // a nie cudzą wizytówkę pod naszą domeną.
    h.badges = [badge("u9", "tenant-b")];
    h.profiles = [
      profile({ id: "u9", tenant_id: "tenant-b", display_name: "Ekspert obcego obszaru" }),
    ];
    h.authorProfiles = [authorProfile({ user_id: "u9", tenant_id: "tenant-b" })];
    await mount();

    expect(screen.queryByText("Ekspert obcego obszaru")).not.toBeInTheDocument();
    expect(screen.getByText("Brak ekspertów do wyświetlenia.")).toBeInTheDocument();
  });

  it("KONTROLA DODATNIA: te same wiersze na WŁASNYM hoście renderują się", async () => {
    // Bez tej pary poprzedni test przechodziłby też wtedy, gdyby trasa nie
    // renderowała NICZEGO - a to nie izolacja, tylko awaria.
    h.badges = [badge("u9", "tenant-b")];
    h.profiles = [
      profile({ id: "u9", tenant_id: "tenant-b", display_name: "Ekspert obcego obszaru" }),
    ];
    h.authorProfiles = [authorProfile({ user_id: "u9", tenant_id: "tenant-b" })];
    h.tenantId = "tenant-b";
    await mount();

    expect(screen.getByText("Ekspert obcego obszaru")).toBeInTheDocument();
  });
});

describe("trasa /experts - filtry z adresu", () => {
  it("walidator przepuszcza `area` i `program`, a śmieci zamienia w `undefined`", () => {
    // `validateSearch` jest kontraktem adresu. Liczba w `?area=` (albo tablica
    // z powtórzonego parametru) nie może wejść do filtra jako `[object Object]`.
    const validate = routeSearchValidator(ExpertsRoute);

    expect(validate({ area: "klimat", program: "prog-1" })).toEqual({
      area: "klimat",
      program: "prog-1",
    });
    expect(validate({ area: 7, program: ["a", "b"] })).toEqual({
      area: undefined,
      program: undefined,
    });
    expect(validate({})).toEqual({ area: undefined, program: undefined });
  });

  it("`?area=<slug>` z profilu ZAWĘŻA listę do tego obszaru", async () => {
    // To jest deep-link linkowany z huba eksperta. Adres, który nic nie robi,
    // wysyła czytelnika na pełną listę bez śladu, czego szukał.
    h.badges = [badge("u1"), badge("u2")];
    h.profiles = [
      profile(),
      profile({ id: "u2", slug: "adam-morski", display_name: "Adam Morski" }),
    ];
    h.authorProfiles = [authorProfile(), authorProfile({ user_id: "u2" })];
    h.areaLinks = [
      { user_id: "u1", sort_order: 0, area: AREA_CLIMATE },
      { user_id: "u2", sort_order: 0, area: AREA_TRADE },
    ];
    const view = await mount("/experts?area=handel");

    expect(view.search()).toEqual({ area: "handel", program: undefined });
    expect(screen.getByText("Adam Morski")).toBeInTheDocument();
    expect(screen.queryByText("Zofia Wietrzna")).not.toBeInTheDocument();
  });

  it("`?area=` z nieznanym slugiem pokazuje PEŁNĄ listę, a nie pustkę", async () => {
    // Slug obszaru zmieniony przez redakcję zostaje w starych linkach. Pusty
    // katalog byłby tu kłamstwem: eksperci są, tylko filtr wskazuje w nic.
    const view = await mount("/experts?area=nie-ma-takiego");

    expect(view.search()).toEqual({ area: "nie-ma-takiego", program: undefined });
    expect(screen.getByText("Zofia Wietrzna")).toBeInTheDocument();
  });

  it("wybór obszaru w filtrze zapisuje się w ADRESIE (link da się udostępnić)", async () => {
    // Filtr trzymany wyłącznie w stanie komponentu daje stronę, której nie da
    // się podlinkować ani odświeżyć bez utraty wyboru.
    const view = await mount();

    fireEvent.change(screen.getByLabelText("Obszar"), { target: { value: "klimat" } });

    // `navigate()` jest asynchroniczne - odczyt bez oczekiwania widziałby
    // adres sprzed kliknięcia i test „przechodziłby" na starym stanie.
    await waitFor(() => expect(view.search().area).toBe("klimat"));
  });

  it("„Wyczyść filtry” pojawia się dopiero przy aktywnym filtrze i czyści adres", async () => {
    const view = await mount("/experts?area=klimat");
    expect(view.search().area).toBe("klimat");

    fireEvent.click(screen.getByRole("button", { name: "Wyczyść filtry" }));

    await waitFor(() => expect(view.search().area).toBeUndefined());
    expect(screen.queryByRole("button", { name: "Wyczyść filtry" })).toBeNull();
  });

  it("filtr programu ZAWĘŻA listę (dowód, że fasety programów nie są ozdobą)", async () => {
    h.badges = [badge("u1"), badge("u2")];
    h.profiles = [
      profile(),
      profile({ id: "u2", slug: "adam-morski", display_name: "Adam Morski" }),
    ];
    h.authorProfiles = [authorProfile(), authorProfile({ user_id: "u2" })];
    h.programLinks = [{ user_id: "u1", sort_order: 0, program: PROGRAM_EAST }];
    await mount();

    fireEvent.change(screen.getByLabelText("Program"), { target: { value: "prog-1" } });

    expect(screen.getByText("Zofia Wietrzna")).toBeInTheDocument();
    expect(screen.queryByText("Adam Morski")).not.toBeInTheDocument();
  });

  it("filtr bez trafień mówi „żaden nie pasuje”, a nie „brak ekspertów”", async () => {
    // Dwa różne zdania dla dwóch różnych sytuacji: „nie ma nikogo" kontra
    // „są, ale nie tacy". Wspólny komunikat wysyła czytelnika z pustymi rękami.
    // Dwa filtry, które razem nie mają wspólnego trafienia: obszar „handel"
    // ma tylko Adama, a program „prog-1" tylko Zofię. To jedyna droga do
    // gałęzi „żaden nie pasuje" - i realna, bo oba filtry są niezależne.
    h.badges = [badge("u1"), badge("u2")];
    h.profiles = [
      profile(),
      profile({ id: "u2", slug: "adam-morski", display_name: "Adam Morski" }),
    ];
    h.authorProfiles = [authorProfile(), authorProfile({ user_id: "u2" })];
    h.areaLinks = [
      { user_id: "u1", sort_order: 0, area: AREA_CLIMATE },
      { user_id: "u2", sort_order: 0, area: AREA_TRADE },
    ];
    h.programLinks = [{ user_id: "u1", sort_order: 0, program: PROGRAM_EAST }];
    await mount("/experts?area=handel");
    expect(screen.getByText("Adam Morski")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Program"), { target: { value: "prog-1" } });

    expect(
      await screen.findByText("Żaden ekspert nie pasuje do wybranych filtrów."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Brak ekspertów do wyświetlenia.")).toBeNull();
  });

  it.fails(
    "DEFEKT: `?program=<id>` z adresu NIE zawęża katalogu, choć walidator go przyjmuje",
    async () => {
      // KONTRAKT, KTÓRY NIE JEST SPEŁNIONY. `validateSearch` deklaruje pole
      // `program`, więc adres `/experts?program=prog-1` wygląda na wspierany -
      // a filtr programu żyje wyłącznie w `useState` i parametr jest cicho
      // ignorowany. Skutek: link „eksperci tego programu" (naturalny do
      // wstawienia ze strony programu) prowadzi na pełną listę.
      //
      // NIE NAPRAWIAM TEGO TUTAJ, bo naprawa jest zmianą zachowania, nie
      // usunięciem błędu: przeniesienie filtra do adresu zmienia semantykę
      // udostępniania tej strony i dotyka „Wyczyść filtry" oraz wartości
      // kontrolowanej obu selectów. Zapadka stoi na kontrakcie, nie na
      // dzisiejszym stanie - kontrola dodatnia niżej trzyma stan dzisiejszy.
      h.badges = [badge("u1"), badge("u2")];
      h.profiles = [
        profile(),
        profile({ id: "u2", slug: "adam-morski", display_name: "Adam Morski" }),
      ];
      h.authorProfiles = [authorProfile(), authorProfile({ user_id: "u2" })];
      h.programLinks = [{ user_id: "u1", sort_order: 0, program: PROGRAM_EAST }];
      await mount("/experts?program=prog-1");

      expect(screen.queryByText("Adam Morski")).not.toBeInTheDocument();
    },
  );

  it("KONTROLA DODATNIA: dziś `?program=` przechodzi walidację i nie zmienia listy", async () => {
    // Para do `it.fails` wyżej. Bez niej tamten test „przechodziłby" także
    // wtedy, gdyby adres z `?program=` w ogóle wywracał trasę.
    h.badges = [badge("u1"), badge("u2")];
    h.profiles = [
      profile(),
      profile({ id: "u2", slug: "adam-morski", display_name: "Adam Morski" }),
    ];
    h.authorProfiles = [authorProfile(), authorProfile({ user_id: "u2" })];
    h.programLinks = [{ user_id: "u1", sort_order: 0, program: PROGRAM_EAST }];
    const view = await mount("/experts?program=prog-1");

    expect(view.search()).toEqual({ area: undefined, program: "prog-1" });
    expect(screen.getByText("Zofia Wietrzna")).toBeInTheDocument();
    expect(screen.getByText("Adam Morski")).toBeInTheDocument();
  });
});

describe("trasa /experts - nagłówek dokumentu", () => {
  it("po polsku niesie polski tytuł, opis i znacznik języka", () => {
    const head = routeHead(ExpertsRoute);

    expect(headTitle(head)).toBe("Eksperci - New European Strategies");
    expect(metaContent(head, "name", "description")).toBe(
      "Zespół analityczny New European Strategies: profile, programy i obszary ekspertyzy.",
    );
    expect(metaContent(head, "httpEquiv", "content-language")).toBe("pl");
    expect(metaContent(head, "property", "og:type")).toBe("website");
  });

  it("prefiks /en w ADRESIE daje angielski tytuł i opis", () => {
    // Język nagłówka rozstrzyga ADRES, nie globalny singleton i18next - inaczej
    // współbieżny SSR dwóch żądań mieszałby języki metadanych.
    h.requestUrl = "https://nes.example.org/en/experts";
    const head = routeHead(ExpertsRoute);

    expect(headTitle(head)).toBe("Experts - New European Strategies");
    expect(metaContent(head, "name", "description")).toBe(
      "The New European Strategies analytical team: profiles, programs and areas of expertise.",
    );
    expect(metaContent(head, "httpEquiv", "content-language")).toBe("en");
  });

  it("kanoniczny i og:url biorą adres z żądania, a pusty adres spada na /experts", () => {
    // Bez kanonicznego wyszukiwarka sama wybiera adres reprezentatywny i potrafi
    // zindeksować wariant z parametrami kampanii jako osobną stronę.
    const withUrl = routeHead(ExpertsRoute);
    expect((withUrl.links ?? []).find((l) => l.rel === "canonical")?.href).toBe(
      "https://nes.example.org/experts",
    );

    h.requestUrl = "";
    const noUrl = routeHead(ExpertsRoute);
    expect((noUrl.links ?? []).find((l) => l.rel === "canonical")?.href).toBe(PATH);
    expect(headTitle(noUrl)).toBe("Eksperci - New European Strategies");
  });

  it("niesie klaster hreflang PL/EN - dwie wersje językowe nie konkurują w indeksie", () => {
    const links = routeHead(ExpertsRoute).links ?? [];
    const alternates = links.filter((l) => l.rel === "alternate" && l.hrefLang !== "x-default");

    expect(alternates.map((l) => l.hrefLang).sort()).toEqual(["en", "pl"]);
  });

  it("NIE wyłącza katalogu z indeksu - to publiczna wizytówka zespołu", () => {
    // Asercja o BRAKU wpisu. Gdyby ktoś „ujednolicił" trasy społecznościowe
    // i dopisał tu `robots: noindex`, katalog wypadłby z wyszukiwarki, a w
    // aplikacji nie byłoby tego widać wcale.
    const robots = (routeHead(ExpertsRoute).meta ?? []).filter((e) => e.name === "robots");

    expect(robots).toEqual([]);
  });
});
