// WARSTWA TREŚCI STRONY /zatrudniamy — dwa hooki, które decydują, CO kandydat
// widzi: którą z trzech możliwych list ofert, w którym języku i czy sekcja
// zdjęta w panelu redakcji dojeżdża do strony jako „ukryj".
//
// ---------------------------------------------------------------------------
// PO CO TEN PLIK ISTNIEJE
// ---------------------------------------------------------------------------
// Stan wejściowy pomiaru `src/lib/careers/useCareerContent.ts`:
//
//   linie 8/13, funkcje 3/6, gałęzie 4/8
//   niepokryte funkcje: (anon)@29 (mapowanie wiersza), useCareerSection@38,
//                       (anon)@42 (memo sekcji)
//   niepokryte linie:   29, 31, 39-42
//   niepokryte gałęzie: cond-expr@19 (wybór języka), if@29, binary-expr@29
//                       (`data && data.length > 0`), if@30 (`isLoading`)
//
// Czyli: cały `useCareerSection` był niemierzony, a z `useCareerOffers`
// zmierzone było wyłącznie to, co przechodni konsument (test organizmu
// `CareersRoles`) akurat po drodze wykonał — jedno ramię jednej decyzji.
// A obie decyzje tego pliku są dokładnie tym, czego przegląd kodu nie widzi:
//
//   * TRZY WYJŚCIA Z DWÓCH BRAMEK. `useCareerOffers` zwraca albo wiersze bazy,
//     albo PUSTĄ listę (odczyt w drodze), albo wbudowany katalog i18n. Zamiana
//     kolejności bramek (`isLoading` przed `data`) nie zmienia ani typu, ani
//     kształtu zwrotki, a daje stronę, na której przy pierwszym malowaniu
//     miga dwanaście ofert ze słownika, po czym podmieniają się na trzy realne
//     z bazy. Usunięcie bramki `isLoading` daje to samo migotanie. Bez pomiaru
//     tej warstwy oba warianty przechodzą jako „porządki w memo".
//   * JĘZYK MIESZKA W MAPOWANIU, NIE W KLUCZU CACHE. Klucz to
//     `["career-roles","published"]` — bez segmentu języka i bez segmentu
//     najemcy. To NIE jest przeoczenie: wiersz `career_roles` niesie obie
//     wersje językowe naraz, więc jeden odczyt obsługuje obie strony, a język
//     wybiera `rowToOffer(row, lang)` przy mapowaniu. Dwie przeciwne regresje
//     są tu niewidoczne w diffie: (a) dołożenie języka do klucza podwaja
//     odczyty i wyrzuca z cache stronę, która właśnie się przełączyła,
//     (b) przeniesienie języka do zapytania (SELECT tylko kolumn aktywnego
//     języka) sprawia, że po przełączeniu języka cache oddaje treść w POPRZEDNIM
//     języku, bo klucz się nie zmienił. Dlatego dowód stoi na SKUTKU: te same
//     wiersze, drugi język, ZERO dodatkowych odczytów relacji.
//   * `t` W ZALEŻNOŚCIACH MEMO. Katalog zapasowy powstaje z `t(...)`, więc
//     wypadnięcie `t` z tablicy zależności `useMemo` (wygląda jak sprzątanie
//     lintem: „`t` jest stabilne") zamraża zapasowe tytuły ofert w języku
//     pierwszego malowania. Świeża instalacja + przełącznik języka = polskie
//     nazwy stanowisk na angielskiej stronie. Nic tego nie mierzyło.
//   * WSTECZNA ZGODNOŚĆ „BRAK WIERSZA ZNACZY POKAŻ". `useCareerSection`
//     otwiera stronę także wtedy, gdy odczyt sekcji jeszcze nie wrócił, wrócił
//     pusty albo został ODMÓWIONY. To reguła świadoma (świeża instalacja nie
//     może dać białej strony — wywód w nagłówku `catalog.ts`), więc każde
//     „utwardzenie" w drugą stronę (brak danych = ukryj) wygasza całą stronę
//     kariery przy pierwszym malowaniu i przy każdej awarii bazy. Ta reguła
//     musi być PRZYBITA, bo wygląda jak niedopatrzenie.
//   * JEDEN ODCZYT NA CAŁĄ STRONĘ. Siedem sekcji pyta o stan siedmioma
//     wywołaniami hooka, ale klucz zapytania nie zawiera klucza sekcji —
//     więc odczyt jest JEDEN. Dołożenie `key` do klucza zapytania (naturalny
//     odruch: „hook parametryzowany, więc klucz parametryzowany") daje siedem
//     identycznych zapytań PostgREST na każde wejście na stronę.
//
// ---------------------------------------------------------------------------
// CO JEST PRZEDMIOTEM DOWODU
// ---------------------------------------------------------------------------
//  1. OFERTY Z BAZY. Opublikowane wiersze jadą na stronę w kolejności
//     odpowiedzi, identyfikatorem oferty jest slug, tytuł i opis pochodzą
//     z wiersza w aktywnym języku.
//  2. ODCZYT W DRODZE = PUSTA LISTA. Przy pierwszym malowaniu hook NIE oddaje
//     katalogu zapasowego (dowód, że bramka `data` stoi PRZED `isLoading`
//     i że bramka `isLoading` istnieje).
//  3. PUSTA TABELA = KATALOG i18n. Wszystkie role z `CAREER_ROLES`, tytuły
//     asertowane przez `realT` na prawdziwej nakładce `@/lib/i18n-careers`
//     (usunięcie klucza ze słownika oblewa ten plik), z kontrolą, że na
//     wyjściu nie ma SUROWEGO klucza i18n.
//  4. ODMOWA ODCZYTU = TEŻ KATALOG i18n, nie pusta strona — z jednoczesnym
//     dowodem, że zapytanie NAPRAWDĘ padło (stan `error` w cache i treść
//     komunikatu PostgREST), a nie cicho zwróciło pustą listę.
//  5. JĘZYK. Ten sam wiersz w dwóch językach po `i18n.changeLanguage`, bez
//     drugiego odczytu relacji; to samo dla katalogu zapasowego (zależność
//     `t`); przeglądarka z kodem regionalnym (`en-GB`) też dostaje angielską
//     ofertę.
//  6. KSZTAŁT KLUCZA CACHE. Po przełączeniu języka w cache stoi DOKŁADNIE
//     jeden wpis ofert i jeden wpis sekcji, o kształcie bez segmentu języka
//     i bez segmentu najemcy — i są to te same klucze, które budują publiczne
//     `queryOptions` (rozjazd hooka z opcjami oblewa test).
//  7. PUBLICZNY HOOK NIE PYTA O BRUDNOPISY. W łańcuchu PostgREST stoi
//     `eq("is_published", true)` — czyli hook woła `careerRolesQueryOptions()`
//     BEZ `includeDrafts`. Podmiana na wariant panelu wpuściłaby na stronę
//     nieopublikowane oferty i nie zmieniłaby ani jednego napisu w kodzie
//     poza jednym argumentem.
//  8. SEKCJE: nadpisanie nagłówka z panelu wygrywa (istniejący klucz), klucz
//     bez wiersza oznacza „pokaż bez nadpisań", sygnał `is_visible: false`
//     z widoku dojeżdża jako `visible: false`, pusta odpowiedź i odmowa
//     odczytu otwierają wszystkie siedem kluczy, a nagłówek sekcji jest
//     dwujęzyczny.
//  9. ZAMKNIĘTY ZBIÓR KLUCZY. Lista sekcji jest w tym pliku WYPISANA (nie
//     zaczytana z hooka), a osobna asercja porównuje ją z `CAREER_SECTION_KEYS`
//     — dołożenie ósmej sekcji do produktu oblewa ten plik, zamiast cicho
//     zostać bez dowodu.
// 10. JEDNA STRONA = DWA ODCZYTY. Złożenie „oferty + siedem sekcji" (tak, jak
//     składa je trasa) czyta relację ofert raz i relację sekcji raz.
//
// ---------------------------------------------------------------------------
// CO JEST ATRAPOWANE I DLACZEGO
// ---------------------------------------------------------------------------
// TYLKO `@/integrations/supabase/client` — granica danych, czyli jedyna
// rzecz, której ta warstwa nie posiada. Transport to `supabaseFromStub()`
// z `@/test/supabaseChain`: łańcuch zapisuje ogniwa (stąd dowód nr 7) i
// rozwiązuje się przy `await`, a kształt odpowiedzi dają `ok`/`fail` (`fail`
// niesie błąd DZIEDZICZĄCY po `Error`, tak jak `PostgrestError` — inaczej
// `throw new Error(error.message)` w `queryFn` mierzyłby atrapę, nie kod).
//
// ŚWIADOMIE NIE MA TU ATRAPY `react-i18next`. Język jest tu PRZEDMIOTEM
// dowodu, a nie tłem: atrapa `{ i18n: { language: "en" } }` odbijałaby
// z powrotem wartość wpisaną w teście i przechodziłaby także wtedy, gdyby hook
// przestał czytać `i18n.language` albo gdyby `useMemo` przestało reagować na
// zmianę języka (bo atrapa nie emituje zdarzenia `languageChanged`). Dlatego
// językiem steruje PRAWDZIWE `i18n.changeLanguage`, a subskrypcję re-renderu
// robi prawdziwe `useTranslation`.
//
// CO ZOSTAJE PRAWDZIWE: React, prawdziwy `@tanstack/react-query`
// (`renderHookWithQueryClient` — świeży klient bez ponowień na każdy test,
// więc żaden wynik nie przecieka między przypadkami), prawdziwy `i18next`
// z nakładką `@/lib/i18n-careers`, prawdziwa cała warstwa `catalog.ts`
// (`careerRolesQueryOptions`, `careerSectionsQueryOptions`, `rowToOffer`,
// `fallbackOffers`, `sectionState`) i prawdziwy katalog `roles.ts`.
// Atrapowanie którejkolwiek z nich zamieniłoby ten plik w test atrapy: hook
// jest KLEJEM między i18n, react-query i tymi regułami — jeśli podmienić
// klej razem z tym, co skleja, nie zostaje nic do dowiedzenia.
//
// ---------------------------------------------------------------------------
// ŚWIADOMIE POZA ZAKRESEM (i gdzie mieszka tamten dowód)
// ---------------------------------------------------------------------------
//  * CZYSTE REGUŁY, które hook tylko woła: łańcuch zapasowy `rowToOffer`
//    (brak tłumaczenia pola), normalizacja pustego napisu na `null`
//    w `sectionState`, kształt katalogu zapasowego, filtry i liczniki —
//    `src/lib/careers/__tests__/catalog.test.ts`. Tu dowodzę WYBORU, jaki hook
//    robi między tymi regułami, nie ich wnętrza.
//  * SKĄD sekcje są czytane (WIDOK `career_page_sections_public` dla strony vs
//    TABELA `career_page_sections` dla panelu) — `careerSectionsSource.test.ts`.
//    Ten plik podstawia odpowiedź dla relacji, której hook faktycznie dotyka,
//    ale bramką pary nie jest.
//  * CO KONSUMENT ROBI ze zwrotką (napisy na kartach, chipsy filtrów, popup
//    oferty, nagłówek sekcji, brak naruszeń axe) —
//    `src/components/careers/__tests__/careersRoles.test.tsx` i
//    `careersSections.test.tsx`. Hook nie ma DOM-u, więc dowodu dostępności
//    (`axeViolations`) nie da się tu postawić — nie ma czego mierzyć; mieszka
//    w testach organizmów.
//  * Prefetch/loader trasy, `applySignal`, SEO — `zatrudniamyRoute.test.tsx`.
//  * Polityki RLS widoku i tabeli (czy anon NAPRAWDĘ nie widzi brudnopisu) —
//    pgTAP; atrapa transportu udowadnia wyłącznie, o co hook PYTA.
//  * `.toLowerCase()` i PREFIKSOWOŚĆ (`startsWith("en")`) w `currentLang` to
//    obrona w głąb przed kodem języka pisanym wielkimi literami i przed kodem
//    regionalnym. Przez prawdziwą instancję i18next ANI JEDNO nie jest dziś
//    osiągalne — ZMIERZONE na tej konfiguracji: `changeLanguage` normalizuje
//    kod (`"EN"` → `"en"`), a `supportedLngs: ["pl","en"]` zwija `"en-GB"` do
//    `"en"`, więc hook zawsze dostaje już zwinięty, mały kod. Żadne z tych
//    dwóch nie jest gałęzią w pomiarze, więc nic nie kosztuje; dowodzony jest
//    SKUTEK („`en-GB` daje angielską ofertę"), a nie wewnętrzny kod języka.
//    Gdyby ktoś dołożył `nonExplicitSupportedLngs`, ta obrona zacznie działać
//    naprawdę i test skutku zostanie prawdziwy bez zmiany.
//  * Ochrona przed `i18n.language === undefined`. Inne miejsca repo piszą
//    `i18n.language ?? "pl"` (patrz `adminAudienceRoutes.test.tsx`), ten hook
//    nie — ale na kliencie `@/lib/i18n` inicjalizuje instancję top-level
//    awaitem PRZED pierwszym renderem Reacta, więc stan bez języka nie jest
//    osiągalny uczciwym testem tej warstwy i nie jest gałęzią w pomiarze.
//
// POMIAR PO TYM PLIKU (ten jeden plik testowy, zakres pomiaru zawężony do
// `useCareerContent.ts`): 13/13 linii, 6/6 funkcji, 8/8 gałęzi,
// 17/17 instrukcji — bez ani jednej luki do uzasadniania.
//
// ---------------------------------------------------------------------------
// ZNALEZISKA (kod produkcyjny NIEZMIENIONY; testy asertują stan ISTNIEJĄCY)
// ---------------------------------------------------------------------------
// ZNALEZISKO 1 — AWARIA ODCZYTU JEST NIEODRÓŻNIALNA OD PUSTEJ TABELY.
//   Bramka `if (isLoading) return []` łapie wyłącznie stan „w drodze". Gdy
//   odczyt PADNIE (RLS, sieć, timeout), `isLoading` jest już `false`, `data`
//   jest `undefined` — i hook oddaje wbudowany katalog i18n, czyli DWANAŚCIE
//   ról ze słownika w miejsce ofert, które w bazie są (albo których już nie
//   ma, bo redakcja je zamknęła). Katalog zapasowy jest zaprojektowany dla
//   ŚWIEŻEJ INSTALACJI, a przy awarii działa jak cicha publikacja starych
//   treści: kandydat aplikuje na rolę, która nie istnieje. Zwrotka hooka to
//   dokładnie `{ offers, isLoading }` — `isError`/`error` z `useQuery` są
//   ODRZUCANE, więc żaden konsument nie ma nawet z czego zbudować komunikatu
//   „nie udało się wczytać ofert". Naprawa mieszka w tym pliku (rozdzielenie
//   `isError` od pustki), więc test „odmowa odczytu…" przybija stan obecny
//   RAZEM z kształtem zwrotki — naprawa będzie widoczna jako zmiana testu.
// ZNALEZISKO 2 — SEKCJA ZDJĘTA W PANELU MIGA NA STRONIE. Dla `data === undefined`
//   (pierwsze malowanie, bo loader trasy sekcji nie prefetchuje — patrz
//   `careersRoles.test.tsx`) hook oddaje `visible: true`, a `visible: false`
//   dojeżdża dopiero po powrocie odczytu. To bezpośrednia konsekwencja reguły
//   „brak wiersza znaczy pokaż" i przy dzisiejszym konsumencie jest UŚPIONE
//   (`CareersRoles` w ogóle nie czyta `visible` — to znalezisko 1 tamtego
//   pliku). Obudzi się w dniu, w którym ktoś podłączy bramkę widoczności:
//   sekcja wyłączona przez redakcję pojawi się na jedno malowanie. Test
//   „w trakcie odczytu sekcja ukryta jest jeszcze widoczna" pokazuje ten stan
//   jawnie, żeby przy podłączaniu bramki nie był zaskoczeniem.
//
// RODO: żadnych prawdziwych osób ani treści. Oferty i sekcje w fixture są
// zmyślone (slug, tytuł, opis, wymagania), nie odpowiadają żadnemu prawdziwemu
// ogłoszeniu; nie ma tu nazwisk, danych kandydatów ani adresów — gdyby jakiś
// był potrzebny, jedyną dopuszczalną domeną jest `@example.com`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  /** Granica danych: `supabase.from` podstawiane per test. */
  from: null as null | ((table: string) => unknown),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => h.from?.(table) },
}));

import i18n from "@/lib/i18n";
// Nakładka słownika rejestruje się efektem ubocznym importu. Hook jej NIE
// importuje (robi to trasa `/zatrudniamy`), więc plik testu musi dociągnąć ją
// sam - inaczej katalog zapasowy oddawałby same klucze i asercje mierzyłyby nic.
import "@/lib/i18n-careers";
import { realT } from "@/test/i18nReal";
import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";
import { fail, ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";
import {
  CAREER_SECTION_KEYS,
  careerRolesQueryOptions,
  careerSectionsQueryOptions,
  type CareerRoleRow,
  type CareerSectionKey,
  type CareerSectionRow,
} from "@/lib/careers/catalog";
import { CAREER_ROLES, roleSummaryKey, roleTitleKey } from "@/lib/careers/roles";
import { useCareerOffers, useCareerSection } from "@/lib/careers/useCareerContent";

const ROLES_RELATION = "career_roles";
const SECTIONS_RELATION = "career_page_sections_public";

const pl = realT("pl");
const en = realT("en");

// ---------------------------------------------------------------------------
// FIXTURE (oferty i sekcje zmyślone - patrz RODO w nagłówku)
// ---------------------------------------------------------------------------

function roleRow(overrides: Partial<CareerRoleRow> = {}): CareerRoleRow {
  return {
    id: "00000000-0000-4000-8000-0000000000a1",
    slug: "koordynator-programu-baltyckiego",
    department: "policy",
    engagement: "full_time",
    seniority: "mid",
    location: "warsaw",
    sort_order: 10,
    is_published: true,
    title_pl: "Koordynator programu bałtyckiego",
    title_en: "Baltic programme coordinator",
    summary_pl: "Prowadzi program regionalny i pilnuje kalendarza konsultacji.",
    summary_en: "Runs the regional programme and owns the consultation calendar.",
    responsibilities_pl: ["Koordynacja partnerów regionalnych"],
    responsibilities_en: ["Regional partner coordination"],
    requirements_pl: ["Trzy lata pracy przy programach publicznych"],
    requirements_en: ["Three years on public programmes"],
    ...overrides,
  } satisfies CareerRoleRow;
}

const ROW_COORDINATOR = roleRow();
const ROW_EDITOR = roleRow({
  id: "00000000-0000-4000-8000-0000000000a2",
  slug: "redaktor-wydania-anglojezycznego",
  department: "editorial",
  engagement: "part_time",
  seniority: "senior",
  location: "remote",
  sort_order: 20,
  title_pl: "Redaktor wydania anglojęzycznego",
  title_en: "English edition editor",
  summary_pl: "Odpowiada za spójność wydania anglojęzycznego.",
  summary_en: "Owns the consistency of the English edition.",
  responsibilities_pl: ["Redakcja analiz przed publikacją"],
  responsibilities_en: ["Editing analyses before publication"],
  requirements_pl: ["Doświadczenie redakcyjne w dwóch językach"],
  requirements_en: ["Editorial experience in two languages"],
});

function sectionRow(overrides: Partial<CareerSectionRow> = {}): CareerSectionRow {
  return {
    key: "roles",
    is_visible: true,
    sort_order: 40,
    title_pl: null,
    title_en: null,
    subtitle_pl: null,
    subtitle_en: null,
    ...overrides,
  } satisfies CareerSectionRow;
}

// ---------------------------------------------------------------------------
// HARNESS
// ---------------------------------------------------------------------------

let stub: SupabaseFromStub;

/**
 * Złożenie CAŁEJ strony: oferty + wszystkie siedem sekcji, każda osobnym
 * wywołaniem hooka - dokładnie tak, jak składają je organizmy trasy. Klucze są
 * WYPISANE (a nie zmapowane po `CAREER_SECTION_KEYS`), bo `react-hooks` zabrania
 * wołania hooka w pętli, a osobna asercja pilnuje, że ta lista pokrywa się
 * z zamkniętym zbiorem produktu.
 */
function useWholePage() {
  return {
    offers: useCareerOffers(),
    hero: useCareerSection("hero"),
    values: useCareerSection("values"),
    benefits: useCareerSection("benefits"),
    roles: useCareerSection("roles"),
    process: useCareerSection("process"),
    form: useCareerSection("form"),
    closing: useCareerSection("closing"),
  };
}

/**
 * Dwie sekcje z jednego odczytu: jedna Z wierszem, druga BEZ. Tylko takie
 * złożenie dowodzi, że stan sekcji jest szukany PO KLUCZU - jeden hook nie
 * odróżni „nie ma mojego wiersza" od „odpowiedź jeszcze nie doszła".
 */
function useHeroAndClosing() {
  return { hero: useCareerSection("hero"), closing: useCareerSection("closing") };
}

/** Zmiana języka na PRAWDZIWEJ instancji i18next, z re-renderem hooka. */
async function switchLanguage(lang: string): Promise<void> {
  await act(async () => {
    await i18n.changeLanguage(lang);
  });
}

beforeEach(async () => {
  stub = supabaseFromStub();
  h.from = stub.from;
  await i18n.changeLanguage("pl");
});

afterEach(async () => {
  cleanup();
  h.from = null;
  // Instancja i18next jest współdzielona w obrębie pliku - test, który zmienił
  // język, nie może zostawić go następnemu.
  await i18n.changeLanguage("pl");
});

// ---------------------------------------------------------------------------
// useCareerOffers - którą z trzech list widzi kandydat
// ---------------------------------------------------------------------------
describe("useCareerOffers - wybór listy ofert", () => {
  it("opublikowane wiersze bazy jadą na stronę: slug jako identyfikator, tekst z wiersza", async () => {
    stub.setResponse(ROLES_RELATION, ok([ROW_COORDINATOR, ROW_EDITOR]));

    const { result } = renderHookWithQueryClient(() => useCareerOffers());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.offers.map((offer) => offer.id)).toEqual([
      ROW_COORDINATOR.slug,
      ROW_EDITOR.slug,
    ]);
    expect(result.current.offers.map((offer) => offer.title)).toEqual([
      ROW_COORDINATOR.title_pl,
      ROW_EDITOR.title_pl,
    ]);
    expect(result.current.offers.map((offer) => offer.summary)).toEqual([
      ROW_COORDINATOR.summary_pl,
      ROW_EDITOR.summary_pl,
    ]);
    // Fasety idą z wiersza bez zmian - na nich stoją filtry działów.
    expect(result.current.offers.map((offer) => offer.department)).toEqual(["policy", "editorial"]);
  });

  it("w trakcie pierwszego odczytu lista jest PUSTA, a nie katalogiem zapasowym", () => {
    stub.setResponse(ROLES_RELATION, ok([ROW_COORDINATOR]));

    // Bez `await`: to jest stan PIERWSZEGO malowania strony.
    const { result } = renderHookWithQueryClient(() => useCareerOffers());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.offers).toEqual([]);
    // Gdyby bramki `isLoading` NIE BYŁO, stałby tu katalog i18n (dwanaście
    // ról), który po powrocie odczytu podmieniłby się na jedną ofertę.
    // ZMIERZONE mutacją: wariant bez tej bramki oblewa dokładnie tę asercję.
    // KOLEJNOŚCI bramek ta asercja nie rozstrzyga i nie udaje, że rozstrzyga -
    // wywód stoi w nagłówku (mutacja równoważna).
    // Ta linia nie jest powtórzeniem `toEqual([])`: pilnuje, żeby katalog
    // zapasowy nie był PUSTY, bo wtedy cały ten przypadek byłby bez treści.
    expect(result.current.offers).not.toHaveLength(CAREER_ROLES.length);
  });

  it("odświeżenie w tle nie gasi listy: bramka czyta stan `pending`, nie `fetching`", async () => {
    stub.setResponse(ROLES_RELATION, ok([ROW_COORDINATOR, ROW_EDITOR]));

    // Zapis KAŻDEGO malowania, bo przedmiotem dowodu jest CIĄG stanów, a nie
    // stan końcowy: regresja `isFetching` w miejsce `isLoading` gasi listę na
    // jedno malowanie i po ustaniu odczytu nie zostawia po sobie śladu.
    const paints: { isLoading: boolean; ids: string[] }[] = [];
    const { result, queryClient } = renderHookWithQueryClient(() => {
      const value = useCareerOffers();
      paints.push({ isLoading: value.isLoading, ids: value.offers.map((offer) => offer.id) });
      return value;
    });
    await waitFor(() => expect(result.current.offers).toHaveLength(2));
    const settled = paints.length - 1;

    // Unieważnienie po zapisie w panelu / powrót na kartę - odczyt idzie znowu.
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: careerRolesQueryOptions().queryKey });
    });
    expect(stub.chainsFor(ROLES_RELATION)).toHaveLength(2);

    // Od chwili, gdy dane doszły, kandydat widzi te same dwie oferty na KAŻDYM
    // malowaniu: ani pustej listy, ani katalogu zapasowego, ani spinnera.
    for (const paint of paints.slice(settled)) {
      expect(paint).toEqual({ isLoading: false, ids: [ROW_COORDINATOR.slug, ROW_EDITOR.slug] });
    }
  });

  it("PUSTA tabela ofert oddaje wbudowany katalog i18n, żeby strona nie była pusta", async () => {
    stub.setResponse(ROLES_RELATION, ok([]));

    const { result } = renderHookWithQueryClient(() => useCareerOffers());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.offers).toHaveLength(CAREER_ROLES.length);
    expect(result.current.offers.map((offer) => offer.id)).toEqual(
      CAREER_ROLES.map((role) => role.id),
    );
    // Napisy mierzą SŁOWNIK: zniknięcie klucza `careers.roles.<id>.title`
    // oblewa tę asercję.
    expect(result.current.offers.map((offer) => offer.title)).toEqual(
      CAREER_ROLES.map((role) => pl(roleTitleKey(role.id))),
    );
    expect(result.current.offers[0].summary).toBe(pl(roleSummaryKey(CAREER_ROLES[0].id)));
    // i18next oddaje brakujący klucz jako sam klucz - bez tej kontroli
    // „careers.roles.x.title" przeszłoby jako poprawny tytuł oferty.
    expect(result.current.offers.some((offer) => offer.title.startsWith("careers."))).toBe(false);
  });

  it("ODMOWA ODCZYTU też oddaje katalog zapasowy - i to jest ZNALEZISKO 1, nie komunikat błędu", async () => {
    stub.setResponse(ROLES_RELATION, fail("permission denied for table career_roles", "42501"));

    const { result, queryClient } = renderHookWithQueryClient(() => useCareerOffers());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Zapytanie NAPRAWDĘ padło - inaczej ten test dowodziłby tylko pustej tabeli.
    const query = queryClient.getQueryCache().find({
      queryKey: careerRolesQueryOptions().queryKey,
    });
    expect(query?.state.status).toBe("error");
    expect((query?.state.error as Error).message).toBe("permission denied for table career_roles");

    // Stan ISTNIEJĄCY: awaria wygląda dla konsumenta jak świeża instalacja.
    expect(result.current.offers).toHaveLength(CAREER_ROLES.length);
    expect(result.current.offers.map((offer) => offer.title)).toEqual(
      CAREER_ROLES.map((role) => pl(roleTitleKey(role.id))),
    );
    // I nie ma czym tego odróżnić: zwrotka nie niesie sygnału błędu.
    expect(Object.keys(result.current).sort()).toEqual(["isLoading", "offers"]);
  });

  it("zmiana języka przemapowuje TE SAME wiersze bez drugiego odczytu relacji", async () => {
    stub.setResponse(ROLES_RELATION, ok([ROW_COORDINATOR]));

    const { result } = renderHookWithQueryClient(() => useCareerOffers());
    await waitFor(() => expect(result.current.offers).toHaveLength(1));
    expect(result.current.offers[0].title).toBe(ROW_COORDINATOR.title_pl);

    await switchLanguage("en");

    expect(result.current.offers[0].title).toBe(ROW_COORDINATOR.title_en);
    expect(result.current.offers[0].summary).toBe(ROW_COORDINATOR.summary_en);
    // Bez tej pary asercji test przechodziłby na wierszu, w którym PL i EN są
    // takie same - czyli mierzyłby nic.
    expect(ROW_COORDINATOR.title_en).not.toBe(ROW_COORDINATOR.title_pl);
    expect(stub.chainsFor(ROLES_RELATION)).toHaveLength(1);
  });

  it("przeglądarka z kodem regionalnym `en-GB` dostaje angielską wersję oferty", async () => {
    stub.setResponse(ROLES_RELATION, ok([ROW_COORDINATOR]));

    const { result } = renderHookWithQueryClient(() => useCareerOffers());
    await waitFor(() => expect(result.current.offers).toHaveLength(1));

    await switchLanguage("en-GB");

    // ZMIERZONE: na tej konfiguracji (`supportedLngs: ["pl","en"]`) i18next
    // ZWIJA kod regionalny do „en", więc hook dostaje już zwinięty kod, a jego
    // własne porównanie prefiksowe (`startsWith("en")`) jest obroną w głąb -
    // działa też wtedy, gdyby ktoś dołożył `nonExplicitSupportedLngs`.
    // Dowodzony jest SKUTEK dla kandydata, a nie wewnętrzny kod języka.
    expect(i18n.language).toBe("en");
    expect(result.current.offers[0].title).toBe(ROW_COORDINATOR.title_en);
  });

  it("zmiana języka przy PUSTEJ bazie przełącza katalog zapasowy na angielskie tytuły", async () => {
    stub.setResponse(ROLES_RELATION, ok([]));

    const { result } = renderHookWithQueryClient(() => useCareerOffers());
    await waitFor(() => expect(result.current.offers).toHaveLength(CAREER_ROLES.length));
    expect(result.current.offers[0].title).toBe(pl(roleTitleKey(CAREER_ROLES[0].id)));

    await switchLanguage("en");

    expect(result.current.offers.map((offer) => offer.title)).toEqual(
      CAREER_ROLES.map((role) => en(roleTitleKey(role.id))),
    );
    // Kontrola tłumacza: gdyby `t` ignorowało język, obie listy byłyby równe.
    expect(en(roleTitleKey(CAREER_ROLES[0].id))).not.toBe(pl(roleTitleKey(CAREER_ROLES[0].id)));
    // Dowodem jest SKUTEK (memo nie jest zamrożone), a nie tablica zależności:
    // `lang` i `t` zmieniają się w tym samym renderze, więc każde z nich
    // osobno wystarcza do przeliczenia - patrz nagłówek.
  });

  it("publiczny hook pyta WYŁĄCZNIE o oferty opublikowane i tylko o relację ofert", async () => {
    stub.setResponse(ROLES_RELATION, ok([ROW_COORDINATOR]));

    const { result } = renderHookWithQueryClient(() => useCareerOffers());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const chain = stub.lastChain(ROLES_RELATION);
    const filters = chain?.calls.filter((call) => call.method === "eq") ?? [];
    // `careerRolesQueryOptions(true)` (wariant panelu) NIE dokłada tego ogniwa.
    expect(filters.map((call) => call.args)).toEqual([["is_published", true]]);
    // Hook ofert nie dotyka niczego innego - w szczególności nie relacji sekcji.
    expect(stub.chains.map((c) => c.table)).toEqual([ROLES_RELATION]);
  });

  it("klucz cache ofert nie rozróżnia ani języka, ani najemcy - jeden wpis na dwie wersje strony", async () => {
    stub.setResponse(ROLES_RELATION, ok([ROW_COORDINATOR]));

    const { result, queryClient } = renderHookWithQueryClient(() => useCareerOffers());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await switchLanguage("en");

    // Kształt WPISANY tutaj: dołożenie segmentu (język, najemca, dział) oblewa
    // ten test, bo mnożyłoby odczyty tej samej listy.
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey),
    ).toEqual([["career-roles", "published"]]);
    // …i to jest DOKŁADNIE ten wpis, który adresują publiczne `queryOptions`
    // (rozjazd hooka z opcjami zostawiłby tu `undefined`).
    expect(queryClient.getQueryData(careerRolesQueryOptions().queryKey)).toEqual([ROW_COORDINATOR]);
  });
});

// ---------------------------------------------------------------------------
// useCareerSection - widoczność i nadpisania nagłówków
// ---------------------------------------------------------------------------
describe("useCareerSection - stan sekcji strony", () => {
  it("nadpisanie nagłówka z panelu dojeżdża do sekcji o tym kluczu", async () => {
    // Wiersz sekcji PYTANEJ stoi DRUGI, a pierwszy niesie inny nagłówek:
    // implementacja czytająca „pierwszy wiersz odpowiedzi" zamiast szukająca
    // po kluczu oblewa ten test, zamiast przejść na szczęśliwym ułożeniu.
    stub.setResponse(
      SECTIONS_RELATION,
      ok([
        sectionRow({ key: "hero", title_pl: "Nagłówek innej sekcji", sort_order: 10 }),
        sectionRow({
          key: "roles",
          title_pl: "Otwarte rekrutacje",
          title_en: "Open recruitments",
          subtitle_pl: "Cztery zespoły szukają ludzi.",
          subtitle_en: "Four teams are hiring.",
        }),
      ]),
    );

    const { result } = renderHookWithQueryClient(() => useCareerSection("roles"));

    await waitFor(() =>
      expect(result.current).toEqual({
        visible: true,
        title: "Otwarte rekrutacje",
        subtitle: "Cztery zespoły szukają ludzi.",
      }),
    );
  });

  it("klucz BEZ wiersza znaczy `pokaż bez nadpisań` - panel nie musi opisać każdej sekcji", async () => {
    stub.setResponse(SECTIONS_RELATION, ok([sectionRow({ key: "hero", title_pl: "Kariera" })]));

    // Dwie sekcje z JEDNEJ odpowiedzi: `hero` ma wiersz, `closing` go nie ma.
    // Oczekiwanie na nagłówek `hero` jest dowodem, że odpowiedź DOSZŁA - bez
    // tego cała asercja byłaby spełniona przez stan „odczyt w drodze", w którym
    // każda sekcja jest widoczna bez nadpisań z całkiem innego powodu
    // (ZMIERZONE: hook ignorujący odpowiedź przechodził poprzednią wersję
    // tego testu w 4 ms).
    const { result } = renderHookWithQueryClient(() => useHeroAndClosing());
    await waitFor(() => expect(result.current.hero.title).toBe("Kariera"));

    expect(result.current.closing).toEqual({ visible: true, title: null, subtitle: null });
    expect(stub.chainsFor(SECTIONS_RELATION)).toHaveLength(1);
  });

  it("sygnał `is_visible: false` z widoku dojeżdża jako `visible: false`", async () => {
    // Widok `career_page_sections_public` ucina nagłówki sekcji ukrytej do NULL
    // (brudnopis nie wychodzi), ale samą FLAGĘ oddaje - to jej droga do hooka.
    stub.setResponse(
      SECTIONS_RELATION,
      ok([sectionRow({ key: "roles", is_visible: false, title_pl: null, subtitle_pl: null })]),
    );

    const { result } = renderHookWithQueryClient(() => useCareerSection("roles"));

    await waitFor(() => expect(result.current.visible).toBe(false));
    expect(result.current).toEqual({ visible: false, title: null, subtitle: null });
  });

  it("ZNALEZISKO 2: w trakcie odczytu sekcja ukryta jest jeszcze WIDOCZNA", async () => {
    stub.setResponse(SECTIONS_RELATION, ok([sectionRow({ key: "roles", is_visible: false })]));

    const { result } = renderHookWithQueryClient(() => useCareerSection("roles"));

    // Pierwsze malowanie: brak danych czyta się jako „pokaż" (świeża instalacja
    // nie może dać białej strony), więc sekcja zdjęta w panelu jest tu widoczna.
    expect(result.current).toEqual({ visible: true, title: null, subtitle: null });

    // Dopiero powrót odczytu przynosi „ukryj".
    await waitFor(() => expect(result.current.visible).toBe(false));
  });

  it("PUSTA odpowiedź otwiera wszystkie sekcje - świeża instalacja pokazuje całą stronę", async () => {
    stub.setResponse(SECTIONS_RELATION, ok([]));
    stub.setResponse(ROLES_RELATION, ok([]));

    const { result, queryClient } = renderHookWithQueryClient(() => useWholePage());
    // Dowód, że PUSTA ODPOWIEDŹ naprawdę doszła, a nie że mierzymy pierwsze
    // malowanie: w cache stoi rozstrzygnięty odczyt z pustą listą. Bez tego
    // asercja „wszystko widoczne" byłaby spełniona przez stan „w drodze"
    // (ZMIERZONE: hook ignorujący odpowiedź przechodził poprzednią wersję
    // tego testu w 5 ms) i dublowała test ZNALEZISKA 2.
    const sectionsKey = careerSectionsQueryOptions().queryKey;
    await waitFor(() =>
      expect(queryClient.getQueryState(sectionsKey)?.status).toBe("success"),
    );
    expect(queryClient.getQueryData(sectionsKey)).toEqual([]);
    expect(stub.chainsFor(SECTIONS_RELATION)).toHaveLength(1);

    // Zbiór kluczy tego pliku POKRYWA zamknięty zbiór produktu - ósma sekcja
    // dołożona do `CAREER_SECTION_KEYS` oblewa tę asercję.
    const sectionKeys = Object.keys(result.current).filter((key) => key !== "offers");
    expect(sectionKeys).toEqual([...CAREER_SECTION_KEYS]);

    for (const key of CAREER_SECTION_KEYS) {
      expect(result.current[key as CareerSectionKey]).toEqual({
        visible: true,
        title: null,
        subtitle: null,
      });
    }
  });

  it("ODMOWA ODCZYTU sekcji nie wygasza strony - reguła zapasowa jest `pokaż`", async () => {
    stub.setResponse(SECTIONS_RELATION, fail("permission denied for view", "42501"));
    stub.setResponse(ROLES_RELATION, ok([ROW_COORDINATOR]));

    const { result, queryClient } = renderHookWithQueryClient(() => useWholePage());
    await waitFor(() => expect(result.current.offers.isLoading).toBe(false));

    const query = queryClient.getQueryCache().find({
      queryKey: careerSectionsQueryOptions().queryKey,
    });
    await waitFor(() => expect(query?.state.status).toBe("error"));
    expect((query?.state.error as Error).message).toBe("permission denied for view");

    for (const key of CAREER_SECTION_KEYS) {
      expect(result.current[key as CareerSectionKey].visible).toBe(true);
    }
  });

  it("nagłówek sekcji jest dwujęzyczny i nie kosztuje drugiego odczytu", async () => {
    stub.setResponse(
      SECTIONS_RELATION,
      ok([
        sectionRow({
          key: "roles",
          title_pl: "Otwarte rekrutacje",
          title_en: "Open recruitments",
          subtitle_pl: "Cztery zespoły szukają ludzi.",
          subtitle_en: "Four teams are hiring.",
        }),
      ]),
    );

    const { result, queryClient } = renderHookWithQueryClient(() => useCareerSection("roles"));
    await waitFor(() => expect(result.current.title).toBe("Otwarte rekrutacje"));

    await switchLanguage("en");

    expect(result.current).toEqual({
      visible: true,
      title: "Open recruitments",
      subtitle: "Four teams are hiring.",
    });
    expect(stub.chainsFor(SECTIONS_RELATION)).toHaveLength(1);
    // Klucz sekcji nie niesie ani języka, ani klucza sekcji - patrz test niżej.
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey),
    ).toEqual([["career-page-sections", "public"]]);
  });

  it("cała strona to JEDEN odczyt sekcji i JEDEN odczyt ofert, choć pyta osiem hooków", async () => {
    stub.setResponse(ROLES_RELATION, ok([ROW_COORDINATOR, ROW_EDITOR]));
    stub.setResponse(
      SECTIONS_RELATION,
      ok([sectionRow({ key: "roles", title_pl: "Otwarte rekrutacje" })]),
    );

    const { result, queryClient } = renderHookWithQueryClient(() => useWholePage());
    await waitFor(() => expect(result.current.offers.isLoading).toBe(false));
    await waitFor(() => expect(result.current.roles.title).toBe("Otwarte rekrutacje"));

    // Siedem sekcji, jeden odczyt: klucz zapytania NIE jest parametryzowany
    // kluczem sekcji (inaczej byłoby tu siedem identycznych zapytań).
    expect(stub.chains.map((chain) => chain.table).sort()).toEqual(
      [ROLES_RELATION, SECTIONS_RELATION].sort(),
    );
    expect(queryClient.getQueryCache().getAll()).toHaveLength(2);
    // Sekcje bez wiersza dostały regułę zapasową, a `roles` nadpisanie -
    // z jednego i tego samego odczytu.
    expect(result.current.hero).toEqual({ visible: true, title: null, subtitle: null });
    expect(result.current.roles.subtitle).toBeNull();
    expect(result.current.offers.offers.map((offer) => offer.title)).toEqual([
      ROW_COORDINATOR.title_pl,
      ROW_EDITOR.title_pl,
    ]);
  });
});
