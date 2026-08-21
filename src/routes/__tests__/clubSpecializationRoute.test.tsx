// `/club/specialization/$slug` - publiczna strona jednego obszaru klubów.
//
// CO TEN PLIK DOWODZI. To jest strona WEJŚCIOWA: przychodzi się na nią
// z wyszukiwarki i z siatki na hubie, a wychodzi się z niej albo do formularza
// zgłoszenia, albo do innego obszaru. Wartość testu leży więc w sklejeniu,
// którego czysta funkcja nie dosięga:
//
//   1. LOADER JEST BRAMKĄ ADRESU. Slug spoza katalogu dostaje `notFound()`,
//      a nie pustą stronę - inaczej `/club/specialization/cokolwiek` odpowiada
//      dwustką i wchodzi do indeksu jako ósma kopia tej samej treści. Dowodzimy
//      OBU ścieżek: znany slug wraca znormalizowany do katalogu, nieznany rzuca
//      sygnałem, który router rozpoznaje przez `isNotFound`.
//   2. CTA JEST CAŁYM LEJKIEM TEJ STRONY. Jeden przycisk, jeden adres:
//      `/club/apply?spec=<slug>`. Zgubiony parametr nie psuje niczego
//      widocznego - cofa kandydata do wyboru obszaru z listy, czyli kosztuje
//      dokładnie to, po co ta strona istnieje.
//   3. PUSTKA MÓWI CO INNEGO GOŚCIOWI. RPC oddaje anonimowi wyłącznie kluby
//      `public`, więc jego pusta sekcja znaczy „zaloguj się", a nie „nie ma
//      klubów". Jeden komunikat dla obu stanów kłamie w jednym z nich.
//   4. NAWIGACJA POPRZECZNA jest pełna i nie zawiera samej siebie - to jedyna
//      droga między ośmioma obszarami.
//   5. ROZJAZD LOADERA I KOMPONENTU jest przewidziany. Oba czytają katalog
//      OSOBNO (`findClubSpecialization` dwa razy), więc komponent ma własną
//      gałąź obronną: gdy katalog przestaje znać slug MIĘDZY loaderem
//      a renderem, strona pokazuje drogę powrotną, a nie wywala się na
//      `spec.icon` z `null`. Test odtwarza dokładnie ten rozjazd (atrapa
//      katalogu „oślepia się" w chwili wejścia w komponent).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - REGUŁ SEO: `buildSpecializationHead` ma własny zakres
//   (`clubApplyAndSpecSeo.test.ts`), a asercje idą PRZECIW tej funkcji
//   wywołanej wprost - nie przeciw wymyślonym napisom.
// - REGUŁ WIDOKU: stopka poprzeczna, klucz pustki, parametr CTA i filary mają
//   tabelę przypadków w `specializationPage.test.ts`. Tutaj sprawdzamy, że
//   trasa ich UŻYWA, a nie liczy po swojemu.
// - KATALOGU SPECJALIZACJI: slugi, ikony i numery to `specializations.ts`
//   z zakresem w `clubPureModules.test.ts`.
// - ORGANIZMU `ClubDirectory`: tutaj jest atrapą-markerem z zapisem propsów;
//   jego zachowanie należy do etapu organizmów.
// - AUTORYTETU WIDOCZNOŚCI: to, które kluby wracają z `club_specialization_*`,
//   rozstrzyga SECURITY DEFINER RPC z pokryciem pgTAP.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { isNotFound } from "@tanstack/react-router";

const h = vi.hoisted(() => ({
  /** Sesja widziana przez `useAuth` - `null` znaczy gość. */
  session: null as { user: { id: string } } | null,
  /** Odpowiedź `useClubsBySpecialization`; `undefined` = zapytanie w locie. */
  clubsPage: undefined as { rows: unknown[] } | undefined,
  clubsPending: false,
  /** Argumenty, z jakimi trasa zawołała zapytanie klubów. */
  clubsArgs: null as { slug: string; limit?: number } | null,
  /** Gdy prawdziwe, katalog „oślepia się" w chwili wejścia w komponent. */
  blindComponent: false,
  /** Stan oślepienia - ustawiany przez atrapę `ensureClubI18n`. */
  catalogBlind: false,
  /** Propsy zapisane przez atrapę `ClubDirectory`. */
  directory: null as Record<string, unknown> | null,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

// `ensureClubI18n()` stoi w PIERWSZEJ linii komponentu, przed odczytem
// katalogu - to jedyne miejsce, z którego test może odtworzyć rozjazd
// „loader widział specjalizację, komponent już nie".
vi.mock("@/lib/i18n-club", () => ({
  ensureClubI18n: () => {
    if (h.blindComponent) h.catalogBlind = true;
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: h.session, user: h.session?.user ?? null, isStaff: false }),
}));

// Atrapa CZĘŚCIOWA: katalog zostaje prawdziwy (slugi, ikony, numery są
// kontraktem publicznym), przełącznik dotyczy wyłącznie odczytu pojedynczej
// specjalizacji.
vi.mock("@/lib/clubs/specializations", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/clubs/specializations")>();
  return {
    ...actual,
    findClubSpecialization: (slug: string) =>
      h.catalogBlind ? null : actual.findClubSpecialization(slug),
  };
});

vi.mock("@/lib/clubs/useClubSpecializations", () => ({
  useClubsBySpecialization: (slug: string, limit?: number) => {
    h.clubsArgs = { slug, limit };
    return { data: h.clubsPage, isPending: h.clubsPending };
  },
}));

vi.mock("@/components/clubs/organisms/ClubDirectory", () => ({
  ClubDirectory: (props: Record<string, unknown>) => {
    h.directory = props;
    return <div data-testid="ClubDirectory" />;
  },
}));

import { renderRoute } from "@/test/routeHarness";
import { Route as SpecRoute } from "@/routes/club.specialization.$slug";
import { buildSpecializationHead } from "@/lib/clubs/specializationHead";
import { CLUB_SPECIALIZATIONS } from "@/lib/clubs/specializations";
import {
  SPECIALIZATION_PILLARS,
  otherClubSpecializations,
  specializationClubsEmptyKey,
} from "@/lib/clubs/specializationPage";
import { CLUB_IDS, clubListRow } from "@/test/clubs/fixtures";

const PATH = "/club/specialization/$slug";
const SLUGS = CLUB_SPECIALIZATIONS.map((spec) => spec.slug);
const SLUG = "energy";

/** Loader trasy w kształcie, w jakim test go naprawdę woła. */
interface SpecLoaderOptions {
  readonly loader: (ctx: { readonly params: { readonly slug: string } }) => { slug: string };
}

/**
 * STRAŻNIK, nie rzutowanie: framework nie wystawia loadera w typie publicznym
 * (`RouteOptions` jest sparametryzowane kontekstem routera), więc odczyt „daj
 * mi loader" trzeba zawęzić samemu - w runtime, a nie na słowo.
 */
function hasSpecLoader(options: object): options is SpecLoaderOptions {
  return "loader" in options && typeof options.loader === "function";
}

/**
 * Loader wołany WPROST, bez routera. Powód: przedmiotem dowodu jest SYGNAŁ,
 * który loader rzuca (`notFound`), a router zamienia go na ekran - czyli
 * zasłania dokładnie to, co sprawdzamy.
 */
function specLoader(): SpecLoaderOptions["loader"] {
  if (!hasSpecLoader(SpecRoute.options)) throw new Error("test: trasa nie ma loadera");
  return SpecRoute.options.loader;
}

async function mount(slug: string = SLUG) {
  return renderRoute({
    route: SpecRoute,
    path: PATH,
    initialEntry: `/club/specialization/${slug}`,
  });
}

/** Adresy wszystkich odnośników w wyrenderowanym drzewie. */
function hrefs(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "");
}

/** Odnośnik, w którym stoi podany napis - `null`, gdy to nie odnośnik. */
function anchorOf(text: string): HTMLAnchorElement | null {
  const found = screen.getByText(text).closest("a");
  return found instanceof HTMLAnchorElement ? found : null;
}

beforeEach(() => {
  cleanup();
  h.session = null;
  h.clubsPage = { rows: [] };
  h.clubsPending = false;
  h.clubsArgs = null;
  h.blindComponent = false;
  h.catalogBlind = false;
  h.directory = null;
});

// --- loader ----------------------------------------------------------------

describe("loader - bramka adresu", () => {
  it.each(SLUGS)("znany slug `%s` przechodzi i wraca znormalizowany", (slug) => {
    expect(specLoader()({ params: { slug } })).toEqual({ slug });
  });

  it.each(["", "nie-ma-takiej", "ENERGY", "energy/", "../club", "energy "])(
    "slug `%s` spoza katalogu rzuca `notFound()`",
    (slug) => {
      // Pusta strona pod nieistniejącym adresem odpowiada dwustką i wchodzi
      // do indeksu jako kolejna kopia tej samej treści.
      expect(() => specLoader()({ params: { slug } })).toThrow();
      try {
        specLoader()({ params: { slug } });
        expect.unreachable("loader miał rzucić");
      } catch (error) {
        expect(isNotFound(error)).toBe(true);
      }
    },
  );

  it("nieznany slug NIE renderuje strony obszaru", async () => {
    const rendered = await mount("nie-ma-takiej");
    expect(screen.queryByText("club.spec.applyCta")).toBeNull();
    expect(screen.queryByTestId("ClubDirectory")).toBeNull();
    expect(rendered.currentPath()).toBe("/club/specialization/nie-ma-takiej");
  });
});

// --- nagłówek SEO ----------------------------------------------------------

describe("head() - własny tytuł i opis per obszar", () => {
  it.each(SLUGS)("`%s`: nagłówek zgadza się z `buildSpecializationHead`", async (slug) => {
    // Asercja PRZECIW funkcji, nie przeciw napisom: zmiana doktryny nagłówka
    // rusza oba wyniki razem, a zgubione wywołanie w trasie - tylko jeden.
    const rendered = await mount(slug);
    const expected = buildSpecializationHead(slug);
    expect(rendered.meta()).toEqual(expected.meta);
    expect(rendered.links()).toEqual(expected.links);
  });

  it("nagłówek liczy się ze SLUGA Z ADRESU, nie ze stałej", async () => {
    const rendered = await mount("legislation");
    expect(rendered.meta()).toEqual(buildSpecializationHead("legislation").meta);
    expect(rendered.meta()).not.toEqual(buildSpecializationHead("energy").meta);
  });
});

// --- lejek: CTA do zgłoszenia ---------------------------------------------

describe("CTA - jedyne wyjście do formularza zgłoszenia", () => {
  it.each(SLUGS)("`%s`: CTA prowadzi do `/club/apply?spec=<slug>`", async (slug) => {
    await mount(slug);
    expect(anchorOf("club.spec.applyCta")?.getAttribute("href")).toBe(`/club/apply?spec=${slug}`);
  });

  it("na stronie jest DOKŁADNIE jedno wejście do formularza", async () => {
    // Dwa CTA na jednej stronie rozbijają pomiar lejka i konkurują o uwagę.
    const { container } = await mount();
    expect(hrefs(container).filter((href) => href.startsWith("/club/apply"))).toHaveLength(1);
  });

  it("droga powrotna prowadzi na hub klubów", async () => {
    await mount();
    expect(anchorOf("club.spec.backToSpecs")?.getAttribute("href")).toBe("/club");
  });
});

// --- sekcja klubów --------------------------------------------------------

describe("kluby w obszarze - co trasa wysyła i co pokazuje", () => {
  it("zapytanie dostaje slug Z ADRESU", async () => {
    await mount("transport");
    expect(h.clubsArgs?.slug).toBe("transport");
  });

  it("zapytanie W LOCIE nie wywraca sekcji - lista jest pusta, nie `undefined`", async () => {
    // `clubsQ.data?.rows ?? []`: bez tego domknięcia organizm dostaje
    // `undefined` i strona pada na pierwszym wejściu, zanim RPC odpowie.
    h.clubsPage = undefined;
    h.clubsPending = true;
    await mount();
    expect(h.directory?.clubs).toEqual([]);
    expect(h.directory?.loading).toBe(true);
  });

  it("odpowiedź bez klubów daje pustą listę i zdjęty stan oczekiwania", async () => {
    h.clubsPage = { rows: [] };
    await mount();
    expect(h.directory?.clubs).toEqual([]);
    expect(h.directory?.loading).toBe(false);
  });

  it("kluby z RPC jadą do organizmu w niezmienionej postaci", async () => {
    const rows = [clubListRow(), clubListRow({ id: CLUB_IDS.otherClub, slug: "klub-drugi" })];
    h.clubsPage = { rows };
    await mount();
    expect(h.directory?.clubs).toEqual(rows);
  });

  it("sekcja idzie w układzie redakcyjnym z własnym tytułem", async () => {
    await mount();
    expect(h.directory?.layout).toBe("editorial");
    expect(h.directory?.title).toBe("club.spec.clubsTitle");
  });

  it("gość dostaje komunikat pustki dla NIEZALOGOWANEGO", async () => {
    h.session = null;
    await mount();
    expect(h.directory?.empty).toBe(specializationClubsEmptyKey(false));
    expect(h.directory?.empty).toBe("club.spec.clubsAnon");
  });

  it("zalogowany dostaje komunikat o stanie OBSZARU", async () => {
    h.session = { user: { id: CLUB_IDS.me } };
    await mount();
    expect(h.directory?.empty).toBe(specializationClubsEmptyKey(true));
    expect(h.directory?.empty).toBe("club.spec.clubsEmpty");
  });

  it("komunikat pustki RÓŻNI SIĘ między gościem a zalogowanym", async () => {
    h.session = null;
    await mount();
    const anon = h.directory?.empty;
    cleanup();
    h.session = { user: { id: CLUB_IDS.me } };
    await mount();
    expect(h.directory?.empty).not.toBe(anon);
  });
});

// --- treść strony obszaru -------------------------------------------------

describe("strona obszaru - filary i nawigacja poprzeczna", () => {
  it("wypisuje trzy filary członkostwa z ich kluczami", async () => {
    await mount();
    for (const pillar of SPECIALIZATION_PILLARS) {
      expect(screen.getByText(pillar.titleKey)).toBeTruthy();
      expect(screen.getByText(pillar.descKey)).toBeTruthy();
    }
  });

  it.each(SLUGS)("`%s`: stopka wypisuje POZOSTAŁE obszary i ani razu siebie", async (slug) => {
    const { container } = await mount(slug);
    const cross = hrefs(container).filter((href) => href.startsWith("/club/specialization/"));
    const expected = otherClubSpecializations(slug).map(
      (spec) => `/club/specialization/${spec.slug}`,
    );
    expect(cross).toEqual(expected);
    expect(cross).not.toContain(`/club/specialization/${slug}`);
  });

  it("tytuł, zajawka i opis idą z KLUCZA obszaru, nie ze sluga", async () => {
    // Slug jest kontraktem adresu, klucz i18n - kontraktem słownika. Dla
    // większości obszarów są różne, więc pomyłka pola daje brak tłumaczenia.
    await mount("defence-geopolitics");
    expect(screen.getByText("club.spec.items.defence.title")).toBeTruthy();
    expect(screen.getByText("club.spec.items.defence.lead")).toBeTruthy();
    expect(screen.getByText("club.spec.items.defence.desc")).toBeTruthy();
  });

  it("numer porządkowy obszaru jest widoczny - to indeks redakcyjny", async () => {
    await mount("defence-geopolitics");
    expect(screen.getByText("01")).toBeTruthy();
  });
});

// --- odporność na rozjazd loadera i komponentu ----------------------------

describe("rozjazd katalogu MIĘDZY loaderem a renderem", () => {
  it("komponent bez specjalizacji pokazuje drogę powrotną, a nie pustą stronę", async () => {
    // Loader i komponent czytają katalog OSOBNO. Trasa nie wpuści tu nikogo
    // (loader rzuca `notFound` wcześniej), ale gałąź obronna w komponencie
    // istnieje właśnie na wypadek, gdy te dwa odczyty przestaną się zgadzać -
    // np. po podmianie katalogu na wersję z bazy. Bez niej render pada na
    // `spec.icon` z `null`, czyli na białym ekranie.
    h.blindComponent = true;
    await mount();
    expect(screen.getByText("club.backToHub")).toBeTruthy();
    expect(screen.queryByText("club.spec.applyCta")).toBeNull();
    expect(screen.queryByTestId("ClubDirectory")).toBeNull();
  });

  it("droga powrotna z tej gałęzi prowadzi na hub", async () => {
    h.blindComponent = true;
    await mount();
    expect(anchorOf("club.backToHub")?.getAttribute("href")).toBe("/club");
  });
});
