// PROCES REKRUTACJI I DOMKNIĘCIE STRONY /zatrudniamy — dwie sekcje, które
// kandydat czyta na końcu ścieżki: „co się teraz stanie" i „co mogę zrobić".
//
// ---------------------------------------------------------------------------
// PO CO TEN PLIK ISTNIEJE
// ---------------------------------------------------------------------------
// Oba pliki weszły do kampanii z DOKŁADNYM ZEREM pomiaru:
//
//   CareersProcess.tsx   0/4 linii, 0/2 funkcji, 0/4 instrukcji
//   CareersClosing.tsx   0/2 linii, 0/1 funkcji, 0/2 instrukcji
//
// To komponenty bez stanu i bez zapytań — więc pokusa jest oczywista: jeden
// `render()`, jedno `toBeInTheDocument()`, pomiar na zielono i nic udowodnione.
// Zerowe pokrycie znaczy tu jednak, że przechodzą bez śladu defekty, których
// przegląd kodu nie łapie, bo każdy z nich wygląda w diffie jak drobiazg:
//
//   * KOLEJNOŚĆ KROKÓW rozjechana z numeracją. Numer bierze się z pozycji
//     w tablicy (`String(index + 1).padStart(2, "0")`), a treść z klucza kroku
//     — przestawienie dwóch wpisów w `STEPS` daje „02 Aplikacja" i „01 Rozmowa
//     wstępna": kandydat czyta, że najpierw jest rozmowa, potem formularz.
//     Ten sam mechanizm psuje się od `index` bez `+ 1` („00…03") i od
//     wypadnięcia `padStart` („1…4" zamiast „01…04").
//   * ROZJAZD SIATKI Z SEMANTYKĄ. Kroki są `<ol>`/`<li>`, więc czytnik ekranu
//     ogłasza „lista, 4 elementy" i porządek jest w znaczniku, nie tylko
//     w wizualnej numeracji. Zamiana `<ol>` na `<div>`+`grid` nie zmienia ani
//     piksela na ekranie i kasuje CAŁĄ tę informację — dokładnie ta zamiana
//     przechodzi review jako „porządki w klasach".
//   * STAGGER PRZYKLEJONY DO ZERA. `CareerReveal index={index}` przesuwa start
//     animacji o `index * 70ms`; stała `index={0}` (albo pomyłka `key` vs
//     `index`) wygląda w kodzie identycznie, a odsłania wszystkie cztery karty
//     naraz.
//   * WYJŚCIE Z DOMKNIĘCIA PROWADZĄCE NA ZEWNĄTRZ. Drugie CTA sekcji
//     zamykającej to `<Link to="/$" params={{ _splat: "kontakt" }}>` — link
//     ROUTERA. Podmiana na `<a href="/kontakt">` (albo dołożenie
//     `target="_blank"`) nie zmienia wyglądu przycisku i zamienia przejście
//     w obrębie aplikacji na pełne przeładowanie dokumentu: kandydat gubi stan
//     wypełnionego wyżej formularza aplikacyjnego. Dlatego dowód „prowadzi
//     wewnątrz aplikacji" stoi tu na PRZEJŚCIU w prawdziwym routerze, a nie na
//     atrybucie `href`.
//   * ZAMIANA RÓL CTA. Pierwsze CTA MUSI być przyciskiem (oddaje intencję do
//     trasy: `openApplication` ustawia `applySignal` i przewija do formularza),
//     drugie MUSI być odnośnikiem (adres do skopiowania, otwarcie w nowej
//     karcie, Enter bez JS). Zamiana ról jest niewidoczna wizualnie i psuje
//     obie rzeczy naraz.
//
// ---------------------------------------------------------------------------
// CO JEST PRZEDMIOTEM DOWODU
// ---------------------------------------------------------------------------
//  1. TREŚĆ ZE SŁOWNIKA, NIE Z LITERAŁU. Wszystkie napisy asertowane przez
//     `realT("pl")` / `realT("en")` na prawdziwej nakładce `@/lib/i18n-careers`:
//     tytuł i podtytuł obu sekcji, cztery kroki (title/body/duration), oba CTA
//     domknięcia. Usunięcie klucza ze słownika oblewa ten plik. Osobny strażnik
//     pilnuje, że KAŻDA z tych 18 wartości różni się od swojego klucza i nie
//     jest pusta (i18next zwraca brakujący klucz jako samego siebie, więc bez
//     tej kontroli asercja `getByText(t(k))` porównywałaby „careers.process.
//     title" z „careers.process.title" i przechodziła jako tautologia).
//     Kompletność listy, której strażnik pilnuje, jest sama zmierzona —
//     to nie jest ozdoba, bo dokładnie tam autor pierwszej wersji miał lukę
//     (patrz REWIZJA ADWERSARYJNA, punkt B).
//  2. KROKI W KOLEJNOŚCI. Cztery `<li>` w kolejności apply → screening → task
//     → decision, każdy z numerem „01".."04" na swojej pozycji. Lista kluczy
//     jest WPISANA W TYM PLIKU, a nie zaimportowana z `CareersProcess.tsx`:
//     lista zaczytana z przedmiotu dowodu przechodzi każde swoje okrojenie
//     (usunięcie kroku „task" przeszłoby test „renderuje wszystkie kroki",
//     gdyby test pytał komponent, ile ich ma być).
//  3. SEMANTYKA LISTY. Kontener to `<ol>` (uporządkowana, nie `<ul>`, nie zbiór
//     divów), jego jedynymi dziećmi są cztery `<li>` plus jeden dekoracyjny
//     `<span>` osi czasu, a ten span jest `aria-hidden` i pusty tekstowo.
//  4. STAGGER Z POZYCJI. Opakowania `CareerReveal` niosą `--crs-delay`
//     0/70/140/210 ms w kolejności DOM — czyli `index` naprawdę pochodzi
//     z pozycji kroku.
//  5. IKONY SĄ DEKORACJĄ. Po dwa `aria-hidden` SVG w karcie (ikona kroku +
//     zegar przy czasie trwania), zero elementów o roli `img` — nazwa dostępna
//     kroku niesie sam tekst. Cztery kroki mają CZTERY RÓŻNE ikony (kopiuj-
//     wklej z jedną ikoną dla wszystkich jest tu realnym regresem).
//  6. HIERARCHIA NAGŁÓWKÓW. Proces: h2 sekcji + cztery h3 kroków, bez skoków.
//     Domknięcie: dokładnie jeden h2. W renderze OBU sekcji obok siebie (tak
//     jak składa je trasa) poziomy układają się w 2,3,3,3,3,2, a identyfikatory
//     `aria-labelledby` są różne — dwie sekcje na jednej stronie nie mogą
//     dzielić id, bo nazwa dostępna jednej przykleiłaby się do drugiej.
//  7. AUTORYTET DOMKNIĘCIA. Pierwsze CTA jest przyciskiem, woła
//     `onOpenApplication` dokładnie raz na klik i NIE nawiguje (adres routera
//     bez zmiany) — decyzja o przewinięciu i o sygnale aplikowania mieszka
//     w trasie. Drugie CTA jest odnośnikiem `href="/kontakt"`, bez `target`
//     i bez `rel`, prowadzi WEWNĄTRZ aplikacji (mierzone przejściem routera na
//     `/$` ze splatem „kontakt", nie atrybutem) i NIE woła `onOpenApplication`.
//     W sekcji jest dokładnie jeden przycisk i jeden odnośnik — trzeciego
//     wyjścia nie ma. Słowa „PIERWSZE" i „DRUGIE" mają tu własny dowód:
//     przycisk POPRZEDZA odnośnik w DOM, czyli w kolejności czytania
//     i tabulacji (bez tego dowodu przestawienie dwóch bloków `Button`
//     przechodziło cały plik — patrz REWIZJA ADWERSARYJNA, punkt A).
//  8. WARSTWA TREŚCI JEJ NIE DOTYCZY (patrz ZNALEZISKO 1). Dowód jest
//     DWUSTRONNY. Negatywnie: nadpisany nagłówek i flaga `is_visible: false`
//     zaseedowane w cache `career_page_sections_public` nie zmieniają ani
//     napisu, ani widoczności, a obie sekcje renderują pełną treść bez
//     `QueryClientProvider`. Pozytywnie: zaseedowane zapytanie ma DOKŁADNIE
//     ZERO obserwatorów po zamontowaniu obu sekcji, przy kontroli dodatniej
//     (komponent-sonda, który to samo zapytanie subskrybuje, podnosi licznik
//     do jedynki i widzi te wiersze). Bez tej drugiej strony „nic się nie
//     zmieniło" przechodziłoby też wtedy, gdyby seed w ogóle nie trafił pod
//     czytany klucz.
//  9. DWUJĘZYCZNOŚĆ. Te same asercje po angielsku, z kontrolą, że EN ≠ PL
//     (inaczej test przechodziłby na tłumaczu ignorującym język).
// 10. DOSTĘPNOŚĆ. Brak naruszeń axe: proces osobno, domknięcie osobno i obie
//     sekcje razem (kolejność nagłówków jest własnością SĄSIEDZTWA, więc
//     `heading-order` ma sens dopiero na złożeniu).
//
// ---------------------------------------------------------------------------
// CO JEST ATRAPOWANE I DLACZEGO
// ---------------------------------------------------------------------------
// NIC z warstwy, o którą pytamy. Świadomie NIE ma tu atrapy `react-i18next`
// (napis mierzyłby atrapę, nie słownik — patrz wywód w `@/test/i18nReal`), NIE
// ma atrapy `Link`/routera (atrapa odbijałaby z powrotem `to`, które sama
// dostała, zamiast pokazać, dokąd router naprawdę przechodzi — czyli kasowałaby
// cały punkt 7) i NIE ma atrapy `IntersectionObserver`. Ten ostatni jest tu
// nietypowo POŻĄDANY w wersji happy-doma: obserwator, który nigdy nie strzela,
// zostawia `CareerReveal` w stanie „przed wejściem w viewport" i dowodzi, że
// treść kroków JEST w DOM (a więc widzi ją crawler i czytelnik bez JS) także
// przed odsłonięciem — ukrywanie robi wyłącznie CSS `crs-reveal`.
// `QueryClientProvider` pojawia się tylko w testach punktu 8, jako NARZĘDZIE
// dowodu (nośnik zaseedowanych wierszy sekcji), nie jako atrapa. Tak samo
// `<form>` z opcji `wForm`: to nie atrapa domknięcia, a UKŁAD, którego dziś na
// stronie nie ma i który budzi ZNALEZISKO 2 — sam komponent jest w tym teście
// prawdziwy w całości.
//
// CO ZOSTAJE PRAWDZIWE: React, prawdziwy `i18next` z nakładką kariery,
// prawdziwy `@tanstack/react-router` z historią pamięciową i dwiema trasami,
// prawdziwy `CareerReveal` + `useInView`, prawdziwy `Button` (Radix `Slot` przy
// `asChild`), prawdziwe ikony `lucide-react`, prawdziwe `axe-core`.
//
// ---------------------------------------------------------------------------
// ŚWIADOMIE POZA ZAKRESEM (i gdzie mieszka tamten dowód)
// ---------------------------------------------------------------------------
//  * Osadzenie sekcji w trasie, `applySignal`, przewijanie do formularza i SEO
//    — `src/routes/__tests__/zatrudniamyRoute.test.tsx` (tam oba organizmy są
//    atrapowane właśnie dlatego, że ich treść dowodzi TEN plik).
//  * Reguła CSS `crs-reveal` (`@media (scripting: enabled)` + brak
//    `prefers-reduced-motion`) — `src/styles.css`; happy-dom nie liczy kaskady,
//    więc atom dowodzi wyłącznie klas i zmiennej `--crs-delay`, a jego własny
//    dowód (stagger, przycięcie do ósmego kafla, brak IO) stoi w
//    `careersValues.test.tsx`.
//  * `sectionState` / `careerSectionsQueryOptions` jako reguły czyste —
//    `src/lib/careers/__tests__/catalog.test.ts`; UŻYCIE tej warstwy przez
//    sekcję, która ją honoruje, ma dowód w `careersRoles.test.tsx`.
//  * Parzystość słowników PL/EN — `src/lib/careers/__tests__/roles.test.ts`.
//  * Kontrast barw — `axeViolations` wyłącza `color-contrast` (brak silnika
//    malowania w happy-dom, patrz `@/test/axe`). Ten sam harness wyłącza też
//    regułę `region` (opakowanie treści w landmarki strony jest zadaniem
//    trasy, nie organizmu), więc dowód „brak naruszeń axe" w tym pliku NIE
//    obejmuje tych dwóch reguł. Nie należy go czytać szerzej, niż mierzy —
//    a `role="region"` asertowany niżej to nazwana sekcja komponentu i z tą
//    wyłączoną regułą nie ma nic wspólnego.
//  * Wygląd docelowej strony `/kontakt` — w tym pliku trasa `/$` jest
//    zaślepką, bo przedmiotem dowodu jest PRZEJŚCIE, nie cel.
//
// POMIAR PO TYM PLIKU (uczciwie, z zastrzeżeniem). 34 testy. `CareersProcess.
// tsx` 4/4 linii, 2/2 funkcji, 4/4 instrukcji; `CareersClosing.tsx` 2/2 linii,
// 1/1 funkcji, 2/2 instrukcji — czyli 100% linii i funkcji bez ani jednej luki
// do uzasadniania. Gałęzie raportują się jako 0/0 i to NIE jest zasługa testów:
// żaden z tych plików nie ma warunku, wartości domyślnej ani operatora `??`,
// więc V8 nie ma tu czego liczyć. Sto procent gałęzi w tym wycinku jest puste
// z definicji i nie należy go czytać jako dowodu czegokolwiek — dowód niosą
// asercje wyżej, nie ten wiersz raportu. Odsłanianie przy scrollu ma gałęzie
// (`inView`, `Math.min(index, 8)`), ale mieszkają w `CareerReveal`/`useInView`
// i ich dowód stoi w `careersValues.test.tsx`.
//
// ---------------------------------------------------------------------------
// ZNALEZISKA (defekty produkcyjne; niżej zaasertowane jest zachowanie ISTNIEJĄCE)
// ---------------------------------------------------------------------------
// 1. SEKCJE „process" I „closing" IGNORUJĄ PANEL REDAKCJI. `admin.hiring`
//    zapisuje do `career_page_sections` wiersze dla WSZYSTKICH siedmiu kluczy
//    z `CAREER_SECTION_KEYS` (w tym „process" i „closing"): widoczność,
//    kolejność oraz nagłówek i podtytuł w obu językach. Ale `useCareerSection`
//    czyta wyłącznie `CareersRoles.tsx` — te dwie sekcje biorą nagłówki tylko
//    ze słownika i nie mają bramki widoczności. Skutek: redakcja zdejmuje
//    „Proces rekrutacji" przełącznikiem w panelu, dostaje komunikat „zapisano",
//    a sekcja stoi na stronie dalej; zmieniony nagłówek nigdy nie wychodzi na
//    produkcję. To defekt CICHY w najgorszym sensie — panel potwierdza zapis,
//    którego strona nie realizuje. Testy w bloku „warstwa treści" przypinają
//    stan istniejący, żeby naprawa była widoczna jako zmiana testu.
// 2. PIERWSZE CTA DOMKNIĘCIA NIE MA `type`. `Button` (`src/components/ui/
//    button.tsx`) nie ustawia domyślnego `type`, więc renderuje `<button>`
//    z domyślnym `type="submit"`. Na `/zatrudniamy` defekt jest UŚPIONY:
//    `CareersClosing` jest RODZEŃSTWEM `CareersApplyForm`, nie jego dzieckiem,
//    więc przycisk nie ma nad sobą żadnego `<form>` i nie ma czego wysłać.
//    Obudzi się w dniu, w którym ktoś przeniesie domknięcie do wnętrza
//    formularza (albo owinie stronę formularzem newslettera) — wtedy „Aplikuj
//    spontanicznie" zacznie SUBMITOWAĆ. Autorytet jest w `Button`, nie w mojej
//    paczce, więc test asertuje stan ISTNIEJĄCY, w dwóch krokach:
//      (a) brak atrybutu `type` ORAZ brak przodka `<form>` nad przyciskiem
//          w dzisiejszym układzie — czyli defekt istnieje i śpi;
//      (b) SKUTEK, gdy układ się zmieni: ten sam komponent owinięty `<form>`
//          wysyła formularz na jedno kliknięcie w CTA, przy kontroli dodatniej
//          (bliźniaczy przycisk z `type="button"` w tym samym formularzu NIE
//          wysyła). Bez (b) znalezisko było opowieścią w komentarzu przy
//          asercji na kształcie — zmierzone, że ustawienie domyślnego `type`
//          w `Button` oblewa oba te testy, i tak ma być, bo to naprawa.
//
// ---------------------------------------------------------------------------
// REWIZJA ADWERSARYJNA (drugie przejście, założenie: autor pierwszej wersji
// hodował pokrycie — trzeba to udowodnić albo obalić)
// ---------------------------------------------------------------------------
// METODA. Pomiar 100%/100% nic nie mówi o sile dowodu, więc rewizja nie czytała
// raportu pokrycia, a MUTOWAŁA przedmiot dowodu: 38 mutantów w obu organizmach
// (i po jednym w `Button` oraz w słowniku), każdy uruchomiony przeciw całemu
// plikowi. ZARZUT HODOWANIA POKRYCIA OBALONY: 37 z 38 mutantów zginęło, w tym
// wszystkie regresy wymienione w sekcji „PO CO TEN PLIK ISTNIEJE" (przestawienie
// kroków, `index` bez `+1`, brak `padStart`, `<ol>`→`<ul>`, stała `index={0}`,
// jedna ikona dla wszystkich, `Link`→`<a href>`, `target="_blank"`, zamiana ról
// CTA, literały w miejsce `t(...)`). Żaden test w tym pliku nie był pusty ani
// tautologiczny. Poprawione zostało to, co mutacja i lektura wykazały jako
// dowód SŁABSZY OD SWOJEJ NAZWY:
//
//  A. MUTANT, KTÓRY PRZEŻYŁ — KOLEJNOŚĆ CTA. Przestawienie dwóch bloków
//     `Button` w `CareersClosing.tsx` przechodziło CAŁY plik: zostawia jeden
//     przycisk i jeden odnośnik z niezmienionymi etykietami, a nagłówek mówił
//     „PIERWSZE CTA" / „DRUGIE CTA", nie mierząc numeracji. Kandydat dostawałby
//     pierwsze „Napisz do nas" zamiast „Aplikuj spontanicznie". Domknięte
//     osobnym testem na kolejność DOM (= kolejność tabulacji).
//  B. STRAŻNIK SŁOWNIKA Z NIEKOMPLETNĄ LISTĄ. `KLUCZE_SLOWNIKA` pomijało
//     cztery klucze `…duration`, choć asercje pliku na nich stoją, a nazwa
//     testu obiecywała „KAŻDY klucz użyty w asercjach". Klucze dopisane,
//     kompletność listy sama zmierzona.
//  C. ZNALEZISKO 2 DOWODZONE KSZTAŁTEM. Dowodem był sam brak atrybutu `type`,
//     a skutek („zacznie SUBMITOWAĆ") stał wyłącznie w komentarzu. Dołożony
//     test SKUTKU z kontrolą dodatnią — patrz ZNALEZISKO 2 (b).
//  D. „NIE SUBSKRYBUJE SEKCJI" DOWODZONE BRAKIEM WYJĄTKU. Ciałem testu było
//     `expect(() => zamontujProces()).not.toThrow()`. Zastąpione pomiarem
//     liczby obserwatorów zaseedowanego zapytania (z kontrolą dodatnią) oraz
//     asercjami na PEŁNEJ treści renderu bez providera.
//  E. ASERCJE ŚLEPE NA WŁASNY BRAK. Oś czasu procesu i tło domknięcia były
//     wyszukiwane selektorem, sprawdzane `toBeDefined()`/`not.toBeNull()`
//     i dalej odczytywane przez `?.` — czyli zniknięcie elementu gasiło jedną
//     asercję, a pozostałe przepuszczało na `undefined`. Teraz `aria-hidden`
//     jest przedmiotem asercji, nie częścią selektora, a odczyty są bez `?.`.
//  F. NAZWA SZERSZA OD CIAŁA. „Treść krokÓW jest w DOM przed odsłonięciem"
//     sprawdzała JEDEN napis jednego kroku; trzy karty mogły wejść w DOM puste
//     (zmierzone mutantem: przechodziło). Teraz pytany jest cały ładunek
//     wszystkich czterech kart, plus jawnie zmierzona przesłanka środowiska
//     (istnienie `IntersectionObserver`, bez którego `useInView` degraduje do
//     `inView = true` i test dowodziłby stanu PO odsłonięciu).
//
// Pokrycie po rewizji NIE SPADŁO (te same 4/4, 2/2, 1/1 — pomiar niżej).
//
// RODO: żadnych prawdziwych osób ani treści. Wszystkie napisy pochodzą ze
// słownika produktu; nie ma tu nazwisk, adresów e-mail ani danych kandydatów
// (formularz aplikacyjny i retencja CV mają własne pliki). Fixture'y panelu
// („NAGŁÓWEK Z PANELU") i etykiety pomocniczego formularza są zmyślone
// i opisują same siebie.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FormEvent } from "react";
import { act, cleanup, render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";

import i18n from "@/lib/i18n";
import { realT } from "@/test/i18nReal";
import { axeViolations, summarize } from "@/test/axe";
// Nakładka słownika rejestruje się efektem ubocznym importu. Oba organizmy jej
// NIE importują (robi to trasa `/zatrudniamy`), więc plik testu musi dociągnąć
// ją sam — inaczej `realT` zwracałby same klucze i asercje mierzyłyby nic.
import "@/lib/i18n-careers";
import {
  CAREER_SECTION_KEYS,
  careerSectionsQueryOptions,
  type CareerSectionRow,
} from "@/lib/careers/catalog";
import { CareersProcess } from "@/components/careers/organisms/CareersProcess";
import { CareersClosing } from "@/components/careers/organisms/CareersClosing";

const t = realT("pl");
const tEn = realT("en");

/**
 * Kroki procesu WPISANE TU JESZCZE RAZ, a nie zaimportowane z
 * `CareersProcess.tsx` — uzasadnienie w punkcie 2 nagłówka. Kolejność jest
 * znacząca: na niej stoi cały dowód chronologii.
 */
const KLUCZE_KROKOW = ["apply", "screening", "task", "decision"] as const;
/**
 * WSZYSTKIE klucze słownika, na których stoją asercje tego pliku - do
 * strażnika „wartość NIE JEST kluczem" niżej.
 *
 * REWIZJA: pierwsza wersja tej listy pomijała cztery klucze `…duration`,
 * mimo że asercje tego pliku na nich stoją (czas trwania kroku jest
 * asertowany w „cztery kroki stoją w kolejności…"), a nazwa testu-strażnika
 * obiecywała „KAŻDY klucz użyty w asercjach". Cztery klucze mogły więc
 * wypaść ze słownika i strażnik nadal świeciłby na zielono.
 */
const KLUCZE_SLOWNIKA = [
  "careers.process.title",
  "careers.process.subtitle",
  "careers.closing.title",
  "careers.closing.body",
  "careers.closing.cta",
  "careers.closing.secondary",
  ...KLUCZE_KROKOW.map((k) => `careers.process.items.${k}.title`),
  ...KLUCZE_KROKOW.map((k) => `careers.process.items.${k}.body`),
  ...KLUCZE_KROKOW.map((k) => `careers.process.items.${k}.duration`),
] as const;

/** Numeracja, jaką ma zobaczyć kandydat (dwie cyfry, licząc od jedynki). */
const NUMERY_KROKOW = ["01", "02", "03", "04"] as const;
/** Stagger `CareerReveal` na pozycjach 0..3 (własny dowód: careersValues.test.tsx). */
const OPOZNIENIA_KROKOW = ["0ms", "70ms", "140ms", "210ms"] as const;
/** Adres CMS, do którego prowadzi drugie CTA domknięcia (`to="/$"` + splat). */
const ADRES_KONTAKTU = "/kontakt";
const ADRES_KARIERY = "/zatrudniamy";
/** Etykiety pomocniczego formularza z dowodu ZNALEZISKA 2 (patrz `wForm`). */
const ETYKIETA_FORMULARZA = "formularz opakowujący z dowodu ZNALEZISKA 2";
const ETYKIETA_KONTROLI = "kontrola z type=button";

/** Poziomy nagłówków w kolejności DOM — do dowodu hierarchii. */
function poziomyNaglowkow(zakres: Element): number[] {
  return Array.from(zakres.querySelectorAll("h1,h2,h3,h4,h5,h6")).map((el) =>
    Number(el.tagName.slice(1)),
  );
}

/**
 * Wiersz sekcji z panelu redakcji — nadpisany nagłówek i ZDJĘTA widoczność.
 * Służy dowodowi ZNALEZISKA 1: strona ma to zignorować (stan istniejący).
 */
function wierszSekcji(key: string): CareerSectionRow {
  return {
    key,
    is_visible: false,
    sort_order: 0,
    title_pl: "NAGŁÓWEK Z PANELU",
    title_en: "HEADING FROM THE PANEL",
    subtitle_pl: "PODTYTUŁ Z PANELU",
    subtitle_en: "SUBTITLE FROM THE PANEL",
  };
}

/** Klient zapytań z zaseedowanym widokiem `career_page_sections_public`. */
function klientZSekcjami(rows: CareerSectionRow[]): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(careerSectionsQueryOptions().queryKey, rows);
  return queryClient;
}

/** Liczba obserwatorów zaseedowanego zapytania sekcji w danym kliencie. */
function liczbaObserwatorow(queryClient: QueryClient): number {
  const zapytanie = queryClient
    .getQueryCache()
    .find({ queryKey: careerSectionsQueryOptions().queryKey });
  // Zapytanie MUSI istnieć — inaczej „zero obserwatorów" byłoby zerem
  // z powodu literówki w kluczu, a nie z powodu braku subskrypcji.
  expect(zapytanie, "zaseedowane zapytanie sekcji nie istnieje w tym kliencie").toBeDefined();
  return zapytanie!.getObserversCount();
}

/**
 * KONTROLA DODATNIA dla `liczbaObserwatorow`: komponent, który ten sam widok
 * JAWNIE subskrybuje. Bez niego „zero obserwatorów" byłoby nie do odróżnienia
 * od „pomiar nie działa".
 */
function SondaSubskrypcji() {
  const { data } = useQuery(careerSectionsQueryOptions());
  return <output data-testid="sonda-subskrypcji">{data?.length ?? -1}</output>;
}

/**
 * Proces renderowany NAGO — bez routera i bez `QueryClientProvider`.
 * To nie oszczędność: `useQuery` bez providera rzuca („No QueryClient set"),
 * więc udany render jest pomiarem tego, że sekcja NIE pyta warstwy treści.
 */
function zamontujProces(queryClient?: QueryClient) {
  const widok = <CareersProcess />;
  return render(
    queryClient ? <QueryClientProvider client={queryClient}>{widok}</QueryClientProvider> : widok,
  );
}

interface OpcjeMontazu {
  /** Co renderuje trasa `/zatrudniamy` w teście. */
  co?: "domkniecie" | "oba";
  /** Zaseedowane wiersze sekcji (dowód ZNALEZISKA 1). */
  queryClient?: QueryClient;
  /**
   * Owija domknięcie w `<form>` — układ, którego dziś na `/zatrudniamy` NIE
   * MA i który budzi ZNALEZISKO 2 (przycisk bez `type` staje się `submit`).
   * Służy dowodowi SKUTKU defektu, nie dowodowi obecnego układu strony.
   */
  wForm?: boolean;
}

/**
 * Domknięcie (i opcjonalnie proces obok niego) w PRAWDZIWYM routerze razem
 * z trasą CMS `/$`, żeby kliknięcie w „Napisz do nas" miało dokąd prowadzić.
 */
async function zamontujWRouterze(opcje: OpcjeMontazu = {}) {
  const onOpenApplication = vi.fn();
  const onSubmit = vi.fn((zdarzenie: FormEvent) => zdarzenie.preventDefault());
  const root = createRootRoute({ component: () => <Outlet /> });
  const kariera = createRoute({
    getParentRoute: () => root,
    path: ADRES_KARIERY,
    component: () => {
      const domkniecie = <CareersClosing onOpenApplication={onOpenApplication} />;
      return (
        <>
          {opcje.co === "oba" ? <CareersProcess /> : null}
          {opcje.wForm ? (
            <form onSubmit={onSubmit} aria-label={ETYKIETA_FORMULARZA}>
              {domkniecie}
              {/* Kontrola dodatnia dla pomiaru: przycisk Z `type="button"`
                  w TYM SAMYM formularzu. Jeśli on nie submituje, a CTA
                  submituje, to mierzymy brak `type`, a nie „każdy klik
                  w formularzu wysyła". */}
              <button type="button">{ETYKIETA_KONTROLI}</button>
            </form>
          ) : (
            domkniecie
          )}
        </>
      );
    },
  });
  // Zaślepka strony CMS: przedmiotem dowodu jest PRZEJŚCIE, nie cel.
  const cms = createRoute({
    getParentRoute: () => root,
    path: "$",
    component: () => <div data-testid="strona-cms">STRONA CMS</div>,
  });
  const router = createRouter({
    routeTree: root.addChildren([kariera, cms]),
    history: createMemoryHistory({ initialEntries: [ADRES_KARIERY] }),
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
  });
  await router.load();
  const drzewo = <RouterProvider router={router} />;
  const widok = render(
    opcje.queryClient ? (
      <QueryClientProvider client={opcje.queryClient}>{drzewo}</QueryClientProvider>
    ) : (
      drzewo
    ),
  );
  // Router domyka przejście poza `render()`; bez tego taktu React zasypuje log
  // ostrzeżeniami „update was not wrapped in act".
  await act(async () => {});
  return {
    ...widok,
    onOpenApplication,
    onSubmit,
    sciezka: () => router.state.location.pathname,
  };
}

afterEach(() => {
  cleanup();
});

describe("słownik kariery jest ZAREJESTROWANY - strażnik samospełniających się asercji", () => {
  /**
   * PUŁAPKA, KTÓRĄ TEN TEST ZAMYKA, WYGLĄDA JAK DOBRA PRAKTYKA.
   * Asercje tego pliku porównują tekst na ekranie z `t("careers.…")` - czyli
   * ze SŁOWNIKIEM, a nie z literałem wklejonym w test. To jest właściwy
   * kierunek, ale sam w sobie NIE WYSTARCZA: i18next dla BRAKUJĄCEGO klucza
   * zwraca SAM KLUCZ, a komponent renderuje `t(key)`. Gdyby więc klucz wypadł
   * ze słownika, `getByText(t(key))` porównywałoby napis „careers.process.title"
   * z napisem „careers.process.title" i przechodziło - test UDAWAŁBY pomiar
   * słownika, będąc tautologią. To gorszy przypadek niż literał w teście, bo
   * literał widać w diffie, a tego nie widać wcale.
   *
   * Znalezione rewizją adwersaryjną w `careersValues.test.tsx` i domknięte tu
   * dla całej rodziny kluczy tego pliku JEDNYM dowodem: każda wartość MUSI
   * różnić się od swojego klucza i nie może być pusta.
   */
  it("każdy klucz użyty w asercjach rozwiązuje się do napisu INNEGO niż on sam", () => {
    // Strażnik jest wart tyle, ile kompletna jest lista, której pilnuje —
    // dlatego najpierw pomiar samej listy: sześć kluczy sekcji plus trzy
    // pola na każdy z czterech kroków (title/body/duration).
    expect(KLUCZE_SLOWNIKA).toHaveLength(6 + 3 * KLUCZE_KROKOW.length);
    for (const klucz of KLUCZE_SLOWNIKA) {
      const wartosc = t(klucz);
      expect(wartosc, `klucz ${klucz} nie ma wartości w słowniku`).not.toBe(klucz);
      expect(wartosc.trim(), `klucz ${klucz} ma pustą wartość`).not.toBe("");
    }
  });

  it("kontrola dodatnia: klucz, którego NIE MA, wraca jako on sam", () => {
    // Bez tej kontroli dowód wyżej mógłby przechodzić dlatego, że `realT`
    // zwraca cokolwiek innego niż klucz (np. pusty napis albo `undefined`),
    // a nie dlatego, że słownik jest zarejestrowany.
    expect(t("careers.klucz.ktorego.nie.ma")).toBe("careers.klucz.ktorego.nie.ma");
  });
});

describe("CareersProcess: kroki procesu w kolejności", () => {
  it("nagłówek i podtytuł sekcji pochodzą ze słownika, a sekcja jest nimi nazwana", () => {
    zamontujProces();

    // `aria-labelledby` -> nazwa dostępna regionu: dowód SKLEJENIA id z h2,
    // a nie samego istnienia atrybutu.
    const sekcja = screen.getByRole("region", { name: t("careers.process.title") });
    expect(within(sekcja).getByRole("heading", { level: 2 })).toHaveTextContent(
      t("careers.process.title"),
    );
    expect(within(sekcja).getByText(t("careers.process.subtitle"))).toBeInTheDocument();
    // Brakujący klucz i18next zwraca jako samego siebie — bez tej kontroli
    // asercje wyżej przechodziłyby na surowym „careers.process.title".
    expect(t("careers.process.title")).not.toContain("careers.process.");
    expect(t("careers.process.subtitle")).not.toContain("careers.process.");
  });

  it("cztery kroki stoją w kolejności apply-screening-task-decision, z treścią ze słownika", () => {
    zamontujProces();

    const kroki = screen.getAllByRole("listitem");
    expect(kroki).toHaveLength(KLUCZE_KROKOW.length);

    KLUCZE_KROKOW.forEach((klucz, index) => {
      const krok = kroki[index];
      const tytul = t(`careers.process.items.${klucz}.title`);
      const tresc = t(`careers.process.items.${klucz}.body`);
      const czas = t(`careers.process.items.${klucz}.duration`);

      expect(within(krok).getByRole("heading", { level: 3 })).toHaveTextContent(tytul);
      expect(within(krok).getByText(tresc)).toBeInTheDocument();
      expect(within(krok).getByText(czas)).toBeInTheDocument();
      // Kontrola sensu: gdyby klucz zniknął ze słownika, `t` oddałby ścieżkę
      // klucza i trzy asercje wyżej nadal by przeszły.
      for (const napis of [tytul, tresc, czas]) {
        expect(napis).not.toContain("careers.process.items.");
      }
    });
  });

  it("numeracja idzie 01..04 - czyli od jedynki i z zerem wiodącym", () => {
    const { container } = zamontujProces();

    const numery = Array.from(container.querySelectorAll("li"))
      .map((krok) => krok.querySelector("span + span"))
      .map((span) => span?.textContent);
    // Łapie trzy realne regresy naraz: `index` bez `+1` („00".."03"),
    // brak `padStart` („1".."4") i przestawienie kart w siatce.
    expect(numery).toEqual([...NUMERY_KROKOW]);
  });

  it("numer stoi PRZY swoim kroku, nie tylko w tej samej kolejności", () => {
    zamontujProces();

    const kroki = screen.getAllByRole("listitem");
    KLUCZE_KROKOW.forEach((klucz, index) => {
      // Dowód sparowania: numer i tytuł są w JEDNEJ karcie. Test na dwóch
      // osobnych listach przeszedłby, gdyby numery i treści rozjechały się
      // o jedną pozycję w przeciwnych kierunkach.
      expect(kroki[index]).toHaveTextContent(NUMERY_KROKOW[index]);
      expect(kroki[index]).toHaveTextContent(t(`careers.process.items.${klucz}.title`));
    });
  });

  it("kroki są LISTĄ UPORZĄDKOWANĄ, a nie zbiorem divów", () => {
    const { container } = zamontujProces();

    const lista = screen.getByRole("list");
    // `<ol>`, nie `<ul>` i nie `<div class=grid>`: porządek siedzi w znaczniku,
    // więc czytnik ekranu ogłasza „lista, 4 elementy" i numer pozycji.
    expect(lista.tagName).toBe("OL");
    expect(container.querySelectorAll("ul")).toHaveLength(0);

    const dzieci = Array.from(lista.children);
    expect(dzieci.filter((el) => el.tagName === "LI")).toHaveLength(KLUCZE_KROKOW.length);
    // Jedyne dziecko poza `<li>` to dekoracyjna oś czasu (patrz test niżej).
    expect(dzieci.filter((el) => el.tagName !== "LI")).toHaveLength(1);
  });

  it("pozioma oś czasu jest dekoracją: aria-hidden, pusta i nieklikalna", () => {
    zamontujProces();

    const lista = screen.getByRole("list");
    // REWIZJA: było `find(… === "SPAN")` + `toBeDefined()` i dalej `os?.…`.
    // Ta para jest ślepa dokładnie tam, gdzie ma widzieć: gdyby oś czasu
    // przestała być `<span>`, `find` oddawał `undefined`, a `os?.textContent`
    // dawało `undefined`, więc jedyną asercją, która by zgasła, była ta
    // trywialna. Bierzemy więc JEDYNE dziecko listy niebędące `<li>` (jego
    // liczebność pilnuje test wyżej) i pytamy o nie bez `?.`.
    const [os] = Array.from(lista.children).filter((el) => el.tagName !== "LI");
    expect(os.tagName).toBe("SPAN");
    expect(os).toHaveAttribute("aria-hidden", "true");
    // Pusta tekstowo i wyjęta ze zdarzeń: linia rysuje relację między kartami,
    // ale nie może wejść do drzewa dostępności ani przechwycić kliknięcia
    // w kartę, nad którą leży (`absolute`).
    expect(os.textContent).toBe("");
    expect(os.className).toContain("pointer-events-none");
    // Skutek na drzewie dostępności: oś nie dokłada listie piątego elementu.
    expect(screen.getAllByRole("listitem")).toHaveLength(KLUCZE_KROKOW.length);
  });

  it("stagger odsłaniania rośnie z POZYCJĄ kroku (0/70/140/210 ms)", () => {
    const { container } = zamontujProces();

    const opoznienia = Array.from(container.querySelectorAll("li > .crs-reveal")).map((el) =>
      (el as HTMLElement).style.getPropertyValue("--crs-delay"),
    );
    // Dowód, że `index` pochodzi z pozycji w liście. Stała `index={0}`
    // (albo `key` w miejscu `index`) dałaby tu cztery zera.
    expect(opoznienia).toEqual([...OPOZNIENIA_KROKOW]);
  });

  it("treść kroków jest w DOM PRZED odsłonięciem - crawler i czytelnik bez JS ją widzą", () => {
    const { container } = zamontujProces();

    // PRZESŁANKA ŚRODOWISKA, JAWNIE ZMIERZONA. `useInView` ma gałąź
    // degradacji: gdy `IntersectionObserver` NIE ISTNIEJE, ustawia
    // `inView = true` od razu — i wtedy każde opakowanie miałoby
    // `crs-reveal--in`, a ten test dowodziłby stanu PO odsłonięciu pod nazwą
    // stanu PRZED. happy-dom obserwatora dostarcza i nigdy nim nie strzela,
    // więc stan „przed wejściem w viewport" jest tu obserwowalny.
    expect(typeof IntersectionObserver).not.toBe("undefined");
    const opakowania = Array.from(container.querySelectorAll("li > .crs-reveal"));
    expect(opakowania).toHaveLength(KLUCZE_KROKOW.length);
    for (const el of opakowania) {
      expect(el.className).toContain("crs-reveal");
      expect(el.className).not.toContain("crs-reveal--in");
      // Ukrywa wyłącznie reguła CSS. Gdyby atom sięgnął po `hidden`,
      // `aria-hidden` albo `display:none` w stylu inline, treść zniknęłaby
      // z DOM-u także dla crawlera i czytelnika bez JS.
      expect(el).not.toHaveAttribute("hidden");
      expect(el).not.toHaveAttribute("aria-hidden");
      expect((el as HTMLElement).style.display).toBe("");
    }
    // REWIZJA: nazwa mówi „treść krokÓW", a dowodem był JEDEN napis („apply").
    // Trzy z czterech kroków mogły więc wejść w DOM puste. Teraz pytamy o cały
    // ładunek każdej karty przed odsłonięciem.
    KLUCZE_KROKOW.forEach((klucz, index) => {
      const opakowanie = opakowania[index];
      for (const pole of ["title", "body", "duration"] as const) {
        expect(opakowanie).toHaveTextContent(t(`careers.process.items.${klucz}.${pole}`));
      }
    });
  });

  it("ikony są dekoracją, a każdy krok ma SWOJĄ ikonę", () => {
    zamontujProces();

    const kroki = screen.getAllByRole("listitem");
    const klasyIkon: string[] = [];
    for (const krok of kroki) {
      const svgs = Array.from(krok.querySelectorAll("svg"));
      // Ikona kroku + zegar przy czasie trwania.
      expect(svgs).toHaveLength(2);
      for (const svg of svgs) {
        expect(svg).toHaveAttribute("aria-hidden", "true");
      }
      // Nazwa dostępna kroku niesie sam tekst: żadnej grafiki w drzewie.
      expect(within(krok).queryAllByRole("img")).toEqual([]);
      klasyIkon.push(svgs[0].getAttribute("class") ?? "");
    }
    // Cztery różne ikony: kopiuj-wklej z jedną ikoną dla wszystkich kroków
    // jest tu realnym regresem, którego nie widać w diffie tekstu.
    expect(new Set(klasyIkon).size).toBe(KLUCZE_KROKOW.length);
  });

  it("hierarchia nagłówków: h2 sekcji i cztery h3 kroków, bez skoków", () => {
    const { container } = zamontujProces();

    expect(poziomyNaglowkow(container)).toEqual([2, 3, 3, 3, 3]);
    // Sekcja wewnątrz strony nie może zabierać h1 (ten należy do hero).
    expect(container.querySelectorAll("h1")).toHaveLength(0);
  });

  it("po angielsku mówi po angielsku - i to są inne napisy", async () => {
    await i18n.changeLanguage("en");
    try {
      zamontujProces();

      expect(
        screen.getByRole("region", { name: tEn("careers.process.title") }),
      ).toBeInTheDocument();
      const kroki = screen.getAllByRole("listitem");
      KLUCZE_KROKOW.forEach((klucz, index) => {
        expect(kroki[index]).toHaveTextContent(tEn(`careers.process.items.${klucz}.title`));
        // Dowód, że porównujemy dwa słowniki, a nie ten sam dwa razy.
        expect(tEn(`careers.process.items.${klucz}.title`)).not.toBe(
          t(`careers.process.items.${klucz}.title`),
        );
      });
      // Kolejność jest własnością komponentu, nie języka.
      expect(
        Array.from(kroki).map((krok) => krok.querySelector("span + span")?.textContent),
      ).toEqual([...NUMERY_KROKOW]);
    } finally {
      // Odmontowanie PRZED powrotem do polskiego: `changeLanguage`
      // przerenderowuje każdy zamontowany komponent, a ten render nie należy
      // już do żadnego testu.
      cleanup();
      await i18n.changeLanguage("pl");
    }
  });

  it("nie ma naruszeń axe", async () => {
    const { container } = zamontujProces();

    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });
});

describe("CareersClosing: domknięcie strony i jego wyjścia", () => {
  it("nagłówek i treść pochodzą ze słownika, a sekcja jest nimi nazwana", async () => {
    const { container } = await zamontujWRouterze();

    const sekcja = screen.getByRole("region", { name: t("careers.closing.title") });
    expect(within(sekcja).getByRole("heading", { level: 2 })).toHaveTextContent(
      t("careers.closing.title"),
    );
    expect(within(sekcja).getByText(t("careers.closing.body"))).toBeInTheDocument();
    // Domknięcie to jedna sekcja z jednym nagłówkiem drugiego poziomu.
    expect(poziomyNaglowkow(container)).toEqual([2]);
    for (const klucz of ["title", "body", "cta", "secondary"] as const) {
      expect(t(`careers.closing.${klucz}`)).not.toContain("careers.closing.");
    }
  });

  it("pierwsze CTA jest PRZYCISKIEM i oddaje intencję do trasy - raz na klik", async () => {
    const { onOpenApplication, sciezka } = await zamontujWRouterze();

    const cta = screen.getByRole("button", { name: t("careers.closing.cta") });
    expect(cta.tagName).toBe("BUTTON");

    fireEvent.click(cta);
    expect(onOpenApplication).toHaveBeenCalledTimes(1);
    fireEvent.click(cta);
    expect(onOpenApplication).toHaveBeenCalledTimes(2);

    // Autorytet nawigacji i przewijania jest w trasie: sekcja tylko zgłasza
    // intencję, sama NIE rusza adresu (gdyby to był `Link`, byłoby tu
    // przeładowanie kontekstu strony i utrata stanu formularza wyżej).
    expect(sciezka()).toBe(ADRES_KARIERY);
    expect(screen.queryByTestId("strona-cms")).toBeNull();
  });

  it("drugie CTA prowadzi WEWNĄTRZ aplikacji - mierzone przejściem routera", async () => {
    const { onOpenApplication, sciezka } = await zamontujWRouterze();
    expect(sciezka()).toBe(ADRES_KARIERY);

    const wyjscie = screen.getByRole("link", { name: t("careers.closing.secondary") });
    // Prawdziwy `<a href>`: adres da się skopiować, otworzyć w nowej karcie
    // i uruchomić Enterem bez JS.
    expect(wyjscie.tagName).toBe("A");
    expect(wyjscie).toHaveAttribute("href", ADRES_KONTAKTU);
    // Adres RELATYWNY do aplikacji i bez wyprowadzania z niej: żadnego
    // schematu, żadnego `target="_blank"`, żadnego `rel="external"`.
    expect(wyjscie.getAttribute("href")).not.toMatch(/^(https?:|\/\/|mailto:)/);
    expect(wyjscie).not.toHaveAttribute("target");
    expect(wyjscie).not.toHaveAttribute("rel");

    await act(async () => {
      fireEvent.click(wyjscie);
    });

    // Skutek, nie znacznik: router stoi na `/kontakt` i zamiast domknięcia
    // renderuje trasę CMS. To jest dowód przejścia W OBRĘBIE aplikacji -
    // `<a href>` bez routera nie zmieniłby tu ani lokalizacji, ani widoku.
    expect(sciezka()).toBe(ADRES_KONTAKTU);
    expect(screen.getByTestId("strona-cms")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: t("careers.closing.title") })).toBeNull();
    // Wyjście na kontakt nie jest zgłoszeniem aplikacji.
    expect(onOpenApplication).not.toHaveBeenCalled();
  });

  it("w sekcji są DOKŁADNIE dwa wyjścia: jeden przycisk i jeden odnośnik", async () => {
    await zamontujWRouterze();

    const sekcja = screen.getByRole("region", { name: t("careers.closing.title") });
    expect(sekcja.querySelectorAll("button")).toHaveLength(1);
    expect(sekcja.querySelectorAll("a")).toHaveLength(1);
    // Zamiana ról CTA (przycisk <-> odnośnik) jest niewidoczna wizualnie,
    // bo oba noszą klasy `Button`. Tu jest widoczna.
    expect(screen.getByRole("button").textContent).toContain(t("careers.closing.cta"));
    expect(screen.getByRole("link").textContent).toContain(t("careers.closing.secondary"));
  });

  it("PRZYCISK stoi PRZED odnośnikiem - czyli akcja główna jest pierwsza w kolejności czytania i tabulacji", async () => {
    const { container } = await zamontujWRouterze();

    // ZNALEZIONE REWIZJĄ ADWERSARYJNĄ (mutant, który przeżył cały plik):
    // przestawienie dwóch bloków `Button` w `CareersClosing.tsx` zostawia
    // dokładnie jeden przycisk i dokładnie jeden odnośnik z niezmienionymi
    // etykietami, więc każda ówczesna asercja tej sekcji przechodziła — a dla
    // kandydata zmienia się to, co dostaje pierwsze: „Napisz do nas" zamiast
    // „Aplikuj spontanicznie". Nagłówek mówił „PIERWSZE CTA" i „DRUGIE CTA",
    // a numeracja nie miała dowodu. Ma go tutaj.
    const wyjscia = Array.from(container.querySelectorAll("button, a"));
    expect(wyjscia.map((el) => el.tagName)).toEqual(["BUTTON", "A"]);
    expect(wyjscia.map((el) => el.textContent?.trim())).toEqual([
      t("careers.closing.cta"),
      t("careers.closing.secondary"),
    ]);
    // Kolejność DOM = kolejność tabulacji (żaden z elementów nie przestawia
    // się `tabindex`-em, a `flex-row` nie odwraca kierunku).
    for (const el of wyjscia) {
      expect(el).not.toHaveAttribute("tabindex");
    }
    expect(
      wyjscia[0].compareDocumentPosition(wyjscia[1]) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeGreaterThan(0);
  });

  it("ZNALEZISKO 2: pierwsze CTA nie ma atrybutu type, a defekt jest UŚPIONY brakiem <form> nad nim", async () => {
    const { container } = await zamontujWRouterze();

    const cta = screen.getByRole("button", { name: t("careers.closing.cta") });
    // Stan ISTNIEJĄCY, przypięty świadomie: autorytet jest w
    // `src/components/ui/button.tsx`, które nie ustawia domyślnego `type`.
    expect(cta).not.toHaveAttribute("type");
    // Druga połowa znaleziska — „uśpiony" — jest tu MIERZONA, a nie tylko
    // opowiedziana w komentarzu: nad przyciskiem nie ma ŻADNEGO przodka
    // `<form>`, więc domyślny `type="submit"` nie ma czego wysłać.
    // (`closest` pyta o łańcuch przodków; `querySelectorAll` niżej pilnuje,
    // że formularza nie ma w tej sekcji w ogóle.)
    expect(cta.closest("form")).toBeNull();
    expect(container.querySelectorAll("form")).toHaveLength(0);
  });

  it("ZNALEZISKO 2: to samo CTA W FORMULARZU WYSYŁA go klikiem - defekt budzi się układem", async () => {
    // REWIZJA: dowodem znaleziska był SAM BRAK ATRYBUTU, czyli kształt.
    // Skutek („zacznie SUBMITOWAĆ") był tylko opowiedziany w nagłówku, a to
    // jego opowiedzenie jest tu przedmiotem pomiaru: ten sam komponent,
    // ta sama ścieżka kliknięcia, jedyna różnica to `<form>` nad sekcją.
    const { onSubmit, onOpenApplication } = await zamontujWRouterze({ wForm: true });

    const cta = screen.getByRole("button", { name: t("careers.closing.cta") });
    // Przesłanka układu: CTA MA nad sobą przodka `<form>` (happy-dom oddaje
    // z `closest` inny obiekt-owijkę niż `getByRole`, więc porównujemy
    // TOŻSAMOŚĆ przez etykietę, nie przez `Object.is`).
    const formularz = cta.closest("form");
    expect(formularz).not.toBeNull();
    expect(formularz).toHaveAttribute("aria-label", ETYKIETA_FORMULARZA);
    expect(screen.getByRole("form", { name: ETYKIETA_FORMULARZA })).toBeInTheDocument();

    // KONTROLA DODATNIA (najpierw, żeby jej wynik nie zależał od kolejności):
    // przycisk z `type="button"` w tym samym formularzu NIE wysyła. Bez niej
    // asercja niżej mogłaby przechodzić dlatego, że happy-dom wysyła
    // formularz na każdy klik w jego wnętrzu.
    fireEvent.click(screen.getByRole("button", { name: ETYKIETA_KONTROLI }));
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(cta);
    // SKUTEK: jedno kliknięcie w „Aplikuj spontanicznie" wysyła formularz,
    // którego kandydat nie zamierzał wysłać. Ustawienie `type="button"`
    // w `Button` (albo w tym CTA) oblewa tę asercję - i tak ma być, bo to
    // będzie oznaczało naprawę.
    expect(onSubmit).toHaveBeenCalledTimes(1);
    // Intencja aplikowania idzie do trasy NIEZALEŻNIE od submitu: to dwa
    // różne skutki jednego kliknięcia, i oba trzeba widzieć.
    expect(onOpenApplication).toHaveBeenCalledTimes(1);
  });

  it("tło sekcji jest dekoracją: aria-hidden, puste i nieklikalne", async () => {
    const { container } = await zamontujWRouterze();

    // REWIZJA: `aria-hidden` było wcześniej WYŁĄCZNIE w selektorze, a dalej
    // szło `tlo?.…` — czyli zdjęcie atrybutu gasiło jedną asercję
    // (`not.toBeNull`) i cicho przepuszczało trzy pozostałe. Selektor bierze
    // więc teraz sam kształt (pierwszy `<span>` sekcji), a atrybut jest
    // PRZEDMIOTEM asercji.
    const sekcja = screen.getByRole("region", { name: t("careers.closing.title") });
    const [tlo] = Array.from(sekcja.children).filter((el) => el.tagName === "SPAN");
    expect(tlo).toHaveAttribute("aria-hidden", "true");
    expect(tlo.textContent).toBe("");
    // `-z-10` + `pointer-events-none`: gradient leży pod treścią i nie
    // przechwytuje kliknięcia w CTA.
    expect(tlo.className).toContain("pointer-events-none");
    expect(tlo.className).toContain("-z-10");
    // Skutek: dekoracja nie wnosi do sekcji żadnego tekstu ani celu kliknięcia
    // — cała mierzalna treść sekcji to nagłówek, akapit i dwa wyjścia.
    expect(container.querySelectorAll("section > span[aria-hidden]")).toHaveLength(1);
  });

  it("ikona strzałki w CTA jest dekoracją - nazwa przycisku to sam tekst", async () => {
    await zamontujWRouterze();

    const cta = screen.getByRole("button", { name: t("careers.closing.cta") });
    const svgs = Array.from(cta.querySelectorAll("svg"));
    expect(svgs).toHaveLength(1);
    expect(svgs[0]).toHaveAttribute("aria-hidden", "true");
    expect(within(cta).queryAllByRole("img")).toEqual([]);
  });

  it("po angielsku mówi po angielsku - i wyjście nadal prowadzi na /kontakt", async () => {
    await i18n.changeLanguage("en");
    try {
      const { sciezka } = await zamontujWRouterze();

      expect(
        screen.getByRole("heading", { level: 2, name: tEn("careers.closing.title") }),
      ).toBeInTheDocument();
      expect(screen.getByText(tEn("careers.closing.body"))).toBeInTheDocument();
      expect(screen.getByRole("button", { name: tEn("careers.closing.cta") })).toBeInTheDocument();
      // Dowód, że porównujemy dwa słowniki, a nie ten sam dwa razy.
      expect(tEn("careers.closing.title")).not.toBe(t("careers.closing.title"));
      expect(tEn("careers.closing.cta")).not.toBe(t("careers.closing.cta"));

      const wyjscie = screen.getByRole("link", { name: tEn("careers.closing.secondary") });
      // Splat „kontakt" jest CELEM aplikacyjnym, nie napisem - nie tłumaczy
      // się razem z etykietą (resolver CMS obsługuje ten slug w obu wersjach).
      expect(wyjscie).toHaveAttribute("href", ADRES_KONTAKTU);
      await act(async () => {
        fireEvent.click(wyjscie);
      });
      expect(sciezka()).toBe(ADRES_KONTAKTU);
    } finally {
      cleanup();
      await i18n.changeLanguage("pl");
    }
  });

  it("nie ma naruszeń axe", async () => {
    const { container } = await zamontujWRouterze();

    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });
});

describe("obie sekcje obok siebie - tak jak składa je trasa /zatrudniamy", () => {
  it("hierarchia nagłówków całego sąsiedztwa: 2,3,3,3,3,2", async () => {
    const { container } = await zamontujWRouterze({ co: "oba" });

    // Kolejność nagłówków jest własnością SĄSIEDZTWA: proces schodzi do h3
    // i wraca na h2 przy domknięciu. Osobny render żadnej z sekcji tego nie
    // pokaże, a to jest dokładnie ta reguła, którą sprawdza `heading-order`.
    expect(poziomyNaglowkow(container)).toEqual([2, 3, 3, 3, 3, 2]);
  });

  it("dwie sekcje na jednej stronie mają RÓŻNE identyfikatory nazw", async () => {
    const { container } = await zamontujWRouterze({ co: "oba" });

    const identyfikatory = Array.from(container.querySelectorAll("section[aria-labelledby]")).map(
      (el) => el.getAttribute("aria-labelledby"),
    );
    expect(identyfikatory).toHaveLength(2);
    expect(new Set(identyfikatory).size).toBe(2);
    // Skutek na nazwach dostępnych: wspólne id przykleiłoby nazwę jednej
    // sekcji do drugiej i nawigacja po regionach straciłaby sens.
    expect(screen.getByRole("region", { name: t("careers.process.title") })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: t("careers.closing.title") })).toBeInTheDocument();
    for (const id of identyfikatory) {
      expect(container.querySelectorAll(`#${id}`)).toHaveLength(1);
    }
  });

  it("nie ma naruszeń axe na złożeniu", async () => {
    const { container } = await zamontujWRouterze({ co: "oba" });

    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });
});

describe("warstwa treści: te sekcje jej NIE czytają (ZNALEZISKO 1)", () => {
  it("panel redakcji oferuje klucze process i closing", () => {
    // Przesłanka znaleziska, zmierzona a nie założona: `admin.hiring`
    // zapisuje wiersz `career_page_sections` dla każdego z tych kluczy
    // (widoczność + nagłówki PL/EN), więc redakcja ma prawo oczekiwać skutku.
    expect(CAREER_SECTION_KEYS).toContain("process");
    expect(CAREER_SECTION_KEYS).toContain("closing");
  });

  it("proces renderuje PEŁNĄ treść bez QueryClientProvider", () => {
    // REWIZJA: dowodem był `expect(() => zamontujProces()).not.toThrow()`,
    // czyli sam brak wyjątku. To za mało: komponent mógłby przy braku
    // providera zjeść błąd i wyrenderować pusty szkielet, a test świeciłby
    // na zielono. `useQuery` bez providera RZUCA („No QueryClient set..."),
    // więc udany render jest przesłanką — ale dowodem jest CAŁA treść.
    zamontujProces();

    expect(screen.getByRole("region", { name: t("careers.process.title") })).toBeInTheDocument();
    const kroki = screen.getAllByRole("listitem");
    expect(kroki).toHaveLength(KLUCZE_KROKOW.length);
    KLUCZE_KROKOW.forEach((klucz, index) => {
      expect(kroki[index]).toHaveTextContent(t(`careers.process.items.${klucz}.title`));
    });
  });

  it("domknięcie renderuje PEŁNĄ treść i działające CTA bez QueryClientProvider", async () => {
    const { onOpenApplication } = await zamontujWRouterze();

    expect(screen.getByRole("region", { name: t("careers.closing.title") })).toBeInTheDocument();
    expect(screen.getByText(t("careers.closing.body"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("careers.closing.cta") }));
    expect(onOpenApplication).toHaveBeenCalledTimes(1);
  });

  it("żadna z sekcji NIE subskrybuje widoku sekcji - zero obserwatorów zapytania", async () => {
    // REWIZJA: „nie czyta warstwy treści" było dowodzone wyłącznie NEGATYWNIE
    // (nadpisany nagłówek się nie pokazał). Taki dowód przechodzi też wtedy,
    // gdy sekcja czyta INNY klucz albo gdy seed w ogóle nie trafił do cache.
    // Tu pomiar jest wprost: ilu obserwatorów ma zaseedowane zapytanie.
    const queryClient = klientZSekcjami([wierszSekcji("process"), wierszSekcji("closing")]);
    expect(liczbaObserwatorow(queryClient)).toBe(0);

    zamontujProces(queryClient);
    expect(liczbaObserwatorow(queryClient)).toBe(0);
    cleanup();

    await zamontujWRouterze({ queryClient });
    expect(liczbaObserwatorow(queryClient)).toBe(0);
    cleanup();

    // KONTROLA DODATNIA: komponent, który subskrybuje, podnosi licznik do
    // jedynki i WIDZI zaseedowane wiersze. Bez tego akapitu wszystkie zera
    // wyżej mogłyby być zerami zepsutego pomiaru.
    await act(async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <SondaSubskrypcji />
        </QueryClientProvider>,
      );
    });
    expect(liczbaObserwatorow(queryClient)).toBe(1);
    expect(screen.getByTestId("sonda-subskrypcji")).toHaveTextContent("2");
  });

  it("nadpisanie nagłówka z panelu NIE wychodzi na stronę (stan istniejący)", async () => {
    const wiersze = [wierszSekcji("process"), wierszSekcji("closing")];

    zamontujProces(klientZSekcjami(wiersze));
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(t("careers.process.title"));
    expect(screen.queryByText("NAGŁÓWEK Z PANELU")).toBeNull();
    expect(screen.queryByText("PODTYTUŁ Z PANELU")).toBeNull();
    cleanup();

    await zamontujWRouterze({ queryClient: klientZSekcjami(wiersze) });
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(t("careers.closing.title"));
    expect(screen.queryByText("NAGŁÓWEK Z PANELU")).toBeNull();
  });

  it("zdjęta widoczność (is_visible=false) NIE ukrywa sekcji (stan istniejący)", async () => {
    // Sedno defektu: panel mówi „zapisano", strona pokazuje sekcję dalej.
    // Sekcja, która TĘ warstwę honoruje, ma dowód w careersRoles.test.tsx.
    const wiersze = [wierszSekcji("process"), wierszSekcji("closing")];
    expect(wiersze.every((w) => w.is_visible === false)).toBe(true);

    zamontujProces(klientZSekcjami(wiersze));
    expect(screen.getAllByRole("listitem")).toHaveLength(KLUCZE_KROKOW.length);
    cleanup();

    const { onOpenApplication } = await zamontujWRouterze({
      queryClient: klientZSekcjami(wiersze),
    });
    const cta = screen.getByRole("button", { name: t("careers.closing.cta") });
    fireEvent.click(cta);
    // Nie tylko widoczna - w pełni działająca.
    expect(onOpenApplication).toHaveBeenCalledTimes(1);
  });
});
