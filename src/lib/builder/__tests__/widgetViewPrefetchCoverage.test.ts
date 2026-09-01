// SPIS POKRYCIA PREFETCHU SSR, KTÓRY SIĘ NIE STARZEJE.
//
// PO CO OSOBNY PLIK (a nie kolejny opis w `sectionPrefetch.test.ts`).
// `sectionPrefetch.test.ts` sprawdza SEMANTYKĘ rejestru: dla podanego widgetu
// grzejemy dokładnie ten klucz, który czyta widok. Ten plik ma rolę INNĄ i
// odwrotnie skierowaną: nie pyta „czy ta gałąź jest poprawna", ale „czy jakiś
// widok czyta dane BEZ gałęzi". Wejściem nie jest lista typów wpisana przez
// człowieka, a zawartość katalogu `components/builder/organisms/widget-view/`
// czytana z dysku. To jedyny sposób, żeby zdanie „ile typów jeszcze brakuje"
// przestało być liczbą w dokumencie i stało się liczbą Z KODU: nowy widok
// z `useQuery` NIE PRZEJDZIE tej bramki, dopóki ktoś go nie zarejestruje albo
// nie wykluczy Z POWODEM.
//
// KLASA DEFEKTU, KTÓRĄ TO PILNUJE. Brak gałęzi w `widgetQueryOptionsList`
// wyłącza NARAZ dwie rzeczy i nie generuje ani jednego komunikatu błędu:
//   * prefetch SSR (`prefetchWidgets` iteruje wyłącznie po tym rejestrze) -
//     widget wychodzi z serwera w stanie `isLoading`/pustym,
//   * bramkę strumieniowania - `shouldStreamSection` wymaga NIEPUSTEJ listy
//     zapytań sekcji, więc sekcja z samym takim widgetem liczy się jako
//     statyczna i `ServerSectionGate` nie ma na co czekać.
//
// CO TA BRAMKA MIERZY, A CZEGO NIE - GRANICA JEST JAWNA.
// Mierzy: BEZPOŚREDNIE `useQuery(` / `useSuspenseQuery(` w plikach tego
// katalogu. Nie mierzy: widgetów, których odczyt danych siedzi w komponencie
// POZA katalogiem (np. typ `menu` renderuje `components/menu/SiteMenu.tsx`,
// który woła `useQuery(menuWithItemsQueryOptions(...))`). Takie przypadki
// wymienia jawnie {@link EXTERNAL_READERS} i one też są tu sprawdzane - bez
// tego spis byłby prawdziwy tylko w granicach jednego katalogu, a udawałby
// pełny.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { WidgetContent, WidgetNode } from "@/lib/builder/types";
import { widgetCacheTargets, widgetQueryOptionsList } from "@/lib/builder/prefetch";

const WIDGET_VIEW = resolve(process.cwd(), "src/components/builder/organisms/widget-view");

/** Odczyt danych = bezpośrednie wywołanie hooka zapytania w pliku widoku. */
const READS_DATA = /\buse(?:Suspense)?Query\s*\(/;

/** Wszystkie pliki źródłowe katalogu (bez testów i bez podkatalogu `__tests__`). */
function viewFiles(dir: string = WIDGET_VIEW, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      viewFiles(join(dir, entry.name), out);
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (/\.(test|spec)\.tsx?$/.test(entry.name)) continue;
    out.push(entry.name);
  }
  return out;
}

function dataReadingFiles(): string[] {
  return viewFiles()
    .filter((name) => READS_DATA.test(readFileSync(join(WIDGET_VIEW, name), "utf8")))
    .sort();
}

function makeWidget(type: WidgetNode["type"], content: WidgetContent): WidgetNode {
  return {
    kind: "widget",
    id: `w-${type}`,
    type,
    content,
    style: {},
    advanced: {},
  } as WidgetNode;
}

/**
 * Widok czytający dane -> typy widgetów, które MAJĄ gałąź w rejestrze, wraz
 * z minimalną treścią, jaka tę gałąź uzbraja (gałęzie bramkowane na źródle albo
 * na skonfigurowanym id nie mają zapytania dla treści pustej - i słusznie).
 */
const REGISTERED: ReadonlyArray<{
  file: string;
  types: ReadonlyArray<{ type: WidgetNode["type"]; content: WidgetContent }>;
}> = [
  { file: "CategoriesView.tsx", types: [{ type: "categories", content: {} }] },
  { file: "TagsView.tsx", types: [{ type: "tags", content: {} }] },
  {
    file: "ClubWidgets.tsx",
    types: [
      { type: "club-card", content: { clubSlug: "klub-energetyczny" } },
      { type: "club-threads", content: {} },
    ],
  },
  {
    file: "EventCountdownCardView.tsx",
    types: [{ type: "event-countdown-card", content: { mode: "event", eventId: "ev-1" } }],
  },
  {
    file: "EventCountdownView.tsx",
    types: [{ type: "event-countdown", content: { mode: "event", eventId: "ev-1" } }],
  },
  {
    file: "EventScheduleView.tsx",
    types: [
      {
        type: "event-schedule",
        content: { days: [{ id: "d1", sessions: [{ id: "s1", speakers: [{ userId: "u1" }] }] }] },
      },
    ],
  },
  { file: "EventsListView.tsx", types: [{ type: "event-list", content: {} }] },
  { file: "NewsTickerView.tsx", types: [{ type: "news-ticker", content: {} }] },
  { file: "TrendingNowView.tsx", types: [{ type: "trending-now", content: {} }] },
  { file: "PodcastLatestView.tsx", types: [{ type: "podcast-latest", content: {} }] },
  {
    file: "PostListView.tsx",
    types: [
      { type: "post-list", content: {} },
      { type: "carousel", content: {} },
    ],
  },
  { file: "PostsSliderWidget.tsx", types: [{ type: "slider", content: { items: [] } }] },
  { file: "PricingPlansView.tsx", types: [{ type: "pricing", content: { source: "plans" } }] },
  { file: "RatedListView.tsx", types: [{ type: "rated-list", content: { source: "dynamic" } }] },
  { file: "SpeakersWidget.tsx", types: [{ type: "speakers", content: { source: "directory" } }] },
  { file: "WebStoriesCarouselView.tsx", types: [{ type: "web-stories-carousel", content: {} }] },
  {
    file: "WorldMapWidget.tsx",
    types: [
      {
        type: "world-map",
        content: { source: "experts", connections: [{ startUserId: "u1", endUserId: "u2" }] },
      },
    ],
  },
];

/**
 * Widoki czytające dane, które CELOWO nie mają gałęzi prefetchu SSR.
 * Jeden wpis = jeden powód. „Nie zdążyłem" nie jest powodem: jeśli decyzja
 * należy do człowieka, powód musi to nazwać i wyjaśnić dlaczego.
 */
const EXCLUDED: ReadonlyArray<{ file: string; reason: string }> = [
  {
    file: "AccountMenuWidget.tsx",
    // Widget PERSONALIZOWANY: `useAuth()` + `useHeaderProfile(user?.id)` -
    // sesję rozwiązuje przeglądarkowy klient Supabase, więc SSR widzi zawsze
    // `null`. Anonimowa rozgrzewka wpisałaby do cache widok wylogowanego
    // i podałaby go zalogowanemu czytelnikowi. Dodatkowo `usePagesIndex` jest
    // bramkowane na `hasPageItems` (menu z pozycjami typu „strona"), więc
    // rozgrzewka na slepo płaciłaby round-trip za większość dokumentów.
    reason:
      "personalizowany (sesja + profil czytelnika) - anonimowa rozgrzewka SSR zatruwałaby cache widokiem wylogowanego",
  },
  {
    file: "PurchaseConfirmationView.tsx",
    // `billingKeys.myStripeSubscription(uid, env)` i lista zamówień czytają
    // dane KONKRETNEGO konta przez `enabled: !inBuilder && !!session`. Klucz
    // niesie `uid`, którego serwer nie zna (SSR nie ma sesji), a wpis pod
    // `uid === null`/anon byłby cudzą subskrypcją w cache czytelnika.
    reason:
      "personalizowany (subskrypcja i zamówienia zalogowanego) - klucz niesie uid, którego SSR nie zna",
  },
  {
    file: "TailoredMustReadsView.tsx",
    // Uzasadnienie pełne (trzy niezależne powody) stoi w
    // `sectionPrefetch.test.ts`, opis „ogon punktu 4 - typy CELOWO bez gałęzi",
    // razem z asercją twierdzącą, że rejestr zwraca dla tego typu pustą listę.
    reason:
      "personalizowany: klucz gościa `[recommended-posts,anon,N]` jest po obu stronach identyczny, więc rozgrzewka anonimowa nadpisałaby personalizację na cały staleTime - patrz sectionPrefetch.test.ts",
  },
  {
    file: "DynamicTagWidgets.tsx",
    // `post-meta` czyta licznik odsłon: `postViewCountQueryOptions(ctx?.id)`,
    // gdzie `ctx` to KONTEKST BIEŻĄCEGO WPISU z trasy, nie treść widgetu.
    // `widgetQueryOptionsList(widget, lang)` dostaje wyłącznie węzeł widgetu,
    // więc id wpisu jest dla rejestru niedostępne - to ograniczenie kształtu
    // rejestru, nie zapomniana gałąź. Dodatkowo zapytanie jest bramkowane na
    // `showViews` i pomijane, gdy kontekst już niesie licznik.
    reason:
      "klucz zależy od kontekstu trasy (id bieżącego wpisu), nie od treści widgetu - statyczny rejestr nie ma jak go wyrazić",
  },
  {
    file: "MeetingBookingView.tsx",
    // `meetingSlotsQueryOptions(c, user?.id ?? null)` - wiersz RPC niesie
    // `booked_by_me` / `is_mine`, czyli flagi ZALEŻNE OD ZALOGOWANEGO. Nagłówek
    // `lib/builder/meetingsQuery.ts` mówi to wprost i wprost odmawia ramienia
    // prefetchu SSR: anonimowy prefetch zdehydrowany do klienta kłamałby
    // zalogowanemu.
    reason:
      "dane zależne od zalogowanego (booked_by_me / is_mine) - moduł meetingsQuery.ts jawnie odmawia ramienia SSR, żeby prefetch nie kłamał zalogowanemu",
  },
  {
    file: "mediaWidgets.tsx",
    // JEST pokryty, tylko nie tędy: `useQuery(siteSettingsQueryOptions)` grzeje
    // loader KORZENIA (`routes/__root.tsx` - `ensureQueryData(siteSettingsQueryOptions)`
    // w tej samej paczce co designTokens i globalColors), więc wpis jest ciepły
    // na każdej trasie, zanim widget się wyrenderuje. Gałąź w rejestrze
    // widgetów byłaby więc drugim, zbędnym rozgrzaniem TEGO SAMEGO klucza -
    // a przy tym kazałaby `shouldStreamSection` uznać sekcję z samym logo za
    // sekcję z danymi i czekać na nią przy strumieniowaniu.
    reason:
      "pokryty gdzie indziej: siteSettingsQueryOptions grzeje loader korzenia (__root.tsx), więc wpis jest ciepły na każdej trasie - gałąź per-widget byłaby duplikatem",
  },
];

/**
 * Widgety, których odczyt danych siedzi POZA tym katalogiem, ale które gałąź
 * w rejestrze mają. Bez tej listy spis byłby prawdziwy tylko wewnątrz katalogu.
 */
const EXTERNAL_READERS: ReadonlyArray<{
  type: WidgetNode["type"];
  content: WidgetContent;
  reader: string;
}> = [
  {
    type: "menu",
    content: { menu_key: "main" },
    reader: "src/components/menu/SiteMenu.tsx",
  },
];

describe("spis pokrycia prefetchu SSR dla widoków widgetów", () => {
  const files = dataReadingFiles();

  it("każdy widok czytający dane jest ALBO w rejestrze, ALBO wykluczony z powodem", () => {
    const registered = new Set(REGISTERED.map((r) => r.file));
    const excluded = new Set(EXCLUDED.map((e) => e.file));

    const unclassified = files.filter((f) => !registered.has(f) && !excluded.has(f));
    expect(
      unclassified,
      "Widok czyta dane (`useQuery`/`useSuspenseQuery`), a spis go nie zna.\n" +
        "Brak gałęzi w `widgetQueryOptionsList` = brak prefetchu SSR ORAZ sekcja\n" +
        "klasyfikowana jako statyczna (`shouldStreamSection` wymaga niepustej listy).\n" +
        "Dopisz plik do REGISTERED (razem z gałęzią w prefetch.ts) albo do EXCLUDED\n" +
        "z POWODEM - milczenie nie jest opcją.",
    ).toEqual([]);

    const both = files.filter((f) => registered.has(f) && excluded.has(f));
    expect(both, "Plik jest jednocześnie zarejestrowany i wykluczony.").toEqual([]);
  });

  it("spis nie wymienia plików, które danych już nie czytają (albo zniknęły)", () => {
    const present = new Set(files);
    const stale = [...REGISTERED.map((r) => r.file), ...EXCLUDED.map((e) => e.file)]
      .filter((f) => !present.has(f))
      .sort();
    expect(
      stale,
      "Wpis w spisie wskazuje plik, który nie istnieje albo przestał czytać dane.\n" +
        "Usuń wpis - martwy wiersz spisu sugeruje pokrycie, którego nie ma.",
    ).toEqual([]);
  });

  it("każdy wpis rejestru faktycznie produkuje zapytanie ORAZ jego odbicie w cache targets", () => {
    const broken: string[] = [];
    for (const entry of REGISTERED) {
      for (const { type, content } of entry.types) {
        const widget = makeWidget(type, content);
        const queries = widgetQueryOptionsList(widget, "pl");
        const targets = widgetCacheTargets(widget, "pl");
        if (queries.length === 0) broken.push(`${entry.file}: ${type} -> pusta lista zapytań`);
        // Brak odbicia w `widgetCacheTargets` po cichu wyłącza klientowy
        // prefetch przy przewijaniu: bramka SWR `useSectionPreload.isSectionFresh`
        // na liście DŁUGOŚCI ZERO zwraca "świeże" dla całej sekcji.
        if (targets.length === 0) broken.push(`${entry.file}: ${type} -> brak cache targets`);
        if (targets.length !== queries.length) {
          broken.push(
            `${entry.file}: ${type} -> ${queries.length} zapytań, ale ${targets.length} cache targets`,
          );
        }
      }
    }
    expect(broken.sort()).toEqual([]);
  });

  it("każdy wykluczony widok naprawdę nie ma gałęzi (wykluczenie nie jest tylko komentarzem)", () => {
    // Typy renderowane przez wykluczone pliki - jeden na plik, bo tylko te
    // odczytują dane. `mediaWidgets.tsx` renderuje `image` (logo w chrome).
    const EXCLUDED_TYPES: ReadonlyArray<{ file: string; type: WidgetNode["type"] }> = [
      { file: "AccountMenuWidget.tsx", type: "account-link" },
      { file: "PurchaseConfirmationView.tsx", type: "purchase-confirmation" },
      { file: "TailoredMustReadsView.tsx", type: "tailored-must-reads" },
      { file: "DynamicTagWidgets.tsx", type: "post-meta" },
      { file: "MeetingBookingView.tsx", type: "meeting-booking" },
      { file: "mediaWidgets.tsx", type: "image" },
    ];
    expect(EXCLUDED_TYPES.map((e) => e.file).sort()).toEqual(EXCLUDED.map((e) => e.file).sort());

    const leaked: string[] = [];
    for (const { file, type } of EXCLUDED_TYPES) {
      const widget = makeWidget(type, { limit: 3, mode: "event", source: "dynamic" });
      if (widgetQueryOptionsList(widget, "pl").length > 0) leaked.push(`${file}: ${type}`);
      if (widgetCacheTargets(widget, "pl").length > 0) leaked.push(`${file}: ${type} (targets)`);
    }
    expect(
      leaked.sort(),
      "Typ jest na liście wykluczeń, a rejestr jednak grzeje mu zapytanie.\n" +
        "Albo wykluczenie jest nieaktualne, albo gałąź powstała przez pomyłkę.",
    ).toEqual([]);
  });

  it("każde wykluczenie ma jeden konkretny powód, nie zaślepkę", () => {
    const bad: string[] = [];
    for (const entry of EXCLUDED) {
      const reason = entry.reason.trim();
      if (reason.length < 40) bad.push(`${entry.file}: powód za krótki, by cokolwiek znaczyć`);
      if (/nie zd[ąa][żz]|TODO|na potem|p[óo][źz]niej/i.test(reason)) {
        bad.push(`${entry.file}: "nie zdążyłem" nie jest powodem`);
      }
    }
    expect(bad.sort()).toEqual([]);
  });

  it("widgety czytające dane spoza katalogu też mają gałąź", () => {
    for (const entry of EXTERNAL_READERS) {
      const widget = makeWidget(entry.type, entry.content);
      expect(widgetQueryOptionsList(widget, "pl").length, `${entry.type} (${entry.reader})`).toBe(
        1,
      );
      expect(widgetCacheTargets(widget, "pl").length, `${entry.type} (${entry.reader})`).toBe(1);
    }
  });

  it("podaje liczby: ile widoków czyta dane, ile w rejestrze, ile wykluczonych", () => {
    const inRegistry = REGISTERED.length;
    const excluded = EXCLUDED.length;
    const total = files.length;
    // Ta linia jest CELEM tej bramki: odpowiedź na „ile jeszcze brakuje" pada
    // z kodu przy każdym przebiegu, a nie z akapitu w dokumencie.
    console.info(
      `[spis prefetchu SSR] widoków czytających dane: ${total}; ` +
        `w rejestrze widgetQueryOptionsList: ${inRegistry}; ` +
        `wykluczonych z powodem: ${excluded}; ` +
        `nierozstrzygniętych: ${total - inRegistry - excluded}; ` +
        `typów widgetów pokrytych przez te pliki: ${REGISTERED.reduce((n, r) => n + r.types.length, 0)}; ` +
        `czytających dane spoza katalogu: ${EXTERNAL_READERS.length}`,
    );
    // Suma MUSI się domykać - to jest ta asercja, która nie pozwala liczbie
    // się zestarzeć: dodanie widoku z `useQuery` bez wpisu psuje ją natychmiast.
    expect(inRegistry + excluded).toBe(total);
  });
});
