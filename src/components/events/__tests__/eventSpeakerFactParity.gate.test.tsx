// BRAMKA CI: DWIE PUBLICZNE LISTY PRELEGENTÓW TEGO SAMEGO WYDARZENIA NIE MOGĄ
// RÓŻNIĆ SIĘ FAKTAMI O OSOBIE.
//
// ── CO SIĘ PSUŁO (POLICZONE, NIE ZGADYWANE) ────────────────────────────────
// Jedno wydarzenie ma dwie publiczne powierzchnie tej samej listy:
//   * przegląd `/events/<slug>` -> `EventSpeakersSection` (poziome chipy),
//   * zakładka `/events/<slug>/speakers` -> `EventSpeakersGrid` (siatka kart).
// Plakietka eksperta (`is_expert`) stała TYLKO w zapowiedzi, a organizacja
// (`company`) TYLKO w siatce. Ta sama osoba, te same wiersze z tego samego RPC
// (`get_public_speakers`, ten sam klucz cache) - i dwie różne odpowiedzi na
// pytanie „kim ona jest”: na przeglądzie ekspertka bez afiliacji, na zakładce
// afiliacja bez tytułu eksperta. Żadna z tych różnic nie była decyzją o wyglądzie.
//
// ── CZEGO TA BRAMKA NIE PILNUJE, I TO JEST ROZSTRZYGNIĘCIE WŁAŚCICIELA ──────
// UKŁADY WOLNO RÓŻNIĆ. Zapowiedź na przeglądzie ZOSTAJE zapowiedzią: awatar
// `lg`, dwie kolumny chipów; siatka zostaje siatką: awatar `xl`, do czterech
// kolumn, podpis wyśrodkowany. Tu nie ma ani jednej asercji na klasę CSS, na
// liczbę kolumn ani na rozmiar zdjęcia - bo złamanie tych rzeczy nie jest
// defektem. Mierzymy WYŁĄCZNIE zestaw FAKTÓW o osobie.
//
// ── DLACZEGO BRAMKA PARYTETU PODGLĄDU TEGO NIE WIDZIAŁA ────────────────────
// `admin/events/__tests__/eventPreviewPublicParity.gate.test.tsx` porównuje
// PODGLĄD STUDIA ze stroną publiczną - inna oś niż ta. A nawet na swojej osi
// nie mogła tego zobaczyć: jej `publicImports()` łapie wyłącznie importy
// z `@/components/events/public/`, a `EventSpeakersSection` leży o katalog wyżej,
// w `@/components/events/`. Nie był to wyjątek na liście - był niewidzialny
// z definicji zasięgu. Dlatego ta bramka nie pyta o katalog ani o nazwę importu.
//
// ── DWA POMIARY, BO JEDEN NIE WYSTARCZA ────────────────────────────────────
//  (1) ZACHOWANIE. Obie powierzchnie dostają TEN SAM wiersz i porównywany jest
//      zestaw faktów, które NAPRAWDĘ wypisały w drzewie. Asercja na obecność
//      nazwy komponentu w źródle („czy plik wspomina `SpeakerExpertBadge`”)
//      byłaby dokładnie tym, na czym przewróciła się pierwsza wersja bramki
//      parytetu podglądu: nazwa w pliku nie dowodzi, że coś się narysowało -
//      martwa gałąź albo nieużyty import przechodzą taki test na zielono.
//  (2) STRUKTURA. Ikonę tarczy wolno rysować WYŁĄCZNIE wspólnej plakietce.
//      To nie zamiast (1), a obok: (1) wykrywa rozjazd, (2) czyni go trudnym,
//      bo drugi rysunek tego samego faktu nie ma jak powstać po cichu.
//
// ── RODZINA POWIERZCHNI JEST LICZONA, NIE WYPISANA ─────────────────────────
// Tej samej doby bramka EB-912 (`src/lib/events/__tests__/timezoneAdoption.gate.test.ts`)
// przepuściła regresję dokładnie dlatego, że miała rodzinę plików WYPISANĄ:
// podział trasy przeniósł dług strefy czasowej z `events.$slug.tsx` do
// `events.$slug.index.tsx`, pliku poza listą, i osiem testów świeciło zielono,
// kiedy defekt żył (commit `f4da209`). Tutaj zbiór konsumentów
// zapytania o prelegentów jest LICZONY z drzewa `src` (kto woła
// `speakersQueryOptions`), a jedyną rzeczą wpisaną ręcznie jest lista
// POKRYTYCH powierzchni oraz jawne wyjątki - i one są SPRAWDZANE względem
// zbioru policzonego, w obie strony.
//
// CO SIĘ STANIE PRZY NASTĘPNYM PRZENIESIENIU. Jeśli podział trasy albo
// przeniesienie pliku zmieni ścieżkę którejkolwiek powierzchni, to:
//   * nowa ścieżka wejdzie do zbioru policzonego i zaczerwieni „każdy konsument
//     jest POKRYTY albo ma jawny powód” z nazwą pliku,
//   * stara ścieżka wypadnie i zaczerwieni „każda POKRYTA powierzchnia nadal
//     woła to zapytanie z tej ścieżki”.
// Autor przeniesienia musi więc dopisać nową ścieżkę - a wpis w
// `COVERED_SURFACES` bez renderera się nie skompiluje, czyli nowa powierzchnia
// wchodzi do dowodu ZACHOWANIA razem ze ścieżką. Trzeci renderer tej samej
// listy zaczerwieni tę samą asercję.
//
// CZEGO SKAN ŹRÓDŁA NIE ZOBACZY. Wołanie schowane za dynamicznym importem albo
// za aliasem (`const q = speakersQueryOptions; q(...)`) wypadnie ze zbioru.
// To granica narzędzia, nie wymówka: takiego wołania w tym repozytorium nie ma,
// a asercja o zniknięciu pokrytej ścieżki pilnuje, żeby ucieczka spod skanu nie
// przeszła w ciszy.
//
// ── ŹRÓDŁO CZYTAMY BEZ KOMENTARZY ──────────────────────────────────────────
// Asercja na treści źródła zaświeciłaby się na własnym opisie, gdyby opis
// cytował szukany literał - a te opisy MUSZĄ go cytować, bo inaczej nikt nie
// wie, czego bramka pilnuje. `withoutComments()` odcina komentarze ze
// SKANOWANYCH plików produkcyjnych: `EventSpeakersGrid.tsx` opisuje w nagłówku
// swoje zapytanie i swoją plakietkę, a `SpeakerExpertBadge.tsx` opisuje ikonę,
// więc bez odcięcia oba liczyłyby się przez opis, a nie przez kod. Ten plik do
// skanu nie wchodzi (katalog `__tests__`).
//
// ── PARYTET PRZEZ USUNIĘCIE TEŻ JEST CZERWIENIĄ ────────────────────────────
// „Obecne w obu albo w żadnej” spełnia też wycięcie faktu z obu powierzchni -
// i to jest parytet, którego nikt nie chce. Dlatego obok asercji SYMETRII stoi
// druga: każdy znany fakt musi być na KAŻDEJ powierzchni. Dwie asercje, dwa
// różne komunikaty - autor zmiany widzi, którą regułę złamał.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement, ReactNode } from "react";

const h = vi.hoisted(() => ({ rows: [] as unknown[] }));

// `t` oddaje KLUCZ, nie tłumaczenie: fakt mierzymy obecnością klucza w drzewie,
// żeby zmiana brzmienia napisu nie oblewała bramki o parytecie faktów. Że sam
// klucz istnieje w obu słownikach, dowodzi osobny kanarek niżej.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "pl", exists: () => true, changeLanguage: () => Promise.resolve() },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@/lib/builder/speakersQuery", () => ({
  speakersQueryOptions: (input: unknown, lang: unknown) => ({
    queryKey: ["speakers", JSON.stringify(input), lang],
    queryFn: () => h.rows,
  }),
}));

// Dialog profilu to powierzchnia JEDNEJ OSOBY, nie listy, i ma własne testy -
// tutaj jest atrapą, bo do dowodu o parytecie dwóch LIST nie wnosi nic, a wnosi
// Radix i zapytanie o profil.
vi.mock("@/components/events/SpeakerProfileDialog", () => ({
  SpeakerProfileDialog: () => null,
}));

import { eventFrontEn, eventFrontPl } from "@/lib/i18n-event-front";

const { EventSpeakersSection } = await import("@/components/events/EventSpeakersSection");
const { EventSpeakersGrid } =
  await import("@/components/events/public/organisms/EventSpeakersGrid");

const SCAN_ROOT = "src";

/** Katalog prelegentów - razem z `public/`, w którym stoi siatka. */
const EVENTS_DIR = "src/components/events";

/** JEDYNY plik, któremu wolno rysować ikonę tarczy w tym katalogu. */
const BADGE_FILE = "src/components/events/SpeakerExpertBadge.tsx";

/** Klucz nazwy plakietki eksperta - ŚLAD faktu `is_expert` w drzewie. */
const EXPERT_FACT_KEY = "eventFront.speakers.expertBadge";

// ── FAKTY O OSOBIE ─────────────────────────────────────────────────────────
//
// Każdy fakt ma w wierszu RPC swoją kolumnę i w drzewie swój rozpoznawalny
// ślad. Wartości są rozłączne, więc `includes` nie może pomylić jednego faktu
// z drugim ani skleić dwóch sąsiednich węzłów tekstowych w trafienie.
const PERSON_FACTS = {
  display_name: "Anna Kowalska",
  role: "Prezes zarządu",
  company: "Szkoła Główna Handlowa",
  is_expert: EXPERT_FACT_KEY,
} as const;

type FactName = keyof typeof PERSON_FACTS;
const ALL_FACTS = Object.keys(PERSON_FACTS) as FactName[];

/** Wiersz, w którym KAŻDY fakt jest wypełniony - inaczej brak faktu w drzewie
 *  znaczyłby brak danych, a nie brak renderera. */
function speakerRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    user_id: "u1",
    slug: "anna-kowalska",
    display_name: PERSON_FACTS.display_name,
    avatar_url: null,
    job_title: "Dyrektorka",
    company: PERSON_FACTS.company,
    headline_pl: PERSON_FACTS.role,
    headline_en: "Chair of the board",
    bio_pl: null,
    bio_en: null,
    topics_pl: [],
    topics_en: [],
    languages: [],
    talks_count: 0,
    rating: 0,
    reviews_count: 0,
    is_expert: true,
    has_speaker_profile: true,
    sort_order: 0,
    ...overrides,
  };
}

interface Surface {
  /** Nazwa w komunikacie czerwieni. */
  readonly label: string;
  /** Plik, który tę powierzchnię rysuje - wiąże dowód zachowania ze zbiorem
   *  policzonym z drzewa. */
  readonly file: string;
  readonly render: () => ReactElement;
}

const COVERED_SURFACES: readonly Surface[] = [
  {
    label: "zapowiedź na przeglądzie (EventSpeakersSection)",
    file: "src/components/events/EventSpeakersSection.tsx",
    render: () => <EventSpeakersSection eventId="e1" lang="pl" />,
  },
  {
    label: "siatka na zakładce (EventSpeakersGrid)",
    file: "src/components/events/public/organisms/EventSpeakersGrid.tsx",
    render: () => <EventSpeakersGrid eventId="e1" />,
  },
];

/**
 * Konsumenci zapytania o prelegentów, którzy NIE są powierzchnią listy jednego
 * wydarzenia. Powód każdego jest mechaniczny - lista bez uzasadnień zamienia
 * się w listę wymówek, a nieużywany wpis czerwieni test tak samo jak brakujący.
 */
const CONSUMER_EXCEPTIONS: Record<string, string> = {
  "src/lib/builder/prefetch.ts":
    "REJESTR PREFETCHU SSR, nie renderer: składa `queryOptions` dla strumienia widgetów i nie rysuje ani jednego węzła, więc nie ma czym skłamać o osobie",
  "src/components/builder/organisms/widget-view/SpeakersWidget.tsx":
    "WIDGET REDAKCYJNY, nie lista jednego wydarzenia: to samo pole karty (`SpeakerItem`) wypełniają wpisy WPISANE RĘCZNIE w studiu, a ich model treści nie ma kolumny organizacji w ogóle - zestaw faktów widgetu jest sumą z ręcznymi wpisami, a nie projekcją wiersza RPC. Widget niesie `is_expert`, ale NIE niesie `company`: to osobna decyzja właściciela, zgłoszona i tutaj NIE zmieniana",
};

/**
 * Źródło BEZ KOMENTARZY - skan liczy KOD, nie opis. Warunek na znak przed `//`
 * zostawia adresy (`https://`) w spokoju.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:'"`\\])\/\/[^\n]*/g, "$1");
}

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__" || entry === "node_modules") continue;
    const full = join(dir, entry).replaceAll("\\", "/");
    if (statSync(full).isDirectory()) {
      // `src/test` to harness testowy, nie kod produkcyjny.
      if (full !== "src/test") walk(full, out);
    } else if (/\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function codeOf(file: string): string {
  return withoutComments(readFileSync(file, "utf8"));
}

/** Pliki produkcyjne, które WOŁAJĄ zapytanie o prelegentów - liczone z drzewa. */
function speakerQueryConsumers(): string[] {
  return walk(SCAN_ROOT, [])
    .filter((file) => /\bspeakersQueryOptions\s*\(/.test(codeOf(file)))
    .sort();
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Fakty, które dana powierzchnia NAPRAWDĘ wypisała dla podanego wiersza. */
async function factsRendered(surface: Surface, row: Record<string, unknown>): Promise<FactName[]> {
  h.rows = [row];
  const { container } = render(surface.render(), { wrapper });
  // Czekamy na POZYCJĘ LISTY, a nie na konkretny fakt: gdyby warunkiem było
  // nazwisko, zniknięcie nazwiska dawałoby timeout zamiast nazwanej różnicy.
  await waitFor(() => expect(container.querySelectorAll("li")).toHaveLength(1));
  const text = container.textContent ?? "";
  const found = ALL_FACTS.filter((fact) => text.includes(PERSON_FACTS[fact]));
  cleanup();
  return found;
}

async function factsBySurface(): Promise<Map<string, FactName[]>> {
  const out = new Map<string, FactName[]>();
  for (const surface of COVERED_SURFACES) {
    out.set(surface.label, await factsRendered(surface, speakerRow()));
  }
  return out;
}

afterEach(() => {
  cleanup();
  h.rows = [];
});

describe("prelegenci wydarzenia: dwie powierzchnie, JEDEN zestaw faktów", () => {
  it("żaden FAKT o osobie nie stoi na jednej powierzchni bez drugiej", async () => {
    const bySurface = await factsBySurface();

    // Komunikat niesie fakt I powierzchnie, bo autor zmiany czyta go zamiast
    // tego pliku: „is_expert: MA [siatka], NIE MA [zapowiedź]”.
    const asymmetric: string[] = [];
    for (const fact of ALL_FACTS) {
      const entries = [...bySurface.entries()];
      const has = entries.filter(([, facts]) => facts.includes(fact)).map(([label]) => label);
      const lacks = entries.filter(([, facts]) => !facts.includes(fact)).map(([label]) => label);
      if (has.length === 0 || lacks.length === 0) continue;
      asymmetric.push(
        `${fact}: MA ${JSON.stringify(has)}, NIE MA ${JSON.stringify(lacks)}` +
          " - to fakt o osobie, nie decyzja o układzie",
      );
    }
    expect(asymmetric).toEqual([]);
  });

  it("parytetu NIE WOLNO osiągnąć usunięciem faktu z obu powierzchni", async () => {
    const bySurface = await factsBySurface();
    const missing = [...bySurface.entries()].flatMap(([label, facts]) =>
      ALL_FACTS.filter((fact) => !facts.includes(fact)).map(
        (fact) => `${label}: nie wypisuje ${fact} - wiersz RPC ma tę kolumnę wypełnioną`,
      ),
    );
    expect(missing).toEqual([]);
  });

  it("ROLA jedzie tą samą polityką pustki na obu powierzchniach", async () => {
    // Ręcznie pisany łańcuch `||` czytał napis z samych białych znaków jako
    // wypełniony, a kanoniczny `pickLocalized` - jako pusty. Ta sama osoba
    // miała więc pustą linię roli w jednym miejscu i stanowisko w drugim.
    const row = speakerRow({ headline_pl: "   ", headline_en: "  ", job_title: "Dyrektorka" });
    const seen = new Map<string, boolean>();
    for (const surface of COVERED_SURFACES) {
      h.rows = [row];
      const { container } = render(surface.render(), { wrapper });
      await waitFor(() => expect(container.querySelectorAll("li")).toHaveLength(1));
      seen.set(surface.label, (container.textContent ?? "").includes("Dyrektorka"));
      cleanup();
    }
    expect([...seen.entries()].filter(([, has]) => !has).map(([label]) => label)).toEqual([]);
  });
});

describe("fakt eksperta ma JEDEN rysunek", () => {
  it("ikonę tarczy rysuje WYŁĄCZNIE wspólna plakietka", () => {
    // Dopóki `ShieldCheck` żyje w jednym pliku katalogu prelegentów, drugi
    // rysunek tego samego faktu nie ma jak powstać po cichu - a rozjazd wymaga
    // USUNIĘCIA plakietki z powierzchni, co widzą asercje zachowania wyżej.
    //
    // GRANICA JEST KATALOGIEM I TO JEST ŚWIADOME. Poza `src/components/events/`
    // ta ikona znaczy w tym repozytorium coś innego (uprawnienia, zgody,
    // dostarczalność) i inwariant repo-wide byłby fałszem. Znany rysunek poza
    // granicą to `widget-view/SpeakersWidget.tsx` - widget redakcyjny z własnym
    // językiem wizualnym, opisany w `CONSUMER_EXCEPTIONS`.
    const rogue = walk(EVENTS_DIR, [])
      .filter((file) => file !== BADGE_FILE && /\bShieldCheck\b/.test(codeOf(file)))
      .sort();
    expect(rogue).toEqual([]);
  });

  it("plakietka nadal stoi tam, gdzie bramka jej szuka", () => {
    // Bez tego poprzednia asercja przechodziłaby po USUNIĘCIU plakietki: zero
    // plików z ikoną to też „żaden poza plakietką”.
    expect(/\bShieldCheck\b/.test(codeOf(BADGE_FILE))).toBe(true);
  });
});

describe("rodzina powierzchni jest LICZONA z drzewa, nie wypisana", () => {
  it("każdy konsument zapytania jest albo POKRYTY, albo ma jawny powód", () => {
    const consumers = speakerQueryConsumers();
    // Zero znaczy, że regexp przestał cokolwiek łapać i bramka mierzy pustkę.
    expect(consumers.length).toBeGreaterThan(0);

    const covered = new Set(COVERED_SURFACES.map((surface) => surface.file));
    const unaccounted = consumers.filter(
      (file) => !covered.has(file) && CONSUMER_EXCEPTIONS[file] === undefined,
    );
    expect(unaccounted).toEqual([]);
  });

  it("każda POKRYTA powierzchnia nadal woła to zapytanie z tej ścieżki", () => {
    // Przeniesienie pliku albo odcięcie go od zapytania musi zaczerwienić się
    // TUTAJ, a nie zniknąć w ciszy razem z dowodem zachowania.
    const consumers = new Set(speakerQueryConsumers());
    const gone = COVERED_SURFACES.map((surface) => surface.file).filter(
      (file) => !consumers.has(file),
    );
    expect(gone).toEqual([]);
  });

  it("nie trzyma wyjątku na plik, który tego zapytania już nie woła", () => {
    const consumers = new Set(speakerQueryConsumers());
    const stale = Object.keys(CONSUMER_EXCEPTIONS).filter((file) => !consumers.has(file));
    expect(stale).toEqual([]);
  });

  it("KANAREK: ślad faktu eksperta jest prawdziwym kluczem w obu słownikach", () => {
    // Bez tego zmiana nazwy klucza zostawiłaby bramkę dopasowującą martwy napis:
    // zielona i ślepa naraz.
    const resolve = (tree: unknown): unknown =>
      EXPERT_FACT_KEY.split(".").reduce<unknown>(
        (node, part) =>
          node !== null && typeof node === "object"
            ? (node as Record<string, unknown>)[part]
            : undefined,
        tree,
      );
    expect(typeof resolve(eventFrontPl)).toBe("string");
    expect(typeof resolve(eventFrontEn)).toBe("string");
  });
});
