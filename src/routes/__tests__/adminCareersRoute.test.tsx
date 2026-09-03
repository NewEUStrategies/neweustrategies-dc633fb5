/**
 * Trasa `/admin/careers` ZAMONTOWANA - skrzynka zgłoszeń rekrutacyjnych ze
 * strony /zatrudniamy. Przed tym plikiem 0/109 linii, 0/42 funkcji i 0/151
 * gałęzi: najgłębsza czarna dziura modułu „Rekrutacja / kariera" i największa
 * liczba niepokrytych gałęzi w całym module.
 *
 * PO CO TEN PLIK. To jedyny ekran w repo, na którym operator obraca DANYMI
 * OSOBOWYMI KANDYDATA: imieniem, adresem, telefonem, treścią zgłoszenia
 * i PLIKIEM CV z prywatnego bucketu. Cztery decyzje tego ekranu mają skutki,
 * których nie da się cofnąć kliknięciem:
 *   1. DOSTĘP DO CV - panel podpisuje link do pliku w prywatnym buckecie na
 *      podstawie `custom.cv_path`, czyli pola, które przyszło z PUBLICZNEGO
 *      formularza. Bez bramki kształtu jedno podmienione pole w żądaniu daje
 *      podpisany adres do dowolnego obiektu w buckecie - czyli do CV innego
 *      kandydata (uzasadnienie stoi przy `CV_PATH_RE` w `recruitmentShared`).
 *   2. USUNIĘCIE ZGŁOSZENIA - kaskada zabiera wiersz procesu i dziennik,
 *      a trigger `career_cv_enqueue_on_message_delete` kolejkuje plik CV do
 *      wymazania z magazynu. Panel nie ma tu żadnego „cofnij".
 *   3. PRZEJŚCIA ETAPÓW - `stage` razem z `stage_note` jadą JEDNYM UPDATE-em,
 *      bo dziennik decyzji („kogo i dlaczego odrzuciliśmy") pisze trigger
 *      `career_application_log_stage`. Rozdzielenie tych dwóch zapisów
 *      zostawiłoby zmianę etapu bez uzasadnienia w audycie.
 *   4. OZNACZANIE PRZECZYTANE - efekt uboczny SAMEGO otwarcia zgłoszenia,
 *      widoczny w drugiej skrzynce (Contact Center czyta tę samą tabelę).
 *
 * ---------------------------------------------------------------------------
 * PYTANIE 1: GDZIE NAPRAWDĘ STOI BRAMKA UPRAWNIEŃ - USTALENIE, NIE ZAŁOŻENIE
 * ---------------------------------------------------------------------------
 * Sprawdzone przed napisaniem asercji, nie założone:
 *   1. `src/routes/admin.tsx` (wspólny layout `/admin`) - JEDYNA bramka
 *      renderu: `useAuth()` daje `isStaff`, efekt robi
 *      `navigate({ to: "/login" })`, a komponent zwraca `null`.
 *   2. TA trasa - zero warunku roli: nie ma `useAuth`, `beforeLoad`,
 *      `redirect` ani `<Navigate/>`.
 *   3. Odczyt i zapis idą ZWYKŁYM klientem Supabase (`supabase.from(...)`),
 *      nie funkcją serwerową z middleware. Autorytetem ostatecznym są więc
 *      polityki `career_applications_staff_read` / `_staff_update`,
 *      `career_application_events_staff_read` oraz polityka bucketu
 *      `career_cv_staff_read` - i to one są tutaj przedmiotem asercji NA
 *      ISTNIENIE (dowód WYKONAWCZY mieszka w uprzęży runtime modułu karier,
 *      `scripts/careers-harness/runtime_test.sql` - patrz ZNALEZISKO 3).
 * Dlatego NIE MA tu testu „bez roli nie widzi panelu": mierzyłby atrapę
 * `useAuth`, której ta trasa nawet nie woła. Jest zamiast tego dowód
 * pozytywny (render nie pyta o rolę) i dowód, że warunek stoi w layoucie.
 *
 * ---------------------------------------------------------------------------
 * CO JEST PRZEDMIOTEM DOWODU
 * ---------------------------------------------------------------------------
 *   * `head()`: tytuł karty i `robots: noindex` (skrzynka z danymi osobowymi
 *     nie ma czego szukać w indeksie).
 *   * KSZTAŁT ZAPYTANIA LISTY: `form_id = "careers"`, kolejność malejąca po
 *     `created_at`, `limit(500)`, embed `career_applications(...)` w JEDNYM
 *     literale, oraz MINIMALIZACJA DANYCH NA POZIOMIE GŁÓWNYM - dokładnie
 *     jedenaście kolumn, które ekran renderuje, i żadnego `select("*")`.
 *     Embed dokłada do tego cztery pola, których panel nie pokazuje NIGDZIE
 *     (w tym powód odrzucenia kandydata) - ZNALEZISKO 9a.
 *   * FILTRY: który jedzie do BAZY (skrzynka: nowe / wszystkie / archiwum),
 *     a który jest przeliczany na KLIENCIE (etap procesu i szukajka).
 *   * `CvAccess` w całości: kto i jak dostaje podpisany adres, że adres NIE
 *     powstaje bez żądania i NIE trafia do DOM-u, co się dzieje przy odmowie
 *     podpisu, jak zachowuje się ścieżka o nieznanym kształcie i link bez
 *     schematu, oraz jak panel odróżnia „kandydat nie dał CV" od „CV usunięte
 *     przez retencję".
 *   * PRZEJŚCIA ETAPÓW: ładunek UPDATE-u (`stage` + `stage_note` razem), cel
 *     zapisu (`career_applications.id`, a NIE `contact_messages.id`), toast,
 *     czyszczenie notatki, unieważnienia, ocena bez notatki, odmowa bazy oraz
 *     wiersz procesu bez identyfikatora.
 *   * DZIENNIK DECYZJI: po czym jest pytany, w jakiej kolejności, i że panel
 *     go tylko czyta.
 *   * STANY LISTY: ładowanie, pustka, odpowiedź `null`, odmowa odczytu.
 *   * ARCHIWIZACJA i USUNIĘCIE (z potwierdzeniem i z odmową).
 *   * CRM: dopasowanie po `email_norm`, obie gałęzie („zsynchronizowano" /
 *     „brak leada") i link do karty leada.
 *   * DWUJĘZYCZNOŚĆ panelu (wbudowane słowniki PL/EN), napędzana PRAWDZIWĄ
 *     instancją i18n przez `i18n.changeLanguage`: WSZYSTKIE 46 napisów obu
 *     słowników - 42 renderowane sprawdzone NA EKRANIE (trzy scENY renderu
 *     plus jeden test napisów pojawiających się po akcji), 4 bez kontrolki
 *     sprawdzone w samym słowniku - plus zamek na literały, czyli zderzenie
 *     każdej pary z tablicy testu ze słownikiem odczytanym z modułu trasy.
 *   * Brak naruszeń axe na obu widokach (lista i otwarte zgłoszenie).
 *
 * ---------------------------------------------------------------------------
 * CO JEST ATRAPOWANE I DLACZEGO (granica atrapy = moduł z własnym dowodem)
 * ---------------------------------------------------------------------------
 *   * `@/integrations/supabase/client` - wspólną atrapą łańcucha PostgREST
 *     (`@/test/supabaseChain`). Granica sieci; tutaj interesuje nas, JAKIE
 *     zapytanie panel składa i co robi z odpowiedzią.
 *   * `@/lib/careers/cvUpload` (`signCvUrl`) - buduje zapytanie do magazynu
 *     i ma własny plik dowodu (`src/lib/careers/__tests__/cvUpload.test.ts`).
 *     Atrapa pozwala dowieść tego, czego tam dowieść nie sposób: że panel woła
 *     podpis DOKŁADNIE dla ścieżki, która przeszła bramkę kształtu, i że
 *     podpisany adres nie wycieka do drzewa DOM.
 *   * `sonner` - toasty jako zapis skutku, nie jako render.
 *
 * CO ZOSTAJE PRAWDZIWE (i dlaczego atrapowanie zamieniłoby ten plik w test
 * atrapy):
 *   * `@/lib/careers/recruitmentLayer` i `recruitmentShared` - to CZYSTE
 *     moduły bez zapytań, których panel używa jako słownika i parsera.
 *     Atrapa `parseRecruitmentPipeline` albo `stageLabel` skasowałaby cały
 *     dowód o tym, że panel pokazuje operatorowi TEKST etapu (a nie kod
 *     enuma), że znosi oba kształty embedu PostgREST (obiekt / tablica) i że
 *     ścieżka CV o nieznanym kształcie nie zostaje podpisana. Ich własne
 *     testy jednostkowe (`recruitmentLayer.test.ts`) dowodzą parsowania
 *     w izolacji; TUTAJ dowodzimy, że panel z nich korzysta.
 *   * `react-i18next`, `@tanstack/react-router`, `@tanstack/react-query`
 *     i komponenty `ui/*`.
 *
 * UWAGA O `realT`. Ta trasa NIE MA ANI JEDNEGO KLUCZA i18n: napisy panelu
 * mieszkają w module w dwóch stałych (`PL`, `EN`), których plik nie
 * eksportuje - taki sam wzorzec, co `admin.crm.$id.tsx`. Asercje na te napisy
 * są więc literałami Z KONIECZNOŚCI, a nie z lenistwa - i dlatego stoją na
 * nich DWA zamki (oba dołożone w rewizji adwersaryjnej, patrz niżej):
 *   1. TABLICA `PARY` zderzona ze słownikiem ODCZYTANYM Z MODUŁU trasy
 *      (`slownikZModulu`), więc literał w teście, który rozjechał się
 *      z panelem, zapala jeden test, a nie zeruje wiarygodność trzydziestu.
 *   2. Dowód przełączenia po `i18n.changeLanguage`, który przechodzi po
 *      KAŻDYM napisie mającym kontrolkę (42 z 46) i sprawdza trzy rzeczy:
 *      polski widoczny po polsku, angielski po angielsku i - to jest ta
 *      asercja, która łapie wklejone zdanie - po angielsku NIE ZOSTAJE
 *      polski. Cztery napisy bez kontrolki (ZNALEZISKO 9b) domyka dowód
 *      słownikowy, bo na ekranie nie da się ich zobaczyć.
 * Napisy pochodzące ze wspólnej warstwy (`stageLabel`,
 * `departmentLabel`, `seniorityLabel`, `startLabel`) są asertowane PRZEZ TE
 * FUNKCJE, więc mierzą słownik. `realT("pl")` jest tu użyty tam, gdzie ma sens:
 * do dowodu, że `aria-label="Refresh"` NIE MA klucza w słowniku (ZNALEZISKO 4).
 *
 * ---------------------------------------------------------------------------
 * ZNALEZISKA (defekty produkcyjne i dziury w dowodzie - kod nietknięty)
 * ---------------------------------------------------------------------------
 * 1. ODMOWA ODCZYTU WYGLĄDA JAK PUSTA SKRZYNKA. `data: rows = []` (linia 296)
 *    sprowadza błąd zapytania do tej samej gałęzi co pustkę, więc gdy RLS
 *    odmówi albo sieć padnie, operator czyta „Brak zgłoszeń." - zdanie o
 *    STANIE BAZY, a nie o tym, że odczyt nie doszedł. Zgłoszenie kandydata
 *    wygląda wtedy na nieistniejące, a termin odpowiedzi biegnie dalej.
 *    Zapisane jako `it.fails` z kontrolą dodatnią; zachowanie ISTNIEJĄCE jest
 *    zaasertowane obok.
 * 2. FILTR ETAPU I SZUKAJKA LICZĄ SIĘ NA KLIENCIE, NA UCIĘTEJ LIŚCIE.
 *    Zapytanie ma `limit(500)`, a `stageFilter` i `q` przesiewają tablicę
 *    w `useMemo` (linie 332-355). Dla najemcy z ponad 500 zgłoszeniami
 *    „Domknięte" i szukanie po nazwisku pokazują wynik z PIERWSZYCH 500
 *    wierszy i milczą o resztzie. To zachowanie jest tu zaasertowane WPROST
 *    (zmiana filtra etapu NIE wywołuje nowego zapytania), żeby nikt nie
 *    pomylił go z filtrem serwerowym.
 * 3. SPROSTOWANE, NIE ZNALEZISKO: PIPELINE REKRUTACYJNY MA DOWÓD WYKONAWCZY.
 *    Pierwsza wersja tego nagłówka twierdziła, że migracja
 *    `20260814110000_careers_pipeline_and_cv_retention.sql` (cztery polityki
 *    RLS, trzy triggery, kolejka usunięć CV) nie ma ANI JEDNEGO dowodu
 *    wykonawczego, i zapisywała to jako `it.fails`. Podstawą był grep po
 *    `supabase/tests/` - czyli szukanie w złym miejscu. Dowód mieszka
 *    w `scripts/careers-harness/runtime_test.sql` (pgTAP nie jest dostępny
 *    w obrazie CI, więc asercje są gołym SQL-em: każda niespełniona rzuca
 *    wyjątkiem) i biegnie w CI jako `check:careers-harness`. Pokrywa
 *    dokładnie to, czego brak zgłaszała tamta wersja: drugiego najemcę,
 *    nieprzenoszalność procesu między najemcami i wpis w dzienniku przy
 *    zmianie etapu. Asercje w tym pliku są DODATNIE (uprząż istnieje, CI ją
 *    odpala), a pusty wynik grepu po `supabase/tests/` jest zaasertowany
 *    jako ŚWIADOMY, żeby następny czytelnik nie powtórzył pomyłki.
 *    REWIZJA ADWERSARYJNA: ciało pliku było już sprostowane, ale TEN
 *    nagłówek nadal głosił obaloną wersję - to jest właśnie ta klasa
 *    defektu, w której nagłówek przestaje być wywodem, a staje się reliktem.
 * 4. `aria-label="Refresh"` JEST NIEPRZETŁUMACZONYM LITERAŁEM (linia 518) -
 *    jedyna nazwa dostępna na tym ekranie, która nie przechodzi ani przez
 *    słownik i18n, ani przez wbudowane `PL`/`EN`. Osoba czytająca panel
 *    czytnikiem ekranu po polsku słyszy angielskie słowo. Zaasertowane jako
 *    stan istniejący, z dowodem przez `realT`, że klucza w słowniku nie ma.
 * 5. WIERSZ PROCESU BEZ IDENTYFIKATORA POKAZUJE SUROWY KLUCZ. Gdy embed
 *    `career_applications` przyjdzie bez `id`, `parseRecruitmentPipeline`
 *    zwraca pipeline z `id: ""`, panel renderuje pełną sekcję etapów, a próba
 *    zapisu kończy się toastem o treści `no_pipeline_row` - kluczem
 *    technicznym zamiast zdania. Zaasertowane jest zachowanie ISTNIEJĄCE
 *    (żaden UPDATE nie wychodzi do bazy - i to jest w tym dobra połowa).
 * 6. ZAMKNIĘTE: BRAMKA RODZIN TRAS PANELU WIDZI JUŻ `admin.careers`.
 *    Stan wejściowy paczki: `adminRouteAuthority.gate.test.ts` miał jawne
 *    listy rodzin (kluby, newsletter, moduł 19, SEO, społeczność) i ŻADNA nie
 *    wymieniała tej trasy, więc dołożenie tu własnego, niezgodnego z bazą
 *    warunku roli przechodziłoby po cichu. Znalezisko zostało domknięte
 *    w tej samej gałęzi (`CAREERS_ROUTES` w bramce), a asercja w tym pliku
 *    jest POZYTYWNA - ma pilnować OBECNOŚCI rodziny, nie utrwalać jej brak.
 *    REWIZJA ADWERSARYJNA: nagłówek nadal mówił „nie dopisuję, zgłaszam
 *    w raporcie", choć bramka wymienia `admin.careers.tsx` od tej samej
 *    gałęzi - poprawione tutaj.
 * 7. ODMOWA ZAPISU „PRZECZYTANE"/ARCHIWIZACJI JEST CAŁKOWICIE CICHA. Mutacja
 *    `patch` (linie 383-398) jest JEDYNĄ z trzech mutacji tego ekranu bez
 *    `onError` - `savePipeline` i `removeApplication` mają swoje. Operator
 *    klika „Archiwizuj", polityka odmawia, i nie pada ani komunikat, ani
 *    zmiana etykiety: zgłoszenie zostaje w kolejce „Nowe" bez śladu porażki.
 * 8. ODMOWA ODCZYTU CRM I DZIENNIKA JEST NIEROZRÓŻNIALNA OD PUSTKI. `data?.[0]
 *    ?? null` (lead) i `data: events = []` (dziennik) sprowadzają błąd do tej
 *    samej gałęzi co brak danych, więc odmowa daje „Brak leada w CRM" (i cichy
 *    duplikat leada w CRM) oraz „Brak zmian etapu." - czyli PUSTY AUDYT decyzji
 *    o kandydacie. To ta sama klasa błędu co ZNALEZISKO 1, tylko dotyczy
 *    dokumentu, po który sięga się przy skardze na proces rekrutacji.
 * 9. PÓŁ FUNKCJI „POWÓD ODRZUCENIA": DANE JADĄ DO PRZEGLĄDARKI, KONTROLKI NIE
 *    MA. (a) Embed listy ciągnie `stage_changed_at`, `rejection_reason`,
 *    `next_step_at` i `owner_id` - cztery pola, których panel nie renderuje
 *    NIGDZIE, przy każdym otwarciu skrzynki i dla wszystkich 500 wierszy.
 *    Uzasadnienie odrzucenia kandydata to ocena jego osoby, więc jego wysyłka
 *    „na zapas" jest kosztem po stronie minimalizacji danych, nie estetyki.
 *    (b) Oba słowniki deklarują cztery napisy, po które JSX nie sięga:
 *    `crm`, `markRead`, `rejectionReason`, `nextStep`. Mutacja `savePipeline`
 *    przyjmuje przy tym `rejection_reason` i `next_step_at`, a żadne z jej
 *    dwóch wywołań ich nie podaje. Kolumny są w bazie, w typach, w zapytaniu
 *    i w słowniku - w interfejsie nie ma ich wcale. Znalezisko dołożone
 *    w rewizji adwersaryjnej; zaasertowane jest zachowanie ISTNIEJĄCE
 *    (pola SĄ pobierane, NIE trafiają do DOM-u, kluczy nikt nie renderuje).
 *
 * ---------------------------------------------------------------------------
 * CZEGO NIE DA SIĘ TU DOWIEŚĆ UCZCIWIE (2 gałęzie z 151, świadomie zostawione)
 * ---------------------------------------------------------------------------
 * `(current?.email ?? "")` w filtrze zapytania o lead (linia 375) i
 * `(current?.pipeline?.id ?? "")` w filtrze dziennika (linia 424) mają
 * nieosiągalną prawą stronę: każde z tych zapytań stoi za `enabled:
 * Boolean(...)` sprawdzającym DOKŁADNIE tę samą wartość, więc `queryFn` nie
 * biegnie, gdy jest nullish. To obrona defensywna bez wejścia - żeby ją
 * wywołać, trzeba by zawołać `queryFn` poza routerem i poza react-query, czyli
 * zmierzyć własną atrapę zamiast panelu. Odpowiednikiem dowodowym są dwa testy
 * mierzące SKUTEK tej bramki: „bez wyboru prawa kolumna prosi o wybór i NIE
 * pyta ani CRM, ani dziennika" (zero łańcuchów do `crm_leads` i
 * `career_application_events`) oraz „ZNALEZISKO 5" (brak identyfikatora
 * procesu = zero pytań o dziennik).
 * Pozostałe 149 gałęzi, wszystkie 42 funkcje i wszystkie 109 linii są pokryte.
 *
 * REWIZJA ADWERSARYJNA POTWIERDZA tę dwójkę po ponownym pomiarze (nadal
 * dokładnie 149/151 gałęzi), ALE dowód zastępczy pierwszego z nich był zielony
 * PRZEZ TIMING: licznik łańcuchów sprawdzano natychmiast po zdaniu „Wybierz
 * zgłoszenie z listy.", które jest na ekranie od pierwszego renderu - czyli
 * przed odpowiedzią listy. Test przechodziłby więc także wtedy, gdyby panel
 * pytał CRM bez wyboru. Dowód czeka teraz na ODPOWIEDŹ listy i na wiersz, a na
 * końcu ma KONTROLĘ DODATNIĄ (po wyborze oba liczniki rosną) - bo zero, którego
 * nikt nie umie podnieść, nie jest pomiarem.
 *
 * ---------------------------------------------------------------------------
 * CO ZNALAZŁA REWIZJA ADWERSARYJNA (wszystko naprawione w tym pliku)
 * ---------------------------------------------------------------------------
 * Założenie rewizji: autor poprzedniego kroku oszukiwał. Osiem miejsc, w których
 * dowód nie sięgał tam, gdzie obiecywał (kod produkcyjny NIETKNIĘTY):
 *   1. NAGŁÓWEK GŁOSIŁ OBALONE ZNALEZISKA. Punkty 3 i 6 opisywały brak dowodu
 *      pgTAP i brak rodziny w bramce autorytetu, gdy ciało pliku dowodziło
 *      DOKŁADNIE ODWROTNIE (uprząż runtime w CI, `CAREERS_ROUTES` w bramce).
 *      To najcięższy z tych defektów: nagłówek jest tu jedyną instrukcją dla
 *      następnego czytelnika, a kłamał o stanie dowodu.
 *   2. TAUTOLOGIA ZAMIAST SKLEJENIA. Test „trasa wisi pod /admin" asertował
 *      `PATH.startsWith("/admin/")`, czyli MIERZYŁ WŁASNĄ STAŁĄ TESTU - zielony
 *      niezależnie od kodu. Zastąpiony dowodem z `routeTree.gen.ts`
 *      (`getParentRoute: () => AdminRoute` plus wpis w dzieciach layoutu), bo
 *      tylko to znaczy, że bramka `isStaff` biegnie NAD tą trasą.
 *   3. OSIEM `expect(...)` BEZ MATCHERA (w tym trzy z komunikatem, który przy
 *      braku matchera nigdy się nie pokaże). Uzupełnione o asercje.
 *   4. NAZWA OBIECYWAŁA WIĘCEJ, NIŻ DOWODZIŁO CIAŁO: „szukajka przesiewa po
 *      nazwisku, adresie, TEMACIE i TREŚCI" przesiewała tylko po nazwisku
 *      i adresie - na fixture, w którym wszystkie zgłoszenia miały identyczny
 *      temat i treść, więc tamtych dwóch pól nie dało się w nim zmierzyć.
 *      Fixture jest rozłączny, a przesiew ma teraz dowód dla WSZYSTKICH
 *      dziewięciu pól (doszło też `custom.role_label`, którego nie mierzył
 *      żaden test).
 *   5. DWUJĘZYCZNOŚĆ „KAŻDEGO NAPISU" NA PRÓBIE OŚMIU Z CZTERDZIESTU SZEŚCIU.
 *      Nagłówek obiecywał, że osobny dowód pilnuje uczciwości literałów dla
 *      KAŻDEGO napisu; sprawdzanych było osiem. Dołożona pełna tablica par
 *      PL/EN (trzy scENY renderu + napisy po akcji), dowód słownikowy dla
 *      czterech napisów bez kontrolki i zamek zderzający każdy literał testu
 *      ze słownikiem odczytanym z modułu trasy.
 *   6. ATRAPA ZJADAŁA PRZEDMIOT DOWODU. Wiszący łańcuch (stany „w toku") nie
 *      zapisywał ogniw do atrapy wspólnej, więc test „jedno zgłoszenie, jeden
 *      DELETE" nie miał czym policzyć DELETE-ów - „zablokowany przycisk" dawało
 *      się udowodnić bez ani jednego żądania. Łańcuch zapisuje teraz ogniwa,
 *      a wiszące jest wyłącznie rozwiązanie `await`.
 *   7. ASERCJA NA NEGATYWIE ZAMIAST NA SKUTKU. „Brak telefonu nie zostawia
 *      wiszącego separatora" sprawdzał tylko, że nie ma dwóch kropek pod rząd -
 *      zielone także dla linii bez adresu albo bez daty. Teraz asercja jest na
 *      PEŁNY tekst linii kontaktu, w obu wariantach.
 *   8. DOWÓD ZASTĘPCZY NIEPOKRYTEJ GAŁĘZI ZIELONY PRZEZ TIMING - opisany wyżej.
 * Przy okazji rewizji doszło ZNALEZISKO 9 (embed ciągnie cztery pola bez
 * kontrolki, w tym powód odrzucenia; cztery napisy słownika bez kontrolki).
 *
 * ŚWIADOMIE POZA ZAKRESEM (i gdzie mieszka tamten dowód):
 *   * wykonanie polityk RLS i triggerów (`career_application_log_stage`,
 *     `career_cv_enqueue_on_message_delete`, `career_cv_gc_*`) - uprząż
 *     runtime `scripts/careers-harness/runtime_test.sql`, odpalana w CI jako
 *     `check:careers-harness` (a NIE „nieistniejący pgTAP" - patrz ZNALEZISKO 3);
 *   * podpisywanie linku w magazynie (`signCvUrl`, `uploadCv`, walidacja
 *     pliku) - `src/lib/careers/__tests__/cvUpload.test.ts`;
 *   * parsowanie warstwy rekrutacyjnej w izolacji -
 *     `src/lib/careers/__tests__/recruitmentLayer.test.ts`;
 *   * bramka roli dla `/admin/*` - `src/routes/admin.tsx` i bramka rodzin
 *     `adminRouteAuthority.gate.test.ts`;
 *   * retencja plików CV (job drenujący kolejkę) - `cvRetention.test.ts`.
 *
 * RODO: wszystkie osoby, adresy, treści i nazwy plików są ZMYŚLONE, adresy
 * wyłącznie w domenie `@example.com`, identyfikatory najemcy i plików to
 * jawne fikcje. Żaden fragment nie pochodzi z produkcji.
 */
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import type { RecruitmentPipelineRow } from "@/lib/careers/recruitmentLayer";

interface RecordedToast {
  kind: "success" | "error";
  text: string;
}

const h = vi.hoisted(() => ({
  /** Wiersze skrzynki. `null` odtwarza odpowiedź PostgREST bez ciała. */
  rows: [] as unknown[] | null,
  rowsError: null as string | null,
  /** Tabele, których łańcuch NIGDY nie odpowiada - do dowodów o oczekiwaniu. */
  hang: new Set<string>(),

  leads: [] as unknown[] | null,
  leadsError: null as string | null,
  events: [] as unknown[] | null,
  eventsError: null as string | null,

  updateError: null as string | null,
  deleteError: null as string | null,
  pipelineError: null as string | null,

  /** Podpisany adres oddawany przez atrapę magazynu (`null` = odmowa). */
  signed: null as string | null,
  signCalls: [] as string[],
  signHolds: false,
  releaseSign: null as (() => void) | null,

  confirmAnswer: true,
  confirmMessages: [] as string[],
  opened: [] as unknown[][],
  toasts: [] as RecordedToast[],
}));

const stub = vi.hoisted(() => ({ current: null as unknown }));

// GRANICA SIECI. Atrapa jest wspólna dla całego repo (`@/test/supabaseChain`),
// więc test widzi DOKŁADNIE te ogniwa PostgREST, które panel wywołał - w tym
// `is` kontra `not` przy filtrze archiwum i dwa różne `eq` w dwóch zapytaniach.
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const shared = supabaseFromStub();
  stub.current = shared;
  /**
   * Łańcuch, który nigdy nie rozwiązuje `await` - jedyny sposób, żeby dowieść
   * stanu oczekiwania (atrapa wspólna odpowiada synchronicznie, bo taki jest
   * jej kontrakt; ten kształt jest tu wyjątkiem, nie drugim harnessem).
   *
   * REWIZJA: pierwsza wersja BUDOWAŁA WŁASNY builder i nie zapisywała ogniw,
   * więc każdy test oczekiwania stawał się niewidomy na to, CZY zapytanie
   * w ogóle poszło i z jakim ładunkiem - „przycisk zablokowany" dawało się
   * udowodnić bez ani jednego żądania. Teraz ogniwa jadą do atrapy wspólnej
   * (czyli są zapisane i asertowalne), a wiszące jest wyłącznie ROZWIĄZANIE.
   */
  const hangingChain = (table: string) => {
    const recorder = shared.from(table) as Record<string, (...args: unknown[]) => unknown>;
    const builder: Record<string, unknown> = {};
    for (const method of [
      "select",
      "insert",
      "update",
      "delete",
      "eq",
      "is",
      "not",
      "order",
      "limit",
    ]) {
      builder[method] = (...args: unknown[]) => {
        recorder[method](...args);
        return builder;
      };
    }
    builder.then = () => undefined;
    return builder;
  };
  return {
    supabase: {
      from: (table: string) => (h.hang.has(table) ? hangingChain(table) : shared.from(table)),
    },
  };
});

// GRANICA MAGAZYNU. `signCvUrl` buduje zapytanie do storage i ma własny plik
// dowodu; tutaj liczy się, CZY i DLA JAKIEJ ścieżki panel je woła.
vi.mock("@/lib/careers/cvUpload", () => ({
  signCvUrl: async (path: string): Promise<string | null> => {
    h.signCalls.push(path);
    if (h.signHolds) {
      await new Promise<void>((resolve) => {
        h.releaseSign = resolve;
      });
    }
    return h.signed;
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: (text: string) => h.toasts.push({ kind: "success", text }),
    error: (text: string) => h.toasts.push({ kind: "error", text }),
  },
}));

// `react-i18next` NIE JEST atrapowany: fabryka `reactI18nextMock()` sięga po
// `@/lib/i18n`, czyli moduł importujący właśnie atrapowany pakiet
// (zakleszczenie - ostrzeżenie z nagłówka `@/test/i18nReal`). Język panelu
// przełączamy na PRAWDZIWEJ instancji.
import i18n from "@/lib/i18n";
import { realT } from "@/test/i18nReal";
import { renderRoute, routeHead } from "@/test/routeHarness";
import { axeViolations, summarize } from "@/test/axe";
import { ok, fail, type RecordedChain, type SupabaseFromStub } from "@/test/supabaseChain";
import {
  CAREER_STAGES,
  CAREER_STAGE_STYLE,
  departmentLabel,
  seniorityLabel,
  stageLabel,
  startLabel,
} from "@/lib/careers/recruitmentLayer";
import { Route as CareersRoute } from "@/routes/admin.careers";

const PATH = "/admin/careers";
const ROUTE_FILE = "src/routes/admin.careers.tsx";
const ADMIN_LAYOUT = "src/routes/admin.tsx";
/**
 * Wygenerowane drzewo tras. To JEDYNE miejsce w repo, w którym stoi rodzic tej
 * trasy: `createFileRoute("/admin/careers")` sam rodzica NIE zna, a harness
 * testowy podkłada zastępczy korzeń, więc asercja na obiekcie `Route` mierzyłaby
 * uprząż, nie sklejenie. Bramka `isStaff` żyje w layoucie, więc dowód „ta trasa
 * jest DZIECKIEM layoutu" musi iść po wygenerowanym drzewie.
 */
const ROUTE_TREE = "src/routeTree.gen.ts";
const AUTHORITY_GATE = "src/routes/__tests__/adminRouteAuthority.gate.test.ts";
/** Migracja z pipeline'em rekrutacyjnym, dziennikiem decyzji i kolejką usunięć CV. */
const PIPELINE_MIGRATION =
  "supabase/migrations/20260814110000_careers_pipeline_and_cv_retention.sql";
/** Migracja zawężająca bucket `career-cv` do najemcy (ścieżka niesie tenanta). */
const CV_SCOPE_MIGRATION = "supabase/migrations/20260814100000_careers_tenant_scope.sql";
const PGTAP_DIR = "supabase/tests";
const CAREER_SECTIONS_PGTAP = "career_sections_visibility_public_read_test.sql";

/** Najemca w fixtures - jawna fikcja, nigdy identyfikator z produkcji. */
const TENANT = "11111111-1111-4111-8111-111111111111";
/** Ścieżka CV w kształcie, który przechodzi bramkę `CV_PATH_RE`. */
const CV_PATH = `${TENANT}/uploads/2026-08-20/abcdef1234.pdf`;

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/** Pliki pgTAP wspominające dany obiekt bazy - do dowodów o istnieniu dowodu. */
function pgtapMentioning(needle: string): string[] {
  return readdirSync(PGTAP_DIR).filter(
    (file) => file.endsWith(".sql") && read(`${PGTAP_DIR}/${file}`).includes(needle),
  );
}

/**
 * UPRZĄŻ RUNTIME MODUŁU KARIER - i to TU, a nie w `supabase/tests/`, mieszka
 * dowód wykonawczy tego modułu. Rozróżnienie jest istotne, bo szukanie
 * dowodu wyłącznie w katalogu pgTAP prowadzi do fałszywego wniosku „dowodu
 * nie ma": pierwsze trzy linie tej uprzęży mówią wprost „pgtap nie jest
 * dostepny w tym obrazie, wiec asercje sa golym SQL-em: kazda niespelniona
 * rzuca wyjatek i przerywa skrypt". Uprząż biegnie w CI jako
 * `check:careers-harness` na czystym Postgresie po odtworzeniu migracji.
 */
const CAREERS_HARNESS = "scripts/careers-harness/runtime_test.sql";
const CI_WORKFLOW = ".github/workflows/ci.yml";

/** Wiersz skrzynki w kształcie, w jakim oddaje go zapytanie panelu. */
interface ApplicationRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  subject: string | null;
  message: string;
  lang: string;
  created_at: string;
  read_at: string | null;
  archived_at: string | null;
  custom: Record<string, unknown>;
  career_applications: RecruitmentPipelineRow | RecruitmentPipelineRow[] | null;
}

function pipelineRow(over: Partial<RecruitmentPipelineRow> = {}): RecruitmentPipelineRow {
  return {
    id: "proces-1",
    stage: "new",
    stage_changed_at: "2026-08-20T08:00:00.000Z",
    stage_note: "",
    rating: null,
    rejection_reason: "",
    next_step_at: null,
    owner_id: null,
    ...over,
  } satisfies RecruitmentPipelineRow;
}

function application(over: Partial<ApplicationRow> = {}): ApplicationRow {
  return {
    id: "zgloszenie-1",
    name: "Zofia Przykładowska",
    email: "zofia.przykladowska@example.com",
    phone: "+48 000 000 001",
    subject: "Analityk ds. polityki cyfrowej",
    message: "Zmyślone uzasadnienie kandydatury na zmyślone stanowisko.",
    lang: "pl",
    created_at: "2026-08-20T07:00:00.000Z",
    read_at: null,
    archived_at: null,
    custom: {
      role: "analysis-lead",
      role_label: "Analityk ds. polityki cyfrowej",
      department: "analysis",
      seniority: "mid",
      start: "month",
      linkedin: "https://linkedin.example.com/in/zmyslona-zofia",
    },
    career_applications: pipelineRow(),
    ...over,
  } satisfies ApplicationRow;
}

const chainStub = (): SupabaseFromStub => {
  const current = stub.current;
  // STRAŻNIK, nie rzutowanie: fabryka `vi.mock` jest hoistowana i biegnie przed
  // tym plikiem, więc brak atrapy to błąd sklejenia testu, nie „pusty stan".
  if (current === null || typeof current !== "object" || !("chainsFor" in current)) {
    throw new Error("test: atrapa klienta Supabase nie została zarejestrowana");
  }
  return current as SupabaseFromStub;
};

const listChains = (): RecordedChain[] =>
  chainStub()
    .chainsFor("contact_messages")
    .filter((chain) => chain.has("select"));

function lastList(): RecordedChain {
  const chain = listChains().at(-1);
  if (!chain) throw new Error("test: panel nie zapytał o zgłoszenia");
  return chain;
}

const messageUpdates = (): RecordedChain[] =>
  chainStub()
    .chainsFor("contact_messages")
    .filter((chain) => chain.has("update"));
const messageDeletes = (): RecordedChain[] =>
  chainStub()
    .chainsFor("contact_messages")
    .filter((chain) => chain.has("delete"));
const pipelineUpdates = (): RecordedChain[] => chainStub().chainsFor("career_applications");
const eventChains = (): RecordedChain[] => chainStub().chainsFor("career_application_events");
const leadChains = (): RecordedChain[] => chainStub().chainsFor("crm_leads");

/** Klient bez ponowień - test odmowy nie ma na co czekać. */
function testClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

async function mount(queryClient?: QueryClient) {
  return renderRoute({
    route: CareersRoute,
    path: PATH,
    initialEntry: PATH,
    queryClient: queryClient ?? testClient(),
  });
}

/** Otwiera zgłoszenie z listy i czeka, aż karta kandydata się pojawi. */
async function openApplication(name: string): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(name) }));
  await screen.findByRole("heading", { level: 2, name });
}

/** Czeka, aż lista przestanie być w stanie ładowania. */
async function settled(): Promise<void> {
  await waitFor(() => expect(screen.queryByText("…")).toBeNull());
}

/**
 * Droplista filtra etapu (w kolumnie listy).
 *
 * STRAŻNIK, nie rzutowanie: na ekranie z otwartym zgłoszeniem są DWIE
 * kontrolki o nazwie „Etap procesu" (filtr listy i etap wiersza procesu), więc
 * namierzenie musi być zawężone do `<aside>` - a to wymaga sprawdzenia
 * w runtime, że kolumna listy w ogóle się wyrenderowała.
 */
function stageFilterSelect(): HTMLElement {
  const aside = document.querySelector("aside");
  if (!(aside instanceof HTMLElement)) {
    throw new Error("test: kolumna listy nie wyrenderowała elementu <aside>");
  }
  return within(aside).getByLabelText("Etap procesu");
}

/** STRAŻNIK, nie rzutowanie: `<select>` po identyfikatorze, sprawdzony w runtime. */
function selectById(id: string): HTMLSelectElement {
  const node = document.getElementById(id);
  if (!(node instanceof HTMLSelectElement)) {
    throw new Error(`test: na ekranie nie ma <select id="${id}">`);
  }
  return node;
}

/**
 * Prawa kolumna (karta zgłoszenia).
 *
 * STRAŻNIK, nie rzutowanie: po angielsku filtr listy („Archive") i akcja karty
 * („Archive") mają IDENTYCZNĄ nazwę dostępną, więc namierzenie akcji musi być
 * zawężone do karty - a to wymaga sprawdzenia w runtime, że karta istnieje.
 */
function detailPane(): HTMLElement {
  const pane = document.querySelector("aside")?.nextElementSibling;
  if (!(pane instanceof HTMLElement)) {
    throw new Error("test: prawa kolumna panelu nie wyrenderowała się");
  }
  return pane;
}

/** STRAŻNIK, nie rzutowanie: wiersz listy po nazwisku kandydata. */
function listRow(name: string): HTMLElement {
  const opener = screen.getByRole("button", { name: new RegExp(name) });
  const row = opener.closest("li");
  if (!row) throw new Error(`test: wiersz „${name}" nie ma kontenera <li>`);
  return row;
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.rows = [];
  h.rowsError = null;
  h.hang = new Set<string>();
  h.leads = [];
  h.leadsError = null;
  h.events = [];
  h.eventsError = null;
  h.updateError = null;
  h.deleteError = null;
  h.pipelineError = null;
  h.signed = null;
  h.signCalls = [];
  h.signHolds = false;
  h.releaseSign = null;
  h.confirmAnswer = true;
  h.confirmMessages = [];
  h.opened = [];
  h.toasts = [];

  const shared = chainStub();
  shared.reset();
  shared.setResponse("contact_messages", (chain) => {
    if (chain.has("delete")) return h.deleteError ? fail(h.deleteError) : ok(null);
    if (chain.has("update")) return h.updateError ? fail(h.updateError) : ok(null);
    return h.rowsError ? fail(h.rowsError) : ok(h.rows);
  });
  shared.setResponse("career_applications", () =>
    h.pipelineError ? fail(h.pipelineError) : ok(null),
  );
  shared.setResponse("career_application_events", () =>
    h.eventsError ? fail(h.eventsError) : ok(h.events),
  );
  shared.setResponse("crm_leads", () => (h.leadsError ? fail(h.leadsError) : ok(h.leads)));

  // Komponent woła `window.confirm` i `window.open` wprost; definiujemy na obu
  // obiektach, bo helpery testowe sięgają po `window`, a kod po globalny bind.
  const confirmStub = (message?: string) => {
    h.confirmMessages.push(message ?? "");
    return h.confirmAnswer;
  };
  const openStub = (...args: unknown[]) => {
    h.opened.push(args);
    return null;
  };
  for (const target of [globalThis, window]) {
    Object.defineProperty(target, "confirm", {
      configurable: true,
      writable: true,
      value: confirmStub,
    });
    Object.defineProperty(target, "open", {
      configurable: true,
      writable: true,
      value: openStub,
    });
  }
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
});

// ---------------------------------------------------------------------------
// SKLEJENIE TRASY I AUTORYTET DOSTĘPU
// ---------------------------------------------------------------------------

describe("/admin/careers - sklejenie trasy i gdzie stoi bramka uprawnień", () => {
  it("head() daje tytuł karty i trzyma skrzynkę z danymi osobowymi poza indeksem", async () => {
    // Czytamy `head()` DWIEMA drogami: wprost (kontrakt funkcji) i przez
    // zamontowany router (to, co faktycznie trafiłoby do `<HeadContent/>`).
    // `noindex` nie jest tu ozdobą: skrzynka niesie CV i kontakty kandydatów.
    expect(routeHead(CareersRoute).meta).toEqual([
      { title: "Rekrutacja | Admin" },
      { name: "robots", content: "noindex" },
    ]);

    const { meta } = await mount();
    expect(meta()).toContainEqual({ title: "Rekrutacja | Admin" });
    expect(meta()).toContainEqual({ name: "robots", content: "noindex" });
  });

  it("trasa jest DZIECKIEM layoutu `/admin` w wygenerowanym drzewie tras", () => {
    // REWIZJA: pierwsza wersja tego testu asertowała `PATH.startsWith("/admin/")`,
    // czyli MIERZYŁA WŁASNĄ STAŁĄ TESTU (`const PATH = "/admin/careers"`) - zielone
    // niezależnie od kodu produkcyjnego. Dowodem sklejenia jest wygenerowane drzewo:
    // `getParentRoute: () => AdminRoute` i obecność w dzieciach layoutu. Dopiero to
    // znaczy, że efekt `isStaff` z `admin.tsx` biegnie NAD tą trasą.
    expect(read(ROUTE_FILE)).toMatch(/createFileRoute\("\/admin\/careers"\)/);

    const tree = read(ROUTE_TREE);
    expect(tree).toMatch(
      /const AdminCareersRoute = AdminCareersRouteImport\.update\(\{\s*id: '\/careers',\s*path: '\/careers',\s*getParentRoute: \(\) => AdminRoute,/,
    );
    // Dziecko musi być też WPISANE do layoutu - `update()` bez wpisu w dzieciach
    // dałoby trasę osieroconą, renderowaną bez layoutu, a więc bez bramki.
    const children = tree.slice(
      tree.indexOf("const AdminRouteChildren: AdminRouteChildren = {"),
      tree.indexOf("const AdminRouteWithChildren"),
    );
    expect(children).toContain("AdminCareersRoute: AdminCareersRoute,");
    // Kontrola dodatnia dla samego wycinka - żeby zielone nie brało się z pustki.
    expect(children).toContain("AdminHiringRoute: AdminHiringRoute,");
    // I pełna ścieżka, po której panel jest osiągalny w przeglądarce.
    expect(tree).toContain("'/admin/careers': typeof AdminCareersRoute");
    expect(PATH).toBe("/admin/careers");
  });

  it("ta trasa NIE bramkuje dostępu sama - renderuje się bez pytania o rolę", async () => {
    // Dowód pozytywny: komponent nie woła `useAuth` ani nie przekierowuje, więc
    // renderuje się w harnessie, w którym żadnej sesji nie ma. To podział
    // pracy, nie dziura - jedna bramka w layoucie zamiast kopii w stu trasach.
    // Gdyby ktoś dołożył warunek roli TUTAJ, ten test zapali się pierwszy.
    await mount();
    expect(screen.getByRole("heading", { level: 1, name: "Rekrutacja" })).toBeInTheDocument();
  });

  it("plik trasy nie zawiera warunku roli ani przekierowania", () => {
    const source = read(ROUTE_FILE);
    expect(source).not.toMatch(/isStaff|isAdmin|isSuperAdmin|useAuth/);
    expect(source).not.toMatch(/beforeLoad|redirect\(|<Navigate/);
  });

  it("bramka renderu żyje w layoucie `/admin` i prowadzi na /login", () => {
    // Odczyt pliku, nie render: layout jest RODZICEM tej trasy, a harness
    // montuje pojedynczą trasę pod zastępczym korzeniem.
    const layout = read(ADMIN_LAYOUT);
    expect(layout).toMatch(/isStaff/);
    expect(layout).toMatch(/navigate\(\{\s*to:\s*"\/login"\s*\}\)/);
    expect(layout).toMatch(/if \(!session \|\| !isStaff\) return null;/);
  });

  it("dane panelu idą ZWYKŁYM klientem - autorytetem jest RLS, nie middleware", () => {
    // Świadome NEGATYWNE ustalenie: gdyby odczyt szedł funkcją serwerową,
    // dowód uprawnień robiłoby się przez `serverFnMiddlewareNames`. Nie idzie.
    const source = read(ROUTE_FILE);
    expect(source).not.toMatch(/createServerFn/);
    expect(source).toContain('from("contact_messages")');
    expect(source).toContain('from("career_applications")');
  });

  it("polityki RLS pipeline'u wymagają personelu I zgodności najemcy", () => {
    // Tu naprawdę mieszka autoryzacja tego ekranu. Ten test nie WYKONUJE
    // polityki (do tego jest uprząż runtime, patrz ZNALEZISKO 3 i test niżej),
    // tylko sprawdza, że nie zniknęła i nadal wymienia OBA warunki.
    const sql = read(PIPELINE_MIGRATION);
    expect(sql).toMatch(
      /CREATE POLICY career_applications_staff_read ON public\.career_applications/,
    );
    expect(sql).toMatch(
      /CREATE POLICY career_applications_staff_update ON public\.career_applications/,
    );
    expect(sql).toMatch(
      /CREATE POLICY career_application_events_staff_read ON public\.career_application_events/,
    );
    expect(sql).toMatch(/public\.is_staff\(\) AND tenant_id = public\.current_tenant_id\(\)/);
  });

  it("dziennik decyzji jest dla klienta TYLKO do czytania - historii nie da się poprawić", () => {
    // Gdyby panel mógł pisać do `career_application_events`, audyt „kogo
    // odrzuciliśmy i dlaczego" dałoby się przepisać po fakcie. Grant jest sam
    // `SELECT`, a wpisy robi trigger.
    const sql = read(PIPELINE_MIGRATION);
    expect(sql).toMatch(/GRANT SELECT ON public\.career_application_events TO authenticated;/);
    expect(sql).not.toMatch(/GRANT[^;]*INSERT[^;]*ON public\.career_application_events/);
    expect(sql).toMatch(/CREATE TRIGGER trg_career_applications_log_stage/);
    expect(read(ROUTE_FILE)).not.toMatch(/career_application_events"\)\s*\.\s*(insert|update)/);
  });

  it("odczyt bucketu `career-cv` jest zawężony do personelu TEGO najemcy", () => {
    // Panel podpisuje link bez pytania o tenanta, więc jedyną granicą jest
    // polityka magazynu - i ona bierze najemcę z PROFILU wołającego,
    // nie z nagłówka hosta (ten da się podmienić w żądaniu).
    const sql = read(CV_SCOPE_MIGRATION);
    expect(sql).toMatch(/CREATE POLICY "career_cv_staff_read"/);
    expect(sql).toMatch(/bucket_id = 'career-cv'\s*\n\s*AND public\.is_staff\(\)/);
    expect(sql).toMatch(
      /\(storage\.foldername\(name\)\)\[1\] = public\.current_tenant_id\(\)::text/,
    );
  });

  /**
   * GDZIE MIESZKA DOWÓD WYKONAWCZY TEJ TRASY (sprostowanie, patrz ZNALEZISKO 3).
   *
   * Ta trasa nie ma na kliencie ŻADNEGO warunku najemcy, więc polityka bazy
   * jest jedynym, co dzieli tenantów - i to ona potrzebuje dowodu, który
   * naprawdę biegnie na Postgresie. Migracja zakłada polityki RLS, trigger
   * bootstrapu wiersza procesu, trigger dziennika decyzji i trigger kolejkujący
   * plik CV do usunięcia; wszystkie cztery rzeczy są wykonane w uprzęży
   * `scripts/careers-harness/runtime_test.sql`, odpalanej w CI.
   *
   * Trzy testy poniżej pilnują tego łańcucha: dowód ISTNIEJE, CI go ODPALA,
   * a pusty katalog `supabase/tests/` jest ŚWIADOMY (pgTAP nie jest dostępny
   * w obrazie, więc asercje są gołym SQL-em). Poprzednia wersja tego bloku
   * opisywała ZŁAMANY KONTRAKT zapisany jako `it.fails` - i przeczyła testowi,
   * który stał bezpośrednio pod nią.
   */
  it("pipeline rekrutacyjny MA dowód wykonawczy - w uprzęży runtime, nie w pgTAP", () => {
    // SPROSTOWANIE WŁASNEGO ZNALEZISKA. Pierwsza wersja tego pliku twierdziła,
    // że pipeline nie ma ANI JEDNEGO dowodu wykonawczego, i zapisywała to jako
    // `it.fails`. Podstawą był grep po `supabase/tests/` - i to było szukanie
    // w złym miejscu. Dowód istnieje i pokrywa DOKŁADNIE to, czego brak
    // zgłaszała tamta wersja: drugiego najemcę, nieprzenoszalność procesu
    // między najemcami i wpis w dzienniku przy zmianie etapu.
    const sql = read(CAREERS_HARNESS);
    expect(sql).toContain("career_applications");
    // §5c - trigger przypina `tenant_id` z powrotem, więc UPDATE nie przenosi
    // procesu kandydata do innego najemcy.
    expect(sql).toContain("UPDATE nie przenosi procesu do innego najemcy");
    expect(sql).toContain("trigger przypial tenant_id do wartosci pierwotnej");
    // §5 i §5b - zmiana etapu ZOSTAWIA wpis w dzienniku, a UPDATE bez zmiany
    // etapu go NIE produkuje (inaczej dziennik puchłby od zapisów bez decyzji).
    expect(sql).toContain("career_application_events");
    expect(sql).toContain("UPDATE bez zmiany etapu NIE produkuje wpisu w dzienniku");
    // §10 - personel widzi w kubełku CV WYŁĄCZNIE swojego najemcę.
    expect(sql).toContain("personel widzi WYLACZNIE swojego najemce");
    // Dwa najemcy w oprzyrządowaniu - bez tego żadna z powyższych asercji nie
    // mierzyłaby izolacji.
    expect(sql).toMatch(/INSERT INTO public\.tenants/);
  });

  it("ten dowód JEST uruchamiany przez CI - inaczej nie byłby dowodem", () => {
    // Uprząż, której nikt nie odpala, jest dokumentacją, nie bramką.
    expect(read(CI_WORKFLOW)).toContain("check:careers-harness");
  });

  it("katalog pgTAP nie zawiera dowodu zgłoszeń - i to jest ŚWIADOME, nie luka", () => {
    // Zostawiamy tę asercję, żeby następny czytelnik nie powtórzył pomyłki:
    // pusty wynik grepu po `supabase/tests/` NIE znaczy „brak dowodu".
    // Kontrola dodatnia: ta sama technika ZNAJDUJE pgTAP dla sekcji karier,
    // więc wzorzec szukania jest sprawny.
    expect(pgtapMentioning("career_applications")).toEqual([]);
    expect(pgtapMentioning("career_sections")).toContain(CAREER_SECTIONS_PGTAP);
    expect(read(CAREERS_HARNESS)).toContain("pgtap nie jest dostepny w tym obrazie");
  });

  it("ZNALEZISKO 6 ZAMKNIĘTE: bramka rodzin tras panelu WIDZI rodzinę `admin.careers`", () => {
    // Stan wejściowy tej paczki: `adminRouteAuthority.gate.test.ts` miał jawne
    // listy rodzin (kluby, newsletter, moduł 19, SEO, społeczność) i ŻADNA nie
    // wymieniała tej trasy - więc dołożenie tu własnego, niezgodnego z bazą
    // warunku roli przechodziłoby po cichu. Znalezisko zostało zamknięte w tej
    // samej gałęzi: bramka ma sekcję „panel rekrutacji - autorytet dostępu".
    // Asercja jest teraz POZYTYWNA, bo dowód ma pilnować obecności rodziny,
    // a nie utrwalać jej brak.
    expect(read(AUTHORITY_GATE)).toContain("admin.careers");
    // Kontrola dodatnia dla samego odczytu - żeby zielone nie brało się
    // z pomylonej ścieżki pliku.
    expect(read(AUTHORITY_GATE)).toContain("admin.newsletter.tsx");
  });
});

// ---------------------------------------------------------------------------
// KSZTAŁT ZAPYTANIA LISTY - i minimalizacja danych
// ---------------------------------------------------------------------------

describe("/admin/careers - co panel pyta bazę o zgłoszenia", () => {
  it("pyta wyłącznie o formularz rekrutacyjny, najnowsze pierwsze, z limitem 500", async () => {
    await mount();
    await waitFor(() => expect(listChains().length).toBeGreaterThan(0));
    const chain = lastList();

    expect(chain.argsOf("eq")).toEqual(["form_id", "careers"]);
    expect(chain.argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(chain.argsOf("limit")).toEqual([500]);
  });

  it('pobiera DOKŁADNIE renderowane kolumny plus embed procesu - żadnego `select("*")`', async () => {
    // MINIMALIZACJA DANYCH: `contact_messages` niesie też pola, których ten
    // ekran nie pokazuje (zgoda newsletterowa, adresat, źródło). Lista kolumn
    // jest jawna, więc panel nie ściąga do przeglądarki danych, których nie
    // potrzebuje - i nie da się tego rozszerzyć „przypadkiem".
    await mount();
    await waitFor(() => expect(listChains().length).toBeGreaterThan(0));
    const [selectArg] = lastList().argsOf("select") ?? [];
    if (typeof selectArg !== "string") throw new Error("test: `select()` nie dostał literału");

    expect(selectArg).not.toContain("*");
    const topLevel = selectArg.replace(/career_applications\([^)]*\)/, "").replace(/,$/, "");
    expect(topLevel.split(",")).toEqual([
      "id",
      "name",
      "email",
      "phone",
      "subject",
      "message",
      "lang",
      "created_at",
      "read_at",
      "archived_at",
      "custom",
    ]);
    expect(selectArg).not.toContain("newsletter_opt_in");
    expect(selectArg).not.toContain("recipient");
  });

  it("ZNALEZISKO 9a: embed procesu ściąga cztery pola, których panel NIE renderuje", async () => {
    // Minimalizacja danych z testu obok jest prawdą o POZIOMIE GŁÓWNYM: tam
    // lista kolumn to dokładnie te jedenaście, które ekran pokazuje. Embed
    // `career_applications(...)` dokłada jednak cztery pola, z których panel
    // nie renderuje ŻADNEGO: `stage_changed_at`, `rejection_reason`,
    // `next_step_at` i `owner_id`. Dwa środkowe mają nawet etykiety w obu
    // słownikach i przyjmuje je mutacja `savePipeline` (ZNALEZISKO 9b), tylko
    // kontrolki nie ma żadnej. Skutek jest po stronie RODO, nie estetyki:
    // uzasadnienie odrzucenia kandydata jedzie do przeglądarki przy KAŻDYM
    // otwarciu skrzynki - dla 500 zgłoszeń naraz - i nikt go tam nie czyta.
    // Zaasertowane jest zachowanie ISTNIEJĄCE: pola SĄ pobierane i NIE trafiają
    // do DOM-u. Naprawą jest zawężenie embedu, więc kod pozostaje nietknięty.
    h.rows = [
      application({
        read_at: "2026-08-21T09:00:00.000Z",
        career_applications: pipelineRow({
          stage_changed_at: "2026-08-25T12:00:00.000Z",
          rejection_reason: "Zmyślony powód odrzucenia: brak zmyślonej kompetencji.",
          next_step_at: "2026-09-01T09:00:00.000Z",
          owner_id: "operator-zmyslony",
        }),
      }),
    ];
    const { container } = await mount();
    await openApplication("Zofia Przykładowska");
    await screen.findByText("Brak zmian etapu.");

    const [selectArg] = lastList().argsOf("select") ?? [];
    for (const kolumna of ["stage_changed_at", "rejection_reason", "next_step_at", "owner_id"]) {
      expect(String(selectArg), `embed przestał pytać o ${kolumna}`).toContain(kolumna);
    }
    for (const wartość of [
      "2026-08-25T12:00:00.000Z",
      "Zmyślony powód odrzucenia: brak zmyślonej kompetencji.",
      "2026-09-01T09:00:00.000Z",
      "operator-zmyslony",
    ]) {
      expect(container.innerHTML, `panel jednak renderuje „${wartość}"`).not.toContain(wartość);
    }

    // Druga połowa tego samego znaleziska: mutacja przyjmuje dwa z tych pól,
    // a żadne z dwóch wywołań na tym ekranie ich nie podaje.
    const source = read(ROUTE_FILE);
    expect(source).toMatch(/rejection_reason\?: string;/);
    expect(source).toMatch(/next_step_at\?: string \| null;/);
    const wywołania = [...source.matchAll(/savePipeline\.mutate\(\{[\s\S]*?\}\)/g)].map(
      (dopasowanie) => dopasowanie[0],
    );
    expect(wywołania).toHaveLength(2);
    expect(wywołania.join("\n")).not.toMatch(/rejection_reason|next_step_at/);
  });

  it("embed procesu jedzie JEDNYM literałem - konkatenacja cofnęłaby typowanie", async () => {
    // Uzasadnienie stoi w komentarzu produkcyjnym: supabase-js parsuje listę
    // kolumn NA POZIOMIE TYPÓW, a sklejony `string` degraduje wynik do
    // `GenericStringError` i embed przestaje się typować. Dowód jest dwustronny:
    // literał w źródle i jeden ciągły argument w wywołaniu.
    expect(read(ROUTE_FILE)).toContain(
      "career_applications(id,stage,stage_changed_at,stage_note,rating,rejection_reason,next_step_at,owner_id)",
    );
    await mount();
    await waitFor(() => expect(listChains().length).toBeGreaterThan(0));
    const args = lastList().argsOf("select") ?? [];
    expect(args).toHaveLength(1);
  });

  it("domyślny filtr „Nowe” pyta o zgłoszenia bez archiwizacji", async () => {
    await mount();
    await waitFor(() => expect(listChains().length).toBeGreaterThan(0));
    expect(lastList().argsOf("is")).toEqual(["archived_at", null]);
    expect(lastList().has("not")).toBe(false);
  });

  it("filtr „Archiwum” pyta o zgłoszenia Z datą archiwizacji - filtr jest SERWEROWY", async () => {
    // Zapytanie jest ucięte na 500 wierszach, więc archiwum policzone na
    // kliencie znikałoby po pierwszych 500 zgłoszeniach.
    await mount();
    await settled();
    fireEvent.click(screen.getByRole("button", { name: "Archiwum" }));

    await waitFor(() => expect(lastList().has("not")).toBe(true));
    expect(lastList().argsOf("not")).toEqual(["archived_at", "is", null]);
    expect(lastList().has("is")).toBe(false);
  });

  it("filtr „Wszystkie” nie zawęża zapytania ani w jedną, ani w drugą stronę", async () => {
    await mount();
    await settled();
    fireEvent.click(screen.getByRole("button", { name: "Wszystkie" }));

    await waitFor(() => expect(lastList().has("is")).toBe(false));
    expect(lastList().has("not")).toBe(false);
  });

  it("aktywny filtr jest widoczny - operator wie, czego NIE widzi", async () => {
    // Bez wyróżnienia aktywnej zakładki „brak zgłoszeń" w archiwum czyta się
    // jak „brak zgłoszeń w ogóle".
    const { container } = await mount();
    await settled();
    const active = container.querySelectorAll("button.bg-brand");
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveTextContent("Nowe");

    fireEvent.click(screen.getByRole("button", { name: "Archiwum" }));
    await waitFor(() =>
      expect(container.querySelector("button.bg-brand")).toHaveTextContent("Archiwum"),
    );
  });

  it("przycisk odświeżania wywołuje ponowne zapytanie", async () => {
    await mount();
    await settled();
    const before = listChains().length;

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(listChains().length).toBeGreaterThan(before));
  });

  it("ZNALEZISKO 4: nazwa przycisku odświeżania jest angielskim literałem bez klucza i18n", () => {
    // `realT` mierzy słownik: brakujący klucz i18next zwraca sam klucz, więc
    // równość dowodzi, że „Refresh" NIE JEST tłumaczone ani przez i18n, ani
    // przez wbudowane `PL`/`EN` (te są w module trasy).
    expect(read(ROUTE_FILE)).toContain('aria-label="Refresh"');
    expect(realT("pl")("Refresh")).toBe("Refresh");
    expect(realT("en")("Refresh")).toBe("Refresh");
  });
});

// ---------------------------------------------------------------------------
// STANY LISTY
// ---------------------------------------------------------------------------

describe("/admin/careers - trzy stany odczytu skrzynki", () => {
  it("w trakcie pobierania mówi, że pracuje - nie udaje pustej skrzynki", async () => {
    h.hang.add("contact_messages");
    await mount();

    expect(await screen.findByText("…")).toBeInTheDocument();
    // Ładowanie i pustka są WZAJEMNIE WYKLUCZAJĄCE - inaczej operator widzi
    // „Brak zgłoszeń." na skrzynce pełnej zgłoszeń.
    expect(screen.queryByText("Brak zgłoszeń.")).toBeNull();
  });

  it("pusta skrzynka mówi to wprost", async () => {
    await mount();
    await settled();
    expect(screen.getByText("Brak zgłoszeń.")).toBeInTheDocument();
  });

  it("odpowiedź bez ciała (`data: null`) nie wywraca panelu", async () => {
    // PostgREST potrafi oddać `null` zamiast pustej tablicy. Bez `data ?? []`
    // panel padałby na `.map` i operator dostawał biały ekran.
    h.rows = null;
    await mount();
    await settled();
    expect(screen.getByText("Brak zgłoszeń.")).toBeInTheDocument();
  });

  it("odmowa odczytu nie renderuje wierszy widmo", async () => {
    // Połowa kontraktu, która DZIAŁA i której nie wolno stracić przy naprawie
    // ZNALEZISKA 1: po odmowie lista jest pusta, a nie wypełniona resztkami.
    h.rowsError = "odmowa RLS";
    const { container } = await mount();
    await settled();
    expect(container.querySelectorAll("li")).toHaveLength(1);
    expect(screen.getByText("Brak zgłoszeń.")).toBeInTheDocument();
  });

  /**
   * ZŁAMANY KONTRAKT (ZNALEZISKO 1): odmowa odczytu wygląda jak pusta
   * skrzynka. `data: rows = []` sprowadza błąd zapytania do gałęzi pustki, więc
   * gdy RLS odmówi albo sieć padnie, operator czyta zdanie o STANIE BAZY.
   * Skutek: zgłoszenie kandydata wygląda na nieistniejące, a termin
   * odpowiedzi biegnie dalej.
   *
   * OCZEKIWANY KONTRAKT: `isError` daje własny komunikat, różny od „Brak
   * zgłoszeń.".
   *
   * `it.fails`, bo naprawa wymaga zmiany pliku trasy. KONTROLA DODATNIA: test
   * „pusta skrzynka mówi to wprost" dowodzi, że ta sama technika oczekiwania
   * wykrywa poprawny przypadek pustki.
   */
  it.fails("odmowa odczytu NIE wygląda jak pusta skrzynka", async () => {
    h.rowsError = "odmowa RLS";
    await mount();
    await settled();
    expect(screen.queryByText("Brak zgłoszeń.")).toBeNull();
  });

  it("wiersz listy niesie nazwisko, datę, rolę, kropkę nieprzeczytanego i etap", async () => {
    h.rows = [application()];
    await mount();
    await screen.findByText("Zofia Przykładowska");
    const row = within(listRow("Zofia Przykładowska"));

    expect(row.getByText("Zofia Przykładowska")).toBeInTheDocument();
    expect(row.getByText("Analityk ds. polityki cyfrowej")).toBeInTheDocument();
    expect(
      row.getByText(new Date("2026-08-20T07:00:00.000Z").toLocaleDateString()),
    ).toBeInTheDocument();
    // Etap pokazujemy TEKSTEM ze wspólnej warstwy, nie kodem enuma - i z
    // kolorem, który jest jedyną szybką różnicą między „Nowe" i „Odrzucony".
    const badge = row.getByText(stageLabel("new", "pl"));
    expect(badge.className).toContain(CAREER_STAGE_STYLE.new);
    expect(listRow("Zofia Przykładowska").querySelector("span.bg-brand")).not.toBeNull();
  });

  it("zgłoszenie przeczytane nie ma kropki nieprzeczytanego", async () => {
    h.rows = [application({ read_at: "2026-08-21T09:00:00.000Z" })];
    await mount();
    await screen.findByText("Zofia Przykładowska");
    expect(listRow("Zofia Przykładowska").querySelector("span.bg-brand")).toBeNull();
  });

  it("podpis wiersza spada z roli na temat, a z tematu na adres kandydata", async () => {
    // Zgłoszenie spontaniczne nie ma etykiety roli, a zgłoszenie z formularza
    // sprzed zmiany nie ma tematu. Wiersz bez podpisu byłby nie do odróżnienia
    // od sąsiedniego.
    h.rows = [
      application({
        id: "bez-roli",
        name: "Bartosz Zmyślony",
        custom: {},
        subject: "Zgłoszenie spontaniczne",
      }),
      application({
        id: "bez-tematu",
        name: "Cecylia Nieistniejąca",
        email: "cecylia.nieistniejaca@example.com",
        custom: {},
        subject: null,
      }),
    ];
    await mount();
    await screen.findByText("Bartosz Zmyślony");

    expect(
      within(listRow("Bartosz Zmyślony")).getByText("Zgłoszenie spontaniczne"),
    ).toBeInTheDocument();
    expect(
      within(listRow("Cecylia Nieistniejąca")).getByText("cecylia.nieistniejaca@example.com"),
    ).toBeInTheDocument();
  });

  it("zgłoszenie bez wiersza procesu nie dostaje plakietki etapu", async () => {
    h.rows = [application({ career_applications: null })];
    await mount();
    await screen.findByText("Zofia Przykładowska");
    expect(within(listRow("Zofia Przykładowska")).queryByText(stageLabel("new", "pl"))).toBeNull();
  });

  it("panel znosi OBA kształty embedu PostgREST - obiekt i jednoelementową tablicę", async () => {
    // PostgREST zwraca zagnieżdżenie raz jako obiekt, raz jako tablicę
    // (zależnie od wykrytej kardynalności). Panel oddaje to parsowanie
    // PRAWDZIWEJ warstwie `parseRecruitmentPipeline`, więc oba kształty
    // muszą dać ten sam wiersz - inaczej etap gubi się przy zmianie planu
    // zapytania, a nie przy zmianie kodu.
    h.rows = [
      application({ id: "obiekt", name: "Dorota Obiektowa", career_applications: pipelineRow() }),
      application({
        id: "tablica",
        name: "Edward Tablicowy",
        career_applications: [pipelineRow({ id: "proces-2", stage: "interview" })],
      }),
    ];
    await mount();
    await screen.findByText("Dorota Obiektowa");

    expect(within(listRow("Dorota Obiektowa")).getByText(stageLabel("new", "pl"))).toHaveClass(
      ...CAREER_STAGE_STYLE.new.split(" "),
    );
    expect(
      within(listRow("Edward Tablicowy")).getByText(stageLabel("interview", "pl")),
    ).toBeInTheDocument();
  });

  it("nieznany etap z bazy nie wywraca listy - warstwa spada na „Nowe”", async () => {
    // Enum `career_stage` może dorosnąć w migracji szybciej niż front. Wtedy
    // panel ma pokazać coś sensownego, a nie puste miejsce bez klasy koloru.
    h.rows = [application({ career_applications: pipelineRow({ stage: "zmyslony_etap" }) })];
    await mount();
    await screen.findByText("Zofia Przykładowska");
    expect(
      within(listRow("Zofia Przykładowska")).getByText(stageLabel("new", "pl")),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// FILTRY LICZONE NA KLIENCIE (ZNALEZISKO 2)
// ---------------------------------------------------------------------------

describe("/admin/careers - filtr etapu i szukajka liczą się na KLIENCIE", () => {
  const trzy = () => [
    application({
      id: "w-toku",
      name: "Filip Wtoku",
      email: "filip.wtoku@example.com",
      career_applications: pipelineRow({ stage: "interview" }),
    }),
    application({
      id: "domkniete",
      name: "Grażyna Domknięta",
      email: "grazyna.domknieta@example.com",
      career_applications: pipelineRow({ id: "proces-3", stage: "rejected" }),
    }),
    application({
      id: "bez-procesu",
      name: "Henryk Bezprocesu",
      email: "henryk.bezprocesu@example.com",
      career_applications: null,
    }),
  ];

  it("ZNALEZISKO 2: zmiana filtra etapu NIE wywołuje nowego zapytania", async () => {
    // To jest sedno znaleziska: lista jest ucięta na 500 wierszach, a etap
    // przesiewa się w `useMemo`. Dla najemcy z dłuższą historią „Domknięte"
    // pokazuje wynik z PIERWSZYCH 500 zgłoszeń i milczy o resztzie. Ten test
    // przybija zachowanie ISTNIEJĄCE, żeby nikt nie pomylił go z filtrem
    // serwerowym - i zapali się, gdy filtr do bazy w końcu pojedzie.
    h.rows = trzy();
    await mount();
    await screen.findByText("Filip Wtoku");
    const before = listChains().length;

    fireEvent.change(stageFilterSelect(), { target: { value: "closed" } });

    await waitFor(() => expect(screen.queryByText("Filip Wtoku")).toBeNull());
    expect(listChains()).toHaveLength(before);
    expect(lastList().calls.map((call) => call.method)).not.toContain("filter");
  });

  it("„W toku” obejmuje etapy otwarte ORAZ zgłoszenia bez wiersza procesu", async () => {
    // Brak wiersza procesu to sygnał awarii triggera bootstrapu, a nie
    // „sprawa zamknięta" - takie zgłoszenie MUSI zostać w kolejce do obróbki.
    h.rows = trzy();
    await mount();
    await screen.findByText("Filip Wtoku");

    fireEvent.change(stageFilterSelect(), { target: { value: "open" } });

    await waitFor(() => expect(screen.queryByText("Grażyna Domknięta")).toBeNull());
    expect(screen.getByText("Filip Wtoku")).toBeInTheDocument();
    expect(screen.getByText("Henryk Bezprocesu")).toBeInTheDocument();
  });

  it("„Domknięte” pokazuje tylko etapy, po których biegnie retencja CV", async () => {
    h.rows = trzy();
    await mount();
    await screen.findByText("Filip Wtoku");

    fireEvent.change(stageFilterSelect(), { target: { value: "closed" } });

    await waitFor(() => expect(screen.getByText("Grażyna Domknięta")).toBeInTheDocument());
    expect(screen.queryByText("Filip Wtoku")).toBeNull();
    expect(screen.queryByText("Henryk Bezprocesu")).toBeNull();
  });

  it("wybór konkretnego etapu zawęża listę do tego jednego etapu", async () => {
    h.rows = trzy();
    await mount();
    await screen.findByText("Filip Wtoku");

    fireEvent.change(stageFilterSelect(), { target: { value: "interview" } });

    await waitFor(() => expect(screen.queryByText("Grażyna Domknięta")).toBeNull());
    expect(screen.getByText("Filip Wtoku")).toBeInTheDocument();
    expect(screen.queryByText("Henryk Bezprocesu")).toBeNull();
  });

  it("droplista filtra oferuje trzy zbiorcze pozycje i KAŻDY etap ze wspólnej warstwy", async () => {
    // Lista etapów jest jednym źródłem prawdy z enumem bazy (`CAREER_STAGES`).
    // Gdyby panel miał własną kopię, nowy etap w migracji nie dałby się
    // odfiltrować, a operator nie miałby o tym skąd wiedzieć.
    await mount();
    await settled();
    const options = within(stageFilterSelect()).getAllByRole("option");

    expect(options.map((option) => option.textContent)).toEqual([
      "Wszystkie etapy",
      "W toku",
      "Domknięte",
      ...CAREER_STAGES.map((stage) => stageLabel(stage, "pl")),
    ]);
  });

  it("szukajka przesiewa po nazwisku, adresie, temacie i treści - bez wielkości liter", async () => {
    // REWIZJA: pierwsza wersja tego testu obiecywała w nazwie „temat i treść",
    // a przesiewała WYŁĄCZNIE po nazwisku i adresie - na fixture, w którym
    // wszystkie trzy zgłoszenia miały IDENTYCZNY temat i treść, więc dowodu
    // tamtych dwóch pól nie dało się w nim nawet napisać. Fixture jest teraz
    // rozłączny: każde z czterech pól niesie napis, który trafia w DOKŁADNIE
    // jedno zgłoszenie, więc każda iteracja mierzy JEDNO pole przesiewu.
    h.rows = [
      application({
        id: "filip",
        name: "Filip Wtoku",
        email: "filip.wtoku@example.com",
        subject: "Zgłoszenie na staż analityczny",
        message: "Zmyślona motywacja: fascynuje mnie regulacja platform cyfrowych.",
      }),
      application({
        id: "grazyna",
        name: "Grażyna Domknięta",
        email: "grazyna.domknieta@example.com",
        subject: "Zgłoszenie spontaniczne",
        message: "Zmyślony list: chciałabym prowadzić szkolenia dla samorządów.",
      }),
    ];
    await mount();
    await screen.findByText("Filip Wtoku");
    const box = screen.getByPlaceholderText("Szukaj: imię, e-mail, rola…");

    const przypadki: ReadonlyArray<[pole: string, needle: string, zostaje: string, znika: string]> =
      [
        ["nazwisko (wielkimi literami)", "GRAŻYNA", "Grażyna Domknięta", "Filip Wtoku"],
        [
          "adres (mieszaną wielkością)",
          "filip.wtoku@EXAMPLE.com",
          "Filip Wtoku",
          "Grażyna Domknięta",
        ],
        ["temat zgłoszenia", "staż analityczny", "Filip Wtoku", "Grażyna Domknięta"],
        ["treść zgłoszenia", "PROWADZIĆ SZKOLENIA", "Grażyna Domknięta", "Filip Wtoku"],
      ];

    for (const [pole, needle, zostaje, znika] of przypadki) {
      fireEvent.change(box, { target: { value: needle } });
      await waitFor(() => expect(screen.queryByText(znika), `przesiew po ${pole}`).toBeNull());
      expect(screen.getByText(zostaje), `przesiew po ${pole}`).toBeInTheDocument();
    }
  });

  it("szukajka sięga też do pól rekrutacyjnych z kolumny `custom`", async () => {
    // Operator szuka „kto aplikował na analizy" albo „kto podał LinkedIn",
    // a nie tylko po nazwisku. Te pola żyją w jsonb, więc muszą być jawnie
    // wymienione w przesiewie.
    // Temat jest tu WYZEROWANY, bo domyślny fixture ma w nim tę samą frazę co
    // `role_label` - bez tego iteracja „etykieta roli" nie mierzyłaby `custom`,
    // tylko `subject`, i przechodziłaby przy usuniętym polu z przesiewu.
    h.rows = [
      application({
        subject: null,
        custom: {
          role_label: "Analityk ds. polityki cyfrowej",
          department: "analysis",
          seniority: "senior",
          linkedin: "https://linkedin.example.com/in/zmyslona-zofia",
          cv_file_name: "zyciorys-zmyslony.pdf",
        },
      }),
      application({ id: "inny", name: "Ignacy Inny", custom: {}, subject: null }),
    ];
    await mount();
    await screen.findByText("Zofia Przykładowska");
    const box = screen.getByPlaceholderText("Szukaj: imię, e-mail, rola…");

    for (const needle of [
      "Analityk ds. polityki",
      "analysis",
      "senior",
      "linkedin.example.com",
      "zyciorys-zmyslony",
    ]) {
      fireEvent.change(box, { target: { value: needle } });
      await waitFor(() => expect(screen.queryByText("Ignacy Inny")).toBeNull());
      expect(
        screen.getByText("Zofia Przykładowska"),
        `szukajka nie widzi „${needle}"`,
      ).toBeInTheDocument();
    }
  });

  it("brak trafień mówi „Brak zgłoszeń.”, a nie pokazuje pustej listy bez słowa", async () => {
    h.rows = trzy();
    await mount();
    await screen.findByText("Filip Wtoku");

    fireEvent.change(screen.getByPlaceholderText("Szukaj: imię, e-mail, rola…"), {
      target: { value: "nikt-taki-nie-aplikował" },
    });

    expect(await screen.findByText("Brak zgłoszeń.")).toBeInTheDocument();
  });

  it("puste zapytanie nie przesiewa niczego - wraca cała strona wyników", async () => {
    h.rows = trzy();
    await mount();
    const box = await screen.findByPlaceholderText("Szukaj: imię, e-mail, rola…");
    fireEvent.change(box, { target: { value: "Filip" } });
    await waitFor(() => expect(screen.queryByText("Grażyna Domknięta")).toBeNull());

    fireEvent.change(box, { target: { value: "   " } });

    await waitFor(() => expect(screen.getByText("Grażyna Domknięta")).toBeInTheDocument());
    expect(screen.getByText("Henryk Bezprocesu")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// WYBÓR ZGŁOSZENIA I OZNACZANIE PRZECZYTANE
// ---------------------------------------------------------------------------

describe("/admin/careers - otwarcie zgłoszenia", () => {
  it("bez wyboru prawa kolumna prosi o wybór i NIE pyta ani CRM, ani dziennika", async () => {
    // TO JEST DOWÓD ZASTĘPCZY dla dwóch świadomie niepokrytych gałęzi
    // (`current?.email ?? ""` w filtrze leada i `current?.pipeline?.id ?? ""`
    // w filtrze dziennika), więc nie wolno mu być zielonym PRZEZ TIMING.
    //
    // REWIZJA: pierwsza wersja asertowała zero łańcuchów NATYCHMIAST po
    // `findByText("Wybierz zgłoszenie z listy.")` - a to zdanie jest na ekranie
    // od PIERWSZEGO renderu, jeszcze przed odpowiedzią listy. Licznik był więc
    // zerowy, bo nic nie zdążyło polecieć, i test przechodziłby także wtedy,
    // gdyby panel pytał CRM bez wyboru. Teraz czekamy, aż lista ODPOWIE i
    // wiersz się wyrenderuje (czyli minie render, w którym `enabled` mogłoby
    // się przewrócić), a KONTROLA DODATNIA na końcu pokazuje, że te same
    // liczniki UMIEJĄ wzrosnąć - zero nie jest własnością pomiaru.
    h.rows = [application()];
    await mount();
    expect(await screen.findByText("Wybierz zgłoszenie z listy.")).toBeInTheDocument();
    await settled();
    expect(await screen.findByText("Zofia Przykładowska")).toBeInTheDocument();
    expect(listChains().length).toBeGreaterThan(0);

    expect(leadChains()).toHaveLength(0);
    expect(eventChains()).toHaveLength(0);

    await openApplication("Zofia Przykładowska");
    await waitFor(() => {
      expect(leadChains().length).toBeGreaterThan(0);
      expect(eventChains().length).toBeGreaterThan(0);
    });
  });

  it("karta kandydata niesie kontakt, datę i język zgłoszenia", async () => {
    h.rows = [application()];
    await mount();
    await openApplication("Zofia Przykładowska");

    expect(screen.getByText(/zofia\.przykladowska@example\.com/)).toBeInTheDocument();
    expect(screen.getByText(/\+48 000 000 001/)).toBeInTheDocument();
    // Język zgłoszenia decyduje, w którym języku pisze się odpowiedź.
    expect(screen.getByText("PL")).toBeInTheDocument();
    expect(
      screen.getByText("Zmyślone uzasadnienie kandydatury na zmyślone stanowisko."),
    ).toBeInTheDocument();
  });

  it("brak telefonu nie zostawia wiszącego separatora w linii kontaktu", async () => {
    // REWIZJA: pierwsza wersja asertowała TYLKO negatyw („nie ma dwóch kropek
    // pod rząd"), co jest zielone także dla linii kontaktu, z której zniknął
    // adres albo data. Asercja jest teraz na PEŁNY tekst linii, w obu
    // wariantach - i to ona mówi, że separator pojawia się dokładnie wtedy,
    // gdy jest co rozdzielać.
    const utworzone = new Date("2026-08-20T07:00:00.000Z").toLocaleString();
    const linia = (root: HTMLElement): string =>
      root.querySelector("section p.text-xs")?.textContent ?? "";

    h.rows = [application({ phone: null })];
    const bezTelefonu = await mount();
    await openApplication("Zofia Przykładowska");
    expect(linia(bezTelefonu.container)).toBe(`zofia.przykladowska@example.com · ${utworzone}`);

    cleanup();
    h.rows = [application()];
    const zTelefonem = await mount();
    await openApplication("Zofia Przykładowska");
    expect(linia(zTelefonem.container)).toBe(
      `zofia.przykladowska@example.com · +48 000 000 001 · ${utworzone}`,
    );
  });

  it("samo OTWARCIE nieprzeczytanego zgłoszenia zapisuje `read_at` i status", async () => {
    // To jedyny zapis, którego operator nie inicjuje świadomie - a widzi go
    // też Contact Center. Bez niego licznik nieprzeczytanych kłamie.
    h.rows = [application()];
    const queryClient = testClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await mount(queryClient);
    await openApplication("Zofia Przykładowska");

    await waitFor(() => expect(messageUpdates()).toHaveLength(1));
    const [values] = messageUpdates()[0].argsOf("update") ?? [];
    if (typeof values !== "object" || values === null) {
      throw new Error("test: UPDATE nie dostał obiektu wartości");
    }
    expect(Object.keys(values).sort()).toEqual(["read_at", "status"]);
    expect(Reflect.get(values, "status")).toBe("read");
    expect(typeof Reflect.get(values, "read_at")).toBe("string");
    expect(messageUpdates()[0].argsOf("eq")).toEqual(["id", "zgloszenie-1"]);

    // Zgłoszenia rekrutacyjne widać także w Contact Center (ta sama tabela),
    // więc bez DRUGIEJ inwalidacji „przeczytane" rozjeżdża się między
    // skrzynkami do końca sesji.
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin-career-applications"] }),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin-contact-messages"] });
  });

  it("otwarcie zgłoszenia JUŻ przeczytanego nie pisze do bazy drugi raz", async () => {
    h.rows = [application({ read_at: "2026-08-21T09:00:00.000Z" })];
    await mount();
    await openApplication("Zofia Przykładowska");
    await waitFor(() => expect(eventChains().length).toBeGreaterThan(0));
    expect(messageUpdates()).toHaveLength(0);
  });

  it("zgłoszenie wypchnięte przez szukajkę zamyka kartę, a nie pokazuje resztek", async () => {
    // `filtered.find(...) ?? null` - bez tego panel trzymałby na ekranie dane
    // kandydata, którego nie ma już na liście, i operator dopisywałby notatkę
    // „do niewidocznego" zgłoszenia.
    h.rows = [application(), application({ id: "drugi", name: "Jan Zmyślony", custom: {} })];
    await mount();
    await openApplication("Zofia Przykładowska");

    fireEvent.change(screen.getByPlaceholderText("Szukaj: imię, e-mail, rola…"), {
      target: { value: "Jan Zmyślony" },
    });

    expect(await screen.findByText("Wybierz zgłoszenie z listy.")).toBeInTheDocument();
  });

  it("wybrany wiersz jest wyróżniony na liście", async () => {
    h.rows = [application(), application({ id: "drugi", name: "Jan Zmyślony", custom: {} })];
    await mount();
    await openApplication("Zofia Przykładowska");

    expect(listRow("Zofia Przykładowska").querySelector("button.bg-muted")).not.toBeNull();
    expect(listRow("Jan Zmyślony").querySelector("button.bg-muted")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// CV KANDYDATA - najdrażliwszy fragment tego ekranu
// ---------------------------------------------------------------------------

describe("/admin/careers - dostęp do CV kandydata", () => {
  const withCustom = (custom: Record<string, unknown>) => [application({ custom })];

  it("brak CV mówi „Brak CV”, a nie zostawia operatora bez informacji", async () => {
    h.rows = withCustom({ role_label: "Analityk ds. polityki cyfrowej" });
    await mount();
    await openApplication("Zofia Przykładowska");

    expect(screen.getByText(/^CV:\s*Brak CV$/)).toBeInTheDocument();
    expect(h.signCalls).toEqual([]);
  });

  it("CV usunięte przez retencję jest odróżnione od CV, którego nigdy nie było", async () => {
    // Bez tego rozróżnienia operator widzi „Brak CV" i szuka błędu
    // w formularzu, a plik został skasowany zgodnie z polityką RODO - data
    // usunięcia jest tu odpowiedzią na pytanie „gdzie ono jest".
    h.rows = withCustom({ cv_purged_at: "2026-08-30" });
    await mount();
    await openApplication("Zofia Przykładowska");

    expect(screen.getByText("CV: CV usunięte (retencja) · 2026-08-30")).toBeInTheDocument();
    expect(screen.queryByText(/Brak CV/)).toBeNull();
  });

  it("pusta data usunięcia (same odstępy) wraca do „Brak CV”", async () => {
    h.rows = withCustom({ cv_purged_at: "   " });
    await mount();
    await openApplication("Zofia Przykładowska");
    expect(screen.getByText(/^CV:\s*Brak CV$/)).toBeInTheDocument();
  });

  it("plik w buckecie daje PRZYCISK z nazwą pliku - a nie gotowy link", async () => {
    // Kluczowa własność prywatności: dopóki operator nie kliknie, podpisanego
    // adresu NIE MA - ani w drzewie DOM, ani w pamięci przeglądarki. Panel
    // pokazuje tylko nazwę pliku, którą kandydat sam nadał.
    h.rows = withCustom({ cv_path: CV_PATH, cv_file_name: "zyciorys-zmyslony.pdf" });
    const { container } = await mount();
    await openApplication("Zofia Przykładowska");

    const button = screen.getByRole("button", { name: "zyciorys-zmyslony.pdf" });
    expect(button.tagName).toBe("BUTTON");
    expect(h.signCalls).toEqual([]);
    expect(container.querySelector(`a[href*="${CV_PATH}"]`)).toBeNull();
    expect(container.innerHTML).not.toContain("token=");
  });

  it("plik bez nazwy własnej dostaje etykietę „Otwórz CV”", async () => {
    h.rows = withCustom({ cv_path: CV_PATH });
    await mount();
    await openApplication("Zofia Przykładowska");
    expect(screen.getByRole("button", { name: "Otwórz CV" })).toBeInTheDocument();
  });

  it("klik podpisuje DOKŁADNIE ścieżkę ze zgłoszenia i otwiera plik w nowej karcie", async () => {
    h.rows = withCustom({ cv_path: CV_PATH, cv_file_name: "zyciorys-zmyslony.pdf" });
    h.signed = "https://storage.example.com/career-cv/podpisany?token=zmyslony";
    const { container } = await mount();
    await openApplication("Zofia Przykładowska");

    fireEvent.click(screen.getByRole("button", { name: "zyciorys-zmyslony.pdf" }));

    await waitFor(() => expect(h.signCalls).toEqual([CV_PATH]));
    // `noopener,noreferrer` nie jest ozdobą: bez nich otwarty dokument dostaje
    // `window.opener` do panelu admina i referrer z adresem skrzynki.
    await waitFor(() =>
      expect(h.opened).toEqual([
        [
          "https://storage.example.com/career-cv/podpisany?token=zmyslony",
          "_blank",
          "noopener,noreferrer",
        ],
      ]),
    );
    // I najważniejsze: podpisany adres NIE trafia do drzewa DOM, więc nie
    // wycieka ani do zrzutu ekranu, ani do rozszerzenia przeglądarki.
    expect(container.innerHTML).not.toContain("token=zmyslony");
    expect(h.toasts).toEqual([]);
  });

  it("odmowa podpisu kończy się komunikatem, a nie pustym oknem", async () => {
    h.rows = withCustom({ cv_path: CV_PATH });
    h.signed = null;
    await mount();
    await openApplication("Zofia Przykładowska");

    fireEvent.click(screen.getByRole("button", { name: "Otwórz CV" }));

    await waitFor(() =>
      expect(h.toasts).toContainEqual({
        kind: "error",
        text: "Nie udało się wygenerować linku do CV.",
      }),
    );
    expect(h.opened).toEqual([]);
  });

  it("w trakcie podpisywania przycisk jest zablokowany - jedno CV, jedno żądanie", async () => {
    h.rows = withCustom({ cv_path: CV_PATH });
    h.signHolds = true;
    h.signed = "https://storage.example.com/career-cv/podpisany?token=zmyslony";
    await mount();
    await openApplication("Zofia Przykładowska");

    const button = screen.getByRole("button", { name: "Otwórz CV" });
    fireEvent.click(button);

    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);
    expect(h.signCalls).toHaveLength(1);

    const release = h.releaseSign;
    if (!release) throw new Error("test: podpisywanie nie wystartowało, nie ma czego zwolnić");
    release();
    await waitFor(() => expect(button).toBeEnabled());
    expect(h.opened).toHaveLength(1);
  });

  it("ścieżka o NIEZNANYM kształcie nie jest podpisywana - to bramka przed cudzym CV", async () => {
    // `custom.cv_path` przychodzi z PUBLICZNEGO formularza, a panel podpisuje
    // ją bez pytania. Bez tej bramki wystarczyłoby podmienić pole w żądaniu,
    // żeby wymusić podpisany link do dowolnego obiektu w buckecie - czyli do
    // CV innego kandydata. Panel nie oferuje wtedy ŻADNEGO przycisku.
    for (const zla of [
      "../../innym-tenancie/uploads/2026-08-20/abcdef1234.pdf",
      "uploads/2026-08-20/skrypt.exe",
      "cv.pdf",
      "https://złośliwy.example.com/cv.pdf",
    ]) {
      cleanup();
      h.rows = withCustom({ cv_path: zla });
      await mount();
      await openApplication("Zofia Przykładowska");

      expect(
        screen.getByText(/^CV:\s*Brak CV$/),
        `ścieżka „${zla}" nie została odrzucona`,
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Otwórz CV" })).toBeNull();
      expect(h.signCalls).toEqual([]);
    }
  });

  it("ścieżka sprzed zmiany konwencji (bez tenanta) nadal działa", async () => {
    // Plików sprzed konwencji nie przenosimy (UPDATE `storage.objects.name`
    // rozjechałby wiersz z plikiem), więc muszą dalej przechodzić walidację -
    // prawa do nich pilnuje polityka bucketu przez referencję ze zgłoszenia.
    h.rows = withCustom({ cv_path: "uploads/2026-08-20/abcdef1234.pdf" });
    h.signed = "https://storage.example.com/career-cv/legacy?token=zmyslony";
    await mount();
    await openApplication("Zofia Przykładowska");

    fireEvent.click(screen.getByRole("button", { name: "Otwórz CV" }));

    await waitFor(() => expect(h.signCalls).toEqual(["uploads/2026-08-20/abcdef1234.pdf"]));
    expect(read(CV_SCOPE_MIGRATION)).toContain("m.custom ->> 'cv_path' = storage.objects.name");
  });

  it("link zewnętrzny BEZ schematu dostaje absolutny adres, nie ścieżkę w panelu", async () => {
    // „linkedin.example.com/in/x" w `<a href>` jest URL-em RELATYWNYM
    // i prowadziłby do /admin/linkedin.example.com/... - operator klikałby
    // w martwy link zamiast otworzyć profil kandydata.
    h.rows = withCustom({ cv_url: "linkedin.example.com/in/zmyslona-zofia" });
    await mount();
    await openApplication("Zofia Przykładowska");

    const link = screen.getByRole("link", { name: "Otwórz CV" });
    expect(link).toHaveAttribute("href", "https://linkedin.example.com/in/zmyslona-zofia");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(h.signCalls).toEqual([]);
  });

  it("wartość, która nie jest adresem, jest traktowana jak brak CV", async () => {
    h.rows = withCustom({ cv_url: "prześlę mailem" });
    await mount();
    await openApplication("Zofia Przykładowska");
    expect(screen.getByText(/^CV:\s*Brak CV$/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Otwórz CV" })).toBeNull();
  });

  it("gdy są OBA - plik z bucketu wygrywa nad linkiem zewnętrznym", async () => {
    // Plik w naszym magazynie jest dowodem, który mamy pod kontrolą (i który
    // podlega retencji). Link zewnętrzny może zniknąć bez naszej wiedzy.
    h.rows = withCustom({ cv_path: CV_PATH, cv_url: "https://linkedin.example.com/in/zofia" });
    await mount();
    await openApplication("Zofia Przykładowska");

    expect(screen.getByRole("button", { name: "Otwórz CV" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Otwórz CV" })).toBeNull();
  });

  it("wartości nietekstowe w `custom` nie docierają do CV - jsonb bywa czymkolwiek", async () => {
    // `custom` jest kolumną jsonb, więc może przyjść liczba, tablica albo
    // obiekt. PRAWDZIWA warstwa (`asCustomRecord`) wpuszcza wyłącznie napisy,
    // dzięki czemu `isCareerCvPath` nie dostaje nigdy nie-stringa.
    h.rows = withCustom({ cv_path: 42, cv_url: ["https://example.com/cv.pdf"], cv_purged_at: 7 });
    await mount();
    await openApplication("Zofia Przykładowska");
    expect(screen.getByText(/^CV:\s*Brak CV$/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// DANE ZGŁOSZENIA I SYNCHRONIZACJA Z CRM
// ---------------------------------------------------------------------------

describe("/admin/careers - dane zgłoszenia i karta leada", () => {
  it("pola rekrutacyjne pokazują TEKST ze wspólnej warstwy, a nie slug z formularza", async () => {
    // Kandydat wybiera slug („analysis", „mid", „month"), a operator musi
    // czytać zdanie. Słowniki żyją w `recruitmentShared` (wspólne z panelem
    // „Rekrutacja" na karcie CRM), więc asercja idzie PRZEZ te funkcje.
    h.rows = [application()];
    const { container } = await mount();
    await openApplication("Zofia Przykładowska");

    const list = container.querySelector("dl");
    if (!(list instanceof HTMLElement)) throw new Error("test: brak listy pól zgłoszenia");
    const pairs = [...list.querySelectorAll("div")].map((row) => [
      row.querySelector("dt")?.textContent,
      row.querySelector("dd")?.textContent,
    ]);
    expect(pairs).toEqual([
      ["Rola", "Analityk ds. polityki cyfrowej"],
      ["Dział", departmentLabel("analysis", "pl")],
      ["Poziom", seniorityLabel("mid", "pl")],
      ["Dostępność", startLabel("month", "pl")],
      ["LinkedIn", "https://linkedin.example.com/in/zmyslona-zofia"],
    ]);
  });

  it("brak etykiety roli spada na slug, a brak jednego i drugiego na „-”", async () => {
    h.rows = [
      application({ id: "slug", name: "Klara Slugowa", custom: { role: "analysis-lead" } }),
      application({ id: "puste", name: "Leon Pustawy", custom: {} }),
    ];
    const { container } = await mount();

    await openApplication("Klara Slugowa");
    expect(container.querySelector("dl")?.textContent ?? "").toContain("analysis-lead");

    await openApplication("Leon Pustawy");
    const pairs = [...(container.querySelectorAll("dl dd") ?? [])].map((dd) => dd.textContent);
    // Pięć razy „-", nie pięć pustych prostokątów: puste pole czyta się jak
    // błąd renderu, a myślnik jak „kandydat tego nie podał".
    expect(pairs).toEqual(["-", "-", "-", "-", "-"]);
  });

  it("nieznany slug pokazujemy SUROWO - lepiej dziwny napis niż puste pole", async () => {
    // Wartość może wjechać do bazy migracją szybciej niż do słownika.
    h.rows = [application({ custom: { department: "zmyslony_dzial", seniority: "principal" } })];
    const { container } = await mount();
    await openApplication("Zofia Przykładowska");

    const text = container.querySelector("dl")?.textContent ?? "";
    expect(text).toContain("zmyslony_dzial");
    expect(text).toContain("principal");
  });

  it("lead w CRM szukany jest po `email_norm`, najnowszy pierwszy, jeden wiersz", async () => {
    // Dopasowanie MUSI iść po `email_norm`: `crm_leads.email` trzyma adres tak,
    // jak go wpisał kandydat, więc porównanie z zlowercase'owanym wejściem
    // gubiło każdego, kto użył wielkiej litery - panel pokazywał „Brak leada
    // w CRM" mimo poprawnej synchronizacji. `limit(1)` zamiast `maybeSingle`,
    // bo super admin widzi ten sam adres u wielu najemców.
    h.rows = [application({ email: "  ZOFIA.Przykladowska@Example.COM  " })];
    h.leads = [{ id: "lead-1", stage: "new", updated_at: "2026-08-21T10:00:00.000Z" }];
    await mount();
    await openApplication("Zofia Przykładowska");

    await waitFor(() => expect(leadChains().length).toBeGreaterThan(0));
    const chain = leadChains()[0];
    expect(chain.argsOf("select")).toEqual(["id,stage,updated_at"]);
    expect(chain.argsOf("eq")).toEqual(["email_norm", "zofia.przykladowska@example.com"]);
    expect(chain.argsOf("order")).toEqual(["updated_at", { ascending: false }]);
    expect(chain.argsOf("limit")).toEqual([1]);
  });

  it("lead znaleziony daje plakietkę „Zsynchronizowano” i link do jego karty", async () => {
    h.rows = [application()];
    h.leads = [{ id: "lead-1", stage: "new", updated_at: "2026-08-21T10:00:00.000Z" }];
    await mount();
    await openApplication("Zofia Przykładowska");

    expect(await screen.findByText("Zsynchronizowano z CRM")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Otwórz w CRM" })).toHaveAttribute(
      "href",
      "/admin/crm/lead-1",
    );
    expect(screen.queryByText("Brak leada w CRM")).toBeNull();
  });

  it("brak leada mówi o tym wprost i NIE oferuje martwego przycisku", async () => {
    h.rows = [application()];
    h.leads = [];
    await mount();
    await openApplication("Zofia Przykładowska");

    expect(await screen.findByText("Brak leada w CRM")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Otwórz w CRM" })).toBeNull();
  });

  it("odpowiedź CRM bez ciała jest czytana jak brak leada, a nie jak awaria", async () => {
    h.rows = [application()];
    h.leads = null;
    await mount();
    await openApplication("Zofia Przykładowska");
    expect(await screen.findByText("Brak leada w CRM")).toBeInTheDocument();
  });

  it("ZNALEZISKO 8a: ODMOWA odczytu CRM jest nierozróżnialna od braku leada", async () => {
    // Zachowanie ISTNIEJĄCE. `error` leci wyjątkiem z `queryFn`, ale panel
    // czyta wyłącznie `data`, więc odmowa polityki `crm_leads` (albo padnięta
    // sieć) daje ten sam widok, co kontakt bez leada: „Brak leada w CRM"
    // i schowany przycisk „Otwórz w CRM". Operator wyciąga wniosek o STANIE
    // CRM z komunikatu o STANIE ODCZYTU - i zakłada nowego, zdublowanego leada.
    h.rows = [application()];
    h.leadsError = "odmowa RLS na crm_leads";
    await mount();
    await openApplication("Zofia Przykładowska");

    expect(await screen.findByText("Brak leada w CRM")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Otwórz w CRM" })).toBeNull();
    // Cisza jest tu kompletna: nie ma nawet toastu.
    expect(h.toasts).toEqual([]);
  });

  it("odpowiedź „Odpowiedz” prowadzi na adres kandydata z tematem zgłoszenia", async () => {
    h.rows = [application()];
    await mount();
    await openApplication("Zofia Przykładowska");

    expect(screen.getByRole("link", { name: "Odpowiedz" })).toHaveAttribute(
      "href",
      `mailto:zofia.przykladowska@example.com?subject=${encodeURIComponent("Analityk ds. polityki cyfrowej")}`,
    );
  });

  it("zgłoszenie bez tematu dostaje w mailu tytuł panelu, nie puste pole", async () => {
    h.rows = [application({ subject: null })];
    await mount();
    await openApplication("Zofia Przykładowska");

    expect(screen.getByRole("link", { name: "Odpowiedz" })).toHaveAttribute(
      "href",
      "mailto:zofia.przykladowska@example.com?subject=Rekrutacja",
    );
  });
});

// ---------------------------------------------------------------------------
// ARCHIWIZACJA I USUNIĘCIE
// ---------------------------------------------------------------------------

describe("/admin/careers - archiwizacja zgłoszenia", () => {
  it("archiwizacja zapisuje datę, melduje się i unieważnia OBIE skrzynki", async () => {
    h.rows = [application({ read_at: "2026-08-21T09:00:00.000Z" })];
    const queryClient = testClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await mount(queryClient);
    await openApplication("Zofia Przykładowska");

    fireEvent.click(screen.getByRole("button", { name: "Archiwizuj" }));

    await waitFor(() => expect(messageUpdates()).toHaveLength(1));
    const [values] = messageUpdates()[0].argsOf("update") ?? [];
    if (typeof values !== "object" || values === null) {
      throw new Error("test: UPDATE nie dostał obiektu wartości");
    }
    expect(Object.keys(values)).toEqual(["archived_at"]);
    expect(typeof Reflect.get(values, "archived_at")).toBe("string");
    expect(messageUpdates()[0].argsOf("eq")).toEqual(["id", "zgloszenie-1"]);

    await waitFor(() =>
      expect(h.toasts).toContainEqual({ kind: "success", text: "Zarchiwizowano" }),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin-career-applications"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin-contact-messages"] });
  });

  it("zgłoszenie zarchiwizowane ma plakietkę i przycisk PRZYWRACAJĄCY, który czyści datę", async () => {
    // Akcja odwrotna stoi w tym samym miejscu - to ona czyni archiwizację
    // jednoklikową bez ryzyka.
    h.rows = [
      application({ read_at: "2026-08-21T09:00:00.000Z", archived_at: "2026-08-22T09:00:00.000Z" }),
    ];
    await mount();
    await openApplication("Zofia Przykładowska");

    expect(screen.getByText("Zarchiwizowano")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Przywróć" }));

    await waitFor(() => expect(messageUpdates()).toHaveLength(1));
    expect(messageUpdates()[0].argsOf("update")).toEqual([{ archived_at: null }]);
  });

  it("ZNALEZISKO 7: odmowa bazy przy archiwizacji jest CAŁKOWICIE CICHA", async () => {
    // Zachowanie ISTNIEJĄCE. Mutacja `patch` (a więc ARCHIWIZACJA i cichy
    // zapis „przeczytane") jest jedyną z trzech mutacji tego ekranu BEZ
    // `onError` - `savePipeline` i `removeApplication` mają swoje. Skutek:
    // operator klika „Archiwizuj", nic się nie dzieje, żaden komunikat nie
    // pada, a zgłoszenie zostaje w skrzynce „Nowe" wyglądając na obrobione
    // dopiero po odświeżeniu. Toast sukcesu też nie pada - i to jedyne, co
    // odróżnia porażkę od powodzenia.
    h.rows = [application({ read_at: "2026-08-21T09:00:00.000Z" })];
    h.updateError = "odmowa RLS na contact_messages";
    await mount();
    await openApplication("Zofia Przykładowska");

    fireEvent.click(screen.getByRole("button", { name: "Archiwizuj" }));

    await waitFor(() => expect(messageUpdates()).toHaveLength(1));
    expect(h.toasts).toEqual([]);
    // Etykieta nie przeskakuje na „Przywróć" - panel nie kłamie o skutku,
    // tylko o nim milczy.
    expect(screen.getByRole("button", { name: "Archiwizuj" })).toBeInTheDocument();
    // Asymetria jest w źródle, nie w interpretacji: dwie pozostałe mutacje
    // tego ekranu mają `onError`, `patch` go nie ma.
    const source = read(ROUTE_FILE);
    const patchBlock = source.slice(
      source.indexOf("const patch = useMutation({"),
      source.indexOf("useEffect(() => {"),
    );
    expect(patchBlock).not.toContain("onError");
    expect(source.slice(source.indexOf("const savePipeline"))).toContain("onError");
  });
});

describe("/admin/careers - usunięcie zgłoszenia (operacja bez cofnięcia)", () => {
  const zapisane = () => [application({ read_at: "2026-08-21T09:00:00.000Z" })];

  it("usunięcie PYTA, a odmowa w oknie nie kasuje niczego", async () => {
    // Kaskada zabiera wiersz procesu i dziennik, a trigger kolejkuje plik CV
    // do wymazania z magazynu. Jedno kliknięcie bez pytania byłoby pułapką.
    h.rows = zapisane();
    h.confirmAnswer = false;
    await mount();
    await openApplication("Zofia Przykładowska");

    fireEvent.click(screen.getByRole("button", { name: "Usuń zgłoszenie" }));

    expect(h.confirmMessages).toEqual([
      "Usunąć zgłoszenie wraz z CV i historią procesu? Tego nie da się cofnąć.",
    ]);
    expect(messageDeletes()).toEqual([]);
    expect(h.toasts).toEqual([]);
  });

  it("potwierdzenie kasuje wiersz po identyfikatorze, melduje kolejkę CV i czyści wybór", async () => {
    h.rows = zapisane();
    const queryClient = testClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await mount(queryClient);
    await openApplication("Zofia Przykładowska");

    fireEvent.click(screen.getByRole("button", { name: "Usuń zgłoszenie" }));

    await waitFor(() => expect(messageDeletes()).toHaveLength(1));
    expect(messageDeletes()[0].argsOf("eq")).toEqual(["id", "zgloszenie-1"]);
    // Komunikat mówi WPROST, co stało się z plikiem - to jedyne miejsce,
    // w którym operator dowiaduje się o kolejce usunięć.
    await waitFor(() =>
      expect(h.toasts).toContainEqual({
        kind: "success",
        text: "Zgłoszenie usunięte. Plik CV trafił do kolejki usunięć.",
      }),
    );
    expect(await screen.findByText("Wybierz zgłoszenie z listy.")).toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin-career-applications"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin-contact-messages"] });
  });

  it("kolejkowanie pliku CV jest po stronie BAZY, nie panelu", async () => {
    // Panel woła jeden DELETE i nie dotyka magazynu - inaczej każda inna
    // ścieżka usunięcia (RPC, service_role, kaskada) zostawiałaby osierocone
    // dane osobowe w buckecie.
    const source = read(ROUTE_FILE);
    expect(source).not.toMatch(/storage/);
    const sql = read(PIPELINE_MIGRATION);
    expect(sql).toMatch(/CREATE TRIGGER trg_contact_messages_career_cv_gc/);
    expect(sql).toMatch(/AFTER DELETE ON public\.contact_messages/);
    expect(sql).toMatch(/'application_deleted'/);
  });

  it("odmowa bazy przy usuwaniu kończy się komunikatem, nie ciszą", async () => {
    h.rows = zapisane();
    h.deleteError = "odmowa: brak roli admina";
    await mount();
    await openApplication("Zofia Przykładowska");

    fireEvent.click(screen.getByRole("button", { name: "Usuń zgłoszenie" }));

    await waitFor(() =>
      expect(h.toasts).toContainEqual({ kind: "error", text: "odmowa: brak roli admina" }),
    );
    // Zgłoszenie ZOSTAJE otwarte - operator widzi, na czym poległ.
    expect(
      screen.getByRole("heading", { level: 2, name: "Zofia Przykładowska" }),
    ).toBeInTheDocument();
    expect(read(PIPELINE_MIGRATION)).toMatch(
      /CREATE POLICY career_applications_admin_delete ON public\.career_applications/,
    );
  });

  it("w trakcie usuwania przycisk jest zablokowany - jedno zgłoszenie, jeden DELETE", async () => {
    // Druga część nazwy („jeden DELETE") była wcześniej NIE DO UDOWODNIENIA:
    // wiszący łańcuch nie zapisywał ogniw, więc `messageDeletes()` było puste
    // niezależnie od tego, ile żądań poszło. Po poprawce atrapy licznik jest
    // realny - i to on odpowiada na pytanie z nazwy testu.
    h.rows = zapisane();
    await mount();
    await openApplication("Zofia Przykładowska");
    h.hang.add("contact_messages");

    const button = screen.getByRole("button", { name: "Usuń zgłoszenie" });
    fireEvent.click(button);

    await waitFor(() => expect(button).toBeDisabled());
    expect(messageDeletes()).toHaveLength(1);
    expect(messageDeletes()[0].argsOf("eq")).toEqual(["id", "zgloszenie-1"]);

    fireEvent.click(button);
    expect(h.confirmMessages).toHaveLength(1);
    expect(messageDeletes()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// WARSTWA PROCESU: ETAPY, OCENA, NOTATKA, DZIENNIK
// ---------------------------------------------------------------------------

describe("/admin/careers - warstwa procesu zgłoszenia", () => {
  const zProcesem = (over: Partial<RecruitmentPipelineRow> = {}) => [
    application({ read_at: "2026-08-21T09:00:00.000Z", career_applications: pipelineRow(over) }),
  ];

  it("brak wiersza procesu jest zgłaszany jako AWARIA, nie jako normalny stan", async () => {
    // Wiersz zakłada trigger `career_application_bootstrap` przy wpływie
    // zgłoszenia, więc jego brak znaczy, że trigger nie pobiegł - i że
    // zgłoszenie wypadnie z każdego raportu po etapach.
    h.rows = [application({ read_at: "2026-08-21T09:00:00.000Z", career_applications: null })];
    const { container } = await mount();
    await openApplication("Zofia Przykładowska");

    const alert = screen.getByText("Brak wiersza procesu dla tego zgłoszenia.");
    expect(alert.className).toContain("text-destructive");
    expect(container.querySelector("#career-stage")).toBeNull();
    // Dziennik nie jest wtedy o co pytać.
    expect(eventChains()).toHaveLength(0);
    expect(read(PIPELINE_MIGRATION)).toMatch(/CREATE TRIGGER trg_contact_messages_career_pipeline/);
  });

  it("droplista etapów niesie WSZYSTKIE etapy enuma i wskazuje etap wiersza", async () => {
    h.rows = zProcesem({ stage: "interview" });
    await mount();
    await openApplication("Zofia Przykładowska");

    const select = selectById("career-stage");
    expect(select.value).toBe("interview");
    expect([...select.options].map((option) => option.textContent)).toEqual(
      CAREER_STAGES.map((stage) => stageLabel(stage, "pl")),
    );
  });

  it("zmiana etapu i notatka jadą JEDNYM UPDATE-em na wiersz PROCESU", async () => {
    // Cel zapisu to `career_applications.id`, a NIE `contact_messages.id` -
    // pomyłka tych dwóch identyfikatorów zapisywałaby etap „w nikogo".
    // Notatka jedzie w tym samym UPDATE, bo dziennik pisze trigger: audyt
    // powstaje bez osobnego RPC i bez drugiej rundy do bazy.
    h.rows = zProcesem({ id: "proces-7" });
    const queryClient = testClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await mount(queryClient);
    await openApplication("Zofia Przykładowska");

    fireEvent.change(screen.getByPlaceholderText("Dlaczego ta decyzja? Trafi do dziennika…"), {
      target: { value: "  Zmyślona notatka: świetne dopasowanie do zmyślonej roli.  " },
    });
    fireEvent.change(selectById("career-stage"), { target: { value: "screening" } });

    await waitFor(() => expect(pipelineUpdates()).toHaveLength(1));
    expect(pipelineUpdates()[0].argsOf("update")).toEqual([
      {
        stage: "screening",
        stage_note: "Zmyślona notatka: świetne dopasowanie do zmyślonej roli.",
      },
    ]);
    expect(pipelineUpdates()[0].argsOf("eq")).toEqual(["id", "proces-7"]);

    await waitFor(() =>
      expect(h.toasts).toContainEqual({ kind: "success", text: "Etap zmieniony." }),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin-career-applications"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin-career-events"] });
  });

  it("dziennik decyzji powstaje w TRIGGERZE, więc audytu nie da się ominąć", () => {
    const sql = read(PIPELINE_MIGRATION);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.career_application_log_stage\(\)/);
    expect(sql).toMatch(/INSERT INTO public\.career_application_events/);
    expect(sql).toMatch(/left\(btrim\(COALESCE\(NEW\.stage_note, ''\)\), 2000\)/);
    // Panel nie ma tu żadnego RPC ani drugiego zapisu - to jest ta sama
    // obietnica, tylko po stronie klienta.
    expect(read(ROUTE_FILE)).not.toMatch(/supabase\.rpc/);
  });

  it("po zapisie etapu notatka jest czyszczona - opis jednej decyzji nie wjedzie w drugą", async () => {
    h.rows = zProcesem();
    await mount();
    await openApplication("Zofia Przykładowska");
    const note = screen.getByPlaceholderText("Dlaczego ta decyzja? Trafi do dziennika…");

    fireEvent.change(note, { target: { value: "Zmyślona notatka do pierwszej decyzji." } });
    fireEvent.change(selectById("career-stage"), { target: { value: "offer" } });

    await waitFor(() => expect(note).toHaveValue(""));
  });

  it("notatka jest szkicem PER ZGŁOSZENIE - przełączenie kandydata czyści pole", async () => {
    // Bez tego resetu uzasadnienie decyzji o jednym kandydacie wjechałoby
    // do dziennika następnego - i to na trwałe, bo dziennika nie da się
    // poprawić z panelu.
    h.rows = [
      application({ read_at: "2026-08-21T09:00:00.000Z" }),
      application({
        id: "drugi",
        name: "Jan Zmyślony",
        email: "jan.zmyslony@example.com",
        read_at: "2026-08-21T09:00:00.000Z",
        custom: {},
        career_applications: pipelineRow({ id: "proces-2" }),
      }),
    ];
    await mount();
    await openApplication("Zofia Przykładowska");
    fireEvent.change(screen.getByPlaceholderText("Dlaczego ta decyzja? Trafi do dziennika…"), {
      target: { value: "Notatka o pierwszym kandydacie." },
    });

    await openApplication("Jan Zmyślony");

    expect(screen.getByPlaceholderText("Dlaczego ta decyzja? Trafi do dziennika…")).toHaveValue("");
  });

  it("ocena zapisuje SAMĄ ocenę - bez notatki i bez komunikatu o zmianie etapu", async () => {
    // Ocena nie jest przejściem etapu, więc nie ma powodu dopisywać jej do
    // dziennika ani meldować „Etap zmieniony." - to byłby fałszywy wpis
    // w audycie decyzji.
    h.rows = zProcesem();
    await mount();
    await openApplication("Zofia Przykładowska");

    fireEvent.change(selectById("career-rating"), { target: { value: "4" } });

    await waitFor(() => expect(pipelineUpdates()).toHaveLength(1));
    expect(pipelineUpdates()[0].argsOf("update")).toEqual([{ rating: 4 }]);
    expect(h.toasts.map((toast) => toast.text)).not.toContain("Etap zmieniony.");
  });

  it("„Bez oceny” zapisuje NULL, a nie zero - zero byłoby najgorszą oceną", async () => {
    h.rows = zProcesem({ rating: 4 });
    await mount();
    await openApplication("Zofia Przykładowska");
    expect(selectById("career-rating").value).toBe("4");

    fireEvent.change(selectById("career-rating"), { target: { value: "" } });

    await waitFor(() => expect(pipelineUpdates()).toHaveLength(1));
    expect(pipelineUpdates()[0].argsOf("update")).toEqual([{ rating: null }]);
  });

  it("droplista oceny ma pozycję „bez oceny” i pięć stopni", async () => {
    h.rows = zProcesem();
    await mount();
    await openApplication("Zofia Przykładowska");

    expect([...selectById("career-rating").options].map((option) => option.textContent)).toEqual([
      "Bez oceny",
      "★",
      "★★",
      "★★★",
      "★★★★",
      "★★★★★",
    ]);
  });

  it("odmowa zapisu procesu pokazuje komunikat BAZY - to on mówi, który warunek padł", async () => {
    h.rows = zProcesem();
    h.pipelineError = "new row violates row-level security policy";
    await mount();
    await openApplication("Zofia Przykładowska");

    fireEvent.change(selectById("career-stage"), { target: { value: "hired" } });

    await waitFor(() =>
      expect(h.toasts).toContainEqual({
        kind: "error",
        text: "new row violates row-level security policy",
      }),
    );
    expect(h.toasts.map((toast) => toast.text)).not.toContain("Etap zmieniony.");
  });

  it("w trakcie zapisu obie droplisty są zablokowane", async () => {
    h.rows = zProcesem();
    await mount();
    await openApplication("Zofia Przykładowska");
    h.hang.add("career_applications");

    fireEvent.change(selectById("career-stage"), { target: { value: "offer" } });

    await waitFor(() => expect(selectById("career-stage")).toBeDisabled());
    expect(selectById("career-rating")).toBeDisabled();
  });

  it("ZNALEZISKO 5: wiersz procesu bez identyfikatora blokuje zapis przed wyjściem do bazy", async () => {
    // Zachowanie ISTNIEJĄCE: panel renderuje pełną sekcję etapów (bo pipeline
    // jest obiektem), ale `mutationFn` przerywa na `if (!id)`. Dobra połowa:
    // ŻADEN UPDATE nie wychodzi, więc nikt nie zapisuje etapu „w nikogo".
    // Zła połowa: operator dostaje surowy klucz techniczny `no_pipeline_row`
    // zamiast zdania - i nie wie, że to awaria triggera bootstrapu.
    h.rows = zProcesem({ id: undefined });
    await mount();
    await openApplication("Zofia Przykładowska");

    fireEvent.change(selectById("career-stage"), { target: { value: "rejected" } });

    await waitFor(() =>
      expect(h.toasts).toContainEqual({ kind: "error", text: "no_pipeline_row" }),
    );
    expect(pipelineUpdates()).toHaveLength(0);
    // Bez identyfikatora nie ma też o co pytać dziennika.
    expect(eventChains()).toHaveLength(0);
  });
});

describe("/admin/careers - dziennik decyzji", () => {
  const zProcesem = () => [
    application({ read_at: "2026-08-21T09:00:00.000Z", career_applications: pipelineRow() }),
  ];

  it("dziennik jest pytany po identyfikatorze PROCESU, najnowsze pierwsze, do 50 wpisów", async () => {
    h.rows = zProcesem();
    await mount();
    await openApplication("Zofia Przykładowska");

    await waitFor(() => expect(eventChains().length).toBeGreaterThan(0));
    const chain = eventChains()[0];
    expect(chain.argsOf("select")).toEqual(["id,from_stage,to_stage,note,created_at"]);
    expect(chain.argsOf("eq")).toEqual(["application_id", "proces-1"]);
    expect(chain.argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(chain.argsOf("limit")).toEqual([50]);
  });

  it("pusty dziennik mówi to wprost, zamiast pokazywać nagłówek nad niczym", async () => {
    h.rows = zProcesem();
    await mount();
    await openApplication("Zofia Przykładowska");

    expect(await screen.findByText("Brak zmian etapu.")).toBeInTheDocument();
    expect(screen.getByText("Dziennik decyzji")).toBeInTheDocument();
  });

  it("odpowiedź dziennika bez ciała czyta się jak pusty dziennik", async () => {
    h.rows = zProcesem();
    h.events = null;
    await mount();
    await openApplication("Zofia Przykładowska");
    expect(await screen.findByText("Brak zmian etapu.")).toBeInTheDocument();
  });

  it("ZNALEZISKO 8b: ODMOWA odczytu dziennika wygląda jak dziennik bez wpisów", async () => {
    // Zachowanie ISTNIEJĄCE i najcięższa wersja tej klasy błędu na tym
    // ekranie: `data: events = []` sprowadza odmowę polityki
    // `career_application_events_staff_read` do zdania „Brak zmian etapu.".
    // Audyt decyzji o kandydacie wygląda wtedy na PUSTY - a to jest dokładnie
    // ten dokument, po który sięga się przy skardze na proces rekrutacji.
    h.rows = zProcesem();
    h.eventsError = "odmowa RLS na career_application_events";
    await mount();
    await openApplication("Zofia Przykładowska");

    expect(await screen.findByText("Brak zmian etapu.")).toBeInTheDocument();
    expect(h.toasts).toEqual([]);
  });

  it("wpis pokazuje przejście TEKSTEM, datę i notatkę operatora", async () => {
    h.rows = zProcesem();
    h.events = [
      {
        id: "wpis-2",
        from_stage: "screening",
        to_stage: "interview",
        note: "Zmyślona notatka: zaproszenie na rozmowę.",
        created_at: "2026-08-22T11:00:00.000Z",
      },
    ];
    const { container } = await mount();
    await openApplication("Zofia Przykładowska");

    const entry = await screen.findByText(
      new RegExp(`${stageLabel("screening", "pl")}.*${stageLabel("interview", "pl")}`),
    );
    expect(entry).toBeInTheDocument();
    const item = container.querySelector("ol li");
    expect(item?.textContent ?? "").toContain(
      new Date("2026-08-22T11:00:00.000Z").toLocaleString(),
    );
    expect(item?.textContent ?? "").toContain("Zmyślona notatka: zaproszenie na rozmowę.");
  });

  it("pierwszy wpis (bez etapu wyjściowego) pokazuje „-”, a nie puste miejsce", async () => {
    h.rows = zProcesem();
    h.events = [
      {
        id: "wpis-1",
        from_stage: null,
        to_stage: "screening",
        note: "",
        created_at: "2026-08-21T11:00:00.000Z",
      },
    ];
    const { container } = await mount();
    await openApplication("Zofia Przykładowska");

    const item = await waitFor(() => {
      const node = container.querySelector("ol li");
      if (!node) throw new Error("test: dziennik nie wyrenderował wpisu");
      return node;
    });
    expect(item.textContent ?? "").toContain(`- → ${stageLabel("screening", "pl")}`);
    // Wpis bez notatki nie dokleja wiszącego separatora.
    expect(item.textContent ?? "").not.toMatch(/·\s*$/);
  });

  it("panel renderuje wpisy w kolejności, w jakiej oddała je baza - nic nie sortuje", async () => {
    // Fixture jest ustawiony PRZECIW każdemu naturalnemu porządkowi klienta:
    // pierwszy element jest najstarszy. Gdyby panel sortował u siebie, ta
    // asercja padnie - a kolejność dziennika to kolejność decyzji.
    h.rows = zProcesem();
    h.events = [
      {
        id: "a",
        from_stage: null,
        to_stage: "screening",
        note: "Alfa",
        created_at: "2026-08-01T10:00:00.000Z",
      },
      {
        id: "b",
        from_stage: "screening",
        to_stage: "interview",
        note: "Beta",
        created_at: "2026-08-09T10:00:00.000Z",
      },
      {
        id: "c",
        from_stage: "interview",
        to_stage: "offer",
        note: "Gamma",
        created_at: "2026-08-05T10:00:00.000Z",
      },
    ];
    const { container } = await mount();
    await openApplication("Zofia Przykładowska");

    await screen.findByText(/Alfa/);
    const notes = [...container.querySelectorAll("ol li")].map((li) =>
      (li.textContent ?? "").replace(/.*· /, ""),
    );
    expect(notes).toEqual(["Alfa", "Beta", "Gamma"]);
    expect(read(ROUTE_FILE)).not.toMatch(/\.sort\(/);
  });
});

// ---------------------------------------------------------------------------
// DWUJĘZYCZNOŚĆ WBUDOWANEGO SŁOWNIKA
// ---------------------------------------------------------------------------

describe("/admin/careers - wbudowany słownik PL/EN", () => {
  it("po angielsku karta kandydata i etykiety wspólnej warstwy też mówią po angielsku", async () => {
    // REWIZJA NAZWY. Ten test nazywał się „CAŁY panel mówi po angielsku" i
    // sprawdzał OSIEM napisów z czterdziestu sześciu - obietnica z nazwy była
    // o pięć razy większa niż ciało. Dowód „każdego napisu" stoi teraz niżej
    // (tablica `PARY` + dowód słownikowy), a TEN test odpowiada na pytanie,
    // którego tamten zadać nie umie: czy w angielskim panelu da się jeszcze
    // NAMIERZYĆ akcje karty, gdy filtr listy („Archive") i akcja karty
    // („Archive") mają IDENTYCZNĄ nazwę dostępną - i czy etykiety wspólnej
    // warstwy (`stageLabel`, `seniorityLabel`) przechodzą na angielski TĄ SAMĄ
    // funkcją słownikową, a nie drugą kopią napisów w module trasy.
    await i18n.changeLanguage("en");
    h.rows = [
      application({
        lang: "en",
        read_at: "2026-08-21T09:00:00.000Z",
        career_applications: pipelineRow({ stage: "screening" }),
      }),
    ];
    h.leads = [];
    await mount();

    expect(screen.getByRole("heading", { level: 1, name: "Recruitment" })).toBeInTheDocument();
    for (const label of ["New", "All", "Archive"]) {
      expect(
        screen.getByRole("button", { name: label }),
        `brak filtra „${label}"`,
      ).toBeInTheDocument();
    }
    expect(screen.getByText("Pick an application from the list.")).toBeInTheDocument();

    await openApplication("Zofia Przykładowska");
    const pane = within(detailPane());
    expect(screen.getByText("No CRM lead")).toBeInTheDocument();
    expect(pane.getByRole("button", { name: "Archive" })).toBeInTheDocument();
    expect(pane.getByRole("button", { name: "Delete application" })).toBeInTheDocument();
    expect(screen.getByText("Decision log")).toBeInTheDocument();
    // Etykiety wspólnej warstwy też przechodzą na angielski - i to przez tę
    // samą funkcję słownikową, nie przez drugą kopię.
    expect(selectById("career-stage").value).toBe("screening");
    expect([...selectById("career-stage").options].map((option) => option.textContent)).toEqual(
      CAREER_STAGES.map((stage) => stageLabel(stage, "en")),
    );
    expect(screen.getByText(seniorityLabel("mid", "en"))).toBeInTheDocument();
  });

  /**
   * PEŁNA TABLICA WBUDOWANEGO SŁOWNIKA.
   *
   * REWIZJA. Nagłówek pierwszej wersji tego pliku obiecywał „osobny dowód, że
   * przełączenie języka zmienia KAŻDY z nich" - a dowodem był jeden test
   * sprawdzający OSIEM napisów z czterdziestu sześciu. To jest dokładnie ta
   * dziura, którą literały w teście miały mieć zasłoniętą: wpisanie polskiego
   * zdania do stałej `EN` przechodziło niewidziane dla trzydziestu ośmiu
   * napisów. Tablica poniżej wymienia KAŻDY liść obu słowników wraz ze scENĄ,
   * na której panel go renderuje; test niżej mierzy dla każdego z nich trzy
   * rzeczy: napis PL jest widoczny po polsku, napis EN po angielsku, i po
   * angielsku NIE ZOSTAJE polski.
   *
   * Cztery klucze (`crm`, `markRead`, `rejectionReason`, `nextStep`) nie mają
   * na tym ekranie ŻADNEJ kontrolki - to ZNALEZISKO 9, nie luka tego dowodu.
   * Cztery napisy są w obu językach IDENTYCZNE, bo są nazwami własnymi albo
   * symbolem (`crm` = „CRM", `cv` = „CV", `linkedin` = „LinkedIn", `none` =
   * „-"), więc dla nich nie ma czego przełączać. `cv` i `linkedin` zostają
   * w tablicy z samą asercją dodatnią (napis MUSI być na ekranie); „-" z niej
   * wypada, bo „tekst zawiera myślnik" jest zielone przy każdej dacie i każdym
   * adresie, czyli jest asercją pozorną - jego dowód renderu stoi w teście
   * „brak etykiety roli spada na slug (…) na „-”". `crm` nie ma kontrolki
   * (ZNALEZISKO 9b). Dowód słownikowy dla wszystkich czterech - niżej.
   */
  type Scena = "lista-pusta" | "karta-archiwum" | "karta-bez-procesu";

  interface Para {
    klucz: string;
    pl: string;
    en: string;
    scena: Scena;
    /** Napis identyczny w obu słownikach - brak przełączenia nie jest defektem. */
    identyczne?: true;
  }

  const PARY: readonly Para[] = [
    { klucz: "title", pl: "Rekrutacja", en: "Recruitment", scena: "lista-pusta" },
    {
      klucz: "subtitle",
      pl: "Zgłoszenia ze strony „Dołącz do zespołu” (/zatrudniamy).",
      en: "Applications from the “Join the team” page (/zatrudniamy).",
      scena: "lista-pusta",
    },
    { klucz: "filter.open", pl: "Nowe", en: "New", scena: "lista-pusta" },
    { klucz: "filter.all", pl: "Wszystkie", en: "All", scena: "lista-pusta" },
    { klucz: "filter.archived", pl: "Archiwum", en: "Archive", scena: "lista-pusta" },
    {
      klucz: "search",
      pl: "Szukaj: imię, e-mail, rola…",
      en: "Search: name, e-mail, role…",
      scena: "lista-pusta",
    },
    { klucz: "empty", pl: "Brak zgłoszeń.", en: "No applications.", scena: "lista-pusta" },
    {
      klucz: "pickOne",
      pl: "Wybierz zgłoszenie z listy.",
      en: "Pick an application from the list.",
      scena: "lista-pusta",
    },
    { klucz: "stageFilterAll", pl: "Wszystkie etapy", en: "All stages", scena: "lista-pusta" },
    { klucz: "stageFilterOpen", pl: "W toku", en: "In progress", scena: "lista-pusta" },
    { klucz: "stageFilterClosed", pl: "Domknięte", en: "Closed", scena: "lista-pusta" },

    { klucz: "role", pl: "Rola", en: "Role", scena: "karta-archiwum" },
    { klucz: "department", pl: "Dział", en: "Department", scena: "karta-archiwum" },
    { klucz: "seniority", pl: "Poziom", en: "Seniority", scena: "karta-archiwum" },
    { klucz: "start", pl: "Dostępność", en: "Availability", scena: "karta-archiwum" },
    {
      klucz: "linkedin",
      pl: "LinkedIn",
      en: "LinkedIn",
      scena: "karta-archiwum",
      identyczne: true,
    },
    { klucz: "message", pl: "Wiadomość", en: "Message", scena: "karta-archiwum" },
    {
      klucz: "crmSynced",
      pl: "Zsynchronizowano z CRM",
      en: "Synced with CRM",
      scena: "karta-archiwum",
    },
    { klucz: "crmOpen", pl: "Otwórz w CRM", en: "Open in CRM", scena: "karta-archiwum" },
    { klucz: "reply", pl: "Odpowiedz", en: "Reply", scena: "karta-archiwum" },
    { klucz: "unarchive", pl: "Przywróć", en: "Restore", scena: "karta-archiwum" },
    { klucz: "archived", pl: "Zarchiwizowano", en: "Archived", scena: "karta-archiwum" },
    { klucz: "cv", pl: "CV", en: "CV", scena: "karta-archiwum", identyczne: true },
    {
      klucz: "cvPurged",
      pl: "CV usunięte (retencja)",
      en: "CV deleted (retention)",
      scena: "karta-archiwum",
    },
    { klucz: "stage", pl: "Etap procesu", en: "Pipeline stage", scena: "karta-archiwum" },
    {
      klucz: "stageNote",
      pl: "Notatka do zmiany etapu",
      en: "Note for this stage change",
      scena: "karta-archiwum",
    },
    {
      klucz: "stageNotePh",
      pl: "Dlaczego ta decyzja? Trafi do dziennika…",
      en: "Why this decision? Goes into the log…",
      scena: "karta-archiwum",
    },
    { klucz: "rating", pl: "Ocena", en: "Rating", scena: "karta-archiwum" },
    { klucz: "ratingClear", pl: "Bez oceny", en: "No rating", scena: "karta-archiwum" },
    { klucz: "history", pl: "Dziennik decyzji", en: "Decision log", scena: "karta-archiwum" },
    {
      klucz: "historyEmpty",
      pl: "Brak zmian etapu.",
      en: "No stage changes yet.",
      scena: "karta-archiwum",
    },
    { klucz: "remove", pl: "Usuń zgłoszenie", en: "Delete application", scena: "karta-archiwum" },

    { klucz: "crmMissing", pl: "Brak leada w CRM", en: "No CRM lead", scena: "karta-bez-procesu" },
    { klucz: "archive", pl: "Archiwizuj", en: "Archive", scena: "karta-bez-procesu" },
    { klucz: "cvMissing", pl: "Brak CV", en: "No CV", scena: "karta-bez-procesu" },
    {
      klucz: "noPipeline",
      pl: "Brak wiersza procesu dla tego zgłoszenia.",
      en: "No pipeline row for this application.",
      scena: "karta-bez-procesu",
    },
  ];

  function ustawScene(scena: Scena): void {
    if (scena === "lista-pusta") {
      h.rows = [];
      return;
    }
    if (scena === "karta-archiwum") {
      h.rows = [
        application({
          read_at: "2026-08-21T09:00:00.000Z",
          archived_at: "2026-08-22T09:00:00.000Z",
          custom: {
            role_label: "Analityk ds. polityki cyfrowej",
            department: "analysis",
            seniority: "mid",
            start: "month",
            linkedin: "https://linkedin.example.com/in/zmyslona-zofia",
            cv_purged_at: "2026-08-30",
          },
          career_applications: pipelineRow({ rating: 3 }),
        }),
      ];
      h.leads = [{ id: "lead-1", stage: "new", updated_at: "2026-08-21T10:00:00.000Z" }];
      h.events = [];
      return;
    }
    h.rows = [
      application({ read_at: "2026-08-21T09:00:00.000Z", custom: {}, career_applications: null }),
    ];
    h.leads = [];
  }

  /** Cały widzialny tekst sceny PLUS placeholdery (te nie są w `textContent`). */
  async function tekstPanelu(scena: Scena, lang: "pl" | "en"): Promise<string> {
    cleanup();
    await i18n.changeLanguage(lang);
    ustawScene(scena);
    const { container } = await mount();
    if (scena === "lista-pusta") await settled();
    else await openApplication("Zofia Przykładowska");
    // Plakietka CRM i link do karty leada pojawiają się DOPIERO po odpowiedzi
    // `crm_leads`, więc bez tego oczekiwania scena „karta-archiwum" zbierałaby
    // tekst sprzed odpowiedzi - i dowód napisu `crmSynced` mierzyłby wyścig.
    if (scena === "karta-archiwum") {
      await waitFor(() =>
        expect(container.querySelector('a[href="/admin/crm/lead-1"]')).not.toBeNull(),
      );
    }

    const placeholdery = [...container.querySelectorAll("[placeholder]")]
      .map((node) => node.getAttribute("placeholder") ?? "")
      .join("\n");
    return `${container.textContent ?? ""}\n${placeholdery}`;
  }

  it("KAŻDY napis wbudowanego słownika przełącza się razem z językiem i18n", async () => {
    for (const scena of ["lista-pusta", "karta-archiwum", "karta-bez-procesu"] as const) {
      const wpisy = PARY.filter((para) => para.scena === scena);
      expect(wpisy.length, `scena „${scena}" bez napisów do sprawdzenia`).toBeGreaterThan(0);

      const polski = await tekstPanelu(scena, "pl");
      const angielski = await tekstPanelu(scena, "en");

      for (const { klucz, pl, en, identyczne } of wpisy) {
        expect(polski, `[${scena}] PL brakuje napisu „${klucz}"`).toContain(pl);
        expect(angielski, `[${scena}] EN brakuje napisu „${klucz}"`).toContain(en);
        if (identyczne) continue;
        expect(angielski, `[${scena}] po angielsku zostaje polskie „${klucz}"`).not.toContain(pl);
        expect(polski, `[${scena}] po polsku zostaje angielskie „${klucz}"`).not.toContain(en);
      }
    }
  });

  it("napisy pojawiające się dopiero PO akcji też mają obie wersje słownika", async () => {
    // Cztery napisy tego panelu nie istnieją w statycznym renderze: etykieta
    // przycisku CV, komunikat odmowy podpisu, potwierdzenie usunięcia i dwa
    // toasty skutku. Ich polskie wersje są zaasertowane w testach nazwanych
    // wyżej (odmowa podpisu, usunięcie, zmiana etapu), więc tutaj domykamy
    // stronę angielską - inaczej „EN" tych czterech napisów nie mierzy nikt.
    await i18n.changeLanguage("en");
    h.rows = [
      application({
        read_at: "2026-08-21T09:00:00.000Z",
        custom: { cv_path: CV_PATH },
        career_applications: pipelineRow(),
      }),
    ];
    h.signed = null;
    await mount();
    await openApplication("Zofia Przykładowska");

    // cvOpen + cvError
    fireEvent.click(screen.getByRole("button", { name: "Open CV" }));
    await waitFor(() =>
      expect(h.toasts).toContainEqual({ kind: "error", text: "Could not generate the CV link." }),
    );

    // stageSaved
    fireEvent.change(selectById("career-stage"), { target: { value: "screening" } });
    await waitFor(() =>
      expect(h.toasts).toContainEqual({ kind: "success", text: "Stage changed." }),
    );

    // removeConfirm + removed
    fireEvent.click(screen.getByRole("button", { name: "Delete application" }));
    expect(h.confirmMessages).toEqual([
      "Delete the application together with its CV and pipeline history? This cannot be undone.",
    ]);
    await waitFor(() =>
      expect(h.toasts).toContainEqual({
        kind: "success",
        text: "Application deleted. Its CV was queued for removal.",
      }),
    );

    // I ani jeden polski napis nie wjechał po drodze.
    const polskie = [
      "Nie udało się wygenerować linku do CV.",
      "Etap zmieniony.",
      "Usunąć zgłoszenie wraz z CV i historią procesu? Tego nie da się cofnąć.",
      "Zgłoszenie usunięte. Plik CV trafił do kolejki usunięć.",
    ];
    expect(h.toasts.map((toast) => toast.text)).not.toEqual(expect.arrayContaining(polskie));
    expect(h.confirmMessages).not.toEqual(expect.arrayContaining(polskie));
  });

  it("ZNALEZISKO 9b: cztery napisy słownika NIE MAJĄ na tym ekranie kontrolki", () => {
    // Oba słowniki deklarują (i tłumaczą!) `crm`, `markRead`, `rejectionReason`
    // i `nextStep`, a JSX nie sięga po żaden z nich. Dwa ostatnie to nie
    // ozdoba: `savePipeline` przyjmuje `rejection_reason` i `next_step_at`,
    // zapytanie listy CIĄGNIE te kolumny do przeglądarki (ZNALEZISKO 9a),
    // a operator nie ma czym ich ani ustawić, ani odczytać. To pół funkcji:
    // „powód odrzucenia" jest w bazie, w typach i w słowniku - i nigdzie
    // w interfejsie.
    const source = read(ROUTE_FILE);
    for (const klucz of ["crm", "markRead", "rejectionReason", "nextStep"] as const) {
      expect(source, `klucz „${klucz}" wypadł ze słownika`).toMatch(
        new RegExp(`^  ${klucz}: string;$`, "m"),
      );
      // `\b` jest tu konieczne: `L.crm` jest przedrostkiem `L.crmSynced`.
      expect(source, `klucz „${klucz}" jednak ma kontrolkę`).not.toMatch(
        new RegExp(`\\b(?:L|labels)\\.${klucz}\\b`),
      );
    }
    // Kontrola dodatnia: ta sama technika WIDZI klucz, który kontrolkę ma.
    expect(source).toMatch(/\b(?:L|labels)\.crmSynced\b/);
    expect(source).toMatch(/\b(?:L|labels)\.cvPurged\b/);
  });

  /**
   * Oba słowniki odczytane Z MODUŁU TRASY, z kluczami zagnieżdżonymi pod
   * pełną nazwą (`filter.archived`).
   *
   * Kwalifikowanie prefiksem nie jest ozdobą: `archived` istnieje w słowniku
   * DWA RAZY - jako `filter.archived` („Archiwum") i jako `archived`
   * („Zarchiwizowano"). Płaska mapa gubi pierwszy z nich po cichu, czyli
   * zostawia jeden napis bez dowodu i jeszcze zafałszowuje licznik kluczy.
   */
  function slownikZModulu(nazwa: "PL" | "EN"): Record<string, string> {
    const source = read(ROUTE_FILE);
    const start = source.indexOf(`const ${nazwa}: CareersDict = {`);
    const koniec = source.indexOf("\n};", start);
    if (start < 0 || koniec < 0) throw new Error(`test: nie ma słownika ${nazwa}`);
    const ciało = source.slice(start, koniec).replace(/\s*\n\s*/g, " ");
    const pary = (fragment: string, prefiks: string): Array<[string, string]> =>
      [...fragment.matchAll(/(\w+):\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => [
        `${prefiks}${m[1]}`,
        m[2],
      ]);
    const zagniezdzone = /filter:\s*\{([^}]*)\}/.exec(ciało)?.[1] ?? "";
    return Object.fromEntries([
      ...pary(ciało.replace(/filter:\s*\{[^}]*\}/, ""), ""),
      ...pary(zagniezdzone, "filter."),
    ]);
  }

  it("słowniki PL i EN różnią się na KAŻDYM kluczu poza czterema nazwami własnymi", () => {
    // Tablica renderowa wyżej dowodzi PRZEŁĄCZENIA na ekranie, ale nie umie
    // dosięgnąć czterech kluczy bez kontrolki (ZNALEZISKO 9b) - a to właśnie
    // one są najbardziej narażone na wklejenie polskiego zdania do `EN`, bo
    // nikt ich nigdy nie widzi. Ten dowód czyta OBA słowniki z modułu i
    // porównuje je klucz po kluczu.
    const pl = slownikZModulu("PL");
    const en = slownikZModulu("EN");
    // 43 klucze skalarne + trzy liście `filter` = 46 napisów w każdym słowniku.
    expect(Object.keys(pl)).toHaveLength(46);
    expect(Object.keys(en).sort()).toEqual(Object.keys(pl).sort());

    // Nazwy własne i symbole: „CRM", „CV", „LinkedIn" i myślnik. Zbiór jest
    // JAWNY, żeby dopisanie tu piątego klucza było świadomą decyzją, a nie
    // sposobem na uciszenie testu po nieprzetłumaczonym napisie.
    const IDENTYCZNE = new Set(["crm", "cv", "linkedin", "none"]);
    for (const klucz of Object.keys(pl)) {
      expect(pl[klucz].length, `klucz „${klucz}" jest pusty po polsku`).toBeGreaterThan(0);
      expect(en[klucz].length, `klucz „${klucz}" jest pusty po angielsku`).toBeGreaterThan(0);
      if (IDENTYCZNE.has(klucz)) {
        expect(en[klucz], `„${klucz}" to nazwa własna - ma być identyczna`).toBe(pl[klucz]);
        continue;
      }
      expect(en[klucz], `klucz „${klucz}" nie jest przetłumaczony`).not.toBe(pl[klucz]);
    }
    // Cztery napisy bez kontrolki (ZNALEZISKO 9b) nie mają dowodu NIGDZIE
    // INDZIEJ - na ekranie nie da się ich zobaczyć. Przybite są tu WARTOŚCIAMI,
    // nie samą obecnością: gdyby ktoś dołożył im kontrolkę, ma zobaczyć, jaki
    // napis się w niej pojawi, a gdyby wyciął klucz - że to zmiana słownika.
    expect([pl.crm, pl.markRead, pl.rejectionReason, pl.nextStep]).toEqual([
      "CRM",
      "Oznacz jako przeczytane",
      "Powód odrzucenia",
      "Następny krok",
    ]);
    expect([en.crm, en.markRead, en.rejectionReason, en.nextStep]).toEqual([
      "CRM",
      "Mark as read",
      "Rejection reason",
      "Next step",
    ]);
  });

  it("napisy z tablicy renderowej są WZIĘTE ZE SŁOWNIKA, a nie wpisane w test", () => {
    // To jest zamek na literały. Trasa nie eksportuje `PL`/`EN`, więc asercje
    // na jej napisy muszą być literałami - ale literał, którego nikt nie
    // porównał ze źródłem, dowodzi tylko tego, że ktoś go kiedyś przepisał.
    // Tu każda para z tablicy jest zderzona z DWOMA słownikami modułu: gdyby
    // ktoś zmienił napis w panelu (albo przepisał go w teście z błędem),
    // zapali się to, a nie trzydzieści asercji na widokach.
    const pl = slownikZModulu("PL");
    const en = slownikZModulu("EN");
    expect(PARY.length).toBeGreaterThan(30);
    for (const para of PARY) {
      expect(pl[para.klucz], `PL „${para.klucz}" nie zgadza się ze słownikiem`).toBe(para.pl);
      expect(en[para.klucz], `EN „${para.klucz}" nie zgadza się ze słownikiem`).toBe(para.en);
    }
    // Liście, których tablica świadomie nie obejmuje: cztery bez kontrolki
    // (ZNALEZISKO 9b), „-" (asercja renderowa byłaby pozorna) i pięć napisów
    // pojawiających się dopiero po akcji - te ma test obok.
    const pokryte = new Set(PARY.map((para) => para.klucz));
    const poAkcji = ["cvOpen", "cvError", "stageSaved", "removeConfirm", "removed"];
    const bezKontrolki = ["crm", "markRead", "rejectionReason", "nextStep"];
    expect(
      Object.keys(pl).filter(
        (klucz) =>
          !pokryte.has(klucz) &&
          !poAkcji.includes(klucz) &&
          !bezKontrolki.includes(klucz) &&
          klucz !== "none",
      ),
    ).toEqual([]);
  });

  it("nieznany język interfejsu spada na polski, a nie na pustkę", async () => {
    // `i18n.language === "en" ? "en" : "pl"` - panel ma dwa słowniki, a aplikacja
    // może mieć więcej języków niż panel admina.
    await i18n.changeLanguage("de");
    await mount();
    expect(screen.getByRole("heading", { level: 1, name: "Rekrutacja" })).toBeInTheDocument();
  });

  it("nagłówek wyjaśnia, SKĄD biorą się te zgłoszenia", async () => {
    // Bez tego zdania operator nie wie, którym formularzem przyszło zgłoszenie
    // i dlaczego widzi je także w Contact Center.
    await mount();
    expect(
      screen.getByText("Zgłoszenia ze strony „Dołącz do zespołu” (/zatrudniamy)."),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// DOSTĘPNOŚĆ
// ---------------------------------------------------------------------------

describe("/admin/careers - dostępność", () => {
  it("widok listy nie ma naruszeń axe", async () => {
    h.rows = [application(), application({ id: "drugi", name: "Jan Zmyślony", custom: {} })];
    const { container } = await mount();
    await screen.findByText("Zofia Przykładowska");

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("otwarte zgłoszenie z warstwą procesu i dziennikiem nie ma naruszeń axe", async () => {
    // Tu żyją wszystkie kontrolki formularza (dwie droplisty, pole notatki),
    // więc to ten widok decyduje o etykietach i porządku nagłówków.
    h.rows = [application({ read_at: "2026-08-21T09:00:00.000Z" })];
    h.leads = [{ id: "lead-1", stage: "new", updated_at: "2026-08-21T10:00:00.000Z" }];
    h.events = [
      {
        id: "wpis-1",
        from_stage: "new",
        to_stage: "screening",
        note: "Zmyślona notatka.",
        created_at: "2026-08-21T11:00:00.000Z",
      },
    ];
    const { container } = await mount();
    await openApplication("Zofia Przykładowska");
    await screen.findByText(/Zmyślona notatka\./);

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
