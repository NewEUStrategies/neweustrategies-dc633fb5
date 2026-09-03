// Lista otwartych ról na stronie /zatrudniamy: filtr działów, licznik, karty
// ofert i popup z pełną ofertą.
//
// ---------------------------------------------------------------------------
// PO CO TEN PLIK ISTNIEJE
// ---------------------------------------------------------------------------
// Trzy pliki tej powierzchni weszły do repo z DOKŁADNIE ZEREM pokrycia
// (zmierzone przed tym plikiem):
//
//   CareersRoles.tsx      0/13 linii, 0/9 funkcji, 0/8 gałęzi
//   CareerRoleCard.tsx    0/4  linii, 0/3 funkcji, 0/10 gałęzi
//   CareerFilterChip.tsx  0/1  linii, 0/1 funkcji, 0/4 gałęzi
//
// Reguły, z którymi te komponenty rozmawiają, mają własny dowód
// (`src/lib/careers/__tests__/roles.test.ts` - katalog i parzystość słowników,
// `catalog.test.ts` - `rowToOffer`, `filterOffersByDepartment`,
// `countOffersByDepartment`, `findOffer`, `sectionState`, `fallbackOffers`).
// Ten plik NIE powtarza ich przedmiotu: dowodzi, co INTERFEJS z tymi regułami
// robi. Bez niego przechodzą bez śladu m.in.:
//   * chip filtra podający `counts[dept]` innego działu (liczby na chipsach
//     rozjechane z listą - kandydat widzi „2", klika i dostaje 5 ofert),
//   * chip, który filtruje SAM (stan filtra ma mieszkać w trasie, bo panel
//     działów w hero ustawia go z góry),
//   * karta oddająca w górę `row.id` (UUID) zamiast `offer.id` (slug) -
//     formularz nie preselekcjonowałby stanowiska,
//   * popup pokazujący ofertę INNEJ karty (`findOffer` po złym identyfikatorze),
//   * karta z zaszytą polską etykietą fasety (strona jest dwujęzyczna),
//   * `aria-pressed` przyklejone do wszystkich chipsów albo do żadnego,
//   * podświetlony chip INNEGO działu, niż filtruje lista (dwa nośniki tej
//     samej informacji - `aria-pressed` dla czytnika i klasy dla wzroku -
//     rozjeżdżają się niezależnie; dopisane w rewizji),
//   * wybrana rola nieodróżnialna wzrokiem od pozostałych, bo z trzech warstw
//     sygnału wyboru dwie przestały patrzeć na `selected` (dopisane w rewizji).
//
// ---------------------------------------------------------------------------
// CO JEST PRZEDMIOTEM DOWODU
// ---------------------------------------------------------------------------
//  1. LICZNIK ZGADZA SIĘ Z LISTĄ. Liczba w regionie `aria-live` to liczba
//     KART na ekranie, a druga liczba to całość katalogu - w każdym stanie
//     filtra, także po zawężeniu do zera.
//  2. FILTR DZIAŁÓW: który chip jest wciśnięty - i to DLA WSZYSTKICH SIEDMIU
//     naraz (`aria-pressed`, dokładnie jeden `true`), jaką liczbę nosi (także
//     zerową), jak wygląda wciśnięty (klasy chipu I jego licznika - drugi,
//     wzrokowy nośnik tej samej informacji), co znika z listy po zawężeniu
//     i że sam chip TYLKO zgłasza wybór w górę - autorytet stanu jest w trasie.
//  3. PUSTKA PO ZAWĘŻENIU: komunikat ze słownika zamiast pustego miejsca.
//  4. DWUJĘZYCZNOŚĆ KART: tytuł i opis z WIERSZA bazy w aktywnym języku,
//     a fasety (dział / poziom / lokalizacja / tryb współpracy) ze SŁOWNIKA -
//     asercje trzymają `realT("pl")` i `realT("en")`, nie literały, i pilnują,
//     że napis PL różni się od EN (inaczej test przechodziłby na atrapie
//     ignorującej język).
//  5. OZNACZENIA ZAANGAŻOWANIA I LOKALIZACJI: dwa znaczniki na karcie, a ikony
//     w nich bez WŁASNEJ nazwy dostępnej (nazwę niesie sam tekst znacznika).
//  6. WYBRANA ROLA: `aria-current` dokładnie na jednej karcie + WSZYSTKIE TRZY
//     warstwy sygnału wyboru (obwódka, belka gradientu, poświata) i uniesienie
//     karty; pozostałe karty bez znacznika i z warstwami czekającymi na kursor.
//  7. OTWARCIE SZCZEGÓŁÓW: co dostaje handler (`onDetails` -> `findOffer` ->
//     popup TEJ karty), co niesie popup i co robią jego przyciski - „Aplikuj"
//     oddaje slug i zamyka, „Zamknij" zamyka bez zgłoszenia.
//  8. NAGŁÓWEK SEKCJI: nadpisanie z panelu (`career_page_sections_public`)
//     wygrywa nad słownikiem, brak wiersza spada na słownik.
//  9. STAN WEJŚCIOWY STRONY: dane w drodze, pusta tabela, awaria bazy.
// 10. DOSTĘPNOŚĆ: chipsy jako NATYWNE przyciski (fokus, `type="button"`, bez
//     własnego `role`/`tabindex`), grupa filtrów z etykietą, brak naruszeń axe
//     i brak surowych kluczy i18n na ekranie w OBU językach.
//
// ---------------------------------------------------------------------------
// CO JEST ATRAPOWANE I DLACZEGO
// ---------------------------------------------------------------------------
// * `@/integrations/supabase/client` - granica danych. Transport podstawiamy
//   ODROCZONY (`deferredChain`), bo `supabaseFromStub()` z `@/test/supabaseChain`
//   rozwiązuje łańcuch przy `await` (to jego kontrakt) i nie umie wyrazić stanu
//   „zapytanie JESZCZE w drodze" - a właśnie ten stan widzi kandydat przy
//   pierwszym malowaniu strony (znalezisko 2 niżej). KSZTAŁT odpowiedzi bierzemy
//   z harnessu (`ok`, `fail` - `fail` niesie błąd dziedziczący po `Error`,
//   tak jak `PostgrestError`).
// * `@/components/ui/dialog` - primitywy Radixa (portal, pułapka fokusu,
//   blokada przewijania) nie działają w happy-dom; całe repo podmienia je
//   w testach na przezroczyste opakowania (wzorzec z
//   `admin/events/__tests__/EventTrackDialog.test.tsx`). Atrapa ZACHOWUJE
//   regułę primitywu (treść istnieje w DOM tylko przy `open`), ale uczciwie:
//   w TYM złożeniu ta bramka nigdy się nie odpala. `CareerRoleDialog` ma
//   barierę `if (!role) return null`, a `open={detailsRole !== null}` jest
//   prawdą dokładnie wtedy, gdy rola istnieje - atrapa nie widzi tu
//   `open === false` ani razu. Nośnikiem dowodu „zamknięte = nie ma tego
//   w DOM" jest więc ODMONTOWANIE okna, nie atrybut `data-open`.
// * `react-i18next` - podmieniony na PRAWDZIWEGO tłumacza (`realT`) wstrzykiwanego
//   pod importami. Fabryka `vi.mock` nic nie importuje: skrót `reactI18nextMock()`
//   sięga po `@/lib/i18n`, czyli moduł importujący właśnie atrapowany pakiet
//   (zakleszczenie - ostrzeżenie stoi w nagłówku `src/test/i18nReal.ts`).
//   `i18n.language` w atrapie jest przełączalne, bo `useCareerOffers` czyta
//   z niego język oferty - dzięki temu jeden plik dowodzi obu wersji strony.
//
// CO ZOSTAJE PRAWDZIWE (i dlaczego atrapowanie zamieniłoby plik w test atrapy):
// `CareerRoleDialog` (to on jest odpowiedzią na pytanie „co dostaje handler
// szczegółów" - atrapa-rejestrator dowodziłaby wyłącznie tego, że props
// poszedł), `CareerRoleCard`, `CareerFilterChip`, `react-query` razem
// z prawdziwymi `useCareerOffers`/`useCareerSection` i całą warstwą
// `catalog.ts` (fallback i18n, filtr, liczniki, `sectionState`) oraz słownik
// `@/lib/i18n-careers`.
//
// ---------------------------------------------------------------------------
// ZNALEZISKA (kod produkcyjny NIEZMIENIONY; testy asertują stan ISTNIEJĄCY)
// ---------------------------------------------------------------------------
// ZNALEZISKO 1 - `visible` z panelu jest ignorowane. `CareersRoles` jest
//   JEDYNYM publicznym konsumentem `useCareerSection`, a ze zwrotki czyta
//   wyłącznie `title`/`subtitle`. `sectionState().visible` nie jest tu w ogóle
//   czytane, więc sekcja zdjęta przełącznikiem „widoczna" w panelu
//   (`src/routes/admin.hiring.tsx:858` - `Switch` na `is_visible`, dla każdego
//   klucza z `CAREER_SECTION_KEYS`, więc i dla `roles`) NADAL renderuje się na
//   stronie publicznej. Migracja `20260817230000` i widok
//   `career_page_sections_public` istnieją właśnie po to, żeby sygnał „ukryj"
//   przeżył drogę do anona (wywód stoi w nagłówku `catalog.ts`) - i ten sygnał
//   dojeżdża do hooka, a ginie w komponencie. Test
//   „ZNALEZISKO: `is_visible: false` NIE ukrywa sekcji" utrwala stan obecny;
//   brakujący dowód „sekcja wyłączona nie istnieje w DOM" nie ma dziś gdzie
//   mieszkać, bo nie ma produkcyjnego kodu, który by ją ukrywał.
// ZNALEZISKO 2 - `isLoading` jest odrzucane. `useCareerOffers` zwraca
//   `isLoading`, ale `CareersRoles` bierze z niego wyłącznie `offers`, a przy
//   ładowaniu `offers` to pusta lista. Skutek widoczny dla kandydata przy
//   pierwszym malowaniu (`loader` trasy `/zatrudniamy` NIE prefetchuje ofert -
//   ciągnie tylko SEO): licznik „0/0 ról" i zdanie „W tym dziale nie prowadzimy
//   teraz rekrutacji", czyli NIEPRAWDA postawiona zamiast szkieletu. Test
//   „ZNALEZISKO: w trakcie wczytywania..." asertuje ten stan i dowodzi, że po
//   rozwiązaniu zapytania lista wchodzi.
//
// ---------------------------------------------------------------------------
// CO ZMIENIŁA REWIZJA ADWERSARIALNA (mierzona mutacjami produkcji)
// ---------------------------------------------------------------------------
// Pierwsza wersja tego pliku raportowała linie 18/18 i funkcje 13/13 - i to
// była prawda. Rewizja pytała o coś innego: czy z tych 43 testów da się
// WYWNIOSKOWAĆ zachowanie, czy tylko fakt wykonania linii. Metoda: mutacja
// kodu produkcyjnego -> uruchomienie pliku -> `git checkout` (produkcja wyszła
// z tego nietknięta). Numeracja niżej to te same numery, którymi podpisane są
// wzmocnione asercje w ciele pliku (`REWIZJA 1` ... `REWIZJA 6`).
//
// REWIZJA 1 (atrapa popupu, przy `vi.mock`) - stan atrapy w zmiennej modułowej
//   przeżywał granicę testu, a jej bramka `open` nie odpalała się tu ani razu.
//   Nie było fałszywej asercji, była fałszywa opowieść w nagłówku.
// REWIZJA 2 („wciśnięty jest DOKŁADNIE...") - nazwa obiecywała wyczerpanie,
//   ciało sprawdzało 3 z 7 chipsów. Klasyczne „nazwa większa od dowodu".
// REWIZJA 3 (wzrokowy sygnał chipu) - PRZEŻYŁY dwie mutacje: zamiana klas
//   aktywny <-> nieaktywny w chipie i to samo w jego liczniku.
// REWIZJA 4 (warstwy karty) - PRZEŻYŁY trzy: wycięcie `selected ? ... :`
//   z belki gradientowej, to samo z poświaty, zdjęcie `aria-hidden`
//   z warstwy dekoracyjnej.
// REWIZJA 5 (uniesienie wybranej karty) - PRZEŻYŁO zdjęcie
//   `selected && "-translate-y-0.5"`, bo jedyna asercja tego sygnału nie
//   mogła oblać: `className).toContain("-translate-y-0.5")` znajduje ten napis
//   w klasie bazowej `hover:-translate-y-0.5`, na KAŻDEJ karcie. Stąd reguła
//   tego pliku: sygnały klasowe asertujemy `toHaveClass` (cały token), nigdy
//   `toContain` na `className`.
// REWIZJA 6 (ikony znaczników) - mutacja RÓWNOWAŻNA, świadomie niezabijana:
//   `lucide-react` sam dokłada `aria-hidden`, gdy ikona nie ma dziecka ani
//   propsa dostępnościowego, więc zdjęcie propsa z JSX-a daje IDENTYCZNY DOM.
//   Dyskryminująca połowa pary („ikona nie ma własnej nazwy") stoi w asercjach
//   i pada, gdy ikonie nadać `aria-label`.
//
// Wspólny mechanizm 3-5: gałąź BYŁA przebiegana (w jednym renderze stoi obok
// siebie chip wciśnięty i sześć luźnych, karta wybrana i dwie zwykłe), więc
// licznik gałęzi pokazywał 100%, a NIKT nie asertował jej skutku. To jest
// hodowanie pokrycia bez ani jednego pustego `it(...)`: metryka domknięta,
// dowodu nie ma. Wszystkie te mutacje po rewizji padają (przemierzone).
//
// Kontrola odwrotna - mutanty, które ginęły od początku i giną nadal: licznik
// z `offers.length` zamiast `roles.length`, chip z licznikiem innego działu,
// `onDepartmentChange` wołane zawsze z „all", `active` liczone ze złego
// porównania, `onDetails` zawsze z pierwszą ofertą, odwrócony warunek
// zamknięcia popupu, `key={department}` zdjęte, `type="button"` zdjęte,
// `aria-pressed` zdjęte, `aria-current` na wszystkich kartach, `aria-live`
// przełączone na „off", `Math.min(index, 7)` bez ogranicznika, opis karty
// podmieniony na tytuł, „Aplikuj" wołające `onDetails`, nadpisanie nagłówka
// z panelu ignorowane, `id` sekcji zaszyte w kodzie.
//
// ---------------------------------------------------------------------------
// ŚWIADOMIE POZA ZAKRESEM
// ---------------------------------------------------------------------------
// * KONTRAKT ZŁOŻENIA TRASY (`applySignal`, przewijanie do formularza, id
//   sekcji jako cel przewinięcia) - `src/routes/__tests__/zatrudniamyRoute.test.tsx`.
// * CZYSTE REGUŁY (filtr, liczniki, `findOffer`, `rowToOffer`, `sectionState`,
//   `fallbackOffers`, parzystość PL/EN słownika) - `src/lib/careers/__tests__/`.
// * DOSTĘPNOŚĆ PRIMITYWU POPUPU (rola `dialog`, dostępna nazwa i opis okna,
//   pułapka fokusu, Escape, `aria-hidden` na rodzeństwie) - primitywy są tu
//   atrapowane, więc axe mierzy TREŚĆ oferty w popupie, nie sam popup.
//   REWIZJA: ten dowód ma już swój plik - `careers/__tests__/careerRoleDialog.test.tsx`
//   NIE atrapuje Radiksa i dowodzi tam roli okna, kolejności sekcji,
//   meta-chipsów, pustych list, kolejności `onOpenChange(false)` przed
//   `onApply` i trzech wyjść (Zamknij / Escape / `×`). Poprzednia wersja tego
//   akapitu mówiła, że takiego pliku „dziś nie ma" - to już nieprawda, a jego
//   nagłówek cytuje tamto zdanie jako powód swojego istnienia. Poza oboma
//   plikami zostaje wyłącznie prawdziwe malowanie (blokada przewijania tła,
//   klik w tło, widoczny pierścień ogniska) - warstwa e2e.
// * AKTYWACJA CHIPU KLAWIATURĄ jako EFEKT. `fireEvent.keyDown(chip, {key:"Enter"})`
//   NIE wywołuje `click` w happy-dom (przeglądarka robi to natywnie, DOM-owa
//   atrapa - nie), więc taka asercja mierzyłaby atrapę zdarzeń, a nie kod.
//   Dowodzimy więc KONTRAKTU, z którego ta obsługa wynika: element jest
//   natywnym `<button type="button">`, przyjmuje fokus i nie nadpisuje
//   `role`/`tabindex`. Gałąź „chip jako `div`" byłaby tu czerwona.
// * GAŁĄŹ `onOpenChange(true)` w `CareersRoles` (`if (!next)` przy `next === true`)
//   jest w tym złożeniu NIEOSIĄGALNA: popup jest w pełni kontrolowany
//   (`open={detailsRole !== null}`) i nie ma w nim `DialogTrigger`, więc Radix
//   nigdy nie zgłosi otwarcia od siebie - jedynym producentem `true` byłby
//   wyzwalacz, którego ta powierzchnia nie ma. To defensywny warunek; wołanie
//   go z atrapy dowodziłoby istnienia atrapy, nie zachowania strony.
// * ANIMACJE JAKO RUCH - mierzymy `animationDelay` i przemontowanie listy
//   (klucz `key={department}`), bo to one decydują o powtórce wejścia; samego
//   malowania klatek happy-dom nie ma.
//
// RODO: żadnych prawdziwych osób ani ofert. Wiersze fixture są zmyślone
// (slugi opisowe, treści jednozdaniowe), nie ma w nich ani nazwisk, ani danych
// kontaktowych. REWIZJA: poprzednia wersja dokładała tu zdanie o adresach
// `@example.com` - ta powierzchnia nie ma żadnego pola adresowego (kontakt
// zbiera formularz aplikacyjny, `careersApplyForm.test.tsx`), więc w tym pliku
// nie ma i nie może być adresu; obietnica bez przedmiotu poszła precz.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState, type ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  /** Język aplikacji - przełączany per test (atrapa czyta go przy każdym renderze). */
  lang: "pl" as "pl" | "en",
  /** Prawdziwy `getFixedT`, wstrzyknięty pod importami - fabryka nic nie importuje. */
  fixedT: null as null | ((lang: "pl" | "en") => TFunction),
  /** Granica danych: `supabase.from` podstawiane per test. */
  from: null as null | ((table: string) => unknown),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT?.(h.lang), i18n: { language: h.lang }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => h.from?.(table) },
}));

// Primitywy popupu: przezroczyste opakowania z JEDNĄ zachowaną regułą Radixa -
// treść jest w DOM tylko przy `open`.
//
// REWIZJA 1. Pierwsza wersja trzymała `open` w MODUŁOWEJ zmiennej
// (`const stan = { open: false }`), którą `Dialog` nadpisywał w trakcie
// renderu, a `DialogContent` czytał przy swoim. Dwie rzeczy były z tym nie tak:
// stan atrapy przeżywał granicę testu (nikt go nie zerował, więc wędrował
// w dół pliku), a sama bramka nigdy się w tym złożeniu nie odpalała -
// `CareerRoleDialog` ma barierę `if (!role) return null`, a
// `open={detailsRole !== null}` jest prawdą DOKŁADNIE wtedy, gdy rola istnieje.
// Atrapa nie widzi tu `open === false` ani razu (`data-open` jest zawsze
// `"true"`), a nośnikiem dowodu „zamknięte = nie ma tego w DOM" jest
// ODMONTOWANIE całego okna, nie ta bramka. Reguła zostaje - bo atrapa nie może
// być łagodniejsza od primitywu - ale siedzi w jednym miejscu i bez zmiennej
// współdzielonej przez wszystkie testy pliku.
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) =>
    open ? (
      <div data-testid="popup" data-open={String(open)}>
        {children}
      </div>
    ) : null,
  DialogContent: ({ children }: { children?: ReactNode }) => (
    <div data-testid="popup-tresc">{children}</div>
  ),
  DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
}));

import type { TFunction } from "i18next";

import { CareersRoles } from "@/components/careers/organisms/CareersRoles";
import {
  careerRolesQueryOptions,
  careerSectionsQueryOptions,
  type CareerRoleRow,
  type CareerSectionRow,
} from "@/lib/careers/catalog";
import { CAREER_DEPARTMENTS, CAREER_ROLES, type CareerDepartmentId } from "@/lib/careers/roles";
import { axeViolations, summarize } from "@/test/axe";
import { realT } from "@/test/i18nReal";
import { fail, ok, type SupabaseResult } from "@/test/supabaseChain";
import "@/lib/i18n-careers";

h.fixedT = realT;

/** Klucze cache czytane z PRAWDZIWYCH `queryOptions` - nie z kopii literału. */
const ROLES_KEY = careerRolesQueryOptions().queryKey;
const SECTIONS_KEY = careerSectionsQueryOptions().queryKey;

/** Identyfikator sekcji - trasa podaje go jako cel przewinięcia „Zobacz role". */
const SECTION_ID = "careers-open-roles";

const pl = realT("pl");
const en = realT("en");

// ---------------------------------------------------------------------------
// FIXTURE
// ---------------------------------------------------------------------------

/**
 * Wiersz `career_roles` w obu językach. Oferta zmyślona: żaden slug, tytuł ani
 * opis nie pochodzi z prawdziwego ogłoszenia, nie ma tu danych kontaktowych.
 */
function roleRow(overrides: Partial<CareerRoleRow> = {}): CareerRoleRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    slug: "analityk-bezpieczenstwa",
    department: "analysis",
    engagement: "full_time",
    seniority: "senior",
    location: "hybrid",
    sort_order: 10,
    is_published: true,
    title_pl: "Analityk bezpieczeństwa",
    title_en: "Security analyst",
    summary_pl: "Prowadzi linię badawczą o bezpieczeństwie europejskim.",
    summary_en: "Runs the European security research line.",
    responsibilities_pl: ["Analizy zdolności obronnych", "Briefy dla instytucji"],
    responsibilities_en: ["Defence capability analysis", "Institutional briefs"],
    requirements_pl: ["Pięć lat pracy analitycznej"],
    requirements_en: ["Five years of analytical work"],
    ...overrides,
  };
}

/** Trzy oferty w dwóch działach - `policy` zostaje PUSTY (dowód pustki). */
const ROW_ANALYST = roleRow();
const ROW_INTERN = roleRow({
  id: "00000000-0000-4000-8000-000000000002",
  slug: "staz-polityka-publiczna",
  department: "analysis",
  engagement: "internship",
  seniority: "junior",
  location: "warsaw",
  sort_order: 20,
  title_pl: "Staż analityczny",
  title_en: "Analytical internship",
  summary_pl: "Półroczny staż przy przeglądach literatury.",
  summary_en: "Six-month internship on literature reviews.",
  responsibilities_pl: ["Research desk-owy"],
  responsibilities_en: ["Desk research"],
  requirements_pl: ["Student kierunków społecznych"],
  requirements_en: ["Social sciences student"],
});
const ROW_MARKETING = roleRow({
  id: "00000000-0000-4000-8000-000000000003",
  slug: "lead-marketingu",
  department: "marketing",
  engagement: "contract",
  seniority: "lead",
  location: "brussels",
  sort_order: 30,
  title_pl: "Lead marketingu",
  title_en: "Marketing lead",
  summary_pl: "Odpowiada za wzrost czytelnictwa newslettera.",
  summary_en: "Owns newsletter readership growth.",
  responsibilities_pl: ["Strategia pozyskania członków"],
  responsibilities_en: ["Member acquisition strategy"],
  requirements_pl: ["Cztery lata w marketingu wzrostowym"],
  requirements_en: ["Four years in growth marketing"],
});
const ROWS = [ROW_ANALYST, ROW_INTERN, ROW_MARKETING];

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
  };
}

// ---------------------------------------------------------------------------
// HARNESS
// ---------------------------------------------------------------------------

/**
 * Łańcuch PostgREST z ODROCZONYM rozwiązaniem.
 *
 * Kontrakt `supabaseFromStub()` mówi „łańcuch rozwiązuje się przy `await`" -
 * to jest jego zaleta wszędzie tam, gdzie liczy się kształt zapytania, i wada
 * dokładnie tutaj: bez stanu „w drodze" nie da się zobaczyć strony, jaką
 * kandydat dostaje przy pierwszym malowaniu. Ogniwa są wypisane JAWNIE
 * (`select`, `order`, `eq` - dokładnie te, które składa
 * `careerRolesQueryOptions`), a nie podstawione `Proxy` na cokolwiek: nieznane
 * ogniwo wywala łańcuch, zamiast zostać cicho pochłonięte. KSZTAŁTU zapytania
 * ten plik nie dowodzi - to przedmiot `catalog.test.ts` i warstwy danych.
 */
function deferredChain(): { chain: unknown; settle: (result: SupabaseResult) => void } {
  let settle: (result: SupabaseResult) => void = () => {};
  const promise = new Promise<SupabaseResult>((resolve) => {
    settle = resolve;
  });
  const chain: Record<string, unknown> = {
    then: (onOk: (value: SupabaseResult) => unknown, onErr?: (reason: unknown) => unknown) =>
      promise.then(onOk, onErr),
  };
  for (const link of ["select", "order", "eq"]) chain[link] = () => chain;
  return { chain, settle: (result) => settle(result) };
}

interface Seed {
  /** `undefined` = wiersz cache NIE zasiany (zapytanie naprawdę pojedzie). */
  offers?: CareerRoleRow[];
  sections?: CareerSectionRow[];
}

function makeClient(seed: Seed): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (seed.offers !== undefined) queryClient.setQueryData(ROLES_KEY, seed.offers);
  queryClient.setQueryData(SECTIONS_KEY, seed.sections ?? []);
  return queryClient;
}

/**
 * Render z filtrem STEROWANYM Z ZEWNĄTRZ - tak, jak jeden moment życia trasy.
 * Dzięki temu widać różnicę między „chip zgłosił wybór" a „lista się zawęziła":
 * to dwie różne rzeczy i tylko druga wymaga zmiany stanu w trasie.
 */
function renderRoles(
  opts: Seed & {
    department?: CareerDepartmentId | "all";
    selectedRoleId?: string | null;
  } = {},
) {
  const onDepartmentChange = vi.fn();
  const onApply = vi.fn();
  const utils = render(
    <QueryClientProvider client={makeClient(opts)}>
      <CareersRoles
        id={SECTION_ID}
        department={opts.department ?? "all"}
        onDepartmentChange={onDepartmentChange}
        selectedRoleId={opts.selectedRoleId ?? null}
        onApply={onApply}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onDepartmentChange, onApply };
}

/**
 * Render z filtrem TRZYMANYM WYŻEJ, jak w `src/routes/zatrudniamy.tsx`
 * (stan działu i wybranej roli żyje w trasie). Potrzebny do pełnej pętli
 * „klik chipu -> zawężona lista -> licznik".
 */
function renderHosted(opts: Seed = {}) {
  const onApply = vi.fn();
  function Host() {
    const [department, setDepartment] = useState<CareerDepartmentId | "all">("all");
    const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
    return (
      <CareersRoles
        id={SECTION_ID}
        department={department}
        onDepartmentChange={setDepartment}
        selectedRoleId={selectedRoleId}
        onApply={(roleId) => {
          onApply(roleId);
          setSelectedRoleId(roleId);
        }}
      />
    );
  }
  const utils = render(
    <QueryClientProvider client={makeClient(opts)}>
      <Host />
    </QueryClientProvider>,
  );
  return { ...utils, onApply };
}

/** Karty ofert - `<article>` na ofertę. */
function cards(): HTMLElement[] {
  return screen.getAllByRole("article");
}

/** Chip filtra: nazwa dostępna = etykieta + licznik, więc jedna asercja mierzy oba. */
function chip(label: string, count: number): HTMLElement {
  return screen.getByRole("button", { name: `${label} ${count}` });
}

/**
 * WSZYSTKIE chipsy filtra - „Wszystkie" + jeden na dział. Rozpoznawane po
 * nazwie dostępnej kończącej się liczbą; przyciski kart („Aplikuj", „Pełna
 * oferta") kończą się słowem, więc do tej selekcji nie wchodzą.
 */
function allChips(): HTMLElement[] {
  return screen.getAllByRole("button", { name: /\d+$/ });
}

/** Chipsy zgłoszone czytnikowi jako wciśnięte - do asercji „dokładnie jeden". */
function pressedChips(): HTMLElement[] {
  return allChips().filter((el) => el.getAttribute("aria-pressed") === "true");
}

/** Licznik wewnątrz chipu (druga plamka) - ma WŁASNĄ parę klas zależną od `active`. */
function badge(target: HTMLElement): HTMLElement {
  const spans = target.querySelectorAll<HTMLElement>("span");
  if (spans.length !== 2) throw new Error(`Chip ma ${spans.length} plamek, oczekiwano 2`);
  return spans[1];
}

/** Region `aria-live` z licznikiem „widoczne / całość". */
function counter(container: HTMLElement): HTMLElement {
  const live = container.querySelector<HTMLElement>('p[aria-live="polite"]');
  if (!live) throw new Error("Brak regionu aria-live z licznikiem ofert");
  return live;
}

beforeEach(() => {
  h.lang = "pl";
  h.from = (table: string) => {
    throw new Error(`Test nie zadeklarował odpowiedzi dla tabeli ${table}`);
  };
});

// ---------------------------------------------------------------------------

describe("CareersRoles: licznik zgadza się z listą", () => {
  it("pokazuje liczbę widocznych ofert obok całości katalogu w regionie aria-live", () => {
    const { container } = renderRoles({ offers: ROWS });

    expect(cards()).toHaveLength(3);
    const live = counter(container);
    expect(live).toHaveAttribute("aria-live", "polite");
    // Pierwsza liczba = karty na ekranie, druga = całość katalogu ze słownika
    // (`showingShort` interpoluje `total`), rozdzielone dekoracyjnym ukośnikiem.
    expect(live.textContent).toBe(`3/${pl("careers.roles.showingShort", { total: 3 })}`);
    expect(live.querySelector("span[aria-hidden]")?.textContent).toBe("/");
  });

  it("etykieta statusu i nagłówek sekcji pochodzą ze słownika", () => {
    renderRoles({ offers: ROWS });

    expect(screen.getByText(pl("careers.roles.statusLabel"))).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: pl("careers.roles.title") }),
    ).toBeVisible();
    expect(screen.getByText(pl("careers.roles.subtitle"))).toBeInTheDocument();
  });

  it("po zawężeniu do działu licznik i lista maleją RAZEM", () => {
    const { container } = renderHosted({ offers: ROWS });
    expect(counter(container).textContent).toBe(
      `3/${pl("careers.roles.showingShort", { total: 3 })}`,
    );

    fireEvent.click(chip(pl("careers.departments.analysis"), 2));

    expect(cards()).toHaveLength(2);
    // Druga liczba to CAŁOŚĆ katalogu - zawężenie jej nie rusza.
    expect(counter(container).textContent).toBe(
      `2/${pl("careers.roles.showingShort", { total: 3 })}`,
    );
    expect(screen.queryByText(ROW_MARKETING.title_pl)).toBeNull();
    expect(screen.getByText(ROW_ANALYST.title_pl)).toBeVisible();
    expect(screen.getByText(ROW_INTERN.title_pl)).toBeVisible();
  });

  it("kolejność kart to kolejność listy ofert (kolejność = prezentacja)", () => {
    renderRoles({ offers: ROWS });

    const titles = cards().map(
      (card) => within(card).getByRole("heading", { level: 3 }).textContent,
    );
    expect(titles).toEqual([ROW_ANALYST.title_pl, ROW_INTERN.title_pl, ROW_MARKETING.title_pl]);
  });
});

describe("CareersRoles: chipsy filtra działów", () => {
  it("każdy dział ma chip z własnym licznikiem, także zerowym", () => {
    renderRoles({ offers: ROWS });

    const expected: Record<CareerDepartmentId, number> = {
      analysis: 2,
      policy: 0,
      marketing: 1,
      advisory: 0,
      editorial: 0,
      operations: 0,
    };
    for (const dept of CAREER_DEPARTMENTS) {
      expect(chip(pl(`careers.departments.${dept}`), expected[dept]), dept).toBeVisible();
    }
    // Chip „Wszystkie" niesie całość, a nie sumę widocznych kart.
    expect(chip(pl("careers.roles.all"), 3)).toBeVisible();
    expect(screen.getAllByRole("button", { name: /\d+$/ })).toHaveLength(
      CAREER_DEPARTMENTS.length + 1,
    );
  });

  it("grupa chipsów ma etykietę ze słownika", () => {
    renderRoles({ offers: ROWS });

    const group = screen.getByRole("group", { name: pl("careers.departments.all") });
    expect(group).toContainElement(chip(pl("careers.roles.all"), 3));
  });

  it("wciśnięty jest DOKŁADNIE jeden chip - ten aktywnego działu", () => {
    renderRoles({ offers: ROWS, department: "analysis" });

    // REWIZJA 2. Pierwsza wersja sprawdzała TRZY z siedmiu chipsów, a nazwa
    // obiecywała „dokładnie". Defekt z listy powodów istnienia tego pliku
    // („aria-pressed przyklejone do wszystkich") mógł więc siedzieć
    // w niesprawdzonej czwórce. Teraz asercja przechodzi po WSZYSTKICH.
    const wszystkie = allChips();
    expect(wszystkie).toHaveLength(CAREER_DEPARTMENTS.length + 1);
    // Brak atrybutu to też defekt: czytnik nie wie wtedy, że to przełącznik.
    for (const c of wszystkie) expect(c, c.textContent ?? "").toHaveAttribute("aria-pressed");
    expect(pressedChips()).toEqual([chip(pl("careers.departments.analysis"), 2)]);
  });

  it("bez zawężenia wciśnięty jest DOKŁADNIE chip „Wszystkie”", () => {
    renderRoles({ offers: ROWS });

    expect(pressedChips()).toEqual([chip(pl("careers.roles.all"), 3)]);
  });

  it("aktywny chip nosi też WZROKOWY sygnał wyboru, a nieaktywne neutralny", () => {
    renderRoles({ offers: ROWS, department: "analysis" });
    const aktywny = chip(pl("careers.departments.analysis"), 2);
    const nieaktywne = allChips().filter((c) => c !== aktywny);

    // REWIZJA 3. `aria-pressed` obsługiwał czytnik ekranu, ale WZROKOWY sygnał
    // („który filtr jest włączony") nie miał ani jednej asercji. Obie gałęzie
    // `cn(...)` w `CareerFilterChip` były PRZEBIEGANE w każdym teście - chip
    // aktywny i sześć nieaktywnych renderuje się razem - więc pokrycie gałęzi
    // pokazywało 100%, a ZAMIANA klas aktywny<->nieaktywny (osobno w chipie,
    // osobno w jego liczniku) przechodziła cały plik bez śladu: kandydat
    // widziałby podświetlony chip innego działu, niż filtruje lista. Zmierzone
    // mutacją: oba warianty przeżywały 43 testy.
    expect(aktywny).toHaveClass("border-primary/60", "bg-primary/10", "text-foreground");
    expect(badge(aktywny)).toHaveClass("bg-primary/20", "text-primary");
    for (const c of nieaktywne) {
      const opis = c.textContent ?? "";
      expect(c, opis).toHaveClass("border-border/70", "bg-card/60", "text-muted-foreground");
      expect(c, opis).not.toHaveClass("border-primary/60");
      expect(c, opis).not.toHaveClass("bg-primary/10");
      expect(badge(c), opis).toHaveClass("bg-muted", "text-muted-foreground");
      expect(badge(c), opis).not.toHaveClass("bg-primary/20");
    }
  });

  it("chip ZGŁASZA wybór w górę i sam nie filtruje listy (autorytet stanu jest w trasie)", () => {
    const { onDepartmentChange } = renderRoles({ offers: ROWS });

    fireEvent.click(chip(pl("careers.departments.policy"), 0));

    expect(onDepartmentChange).toHaveBeenCalledTimes(1);
    expect(onDepartmentChange).toHaveBeenCalledWith("policy");
    // Prop `department` się nie zmienił, więc lista MUSI zostać nietknięta.
    expect(cards()).toHaveLength(3);
  });

  it("chip „Wszystkie” zgłasza zdjęcie filtra", () => {
    const { onDepartmentChange } = renderRoles({ offers: ROWS, department: "analysis" });

    fireEvent.click(chip(pl("careers.roles.all"), 3));

    expect(onDepartmentChange).toHaveBeenCalledTimes(1);
    expect(onDepartmentChange).toHaveBeenCalledWith("all");
    // Zdjęcie filtra to JEDEN sygnał - nie „all" poprzedzone działem.
    expect(onDepartmentChange.mock.calls).toEqual([["all"]]);
  });

  it("chip jest NATYWNYM przyciskiem: przyjmuje fokus, ma type=button, nie nadpisuje role/tabindex", () => {
    renderRoles({ offers: ROWS });
    const target = chip(pl("careers.departments.marketing"), 1);

    expect(target.tagName).toBe("BUTTON");
    expect(target).toHaveAttribute("type", "button");
    expect(target).not.toHaveAttribute("role");
    expect(target).not.toHaveAttribute("tabindex");
    expect(target).not.toBeDisabled();
    target.focus();
    expect(document.activeElement).toBe(target);
  });

  it("zmiana filtra PRZEMONTOWUJE listę, żeby wejście kart zagrało od nowa", () => {
    renderHosted({ offers: ROWS });
    const before = screen.getByText(ROW_ANALYST.title_pl);

    fireEvent.click(chip(pl("careers.departments.analysis"), 2));

    const after = screen.getByText(ROW_ANALYST.title_pl);
    expect(after).not.toBe(before);
    expect(document.body.contains(before)).toBe(false);
  });
});

describe("CareersRoles: pustka po zawężeniu filtrów", () => {
  it("dział bez ofert pokazuje komunikat ze słownika zamiast pustego miejsca", () => {
    const { container } = renderHosted({ offers: ROWS });

    fireEvent.click(chip(pl("careers.departments.policy"), 0));

    expect(screen.queryAllByRole("article")).toHaveLength(0);
    expect(screen.getByText(pl("careers.roles.empty"))).toBeVisible();
    expect(counter(container).textContent).toBe(
      `0/${pl("careers.roles.showingShort", { total: 3 })}`,
    );
  });

  it("komunikat pustki znika po powrocie do „Wszystkie”", () => {
    renderHosted({ offers: ROWS });
    fireEvent.click(chip(pl("careers.departments.editorial"), 0));
    expect(screen.getByText(pl("careers.roles.empty"))).toBeVisible();

    fireEvent.click(chip(pl("careers.roles.all"), 3));

    expect(screen.queryByText(pl("careers.roles.empty"))).toBeNull();
    expect(cards()).toHaveLength(3);
  });
});

describe("CareerRoleCard: treść oferty i jej oznaczenia", () => {
  it("karta niesie dział i poziom ze słownika, a tytuł i opis z WIERSZA bazy", () => {
    renderRoles({ offers: [ROW_ANALYST] });
    const card = cards()[0];

    expect(within(card).getByRole("heading", { level: 3 })).toHaveTextContent(ROW_ANALYST.title_pl);
    expect(within(card).getByText(ROW_ANALYST.summary_pl)).toBeVisible();
    expect(within(card).getByText(pl("careers.departments.analysis"))).toBeVisible();
    expect(within(card).getByText(pl("careers.seniority.senior"))).toBeVisible();
    // Tytuł NIE pochodzi z katalogu wbudowanego - wiersz bazy wygrywa.
    expect(screen.queryByText(pl(`careers.roles.${CAREER_ROLES[0].id}.title`))).toBeNull();
  });

  it("dwa znaczniki, a ikony w nich nie mają WŁASNEJ nazwy dostępnej", () => {
    renderRoles({ offers: [ROW_ANALYST] });
    const markers = within(cards()[0]).getAllByRole("listitem");

    expect(markers).toHaveLength(2);
    // Ikona nie dokłada nic do nazwy dostępnej - inaczej czytnik czytałby śmieć.
    expect(markers[0].textContent).toBe(pl("careers.location.hybrid"));
    expect(markers[1].textContent).toBe(pl("careers.engagement.full_time"));
    for (const marker of markers) {
      const ikona = marker.querySelector("svg");
      expect(ikona).toHaveAttribute("aria-hidden", "true");
      // REWIZJA 6. Sam `aria-hidden` nie jest dowodem DECYZJI karty:
      // `lucide-react` dokłada go z siebie, gdy ikona nie ma dziecka ani
      // propsa dostępnościowego (`Icon.js`: `...!children && !hasA11yProp(rest)
      // && { "aria-hidden": "true" }`), więc zdjęcie `aria-hidden` z JSX-a jest
      // mutacją RÓWNOWAŻNĄ - DOM wychodzi identyczny (zmierzone). Rozstrzyga
      // druga połowa: nadanie ikonie nazwy odbiera lucide'owi domyślne
      // ukrycie i czytnik ogłasza „map pin Hybryda" - i to ta mutacja pada.
      expect(ikona).not.toHaveAttribute("aria-label");
      expect(ikona).not.toHaveAttribute("aria-labelledby");
      expect(ikona).not.toHaveAttribute("role");
    }
  });

  it("każda karta niesie WŁASNE fasety, nie fasety pierwszej oferty", () => {
    renderRoles({ offers: ROWS });
    const [analyst, intern, marketing] = cards();

    expect(
      within(analyst)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual([pl("careers.location.hybrid"), pl("careers.engagement.full_time")]);
    expect(
      within(intern)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual([pl("careers.location.warsaw"), pl("careers.engagement.internship")]);
    expect(
      within(marketing)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual([pl("careers.location.brussels"), pl("careers.engagement.contract")]);
    expect(within(intern).getByText(pl("careers.seniority.junior"))).toBeVisible();
    expect(within(marketing).getByText(pl("careers.departments.marketing"))).toBeVisible();
  });

  it("wybrana rola jest oznaczona aria-current DOKŁADNIE na jednej karcie", () => {
    renderRoles({ offers: ROWS, selectedRoleId: ROW_INTERN.slug });
    const [analyst, intern, marketing] = cards();

    expect(intern).toHaveAttribute("aria-current", "true");
    expect(analyst).not.toHaveAttribute("aria-current");
    expect(marketing).not.toHaveAttribute("aria-current");
  });

  it("wybrana karta ma WSZYSTKIE TRZY warstwy sygnału wyboru, pozostałe żadnej", () => {
    renderRoles({ offers: ROWS, selectedRoleId: ROW_INTERN.slug });
    const [analyst, intern, marketing] = cards();

    // REWIZJA 4. Pierwsza wersja sprawdzała TYLKO pierwszą warstwę (obwódkę)
    // i tylko na dwóch z trzech kart. Belka gradientowa i poświata mają własne
    // gałęzie `selected`, obie PRZEBIEGANE w tym samym renderze (karta wybrana
    // + dwie niewybrane), więc pokrycie gałęzi czytało 100%, a wycięcie
    // `selected ? ... :` z którejkolwiek z nich przeżywało 43 testy: wybrana
    // rola wyglądałaby jak każda inna, dopóki kandydat nie najedzie kursorem.
    //
    // REWIZJA 5. Asercja `intern.className).toContain("-translate-y-0.5")`
    // była PUSTA: klasa bazowa karty to `hover:-translate-y-0.5`, więc szukany
    // NAPIS siedzi w każdej karcie, wybranej i nie. Zmierzone mutacją: zdjęcie
    // `selected && "-translate-y-0.5"` z produkcji nie zapalało nic. Dlatego
    // tu i niżej `toHaveClass` (dopasowanie CAŁEGO tokenu), nie `toContain`.
    const warstwy = (card: HTMLElement) =>
      [...card.children].filter((el): el is HTMLElement => el.tagName === "SPAN");

    const [obwodka, belka, poswiata] = warstwy(intern);
    expect(warstwy(intern)).toHaveLength(3);
    // Warstwy są DEKORACJĄ: puste, bez zdarzeń i wyjęte z drzewa dostępności.
    for (const warstwa of warstwy(intern)) {
      expect(warstwa).toHaveAttribute("aria-hidden");
      expect(warstwa).toHaveClass("pointer-events-none");
      expect(warstwa.textContent).toBe("");
    }
    expect(obwodka).toHaveClass("border-brand/50", "bg-brand/[0.08]");
    expect(belka).toHaveClass("bg-[position:0%_100%]");
    expect(poswiata).toHaveClass("bg-[position:0%_100%]", "opacity-50");
    expect(intern).toHaveClass("-translate-y-0.5");

    for (const card of [analyst, marketing]) {
      const opis = within(card).getByRole("heading", { level: 3 }).textContent ?? "";
      const [tloObwodka, tloBelka, tloPoswiata] = warstwy(card);
      expect(tloObwodka, opis).toHaveClass("border-border/60", "bg-brand/[0.04]");
      expect(tloObwodka, opis).not.toHaveClass("border-brand/50");
      // Niewybrana karta pokazuje ruch DOPIERO pod kursorem - stąd modyfikator.
      expect(tloBelka, opis).toHaveClass("group-hover:bg-[position:0%_100%]");
      expect(tloBelka, opis).not.toHaveClass("bg-[position:0%_100%]");
      expect(tloPoswiata, opis).toHaveClass("group-hover:opacity-50");
      expect(tloPoswiata, opis).not.toHaveClass("opacity-50");
      expect(card, opis).not.toHaveClass("-translate-y-0.5");
    }
  });

  it("„Aplikuj” oddaje w górę SLUG tej karty, nie klucz główny wiersza", () => {
    const { onApply } = renderRoles({ offers: ROWS });

    fireEvent.click(within(cards()[2]).getByRole("button", { name: pl("careers.roles.apply") }));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(ROW_MARKETING.slug);
    expect(onApply).not.toHaveBeenCalledWith(ROW_MARKETING.id);
  });

  it("wskazanie roli z karty wraca w dół jako oznaczenie wybranej oferty", () => {
    const { onApply } = renderHosted({ offers: ROWS });

    fireEvent.click(within(cards()[1]).getByRole("button", { name: pl("careers.roles.apply") }));

    expect(onApply).toHaveBeenCalledWith(ROW_INTERN.slug);
    expect(cards()[1]).toHaveAttribute("aria-current", "true");
    expect(cards()[0]).not.toHaveAttribute("aria-current");
  });

  it("odstęp wejścia rośnie z pozycją i PRZESTAJE rosnąć na ósmej karcie", () => {
    // Pusta tabela ofert -> katalog wbudowany (10 ról), czyli jedyny stan,
    // w którym widać zatrzymanie kaskady.
    renderRoles({ offers: [] });
    const delays = cards().map((card) => (card.parentElement as HTMLElement).style.animationDelay);

    expect(delays).toHaveLength(CAREER_ROLES.length);
    expect(delays.slice(0, 3)).toEqual(["0ms", "55ms", "110ms"]);
    expect(delays[7]).toBe("385ms");
    expect(delays[8]).toBe("385ms");
    expect(delays[9]).toBe("385ms");
    expect(cards()[0].parentElement).toHaveClass("crs-pop");
  });
});

describe("CareersRoles: dwujęzyczność listy", () => {
  it("po polsku bierze polskie kolumny wiersza i polskie fasety", () => {
    renderRoles({ offers: [ROW_MARKETING] });

    expect(screen.getByText(ROW_MARKETING.title_pl)).toBeVisible();
    expect(screen.queryByText(ROW_MARKETING.title_en)).toBeNull();
    expect(screen.getByText(pl("careers.location.brussels"))).toBeVisible();
    expect(screen.getByRole("button", { name: pl("careers.roles.details") })).toBeVisible();
  });

  it("po angielsku bierze angielskie kolumny wiersza i angielskie fasety", () => {
    h.lang = "en";
    renderRoles({ offers: [ROW_MARKETING] });

    expect(screen.getByText(ROW_MARKETING.title_en)).toBeVisible();
    expect(screen.queryByText(ROW_MARKETING.title_pl)).toBeNull();
    const markers = within(cards()[0]).getAllByRole("listitem");
    expect(markers.map((li) => li.textContent)).toEqual([
      en("careers.location.brussels"),
      en("careers.engagement.contract"),
    ]);
    // Gdyby komponent ignorował język, te napisy byłyby identyczne z polskimi.
    expect(en("careers.location.brussels")).not.toBe(pl("careers.location.brussels"));
    expect(en("careers.engagement.contract")).not.toBe(pl("careers.engagement.contract"));
    expect(screen.getByRole("button", { name: en("careers.roles.apply") })).toBeVisible();
    expect(chip(en("careers.departments.marketing"), 1)).toBeVisible();
    expect(chip(en("careers.roles.all"), 1)).toBeVisible();
  });

  it("pusta tabela ofert pokazuje katalog wbudowany w AKTYWNYM języku", () => {
    h.lang = "en";
    const { container } = renderRoles({ offers: [] });

    expect(cards()).toHaveLength(CAREER_ROLES.length);
    expect(screen.getByText(en(`careers.roles.${CAREER_ROLES[0].id}.title`))).toBeVisible();
    expect(screen.queryByText(pl(`careers.roles.${CAREER_ROLES[0].id}.title`))).toBeNull();
    expect(counter(container).textContent).toBe(
      `${CAREER_ROLES.length}/${en("careers.roles.showingShort", { total: CAREER_ROLES.length })}`,
    );
  });

  it("żaden klucz i18n nie wycieka na ekran - w PL i w EN", () => {
    const polska = renderRoles({ offers: [] });
    expect(polska.container.textContent).not.toMatch(/careers\./);
    polska.unmount();

    h.lang = "en";
    const angielska = renderRoles({ offers: [] });
    expect(angielska.container.textContent).not.toMatch(/careers\./);
  });
});

describe("CareersRoles: otwarcie szczegółów oferty", () => {
  it("popup jest zamknięty, dopóki nikt nie poprosi o pełną ofertę", () => {
    renderRoles({ offers: ROWS });

    expect(screen.queryByTestId("popup")).toBeNull();
    expect(screen.queryByTestId("popup-tresc")).toBeNull();
  });

  it("„Pełna oferta” otwiera popup z ofertą TEJ karty, nie pierwszej z listy", () => {
    renderRoles({ offers: ROWS });

    fireEvent.click(within(cards()[1]).getByRole("button", { name: pl("careers.roles.details") }));

    expect(screen.getByTestId("popup")).toHaveAttribute("data-open", "true");
    const popup = screen.getByTestId("popup-tresc");
    expect(within(popup).getByRole("heading", { level: 2 })).toHaveTextContent(ROW_INTERN.title_pl);
    expect(within(popup).getByText(ROW_INTERN.summary_pl)).toBeVisible();
    expect(within(popup).queryByText(ROW_ANALYST.title_pl)).toBeNull();
  });

  it("popup niesie zakres obowiązków i wymagania z wiersza oraz nagłówki ze słownika", () => {
    renderRoles({ offers: ROWS });

    fireEvent.click(within(cards()[0]).getByRole("button", { name: pl("careers.roles.details") }));
    const popup = screen.getByTestId("popup-tresc");

    expect(within(popup).getByText(pl("careers.roles.dialog.overview"))).toBeVisible();
    expect(within(popup).getByText(pl("careers.roles.dialog.responsibilities"))).toBeVisible();
    expect(within(popup).getByText(pl("careers.roles.dialog.requirements"))).toBeVisible();
    for (const item of [...ROW_ANALYST.responsibilities_pl, ...ROW_ANALYST.requirements_pl]) {
      expect(within(popup).getByText(item), item).toBeVisible();
    }
    // Cztery meta-chipsy: lokalizacja, tryb, poziom, dział.
    expect(within(popup).getByText(pl("careers.location.hybrid"))).toBeVisible();
    expect(within(popup).getByText(pl("careers.seniority.senior"))).toBeVisible();
    expect(within(popup).getAllByText(pl("careers.departments.analysis"))).toHaveLength(2);
  });

  it("„Aplikuj” w popupie oddaje slug i zamyka popup", () => {
    const { onApply } = renderRoles({ offers: ROWS });
    fireEvent.click(within(cards()[2]).getByRole("button", { name: pl("careers.roles.details") }));
    const popup = screen.getByTestId("popup-tresc");

    fireEvent.click(within(popup).getByRole("button", { name: pl("careers.roles.apply") }));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(ROW_MARKETING.slug);
    expect(screen.queryByTestId("popup-tresc")).toBeNull();
  });

  it("„Zamknij” zamyka popup bez zgłaszania aplikacji", () => {
    const { onApply } = renderRoles({ offers: ROWS });
    fireEvent.click(within(cards()[0]).getByRole("button", { name: pl("careers.roles.details") }));

    fireEvent.click(
      within(screen.getByTestId("popup-tresc")).getByRole("button", {
        name: pl("careers.roles.dialog.close"),
      }),
    );

    expect(screen.queryByTestId("popup-tresc")).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("po zamknięciu można otworzyć szczegóły INNEJ oferty", () => {
    renderRoles({ offers: ROWS });
    fireEvent.click(within(cards()[0]).getByRole("button", { name: pl("careers.roles.details") }));
    fireEvent.click(
      within(screen.getByTestId("popup-tresc")).getByRole("button", {
        name: pl("careers.roles.dialog.close"),
      }),
    );

    fireEvent.click(within(cards()[2]).getByRole("button", { name: pl("careers.roles.details") }));

    expect(
      within(screen.getByTestId("popup-tresc")).getByRole("heading", { level: 2 }),
    ).toHaveTextContent(ROW_MARKETING.title_pl);
  });
});

describe("CareersRoles: nagłówek sekcji z panelu redakcji", () => {
  it("brak wiersza sekcji w bazie spada na słownik", () => {
    renderRoles({ offers: ROWS, sections: [] });

    expect(
      screen.getByRole("heading", { level: 2, name: pl("careers.roles.title") }),
    ).toBeVisible();
    expect(screen.getByText(pl("careers.roles.subtitle"))).toBeVisible();
  });

  it("nadpisanie z panelu wygrywa nad słownikiem", () => {
    renderRoles({
      offers: ROWS,
      sections: [
        sectionRow({ title_pl: "Rekrutujemy do zespołu badawczego", subtitle_pl: "Cztery etapy." }),
      ],
    });

    expect(
      screen.getByRole("heading", { level: 2, name: "Rekrutujemy do zespołu badawczego" }),
    ).toBeVisible();
    expect(screen.getByText("Cztery etapy.")).toBeVisible();
    expect(screen.queryByText(pl("careers.roles.title"))).toBeNull();
    expect(screen.queryByText(pl("careers.roles.subtitle"))).toBeNull();
  });

  it("puste nadpisanie NIE zjada nagłówka ze słownika", () => {
    // `sectionState` normalizuje pusty napis do `null`, więc `??` musi wpuścić słownik.
    renderRoles({ offers: ROWS, sections: [sectionRow({ title_pl: "", subtitle_pl: "" })] });

    expect(
      screen.getByRole("heading", { level: 2, name: pl("careers.roles.title") }),
    ).toBeVisible();
    expect(screen.getByText(pl("careers.roles.subtitle"))).toBeVisible();
  });

  it("sekcja wiąże swój nagłówek i nosi identyfikator podany przez trasę", () => {
    const { container } = renderRoles({ offers: ROWS });
    const section = container.querySelector("section");

    expect(section).toHaveAttribute("id", SECTION_ID);
    expect(section).toHaveAttribute("aria-labelledby", "careers-roles");
    expect(screen.getByRole("heading", { level: 2 })).toHaveAttribute("id", "careers-roles");
  });

  it("ZNALEZISKO: `is_visible: false` z panelu NIE ukrywa sekcji na stronie publicznej", () => {
    // Stan ISTNIEJĄCY. `useCareerSection` oddaje `visible: false`, ale
    // `CareersRoles` czyta ze zwrotki wyłącznie `title`/`subtitle`, więc
    // przełącznik „widoczna" w /admin/hiring nie ma tu żadnego skutku.
    // Nagłówki wiersza ukrytego widok ucina do NULL (migracja 20260817230000),
    // dlatego jedyne, co się zmienia, to powrót nagłówka do słownika.
    renderRoles({
      offers: ROWS,
      sections: [sectionRow({ is_visible: false, title_pl: null, subtitle_pl: null })],
    });

    expect(
      screen.getByRole("heading", { level: 2, name: pl("careers.roles.title") }),
    ).toBeVisible();
    expect(cards()).toHaveLength(3);
  });
});

describe("CareersRoles: stan wejściowy strony (dane w drodze, pusta tabela, awaria)", () => {
  it("ZNALEZISKO: w trakcie wczytywania widać komunikat o braku rekrutacji i licznik 0/0", async () => {
    const deferred = deferredChain();
    h.from = () => deferred.chain;
    // Bez zasianego wiersza cache zapytanie NAPRAWDĘ jedzie do granicy danych.
    const { container } = renderRoles({ sections: [] });

    // Stan pierwszego malowania: `isLoading` odrzucone, pusta lista udaje pustkę.
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    expect(screen.getByText(pl("careers.roles.empty"))).toBeVisible();
    expect(counter(container).textContent).toBe(
      `0/${pl("careers.roles.showingShort", { total: 0 })}`,
    );
    expect(chip(pl("careers.roles.all"), 0)).toBeVisible();

    deferred.settle(ok([]));

    await waitFor(() => expect(cards()).toHaveLength(CAREER_ROLES.length));
    expect(screen.queryByText(pl("careers.roles.empty"))).toBeNull();
    expect(screen.getByText(pl(`careers.roles.${CAREER_ROLES[0].id}.title`))).toBeVisible();
  });

  it("awaria zapytania degraduje do katalogu wbudowanego, nie do pustej strony", async () => {
    const deferred = deferredChain();
    h.from = () => deferred.chain;
    renderRoles({ sections: [] });

    deferred.settle(fail("kontakt z bazą przerwany"));

    await waitFor(() => expect(cards()).toHaveLength(CAREER_ROLES.length));
    expect(screen.getByText(pl(`careers.roles.${CAREER_ROLES[0].id}.title`))).toBeVisible();
    expect(chip(pl("careers.roles.all"), CAREER_ROLES.length)).toBeVisible();
  });

  it("katalog wbudowany karmi chipsy tymi samymi licznikami, co lista", () => {
    renderRoles({ offers: [] });

    let suma = 0;
    for (const dept of CAREER_DEPARTMENTS) {
      const oczekiwane = CAREER_ROLES.filter((role) => role.department === dept).length;
      suma += oczekiwane;
      expect(chip(pl(`careers.departments.${dept}`), oczekiwane), dept).toBeVisible();
    }
    expect(suma).toBe(CAREER_ROLES.length);
    expect(cards()).toHaveLength(CAREER_ROLES.length);
  });
});

describe("CareersRoles: dostępność", () => {
  it("nie ma naruszeń axe na liście z wybraną rolą i pełnym zestawem chipsów", async () => {
    const { container } = renderRoles({ offers: ROWS, selectedRoleId: ROW_INTERN.slug });

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("nie ma naruszeń axe w stanie pustki po zawężeniu filtra", async () => {
    const { container } = renderRoles({ offers: ROWS, department: "advisory" });

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("nie ma naruszeń axe w treści otwartej oferty", async () => {
    const { container } = renderRoles({ offers: ROWS });
    fireEvent.click(within(cards()[0]).getByRole("button", { name: pl("careers.roles.details") }));

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
