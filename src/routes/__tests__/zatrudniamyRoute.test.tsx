/**
 * Trasa `/zatrudniamy` ZAMONTOWANA - PUBLICZNA STRONA KARIERY, czyli ekran,
 * na który wchodzi kandydat z zewnątrz.
 *
 * ---------------------------------------------------------------------------
 * PO CO TEN PLIK ISTNIEJE
 * ---------------------------------------------------------------------------
 * Przed nim: 0/34 linii, 0/11 funkcji, 0/22 gałęzi - ZERO. I nie było to
 * przypadkowe przeoczenie jednego pliku, tylko skutek DZIURY W MAPIE MODUŁÓW:
 * moduł 21 („Rekrutacja / kariera”) łapał `^src/routes/.*(career|job)` oraz
 * `^src/routes/admin\.hiring`, a trasa kandydata nazywa się po polsku
 * (`zatrudniamy.tsx`) i nie ma w nazwie ani jednego z tych członów. Nie
 * należała więc do żadnego z modułów 1-19, a jako ostatni brał ją łapacz
 * `^src\/routes\//` modułu 20 („Platforma / backend / infrastruktura / SSR”).
 * Skutek: moduł odpowiedzialny za rekrutację NIE ZAWIERAŁ strony
 * rekrutacyjnej, więc żaden wiersz tabeli pokrycia nie mógł jej pokazać.
 * Wzorzec dopisano w tej samej gałęzi (`scripts/taxonomy/moduleMap.mjs`),
 * a ten plik zamyka odsłonięte przez to zero.
 *
 * ---------------------------------------------------------------------------
 * CO JEST PRZEDMIOTEM DOWODU
 * ---------------------------------------------------------------------------
 * Ta trasa nie rysuje treści - ona SKŁADA moduł i trzyma jego stan. Dowodzimy
 * dokładnie tego, co ona decyduje:
 *   1. `loader` bierze metadane SEO strony `zatrudniamy` i bierze je TYLKO
 *      dla wiersza opublikowanego i nieusuniętego (kształt zapytania),
 *   2. awaria tego odczytu NIE wywraca strony (loader ma `.catch(() => null)`)
 *      - kandydat widzi ofertę także wtedy, gdy panel treści nie odpowiada,
 *   3. `head()`: napisy zastępcze w obu językach, nadpisanie ich wiersza z
 *      bazy, adres kanoniczny TYLKO gdy ustawiony, `noindex` TYLKO gdy
 *      ustawiony, `og:image`/`twitter:image` TYLKO gdy jest obraz,
 *   4. kontrakt złożenia: która sekcja dostaje który identyfikator i który
 *      uchwyt - bo to on decyduje, czy „Aplikuj” w ogóle dowiezie kandydata
 *      do formularza,
 *   5. LICZNIK INTENCJI APLIKOWANIA (`applySignal`) rośnie przy KAŻDYM
 *      wezwaniu do działania, także gdy wybrana rola się NIE ZMIENIA. To
 *      najsubtelniejsza reguła tego pliku i jedyna, której nie widać z DOM-u:
 *      bez niej kreator formularza nie wróciłby z panelu potwierdzenia po
 *      powtórnym kliknięciu tej samej oferty,
 *   6. „Zobacz role” przewija do listy i NIE podbija licznika intencji
 *      (to nawigacja, nie zamiar aplikowania),
 *   7. filtr działu i wybór roli wracają w dół jako właściwości (stan żyje
 *      w trasie, nie w dzieciach),
 *   8. język formularza idzie za językiem aplikacji,
 *   9. `errorComponent` pokazuje komunikat w regionie `role="alert"`.
 *
 * ---------------------------------------------------------------------------
 * CO JEST ATRAPOWANE I DLACZEGO
 * ---------------------------------------------------------------------------
 * SZEŚĆ ORGANIZMÓW (`CareersHero`, `CareersValues`, `CareersRoles`,
 * `CareersProcess`, `CareersApplyForm`, `CareersClosing`) stoi tu jako
 * REJESTRATORY WŁAŚCIWOŚCI. To jest wybór, nie skrót:
 *   * każdy z nich ma WŁASNY plik dowodu w `src/components/careers/__tests__/`
 *     i tam mierzy się jego zawartość, dostępność i zachowanie,
 *   * przedmiotem dowodu TUTAJ jest KONTRAKT ZŁOŻENIA - co trasa im podaje
 *     i co robi z ich zwrotkami. Prawdziwe dzieci ten kontrakt ZASŁONIŁYBY:
 *     wzrost `applySignal` przy niezmienionej roli nie ma żadnego śladu w
 *     DOM-ie, więc test na prawdziwych dzieciach nie odróżniłby implementacji
 *     poprawnej od takiej, która podbija licznik tylko przy zmianie roli.
 * `@/integrations/supabase/client` - granica danych; atrapa łańcucha
 * PostgREST pozwala zaasertować KSZTAŁT zapytania SEO, a nie tylko jego wynik.
 * `pickStaticSeo` zostaje PRAWDZIWE, bo scalanie napisów zastępczych z
 * wierszem bazy jest tu przedmiotem dowodu.
 *
 * PRAWDZIWE zostają też: router (`renderRoute` montuje trasę z jej `loader`,
 * `head` i `errorComponent`), react-query, `activeLang` oraz i18n razem ze
 * słownikiem `@/lib/i18n-careers` - dzięki temu asercja na napisie mierzy
 * słownik, a nie literał wpisany w teście.
 *
 * ---------------------------------------------------------------------------
 * ŚWIADOMIE POZA ZAKRESEM
 * ---------------------------------------------------------------------------
 * * BRAK NARUSZEŃ AXE. Przy rejestratorach właściwości własny DOM tej trasy to
 *   jeden `div` kontenera - `axe` na takim drzewie nie dowodziłby niczego o
 *   dostępności strony kariery. Dowód dostępności mieszka w plikach
 *   organizmów (`careersHero.test.tsx`, `careersValues.test.tsx`,
 *   `careersRoles.test.tsx`, `careersApplyForm.test.tsx`, ...), gdzie drzewo
 *   jest prawdziwe.
 * * PRZEWIJANIE JAKO EFEKT WIZUALNY. Mierzymy, że trasa woła
 *   `scrollIntoView` na WŁAŚCIWYM elemencie z `behavior: "smooth"`; samo
 *   przewinięcie okna jest zachowaniem przeglądarki, nie tej trasy.
 * * TREŚĆ OFERT I ZAPIS ZGŁOSZENIA - `src/lib/careers/*` i ich testy.
 * * CZTERY GAŁĘZIE STRAŻY SSR - i to jest CAŁA reszta niepokrycia tego pliku
 *   (linie 34/34 = 100%, funkcje 11/11 = 100%, gałęzie 18/22 = 81,8%).
 *   Nieosiągalne są dokładnie: `typeof window === "undefined"` w linii 67
 *   (wraz z zapasowym `getRequestUrl() || "/zatrudniamy"` w jego wnętrzu) oraz
 *   `typeof document === "undefined"` w linii 78. W środowisku testowym z DOM-em
 *   `window` i `document` ISTNIEJĄ ZAWSZE, więc gałąź serwerowa nie da się
 *   wywołać bez podmiany globali - a taka podmiana mierzyłaby atrapę globala,
 *   nie tę trasę. Tych straży nie „obchodzimy" liczbowo: gałąź kliencka obu
 *   warunków jest dowiedziona (język z prefiksu ścieżki, przewijanie do
 *   właściwego elementu), a ścieżka serwerowa należy do renderu SSR, którego
 *   dowód mieszka w module 20.
 *
 * RODO: żadnych prawdziwych osób ani treści. Wszystkie napisy fixture są
 * zmyślone, adresy wyłącznie w domenie `example.com`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import type { CareerDepartmentId } from "@/lib/careers/roles";
import type { SupabaseFromStub, SupabaseResult } from "@/test/supabaseChain";

/** Właściwości, jakie trasa podaje liście ofert. */
interface RolesProps {
  id: string;
  department: CareerDepartmentId | "all";
  selectedRoleId: string | null;
}

/** Właściwości, jakie trasa podaje formularzowi zgłoszenia. */
interface FormProps {
  id: string;
  lang: "pl" | "en";
  selectedRoleId: string | null;
  applySignal: number;
}

const h = vi.hoisted(() => ({
  db: null as SupabaseFromStub | null,
  /** Ostatnie właściwości każdego rejestratora - do asercji kontraktu złożenia. */
  roles: [] as RolesProps[],
  form: [] as FormProps[],
  /** Uchwyty przekazane w dół, wołane przez test w imieniu dziecka. */
  onSeeRoles: null as (() => void) | null,
  onOpenApplicationHero: null as (() => void) | null,
  onOpenApplicationClosing: null as (() => void) | null,
  onApply: null as ((roleId: string) => void) | null,
  onDepartmentChange: null as ((d: CareerDepartmentId | "all") => void) | null,
  onRoleChange: null as ((roleId: string | null) => void) | null,
  /** Kolejność renderu sekcji - dowód, że strona nie sklei się w innym porządku. */
  order: [] as string[],
  /** Wywołania `scrollIntoView`: na czym i z jakimi opcjami. */
  scrolls: [] as { id: string; options: unknown }[],
  /** Adres żądania widziany przez `head()` - dźwignia języka nagłówka. */
  requestUrl: "https://example.com/zatrudniamy",
  /** Gdy ustawione, `supabase.from` RZUCA - do dowodu o `.catch()` loadera. */
  fromThrows: null as string | null,
}));

// AKCESOR ADRESU ŻĄDANIA. `getRequestUrl` jest funkcją izomorficzną i w teście
// jednostkowym rozstrzyga się do gałęzi SERWEROWEJ, w której `getRequest()`
// rzuca (nie ma runtime'u serwera) - a wtedy zwraca "". Bez tej atrapy `head()`
// nigdy nie zobaczyłby adresu, więc gałąź angielska byłaby NIEOSIĄGALNA,
// a test „napisy zastępcze po angielsku" przechodziłby na polskich napisach.
vi.mock("@/lib/seo/request", () => ({
  getRequestUrl: () => h.requestUrl,
  getOrigin: () => "https://example.com",
}));

// GRANICA DANYCH. Atrapa łańcucha PostgREST - kształt zapytania SEO jest tu
// przedmiotem dowodu, więc test musi widzieć ogniwa, nie tylko wynik.
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const db = supabaseFromStub();
  h.db = db;
  return {
    supabase: {
      from: (table: string) => {
        // Błąd PostgREST i WYJĄTEK to dwie różne awarie: pierwszą tłumi
        // `queryFn` (zwraca `null`), druga leci przez `ensureQueryData`
        // i dopiero ją łapie `.catch()` loadera.
        if (h.fromThrows !== null) throw new Error(h.fromThrows);
        return db.from(table);
      },
    },
  };
});

// SZEŚĆ REJESTRATORÓW WŁAŚCIWOŚCI. Uzasadnienie w nagłówku pliku.
vi.mock("@/components/careers/organisms/CareersHero", () => ({
  CareersHero: (props: { onSeeRoles: () => void; onOpenApplication: () => void }) => {
    h.order.push("hero");
    h.onSeeRoles = props.onSeeRoles;
    h.onOpenApplicationHero = props.onOpenApplication;
    return <div data-testid="hero" />;
  },
}));

vi.mock("@/components/careers/organisms/CareersValues", () => ({
  CareersValues: () => {
    h.order.push("values");
    return <div data-testid="values" />;
  },
}));

vi.mock("@/components/careers/organisms/CareersRoles", () => ({
  CareersRoles: (
    props: RolesProps & {
      onDepartmentChange: (d: CareerDepartmentId | "all") => void;
      onApply: (roleId: string) => void;
    },
  ) => {
    h.order.push("roles");
    h.roles.push({
      id: props.id,
      department: props.department,
      selectedRoleId: props.selectedRoleId,
    });
    h.onDepartmentChange = props.onDepartmentChange;
    h.onApply = props.onApply;
    // Identyfikator MUSI trafić do DOM-u: to po nim trasa szuka celu przewinięcia.
    return <section id={props.id} data-testid="roles" />;
  },
}));

vi.mock("@/components/careers/organisms/CareersProcess", () => ({
  CareersProcess: () => {
    h.order.push("process");
    return <div data-testid="process" />;
  },
}));

vi.mock("@/components/careers/organisms/CareersApplyForm", () => ({
  CareersApplyForm: (props: FormProps & { onRoleChange: (roleId: string | null) => void }) => {
    h.order.push("form");
    h.form.push({
      id: props.id,
      lang: props.lang,
      selectedRoleId: props.selectedRoleId,
      applySignal: props.applySignal,
    });
    h.onRoleChange = props.onRoleChange;
    return <section id={props.id} data-testid="form" />;
  },
}));

vi.mock("@/components/careers/organisms/CareersClosing", () => ({
  CareersClosing: (props: { onOpenApplication: () => void }) => {
    h.order.push("closing");
    h.onOpenApplicationClosing = props.onOpenApplication;
    return <div data-testid="closing" />;
  },
}));

import i18n from "@/lib/i18n";
import { realT } from "@/test/i18nReal";
import { renderRoute, routeHead } from "@/test/routeHarness";
import { ok } from "@/test/supabaseChain";
import type { StaticPageSeo } from "@/lib/queries/staticPageSeo";
import { Route as CareersRoute } from "@/routes/zatrudniamy";

const PATH = "/zatrudniamy";
const ROLES_ID = "careers-open-roles";
const FORM_ID = "careers-application";

/** Napisy zastępcze `head()` - literały z trasy, świadomie, bo to KONTRAKT SEO. */
const FALLBACK_TITLE_PL = "Kariera - dołącz do zespołu New European Strategies";
const FALLBACK_TITLE_EN = "Careers - join the New European Strategies team";

/** Wiersz `pages` w kształcie, którego dotyka test - zmyślony w całości. */
function seoRow(over: Partial<NonNullable<StaticPageSeo>> = {}): NonNullable<StaticPageSeo> {
  return {
    slug: "zatrudniamy",
    title_pl: null,
    title_en: null,
    excerpt_pl: null,
    excerpt_en: null,
    seo_title_pl: null,
    seo_title_en: null,
    seo_description_pl: null,
    seo_description_en: null,
    seo_canonical_url: null,
    seo_noindex: null,
    seo_og_image_url: null,
    og_image_generated_url: null,
    ...over,
  };
}

/** Klient bez ponowień - test odmowy odczytu nie ma na co czekać. */
function testClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function planPages(result: SupabaseResult): void {
  h.db?.setResponse("pages", result);
}

async function mount() {
  return renderRoute({
    route: CareersRoute,
    path: PATH,
    initialEntry: PATH,
    queryClient: testClient(),
  });
}

/**
 * Woła uchwyt przekazany dziecku W IMIENIU tego dziecka, w `act()`.
 * Bez `act()` React ostrzega o aktualizacji stanu poza transakcją, a asercja
 * mogłaby zobaczyć render sprzed przeliczenia - czyli fałszywy wynik.
 */
async function jakDziecko(action: () => void): Promise<void> {
  await act(async () => {
    action();
  });
}

/** Ostatnie właściwości formularza - najczęstsza asercja tego pliku. */
function lastForm(): FormProps {
  const last = h.form.at(-1);
  if (!last) throw new Error("test: formularz nie został wyrenderowany");
  return last;
}

/** Ostatnie właściwości listy ofert. */
function lastRoles(): RolesProps {
  const last = h.roles.at(-1);
  if (!last) throw new Error("test: lista ofert nie została wyrenderowana");
  return last;
}

/** Meta jako mapa `title`/`name`/`property` -> treść, do zwięzłych asercji. */
function metaMap(entries: Record<string, unknown>[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of entries) {
    if (typeof entry.title === "string") out.set("title", entry.title);
    const key = typeof entry.name === "string" ? entry.name : entry.property;
    if (typeof key === "string" && typeof entry.content === "string") out.set(key, entry.content);
  }
  return out;
}

beforeEach(() => {
  h.db?.reset();
  h.roles.length = 0;
  h.form.length = 0;
  h.order.length = 0;
  h.scrolls.length = 0;
  h.onSeeRoles = null;
  h.onOpenApplicationHero = null;
  h.onOpenApplicationClosing = null;
  h.onApply = null;
  h.onDepartmentChange = null;
  h.onRoleChange = null;
  planPages(ok(null));
  h.requestUrl = "https://example.com/zatrudniamy";
  h.fromThrows = null;
  window.history.pushState({}, "", "/zatrudniamy");
  // happy-dom nie implementuje `scrollIntoView`. Atrapa notuje, NA CZYM
  // i z jakimi opcjami trasa je zawołała - to jest tu przedmiotem dowodu.
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    writable: true,
    value: function scrollIntoViewStub(this: Element, options: unknown) {
      h.scrolls.push({ id: this.id, options });
    },
  });
});

afterEach(async () => {
  cleanup();
  window.history.pushState({}, "", "/zatrudniamy");
  await i18n.changeLanguage("pl");
});

describe("loader: metadane SEO strony kariery", () => {
  it("pyta o wiersz `pages` po slugu `zatrudniamy`, i tylko o opublikowany oraz nieusunięty", async () => {
    planPages(ok(seoRow()));
    await mount();

    const chain = h.db?.lastChain("pages");
    expect(chain).toBeDefined();
    expect(chain?.argsOf("eq")).toEqual(["slug", "zatrudniamy"]);
    // Trzy filtry, nie jeden: slug + status + brak skasowania.
    const eqs = chain?.calls.filter((c) => c.method === "eq").map((c) => c.args) ?? [];
    expect(eqs).toEqual([
      ["slug", "zatrudniamy"],
      ["status", "published"],
    ]);
    expect(chain?.argsOf("is")).toEqual(["deleted_at", null]);
    expect(chain?.has("maybeSingle")).toBe(true);
  });

  it("odmowa odczytu metadanych NIE wywraca strony - kandydat wciąż widzi ofertę", async () => {
    // `staticPageSeoQueryOptions` zamienia błąd na `null`, a loader ma jeszcze
    // własny `.catch(() => null)`. Dowodzimy SKUTKU: strona się składa.
    planPages({ data: null, error: Object.assign(new Error("test: RLS odmówił"), { name: "x" }) });
    await mount();

    expect(await screen.findByTestId("form")).toBeInTheDocument();
    expect(screen.getByTestId("roles")).toBeInTheDocument();
  });

  it("WYJĄTEK warstwy danych też nie wywraca strony - to po to loader ma `.catch()`", async () => {
    // Rozróżnienie, którego nie widać z zewnątrz: `queryFn` sam tłumi BŁĄD
    // PostgREST (zwraca `null`), więc `.catch()` loadera jest martwy dla tej
    // ścieżki. Ożywia go dopiero WYJĄTEK - np. gdy klient nie zdąży się
    // zainicjalizować. Bez tego dowodu usunięcie `.catch()` przeszłoby po
    // cichu i pierwsza taka awaria zamieniłaby stronę kariery w błąd trasy.
    h.fromThrows = "test: klient danych nie wystartował";
    await mount();

    expect(await screen.findByTestId("form")).toBeInTheDocument();
    expect(screen.getByTestId("closing")).toBeInTheDocument();
  });

  it("brak wiersza w bazie (strona nieopisana w panelu treści) też składa stronę", async () => {
    planPages(ok(null));
    h.requestUrl = "https://example.com/zatrudniamy";
    h.fromThrows = null;
    window.history.pushState({}, "", "/zatrudniamy");
    await mount();

    expect(await screen.findByTestId("hero")).toBeInTheDocument();
  });
});

describe("head(): kontrakt SEO strony kariery", () => {
  it("bez wiersza z bazy daje polskie napisy zastępcze i pełny zestaw Open Graph", () => {
    const head = routeHead(CareersRoute, { loaderData: { seo: null } });
    const meta = metaMap(head.meta ?? []);

    expect(meta.get("title")).toBe(FALLBACK_TITLE_PL);
    expect(meta.get("og:title")).toBe(FALLBACK_TITLE_PL);
    expect(meta.get("og:description")).toBe(meta.get("description"));
    expect(meta.get("og:type")).toBe("website");
    expect(meta.get("twitter:card")).toBe("summary_large_image");
    expect(meta.get("description")).toContain("Aplikuj online");
  });

  it("po przełączeniu aplikacji na angielski napisy zastępcze są angielskie", () => {
    // DŹWIGNIĄ JĘZYKA JEST PREFIKS ADRESU, NIE `i18n.changeLanguage`. Ustalone
    // czytaniem `src/lib/seo/head.ts` i `src/lib/i18n/localeRuntime.ts`:
    // `activeLang(u)` bierze język z PREFIKSU ścieżki, a dopiero bez prefiksu
    // schodzi do `currentLang()` - która w teście jednostkowym rozstrzyga się
    // do gałęzi serwerowej i zawsze oddaje język domyślny. Test oparty na
    // `i18n.changeLanguage` przeszedłby więc na polskich napisach.
    h.requestUrl = "https://example.com/en/zatrudniamy";
    const head = routeHead(CareersRoute, { loaderData: { seo: null } });
    const meta = metaMap(head.meta ?? []);

    expect(meta.get("title")).toBe(FALLBACK_TITLE_EN);
    expect(meta.get("og:title")).toBe(FALLBACK_TITLE_EN);
  });

  it("gdy akcesor adresu żądania nic nie zwraca, `head()` staje na własnej ścieżce zapasowej", () => {
    // Za brzegiem (albo przy braku nagłówka `host`) `getRequestUrl()` oddaje
    // pusty napis. Nagłówek nie może się wtedy rozsypać - bierze `/zatrudniamy`
    // i tym samym język domyślny.
    h.requestUrl = "";
    const meta = metaMap(routeHead(CareersRoute, { loaderData: { seo: null } }).meta ?? []);
    expect(meta.get("title")).toBe(FALLBACK_TITLE_PL);
  });

  it("wiersz z panelu treści NADPISUJE napisy zastępcze", () => {
    const head = routeHead(CareersRoute, {
      loaderData: {
        seo: seoRow({
          seo_title_pl: "Zmyślony tytuł rekrutacyjny",
          seo_description_pl: "Zmyślony opis naboru do zespołu.",
        }),
      },
    });
    const meta = metaMap(head.meta ?? []);

    expect(meta.get("title")).toBe("Zmyślony tytuł rekrutacyjny");
    expect(meta.get("description")).toBe("Zmyślony opis naboru do zespołu.");
  });

  it("adres kanoniczny pojawia się TYLKO wtedy, gdy panel go ustawił", () => {
    const bez = routeHead(CareersRoute, { loaderData: { seo: seoRow() } });
    expect(bez.links ?? []).toEqual([]);

    const z = routeHead(CareersRoute, {
      loaderData: { seo: seoRow({ seo_canonical_url: "https://example.com/zatrudniamy" }) },
    });
    expect(z.links).toEqual([{ rel: "canonical", href: "https://example.com/zatrudniamy" }]);
  });

  it("`noindex` pojawia się TYLKO wtedy, gdy panel go ustawił - inaczej strona ma być indeksowana", () => {
    const bez = metaMap(routeHead(CareersRoute, { loaderData: { seo: seoRow() } }).meta ?? []);
    expect(bez.has("robots")).toBe(false);

    const z = metaMap(
      routeHead(CareersRoute, { loaderData: { seo: seoRow({ seo_noindex: true }) } }).meta ?? [],
    );
    expect(z.get("robots")).toBe("noindex,nofollow");
  });

  it("obraz społecznościowy dokłada OBA wpisy (og:image i twitter:image) albo żaden", () => {
    const bez = metaMap(routeHead(CareersRoute, { loaderData: { seo: seoRow() } }).meta ?? []);
    expect(bez.has("og:image")).toBe(false);
    expect(bez.has("twitter:image")).toBe(false);

    const z = metaMap(
      routeHead(CareersRoute, {
        loaderData: { seo: seoRow({ seo_og_image_url: "https://example.com/kariera.png" }) },
      }).meta ?? [],
    );
    expect(z.get("og:image")).toBe("https://example.com/kariera.png");
    expect(z.get("twitter:image")).toBe("https://example.com/kariera.png");
  });

  it("obraz wygenerowany służy jako zapas, gdy panel nie wskazał własnego", () => {
    const meta = metaMap(
      routeHead(CareersRoute, {
        loaderData: { seo: seoRow({ og_image_generated_url: "https://example.com/auto.png" }) },
      }).meta ?? [],
    );
    expect(meta.get("og:image")).toBe("https://example.com/auto.png");
  });

  it("head() bez danych loadera (pierwszy przebieg, przed rozwiązaniem zapytania) nie wybucha", () => {
    const meta = metaMap(routeHead(CareersRoute, {}).meta ?? []);
    expect(meta.get("title")).toBe(FALLBACK_TITLE_PL);
  });
});

describe("kontrakt złożenia strony", () => {
  it("składa sześć sekcji w kolejności: hero, wartości, role, proces, formularz, zamknięcie", async () => {
    await mount();
    // Render może się powtórzyć (stan trasy), więc porównujemy PIERWSZE
    // wystąpienia - kolejność, nie liczbę przebiegów.
    const pierwsze = [...new Set(h.order)];
    expect(pierwsze).toEqual(["hero", "values", "roles", "process", "form", "closing"]);
  });

  it("lista ofert i formularz dostają identyfikatory, po których trasa je odnajduje", async () => {
    await mount();
    expect(lastRoles().id).toBe(ROLES_ID);
    expect(lastForm().id).toBe(FORM_ID);
    expect(document.getElementById(ROLES_ID)).not.toBeNull();
    expect(document.getElementById(FORM_ID)).not.toBeNull();
  });

  it("na wejściu żadna rola nie jest wybrana, filtr działu jest otwarty, licznik intencji zerowy", async () => {
    await mount();
    expect(lastRoles().selectedRoleId).toBeNull();
    expect(lastRoles().department).toBe("all");
    expect(lastForm().applySignal).toBe(0);
    expect(lastForm().selectedRoleId).toBeNull();
  });

  it("język formularza bierze się z PREFIKSU adresu strony, na której stoi kandydat", async () => {
    // Komponent czyta `window.location.pathname` (gałąź kliencka warunku
    // `typeof window === "undefined"`), więc dowód jedzie prawdziwą ścieżką.
    await mount();
    expect(lastForm().lang).toBe("pl");

    cleanup();
    h.form.length = 0;
    window.history.pushState({}, "", "/en/zatrudniamy");
    await mount();
    expect(lastForm().lang).toBe("en");
  });
});

describe("intencja aplikowania: rola z listy", () => {
  it("„Aplikuj” na ofercie ustawia rolę, podbija licznik intencji i przewija do formularza", async () => {
    await mount();

    await jakDziecko(() => h.onApply?.("rola-zmyslona-1"));

    await waitFor(() => expect(lastForm().selectedRoleId).toBe("rola-zmyslona-1"));
    expect(lastForm().applySignal).toBe(1);
    expect(h.scrolls).toEqual([{ id: FORM_ID, options: { behavior: "smooth", block: "start" } }]);
  });

  it("PONOWNE „Aplikuj” na TEJ SAMEJ ofercie znów podbija licznik, choć rola się nie zmienia", async () => {
    // TO JEST REGUŁA, DLA KTÓREJ LICZNIK ISTNIEJE. Gdyby trasa podbijała go
    // tylko przy zmianie roli, kreator formularza nie wróciłby z panelu
    // potwierdzenia po powtórnym kliknięciu tej samej oferty - a kandydat
    // zobaczyłby ekran „wysłano” zamiast pustego formularza. Tego defektu NIE
    // WIDAĆ w DOM-ie, dlatego dzieci są tu rejestratorami właściwości.
    await mount();

    await jakDziecko(() => h.onApply?.("rola-zmyslona-1"));
    await waitFor(() => expect(lastForm().applySignal).toBe(1));

    await jakDziecko(() => h.onApply?.("rola-zmyslona-1"));
    await waitFor(() => expect(lastForm().applySignal).toBe(2));
    expect(lastForm().selectedRoleId).toBe("rola-zmyslona-1");
    expect(h.scrolls).toHaveLength(2);
  });

  it("wybór innej oferty podmienia rolę i podbija licznik dalej", async () => {
    await mount();

    await jakDziecko(() => h.onApply?.("rola-zmyslona-1"));
    await waitFor(() => expect(lastForm().applySignal).toBe(1));
    await jakDziecko(() => h.onApply?.("rola-zmyslona-2"));

    await waitFor(() => expect(lastForm().selectedRoleId).toBe("rola-zmyslona-2"));
    expect(lastForm().applySignal).toBe(2);
  });

  it("wybrana rola wraca w dół także do listy ofert - stan mieszka w trasie", async () => {
    await mount();
    await jakDziecko(() => h.onApply?.("rola-zmyslona-7"));
    await waitFor(() => expect(lastRoles().selectedRoleId).toBe("rola-zmyslona-7"));
  });
});

describe("intencja aplikowania: wezwania bez wybranej roli", () => {
  it("„Aplikuj” w nagłówku CZYŚCI wybraną rolę i podbija licznik", async () => {
    await mount();

    await jakDziecko(() => h.onApply?.("rola-zmyslona-1"));
    await waitFor(() => expect(lastForm().selectedRoleId).toBe("rola-zmyslona-1"));

    await jakDziecko(() => h.onOpenApplicationHero?.());

    await waitFor(() => expect(lastForm().selectedRoleId).toBeNull());
    expect(lastForm().applySignal).toBe(2);
    expect(h.scrolls.at(-1)).toEqual({
      id: FORM_ID,
      options: { behavior: "smooth", block: "start" },
    });
  });

  it("„Aplikuj” w sekcji zamykającej działa tym samym uchwytem co w nagłówku", async () => {
    await mount();

    await jakDziecko(() => h.onOpenApplicationClosing?.());

    await waitFor(() => expect(lastForm().applySignal).toBe(1));
    expect(lastForm().selectedRoleId).toBeNull();
    expect(h.scrolls.at(-1)?.id).toBe(FORM_ID);
  });

  it("dwa różne wezwania z rzędu podbijają licznik dwa razy", async () => {
    await mount();

    await jakDziecko(() => h.onOpenApplicationHero?.());
    await waitFor(() => expect(lastForm().applySignal).toBe(1));
    await jakDziecko(() => h.onOpenApplicationClosing?.());
    await waitFor(() => expect(lastForm().applySignal).toBe(2));
  });
});

describe("nawigacja, która nie jest zamiarem aplikowania", () => {
  it("„Zobacz role” przewija do listy ofert i NIE podbija licznika intencji", async () => {
    await mount();

    await jakDziecko(() => h.onSeeRoles?.());

    await waitFor(() =>
      expect(h.scrolls).toEqual([
        { id: ROLES_ID, options: { behavior: "smooth", block: "start" } },
      ]),
    );
    expect(lastForm().applySignal).toBe(0);
    expect(lastForm().selectedRoleId).toBeNull();
  });
});

describe("stan filtra działu i korekta roli w formularzu", () => {
  it("zmiana działu z listy wraca w dół jako właściwość", async () => {
    await mount();
    expect(lastRoles().department).toBe("all");

    await jakDziecko(() => h.onDepartmentChange?.("research"));

    await waitFor(() => expect(lastRoles().department).toBe("research"));
    // Filtr działu NIE jest zamiarem aplikowania - licznik stoi.
    expect(lastForm().applySignal).toBe(0);
  });

  it("powrót filtra na „wszystkie” jest możliwy", async () => {
    await mount();
    await jakDziecko(() => h.onDepartmentChange?.("research"));
    await waitFor(() => expect(lastRoles().department).toBe("research"));

    await jakDziecko(() => h.onDepartmentChange?.("all"));
    await waitFor(() => expect(lastRoles().department).toBe("all"));
  });

  it("formularz może sam podmienić rolę (`onRoleChange`) i lista to widzi", async () => {
    await mount();

    await jakDziecko(() => h.onRoleChange?.("rola-zmyslona-9"));
    await waitFor(() => expect(lastRoles().selectedRoleId).toBe("rola-zmyslona-9"));

    await jakDziecko(() => h.onRoleChange?.(null));
    await waitFor(() => expect(lastRoles().selectedRoleId).toBeNull());
  });

  it("podmiana roli z formularza NIE podbija licznika intencji", async () => {
    // Inaczej wybór roli w formularzu resetowałby kreator w kółko.
    await mount();
    await jakDziecko(() => h.onRoleChange?.("rola-zmyslona-9"));
    await waitFor(() => expect(lastForm().selectedRoleId).toBe("rola-zmyslona-9"));
    expect(lastForm().applySignal).toBe(0);
  });
});

describe("errorComponent trasy", () => {
  it("pokazuje komunikat błędu w regionie ogłaszanym czytnikom ekranu", () => {
    const ErrorView = CareersRoute.options.errorComponent;
    if (typeof ErrorView !== "function") throw new Error("test: trasa nie ma errorComponent");

    const { getByRole } = render(
      <ErrorView
        error={new Error("Zmyślona awaria warstwy treści")}
        reset={() => {}}
        info={{ componentStack: "" }}
      />,
    );
    const alert = getByRole("alert");
    expect(alert).toHaveTextContent("Zmyślona awaria warstwy treści");
  });
});

describe("napisy strony pochodzą ze słownika, nie z literałów trasy", () => {
  it("słownik kariery jest zarejestrowany przy imporcie trasy", () => {
    // `ensureCareersI18n()` woła trasa; bez rejestracji sekcje dostałyby
    // z powrotem własne klucze i strona pokazałaby `careers.process.title`.
    const t = realT("pl");
    expect(t("careers.process.title")).not.toBe("careers.process.title");
    expect(t("careers.hero.titleAccent")).not.toBe("careers.hero.titleAccent");
  });
});
