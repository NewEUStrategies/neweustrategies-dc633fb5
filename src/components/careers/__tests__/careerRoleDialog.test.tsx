// Popup pełnej oferty pracy na stronie /zatrudniamy - `CareerRoleDialog`.
//
// ---------------------------------------------------------------------------
// PO CO TEN PLIK ISTNIEJE
// ---------------------------------------------------------------------------
// Plik wszedł do repo z DOKŁADNIE ZEREM pokrycia: 0/9 linii, 0/6 funkcji,
// 0/2 gałęzi. Sześć niepokrytych funkcji to `MetaChip`, `OfferList`, callback
// `items.map`, samo `CareerRoleDialog` i DWA handlery przycisków stopki -
// czyli cała droga kandydata od „Pełna oferta" do „Aplikuj na tę rolę".
//
// Zera nie da się załatać testem listy ról: `careersRoles.test.tsx` PODMIENIA
// `@/components/ui/dialog` na przezroczyste opakowania (`vi.mock` stoi tam do
// dziś) i słusznie - dowodzi czego INNEGO: że karta oddaje w górę właściwy
// slug. Pod tą atrapą nie istnieje ani portal, ani pułapka fokusu, ani Escape,
// a jej sekcja „poza zakresem" odsyła dowód samego okna tutaj. Ten plik go
// zamyka i dlatego NIE atrapuje Radiksa.
//
// SPROSTOWANIE CYTATU (rewizja). Pierwsza wersja tego akapitu cytowała zdanie
// sąsiada, że plik `careerRoleDialog.test.tsx` „dziś nie ma" - i podawała ten
// cytat jako powód swojego istnienia. Zdanie już tam nie stoi: `careersRoles`
// został zrewidowany i sam odnotowuje, że ten dowód „ma już swój plik".
// Cytat z pliku, który zmienia się w tej samej kampanii, starzeje się w tydzień
// - dlatego powód istnienia stoi teraz na zmierzonych zerach pokrycia
// i na `vi.mock("@/components/ui/dialog")`, czyli na faktach, które da się
// sprawdzić bez wiary w cudzy nagłówek.
//
// Bez tego pliku przechodzą bez śladu m.in.:
//   * zdjęcie bariery `if (!role) return null` - trasa trzyma
//     `open={detailsRole !== null}` i `role={findOffer(...)}`, więc w chwili
//     zamykania (Radiks animuje wyjście) `role` bywa `null` przy `open`
//     jeszcze prawdziwym; odczyt `role.department` na `null` to biała strona
//     kariery, nie brzydki popup,
//   * odwrócenie kolejności w handlerze „Aplikuj": `onApply` PRZED
//     `onOpenChange(false)` zostawia okno nad formularzem, do którego trasa
//     właśnie przewinęła kandydata - obietnica „klikam Aplikuj i jestem
//     w formularzu" pęka, a przycisk wygląda na zepsuty,
//   * oddanie w górę `role.title` zamiast `role.id` - formularz nie
//     preselekcjonowałby stanowiska, a zgłoszenie wpadałoby bez roli,
//   * „Zamknij", które oprócz zamknięcia zgłasza aplikację (albo odwrotnie:
//     „Aplikuj", które tylko zamyka),
//   * zdjęcie `DialogDescription`, czyli jedynego OPISU okna - `aria-describedby`
//     wskazywałoby wtedy w pustkę albo zniknęłoby razem z ostrzeżeniem Radiksa,
//   * zaszycie faset po polsku (dział / lokalizacja / tryb / poziom) - strona
//     jest dwujęzyczna, a chipy idą przez `t()`,
//   * zdjęcie `aria-hidden` z KROPKI PUNKTORA (zwykły `<span>`) - czytnik
//     ekranu ogłaszałby pusty element przed każdym punktem oferty; uwaga:
//     analogiczne zdjęcie propa z IKON chipsów jest niemierzalne, bo lucide
//     ukrywa je samo - patrz ZNALEZISKO 3,
//   * `OfferList`, które przy pustej tablicy gubi cały nagłówek sekcji (albo
//     wywala się na `items.map`) - a pusta tablica to normalny stan wiersza
//     z panelu, bo `career_roles.responsibilities_*` nie ma tam bramki
//     „minimum jeden punkt".
//
// ---------------------------------------------------------------------------
// CO JEST PRZEDMIOTEM DOWODU
// ---------------------------------------------------------------------------
//  1. BRAMA OTWARCIA. Bez oferty NIE MA NICZEGO w dokumencie, choćby `open`
//     było prawdą (bariera `!role`); z ofertą, ale zamknięte - treść oferty
//     nie istnieje w DOM (nie jest tylko schowana klasą), bo Radiks montuje
//     portal dopiero przy otwarciu.
//  2. TOŻSAMOŚĆ OKNA W DRZEWIE DOSTĘPNOŚCI. Rola `dialog`, dostępna NAZWA to
//     tytuł oferty (`aria-labelledby` -> `DialogTitle`), dostępny OPIS to
//     `careers.roles.dialog.meta` ze słownika, podany klasą `sr-only`
//     (widoczny pasek chipsów tego nie zastępuje - dla czytnika ekranu
//     to cztery luźne napisy).
//  3. NAGŁÓWEK. Nadtytuł = dział ze słownika, PRZED tytułem oferty; cztery
//     meta-chipy w kolejności lokalizacja -> tryb -> poziom -> dział, każdy
//     z etykietą ze SŁOWNIKA i z ikoną, która nie wnosi do tej etykiety ani
//     znaku (dowód stoi na TEKŚCIE chipu, nie na atrybucie ikony -
//     ZNALEZISKO 3).
//  4. TREŚĆ. Trzy sekcje w stałej kolejności (O roli -> Zakres obowiązków ->
//     Wymagania), opis z oferty, punkty jako `<li>` w kolejności podanej
//     przez ofertę, w SWOICH listach; kropka punktora `aria-hidden`.
//  5. PUSTA LISTA. Oferta bez obowiązków zachowuje nagłówek sekcji i pustą
//     listę, a druga sekcja nadal ma punkty; oferta bez OBU list nadal
//     pokazuje opis roli i oba nagłówki. Nagłówki i listy czytane są PRZEZ
//     ROLĘ, czyli z drzewa dostępności: sekcja obecna w DOM, ale schowana
//     (`hidden`, `display:none`) tych asercji NIE przechodzi.
//  6. DROGA DO FORMULARZA. „Aplikuj na tę rolę" robi DWIE rzeczy w JEDNEJ
//     kolejności: najpierw melduje zamknięcie, potem oddaje IDENTYFIKATOR
//     (slug, nie tytuł) - asercja stoi na wspólnym dzienniku wywołań.
//  7. WYJŚCIA. „Zamknij", Escape i przycisk `×` primitywu meldują zamknięcie
//     i ŻADEN z nich nie zgłasza aplikacji.
//  8. DOSTĘPNOŚĆ. Ognisko wchodzi do okna i staje na „Zamknij" (nie na
//     nieodwracalnym „Aplikuj"); ognisko wyprowadzone poza okno wraca do
//     środka (pułapka), a rodzeństwo poza oknem dostaje `aria-hidden` -
//     tak Radiks realizuje modalność (tego okna NIE cechuje `aria-modal`);
//     hierarchia nagłówków h2 -> h3 bez skoku; brak naruszeń axe zarówno
//     dla pełnej oferty, jak i dla oferty z pustymi listami.
//  9. DWUJĘZYCZNOŚĆ. Te same asercje po przełączeniu i18n na `en`, z bramką
//     „napis EN różni się od PL" (inaczej test przechodziłby na polskim
//     fallbacku) i z kontrolą, że w oknie nie ma surowego klucza `careers.*`.
//
// ---------------------------------------------------------------------------
// CO JEST ATRAPOWANE I DLACZEGO
// ---------------------------------------------------------------------------
// NIC. W tym pliku nie ma ani jednego `vi.mock` - i to jest decyzja, nie
// zaniedbanie:
// * `@/components/ui/dialog` (Radix) - obietnice „zamknij Escape'em", „ognisko
//   siedzi w oknie", „reszta strony wychodzi z drzewa dostępności" mieszkają
//   WYŁĄCZNIE w primitywie, a komponent podaje mu tylko `open` i `onOpenChange`.
//   Atrapa dowiodłaby, że atrapa działa (wywód identyczny jak w nagłówku
//   `src/components/admin/analytics/__tests__/chartDrillDialog.test.tsx`).
// * `react-i18next` + `@/lib/i18n-careers` - prawdziwy słownik, bo połowa
//   przedmiotu dowodu to „napis przyszedł ze słownika w aktywnym języku".
//   Atrapa `t: (k) => k` mierzyłaby literały wpisane w teście.
// * `@/components/ui/scroll-area` (Radix) - kontener treści; happy-dom ma
//   `ResizeObserver`, więc prawdziwy `ScrollArea` montuje się bez protez,
//   a jego zdjęcie zabrałoby dowód, że punkty oferty NAPRAWDĘ są w drzewie
//   (viewport Radiksa wstawia dwa własne opakowania między sekcje i okno).
// Granicy danych tu nie ma: komponent nie dotyka ani Supabase, ani react-query -
// dostaje gotową `CareerOffer`. Dlatego oferty w tym pliku są literałami
// typowanymi `satisfies CareerOffer`: typ pilnuje, żeby fixture nie rozjechał
// się z kontraktem `rowToOffer`.
//
// ---------------------------------------------------------------------------
// ZNALEZISKA (kod produkcyjny NIEZMIENIONY; testy asertują stan ISTNIEJĄCY)
// ---------------------------------------------------------------------------
// ZNALEZISKO 1 - punktor kluczowany TREŚCIĄ. `OfferList` renderuje
//   `<li key={item}>`, a `item` to tekst z panelu (`career_roles.responsibilities_pl`
//   to zwykła tablica `text[]`, bez bramki unikalności). Dwa identyczne punkty
//   w jednej ofercie dają kolizję kluczy Reacta („Encountered two children with
//   the same key"), czyli ostrzeżenie w konsoli produkcyjnej i - słowami samego
//   Reacta - render, w którym dzieci „may be duplicated and/or omitted".
//   Dzisiejszy React 19 rysuje OBA punkty; test „ZNALEZISKO 1" utrwala i ten
//   render, i sam fakt kolizji. Poprawką byłby klucz z indeksu (kolejność jest
//   tu jedyną tożsamością punktu), ale to zmiana kodu produkcyjnego - poza
//   zakresem tego pliku.
// ZNALEZISKO 2 - trzecie wyjście okna mówi po angielsku. `DialogContent`
//   z `src/components/ui/dialog.tsx` dokłada własny przycisk `×` z ZASZYTĄ
//   nazwą `sr-only` „Close" (linia z `<span className="sr-only">Close</span>`).
//   Na polskiej stronie kariery czytnik ekranu ogłasza więc trzy wyjścia,
//   z czego jedno po angielsku - obok „Zamknij" ze słownika. Defekt mieszka
//   w primitywie współdzielonym przez cały panel i całą stronę, nie w tym
//   komponencie, więc test „ZNALEZISKO 2" asertuje stan istniejący (nazwa
//   „Close" niezależna od języka i18n) i nazywa właściciela.
//
// ZNALEZISKO 3 - `aria-hidden` na ikonach jest NIEMIERZALNE w tej warstwie
//   (ustalone rewizją, nie przez lekturę komponentu). `MetaChip` podaje
//   `<Icon ... aria-hidden />`, ale `lucide-react` dokłada
//   `aria-hidden="true"` KAŻDEJ ikonie, która nie ma dzieci ani żadnego propa
//   `aria-*` / `role` / `title`
//   (`node_modules/lucide-react/dist/esm/shared/src/utils/hasA11yProp.js`
//   oraz `Icon.js`). Skutek: usunięcie propa z `MetaChip` albo z `ArrowRight`
//   NIE ZMIENIA renderu i żaden test tej warstwy tego nie wykryje - asercja
//   na samym atrybucie mierzyłaby wtedy domyślną decyzję biblioteki, nie
//   decyzję komponentu. Oba przypadki („ikony chipsów...", „nazwą dostępną
//   CTA...") stoją więc na SKUTKU: tekst chipu i nazwa przycisku muszą być
//   DOKŁADNIE napisem ze słownika. Zmierzone: podanie ikonie `aria-label`
//   (realna regresja, po której lucide przestaje ją ukrywać) oblewa oba
//   przypadki. Prop w komponencie jest zatem redundantny, ale poprawny -
//   jego usunięcie to zmiana kodu produkcyjnego, poza zakresem tego pliku.
//
// ---------------------------------------------------------------------------
// PROTOKÓŁ REWIZJI ADWERSARYJNEJ (co zostało PODWAŻONE pomiarem)
// ---------------------------------------------------------------------------
// Pokrycie 9/9 linii i 6/6 funkcji nie dowodzi, że test coś wykrywa - dowodzi
// tylko, że kod się wykonał. Dlatego ten plik przejechano baterią 22 RÓŻNYCH
// mutacji `CareerRoleDialog.tsx` (źródło przywrócone bit w bit, sprawdzone
// `diff` i `git status`). 18 z nich oblewało właściwe przypadki od razu - m.in.
// odwrócenie kolejności `onOpenChange`/`onApply`, `onApply(role.title)`,
// CTA bez `onOpenChange`, zamiana list obowiązków i wymagań, zaszycie fasety
// po polsku, `onOpenChange(true)` w „Zamknij", zdjęcie `DialogDescription`,
// zdjęcie nadtytułu, h3 -> span, przestawienie chipsów, odwrócenie kolejności
// stopki, pełne usunięcie bariery `!role`, `aria-label` na ikonie chipu i na
// strzałce CTA, `<ul>` z nie-listowym dzieckiem (to złapał WYŁĄCZNIE axe -
// dowód, że te dwa przypadki nie są ozdobą) i `aria-labelledby` wskazujące
// w pustkę. CZTERY mutacje PRZESZŁY BEZ WYKRYCIA i to one wskazały prawdziwe
// dziury w dowodach:
//   * M03c `if (!role) return <div />` - przypadek obiecywał „nie renderuje
//     NICZEGO", a dowodził jedynie braku TEKSTU; puste opakowanie przechodziło.
//     Dziś asercja stoi na `container.childNodes` i `innerHTML`, więc mierzy
//     to, co nazwa obiecuje: zwrot `null`. (Pełne usunięcie bariery, M03b,
//     przypadek łapał od początku.)
//   * M15b/M15c `<section hidden>` i `<ul hidden>` przy pustej liście -
//     dowód „nagłówek sekcji zostaje" stał na `getByText` i `querySelector`,
//     czyli na obecności węzła w DOM. Sekcja schowana przed użytkownikiem
//     i przed czytnikiem ekranu przechodziła oba. Dziś nagłówki i listy
//     czytane są przez role (`heading` / `list`), które pomijają poddrzewa
//     niedostępne.
//   * M04 zdjęcie `aria-hidden` z ikony chipu - niemierzalne z winy biblioteki,
//     nie testu; rozpisane w ZNALEZISKU 3, a przypadki przestawione na skutek.
// Po poprawkach łapane jest 21 z 22 mutacji. Jedyna ocalała to M04, czyli
// mutacja RÓWNOWAŻNA: lucide renderuje `aria-hidden="true"` tak samo z propem
// i bez niego, więc nie istnieje test tej warstwy, który by ją odróżnił -
// i dlatego nie udaje się tu dowodu, którego nie ma.
// Poza tym rewizja domknęła: sondę `console.error` (przywracana w `afterEach`,
// nie na szczęśliwej ścieżce), „dokładnie raz" przy Escape (dziennik po
// uspokojeniu kolejki, bo `waitFor` przechodzi w chwili sięgnięcia jedynki),
// dowód ZNALEZISKA 2 w OBU językach (wcześniej nazwa obiecywała „w każdym
// języku", a ciało jechało tylko po polsku) oraz nieaktualny cytat z sąsiada.
//
// ---------------------------------------------------------------------------
// ŚWIADOMIE POZA ZAKRESEM
// ---------------------------------------------------------------------------
// * KTO i CZYM otwiera okno (`onDetails` -> `findOffer` -> `open`), oraz że
//   karta oddaje slug, a nie UUID - `careers/__tests__/careersRoles.test.tsx`.
// * SKĄD BIERZE SIĘ `CareerOffer` (wiersz bazy vs katalog i18n, wybór języka,
//   filtr, liczniki) - `src/lib/careers/__tests__/catalog.test.ts`
//   i `roles.test.ts`.
// * CO ROBI FORMULARZ z otrzymanym slugiem (preselekcja stanowiska, przewinięcie
//   do sekcji, `applySignal`) - `careers/__tests__/careersApplyForm.test.tsx`
//   i `src/routes/__tests__/zatrudniamyRoute.test.tsx`.
// * PRAWDZIWE MALOWANIE: blokada przewijania tła, kliknięcie w tło (Radiks
//   podpina nasłuch `pointerdown` na warstwie, którą happy-dom rysuje bez
//   geometrii), widoczny pierścień ogniska, przewijanie `ScrollArea` przy
//   `max-h-[55vh]` - warstwa e2e.
// * REGUŁY axe `color-contrast` i `region` - wyłączone w harnessie
//   `@/test/axe` (brak silnika layoutu; landmarki to sprawa trasy-gospodarza).
//
// RODO: żadnych prawdziwych osób ani treści. Oferty, tytuły i punkty są
// zmyślone na potrzeby tego pliku; komponent nie przyjmuje danych kandydata,
// więc nie ma tu ani jednego adresu (gdyby był, byłby `@example.com`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import "@/test/i18nReal";
import { realT } from "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { ensureI18n } from "@/lib/i18n-careers";
import { axeViolations, summarize } from "@/test/axe";
import { CareerRoleDialog } from "@/components/careers/organisms/CareerRoleDialog";
import type { CareerOffer } from "@/lib/careers/catalog";

// Słownik kariery rejestruje się efektem ubocznym importu; wywołanie `ensureI18n`
// jest tym samym „nie wyrzucaj mnie z chunku", którym posługują się trasy.
ensureI18n();

// ---------------------------------------------------------------------------
// Oferty. Dwie, bo każda faseta ma w drugiej INNĄ wartość - dzięki temu
// asercja na chipie nie może przejść przez pomyłkę „zawsze pierwszy klucz".
// ---------------------------------------------------------------------------

const ANALITYK = {
  id: "analityk-energia-cee",
  department: "analysis",
  engagement: "full_time",
  seniority: "senior",
  location: "warsaw",
  title: "Analityk - energia w Europie Środkowej",
  summary: "Prowadzisz linię badawczą o rynku energii i tłumaczysz regulację UE na decyzje firm.",
  responsibilities: [
    "Projektowanie analiz rynku energii.",
    "Briefy regulacyjne dla instytucji.",
    "Reprezentowanie zespołu na panelach.",
  ],
  requirements: ["Trzy lata pracy analitycznej.", "Biegły polski i angielski."],
} satisfies CareerOffer;

const REDAKTOR = {
  id: "redaktor-wydania-en",
  department: "editorial",
  engagement: "contract",
  seniority: "junior",
  location: "remote",
  title: "Redaktor wydania angielskiego",
  summary: "Redagujesz analizy w wersji angielskiej i pilnujesz spójności terminologii.",
  responsibilities: ["Redakcja tekstów w EN."],
  requirements: ["Doświadczenie redakcyjne w EN."],
} satisfies CareerOffer;

/** Oferta z panelu, w której redakcja nie wpisała ani jednego punktu. */
const BEZ_PUNKTOW = {
  ...ANALITYK,
  id: "oferta-bez-punktow",
  responsibilities: [],
  requirements: [],
} satisfies CareerOffer;

// ---------------------------------------------------------------------------
// Render. Handlery piszą do WSPÓLNEGO dziennika, bo przedmiotem dowodu jest
// nie tylko „co zawołano", ale i „w jakiej kolejności" (punkt 6 nagłówka).
// ---------------------------------------------------------------------------

type Wpis = { handler: "onOpenChange"; open: boolean } | { handler: "onApply"; roleId: string };

function otworz(role: CareerOffer | null, open = true) {
  const dziennik: Wpis[] = [];
  const onOpenChange = vi.fn((next: boolean) => {
    dziennik.push({ handler: "onOpenChange", open: next });
  });
  const onApply = vi.fn((roleId: string) => {
    dziennik.push({ handler: "onApply", roleId });
  });
  const wynik = render(
    <CareerRoleDialog role={role} open={open} onOpenChange={onOpenChange} onApply={onApply} />,
  );
  return { ...wynik, onOpenChange, onApply, dziennik };
}

/** Okno Radiksa ląduje w portalu na `document.body`, nie w kontenerze renderu. */
function okno(): HTMLElement {
  return screen.getByRole("dialog");
}

/** Nagłówek okna (`DialogHeader`) - pierwszy blok treści. */
function naglowekOkna(): HTMLElement {
  return okno().firstElementChild as HTMLElement;
}

/** Pasek meta-chipsów: ostatnie dziecko nagłówka okna. */
function pasekChipsow(): HTMLElement {
  return naglowekOkna().lastElementChild as HTMLElement;
}

function chipy(): string[] {
  return Array.from(pasekChipsow().children).map((chip) => chip.textContent ?? "");
}

/**
 * Sekcja treści po jej nagłówku - punkty czytamy TYLKO z niej.
 *
 * Nagłówek szukany PRZEZ ROLĘ, nie przez `getByText`: zapytania rolowe
 * pomijają poddrzewa niedostępne (`hidden`, `display:none`), więc sekcja
 * schowana przed użytkownikiem tu NIE ZOSTANIE znaleziona. `getByText`
 * znajdował ją nadal - i dlatego przepuszczał mutację „pusta lista chowa
 * całą sekcję" (M15b w rewizji).
 */
function sekcja(naglowek: string): HTMLElement {
  return within(okno())
    .getByRole("heading", { level: 3, name: naglowek })
    .closest("section") as HTMLElement;
}

const pl = realT("pl");

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  // Portal i strażnicy ogniska Radiksa mieszkają na `document.body`; jeden
  // przypadek dokłada tam własny przycisk. Start z pustego ciała.
  document.body.innerHTML = "";
});

afterEach(() => {
  cleanup();
  // Sonda `console.error` z przypadku „ZNALEZISKO 1" MUSI zniknąć także wtedy,
  // gdy asercja przed nią oblała się w połowie. Bez tego kolejne przypadki
  // tego pliku biegłyby z wyciszoną konsolą, a ostrzeżenia Reacta przepadałyby
  // razem z dowodem kolizji kluczy.
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe("CareerRoleDialog - brama otwarcia", () => {
  it("bez oferty nie renderuje NICZEGO, choćby `open` było prawdą", () => {
    // Trasa trzyma `open={detailsRole !== null}` i `role={findOffer(...)}`.
    // Te dwa źródła rozjeżdżają się w chwili zamykania (Radiks animuje wyjście)
    // i przy nieznanym identyfikatorze w adresie - `findOffer` oddaje wtedy
    // `undefined`, a props mówi `open`.
    const { container } = otworz(null, true);

    expect(screen.queryByRole("dialog")).toBeNull();
    // NIE „brak tekstu": komponent oddaje `null`, więc kontener renderu jest
    // PUSTY. Sama asercja na `textContent` przepuszczała barierę oddającą puste
    // opakowanie (`if (!role) return <div />`) - zmierzone mutacją M03c
    // w rewizji. Puste opakowanie nie jest niczym: w drzewie trasy zostaje
    // węzeł, który łapie style i psuje `:empty`/odstępy siatki kariery.
    expect(container.childNodes).toHaveLength(0);
    expect(container.innerHTML).toBe("");
    expect(document.body.textContent).toBe("");
  });

  it("z ofertą, ale zamknięte - treść oferty NIE ISTNIEJE w dokumencie", () => {
    // Nie „jest schowana klasą": Radiks montuje portal dopiero przy otwarciu.
    // Gdyby treść wisiała w DOM, oferta byłaby czytelna dla czytnika ekranu
    // i indeksowalna przy zamkniętym oknie.
    otworz(ANALITYK, false);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.textContent).not.toContain(ANALITYK.title);
    expect(document.body.textContent).not.toContain(ANALITYK.summary);
    expect(document.body.textContent).not.toContain(pl("careers.roles.dialog.overview"));
    expect(screen.queryByRole("button", { name: pl("careers.roles.apply") })).toBeNull();
  });

  it("otwarte - dostępną NAZWĄ okna jest tytuł oferty", () => {
    otworz(ANALITYK);

    const dialog = screen.getByRole("dialog", { name: ANALITYK.title });
    const tytul = within(dialog).getByRole("heading", { level: 2 });
    // Nazwa nie jest przepisana do `aria-label` - niesie ją WIDOCZNY nagłówek.
    expect(dialog.getAttribute("aria-labelledby")).toBe(tytul.id);
    expect(dialog.getAttribute("aria-label")).toBeNull();
    expect(tytul.textContent).toBe(ANALITYK.title);
  });

  it("dostępny OPIS okna to napis ze słownika, podany tylko czytnikowi ekranu", () => {
    // Widoczny pasek chipsów nie jest opisem: dla czytnika to cztery luźne
    // napisy bez zapowiedzi. `DialogDescription` daje jedno zdanie zapowiedzi,
    // a `sr-only` trzyma je poza układem graficznym.
    otworz(ANALITYK);

    const opis = within(okno()).getByText(pl("careers.roles.dialog.meta"));
    expect(okno().getAttribute("aria-describedby")).toBe(opis.id);
    expect(opis.className).toContain("sr-only");
  });
});

describe("CareerRoleDialog - nagłówek oferty", () => {
  it("nadtytuł to DZIAŁ ze słownika i stoi PRZED tytułem oferty", () => {
    otworz(ANALITYK);

    const naglowek = naglowekOkna();
    expect((naglowek.children[0] as HTMLElement).textContent).toBe(
      pl("careers.departments.analysis"),
    );
    expect((naglowek.children[1] as HTMLElement).textContent).toBe(ANALITYK.title);
  });

  it("cztery meta-chipy: lokalizacja, tryb, poziom, dział - w tej kolejności", () => {
    otworz(ANALITYK);

    expect(chipy()).toEqual([
      pl("careers.location.warsaw"),
      pl("careers.engagement.full_time"),
      pl("careers.seniority.senior"),
      pl("careers.departments.analysis"),
    ]);
  });

  it("druga oferta daje INNE etykiety - chipy idą z faset wiersza, nie ze stałej", () => {
    otworz(REDAKTOR);

    expect(chipy()).toEqual([
      pl("careers.location.remote"),
      pl("careers.engagement.contract"),
      pl("careers.seniority.junior"),
      pl("careers.departments.editorial"),
    ]);
    // Etykiety pierwszej oferty nie zostały w oknie.
    expect(okno().textContent).not.toContain(pl("careers.location.warsaw"));
    expect(okno().textContent).not.toContain(pl("careers.seniority.senior"));
  });

  it("ikony chipsów nie wnoszą tekstu do etykiet - nazwą chipu jest sam napis ze słownika", () => {
    // ZASTRZEŻENIE POMIARU (dopisane w rewizji, patrz ZNALEZISKO 3 w nagłówku):
    // `aria-hidden` na ikonie chipu jest gwarantowane DWA razy - raz propem
    // w `MetaChip`, raz przez samo `lucide-react`, które dokłada
    // `aria-hidden="true"` każdej ikonie bez dzieci i bez propa
    // `aria-*`/`role`/`title`. Zdjęcie propa z komponentu NIE ZMIENIA więc
    // renderu (zmierzone mutacją M04) i żaden test tej warstwy tego nie
    // wykryje. Ten przypadek pilnuje zatem SKUTKU, który jest własnością
    // złożenia: ikona nie wnosi ani tekstu, ani własnej nazwy dostępnej, więc
    // etykietą chipu zostaje sam napis ze słownika. Mutacja, którą oblewa
    // (M04b): podanie ikonie `aria-label` - wtedy lucide przestaje ją ukrywać
    // i czytnik czyta etykietę dwa razy.
    otworz(ANALITYK);

    const pasek = pasekChipsow();
    const ikony = Array.from(pasek.querySelectorAll("svg"));
    expect(ikony).toHaveLength(4);
    for (const ikona of ikony) {
      expect(ikona.getAttribute("aria-hidden")).toBe("true");
      expect(ikona.getAttribute("aria-label")).toBeNull();
      expect(ikona.querySelector("title")).toBeNull();
      expect(ikona.textContent).toBe("");
    }
    // SKUTEK: tekst każdego chipu to DOKŁADNIE etykieta ze słownika - ani
    // znaku więcej, więc ikona nie przecieka do nazwy.
    expect(chipy()).toEqual([
      pl("careers.location.warsaw"),
      pl("careers.engagement.full_time"),
      pl("careers.seniority.senior"),
      pl("careers.departments.analysis"),
    ]);
  });

  it("dział pada w oknie DWA razy - jako nadtytuł i jako chip", () => {
    // Utrwalenie stanu istniejącego: nadtytuł i czwarty chip niosą ten sam
    // klucz `careers.departments.*`. Gdyby ktoś „odchudził" nagłówek, ta
    // asercja pokaże, którą z dwóch instancji zabrał.
    otworz(ANALITYK);

    expect(within(okno()).getAllByText(pl("careers.departments.analysis"))).toHaveLength(2);
  });
});

describe("CareerRoleDialog - treść oferty", () => {
  it("trzy sekcje w stałej kolejności, każda z nagłówkiem ze słownika", () => {
    otworz(ANALITYK);

    expect(
      within(okno())
        .getAllByRole("heading", { level: 3 })
        .map((h) => h.textContent),
    ).toEqual([
      pl("careers.roles.dialog.overview"),
      pl("careers.roles.dialog.responsibilities"),
      pl("careers.roles.dialog.requirements"),
    ]);
  });

  it("opis roli przychodzi z OFERTY, nie ze słownika", () => {
    otworz(ANALITYK);

    const o_roli = sekcja(pl("careers.roles.dialog.overview"));
    expect(within(o_roli).getByText(ANALITYK.summary)).toBeTruthy();
  });

  it("punkty stoją w SWOICH listach i w kolejności podanej przez ofertę", () => {
    // Rozdział list jest tu sednem: obowiązki wpisane w wymagania czytają się
    // jak warunek wstępny, a wymagania wpisane w obowiązki - jak obietnica
    // pracodawcy. Asercje idą PO SEKCJI, nie po całym oknie.
    otworz(ANALITYK);

    const obowiazki = sekcja(pl("careers.roles.dialog.responsibilities"));
    const wymagania = sekcja(pl("careers.roles.dialog.requirements"));

    expect(
      within(obowiazki)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(ANALITYK.responsibilities);
    expect(
      within(wymagania)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(ANALITYK.requirements);
  });

  it("kropka punktora jest wyjęta z drzewa dostępności", () => {
    // Ozdobny `<span>` bez `aria-hidden` to dla czytnika ekranu pusty element
    // przed każdym punktem oferty.
    otworz(ANALITYK);

    const obowiazki = sekcja(pl("careers.roles.dialog.responsibilities"));
    const punkty = within(obowiazki).getAllByRole("listitem");
    for (const punkt of punkty) {
      expect((punkt.firstElementChild as HTMLElement).getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("PUSTA lista obowiązków zostawia nagłówek i pustą listę, a wymagania działają dalej", () => {
    // `career_roles.responsibilities_*` to `text[]` bez bramki „minimum jeden
    // punkt”, więc oferta z panelu może przyjechać bez punktów. Sekcja musi
    // zostać (kandydat widzi, czego brakuje), a druga lista - działać.
    otworz({ ...ANALITYK, responsibilities: [] });

    // `sekcja()` szuka nagłówka PRZEZ ROLĘ, a lista przez rolę `list`: obie
    // asercje mierzą drzewo dostępności, nie samą obecność węzła w DOM.
    // `querySelector("ul")` przepuszczał `<ul hidden>` (mutacja M15c).
    const obowiazki = sekcja(pl("careers.roles.dialog.responsibilities"));
    expect(within(obowiazki).getByRole("list")).toBeTruthy();
    expect(within(obowiazki).queryAllByRole("listitem")).toHaveLength(0);

    const wymagania = sekcja(pl("careers.roles.dialog.requirements"));
    expect(
      within(wymagania)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(ANALITYK.requirements);
  });

  it("oferta bez OBU list nadal pokazuje opis roli i oba nagłówki", () => {
    otworz(BEZ_PUNKTOW);

    const w = within(okno());
    expect(w.getByText(BEZ_PUNKTOW.summary)).toBeTruthy();
    // Nagłówki i listy czytane PRZEZ ROLĘ: sekcja schowana atrybutem `hidden`
    // wypada z drzewa dostępności i ta asercja ją oblewa (mutacje M15b/M15c).
    // Wersja na `getByText` + `querySelector` obie przepuszczała.
    expect(w.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      pl("careers.roles.dialog.overview"),
      pl("careers.roles.dialog.responsibilities"),
      pl("careers.roles.dialog.requirements"),
    ]);
    expect(w.getAllByRole("list")).toHaveLength(2);
    expect(w.queryAllByRole("listitem")).toHaveLength(0);
    // Puste okno nie może zamienić się w okno bez wyjścia.
    expect(w.getByRole("button", { name: pl("careers.roles.dialog.close") })).toBeTruthy();
  });

  it("ZNALEZISKO 1: dwa identyczne punkty renderują się OBA, ale kluczem jest ich treść", () => {
    // `<li key={item}>` bierze klucz z tekstu punktu, a tekst pochodzi z panelu
    // (tablica `text[]` bez unikalności). React 19 rysuje oba punkty i ZGŁASZA
    // kolizję kluczy - a przy kolizji sam zastrzega, że dzieci „may be
    // duplicated and/or omitted". Test utrwala JEDNO I DRUGIE: dzisiejszy
    // render i sam fakt kolizji. Poprawką byłby klucz z indeksu (kolejność
    // jest jedyną tożsamością punktu), ale to zmiana kodu produkcyjnego.
    const bledy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const powtorka = "Redakcja tekstów w EN.";

    otworz({ ...REDAKTOR, responsibilities: [powtorka, powtorka] });

    const obowiazki = sekcja(pl("careers.roles.dialog.responsibilities"));
    expect(
      within(obowiazki)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual([powtorka, powtorka]);
    expect(bledy.mock.calls.map((args) => String(args[0])).join("\n")).toContain(
      "two children with the same key",
    );
    // Zdjęcie sondy należy do `afterEach` - tutaj `mockRestore()` wykonałby się
    // TYLKO przy zielonej asercji, czyli dokładnie wtedy, gdy nie jest potrzebny.
  });
});

describe("CareerRoleDialog - droga do formularza zgłoszenia", () => {
  it("„Aplikuj” NAJPIERW zamyka okno, POTEM oddaje identyfikator roli", () => {
    // Kolejność jest widoczna dla kandydata: trasa na sygnał `onApply`
    // przewija stronę do formularza, a okno zostawione otwarte stoi nad nim.
    const { dziennik, onOpenChange, onApply } = otworz(ANALITYK);

    fireEvent.click(screen.getByRole("button", { name: pl("careers.roles.apply") }));

    expect(dziennik).toEqual([
      { handler: "onOpenChange", open: false },
      { handler: "onApply", roleId: ANALITYK.id },
    ]);
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("handler dostaje SLUG oferty, nie jej tytuł ani etykietę działu", () => {
    // Formularz preselekcjonuje stanowisko po tym identyfikatorze; tytuł jest
    // dwujęzyczny i redagowalny, więc jako klucz byłby fikcją.
    const { onApply } = otworz(REDAKTOR);

    fireEvent.click(screen.getByRole("button", { name: pl("careers.roles.apply") }));

    // Dziennik wywołań W CAŁOŚCI: jedno wywołanie, jeden argument, ten właściwy.
    // `toHaveBeenCalledWith` samo przepuściłoby drugie wywołanie z tytułem.
    expect(onApply.mock.calls).toEqual([[REDAKTOR.id]]);
    expect(onApply).not.toHaveBeenCalledWith(REDAKTOR.title);
    expect(onApply).not.toHaveBeenCalledWith(pl("careers.departments.editorial"));
  });

  it("„Zamknij” melduje zamknięcie i NIE zgłasza aplikacji", () => {
    const { dziennik, onApply } = otworz(ANALITYK);

    fireEvent.click(screen.getByRole("button", { name: pl("careers.roles.dialog.close") }));

    expect(dziennik).toEqual([{ handler: "onOpenChange", open: false }]);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("Escape zamyka okno dokładnie raz i też nie zgłasza aplikacji", async () => {
    const { dziennik, onOpenChange, onApply } = otworz(ANALITYK);

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledTimes(1));
    // `waitFor` przechodzi w CHWILI, gdy licznik sięgnie jedynki - to jeszcze
    // nie dowód „dokładnie raz". Dowodem jest dziennik odczytany po uspokojeniu
    // kolejki: gdyby Radiks meldował zamknięcie drugi raz (np. `onEscapeKeyDown`
    // plus `onOpenChange`), stałby tu drugi wpis.
    await act(async () => {
      await new Promise((gotowe) => setTimeout(gotowe, 0));
    });
    expect(dziennik).toEqual([{ handler: "onOpenChange", open: false }]);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("ZNALEZISKO 2: przycisk `×` primitywu zamyka, ale nazywa się „Close” niezależnie od języka", async () => {
    // Trzecie wyjście dokłada `DialogContent` z `src/components/ui/dialog.tsx`
    // razem z zaszytym `<span className="sr-only">Close</span>`. Na polskiej
    // stronie czytnik ekranu ogłasza więc dwa różne wyjścia: „Zamknij"
    // ze słownika i angielskie „Close". Defekt należy do primitywu
    // współdzielonego przez cały panel, nie do tego komponentu - test asertuje
    // stan istniejący i pilnuje, że przycisk PRZYNAJMNIEJ zamyka.
    const { onOpenChange, onApply } = otworz(ANALITYK);

    const nazwy = () =>
      within(okno())
        .getAllByRole("button")
        .map((b) => b.textContent);
    /** `×` primitywu jest OSTATNIM dzieckiem `DialogContent`, po `children`. */
    const krzyzyk = () => within(okno()).getAllByRole("button").at(-1) as HTMLElement;

    // PL jest przypadkiem ROZSTRZYGAJĄCYM: obok „Zamknij" ze słownika stoi
    // wyjście podpisane po angielsku.
    expect(nazwy()).toEqual([
      pl("careers.roles.dialog.close"),
      expect.stringContaining(pl("careers.roles.apply")),
      "Close",
    ]);
    expect(krzyzyk().textContent).not.toBe(pl("careers.roles.dialog.close"));

    fireEvent.click(within(okno()).getByRole("button", { name: "Close" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onApply).not.toHaveBeenCalled();

    // EN pokazuje, DLACZEGO defekt nie kłuje w oczy: napis `×` się NIE ZMIENIA,
    // a napis ze słownika owszem („Zamknij" -> „Close"), więc oba wyjścia
    // przypadkiem się zgadzają. Stała nazwa przy zmienionym języku to dowód,
    // że nie przechodzi ona przez i18n.
    cleanup();
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    otworz(ANALITYK);
    expect(krzyzyk().textContent).toBe("Close");
    expect(realT("en")("careers.roles.dialog.close")).toBe("Close");
    expect(pl("careers.roles.dialog.close")).not.toBe("Close");
  });

  it("nazwą dostępną CTA jest sam napis ze słownika - strzałka nie wnosi tekstu", () => {
    // To samo zastrzeżenie pomiaru co przy chipsach (ZNALEZISKO 3): `aria-hidden`
    // na `ArrowRight` dokłada również samo lucide, więc dowodem NIE jest atrybut,
    // a nazwa przycisku - `getByRole` z napisem dopasowuje ją DOKŁADNIE, więc
    // każdy znak wniesiony przez ikonę oblałby to zapytanie.
    otworz(ANALITYK);

    const cta = screen.getByRole("button", { name: pl("careers.roles.apply") });
    const strzalka = cta.querySelector("svg") as SVGElement;
    expect(strzalka.getAttribute("aria-hidden")).toBe("true");
    expect(strzalka.getAttribute("aria-label")).toBeNull();
    expect(strzalka.textContent).toBe("");
    expect(cta.textContent).toBe(pl("careers.roles.apply"));
  });
});

describe("CareerRoleDialog - dostępność okna", () => {
  it("po otwarciu ognisko stoi na „Zamknij”, nie na nieodwracalnym „Aplikuj”", async () => {
    // Radiks daje ognisko pierwszemu elementowi tabulacji w treści okna.
    // Kolejność stopki (najpierw „Zamknij", potem CTA) sprawia, że Enter
    // wciśnięty odruchowo zaraz po otwarciu zamyka okno, a nie wysyła
    // kandydata do formularza.
    otworz(ANALITYK);

    await waitFor(() => expect(okno().contains(document.activeElement)).toBe(true));
    expect(document.activeElement?.textContent).toBe(pl("careers.roles.dialog.close"));
  });

  it("ognisko wyprowadzone poza okno WRACA do środka, a tło wychodzi z drzewa dostępności", async () => {
    // Tak Radiks realizuje modalność: NIE atrybutem `aria-modal`, ale
    // pułapką ogniska plus `aria-hidden` na rodzeństwie portalu. Bez tego
    // kandydat nawigujący klawiaturą wypadałby z okna w listę ról za nim.
    document.body.innerHTML = '<button id="tlo" type="button">Karta roli</button>';
    const tlo = document.getElementById("tlo") as HTMLButtonElement;

    otworz(ANALITYK);
    await waitFor(() => expect(okno().contains(document.activeElement)).toBe(true));

    expect(okno().getAttribute("aria-modal")).toBeNull();
    expect(tlo.getAttribute("aria-hidden")).toBe("true");

    await act(async () => {
      tlo.focus();
      await new Promise((gotowe) => setTimeout(gotowe, 0));
    });

    expect(document.activeElement).not.toBe(tlo);
    expect(okno().contains(document.activeElement)).toBe(true);
  });

  it("hierarchia nagłówków nie przeskakuje poziomu: tytuł h2, sekcje h3", () => {
    otworz(ANALITYK);

    expect(
      within(okno())
        .getAllByRole("heading")
        .map((h) => h.tagName),
    ).toEqual(["H2", "H3", "H3", "H3"]);
  });

  it("pełna oferta nie wnosi naruszeń axe", async () => {
    // Zasięg to TREŚĆ okna, nie `document.body`: poza treścią stoją strażnicy
    // ogniska Radiksa (`aria-hidden` + `tabindex=0`), których reguła
    // `aria-hidden-focus` zgłasza w KAŻDYM modalu tej biblioteki - to artefakt
    // primitywu, nie właściwość `CareerRoleDialog`.
    otworz(ANALITYK);

    const naruszenia = await axeViolations(okno());
    expect(summarize(naruszenia)).toBe("");
  });

  it("oferta z pustymi listami też jest czysta w axe", async () => {
    // Pusty `<ul>` to najczęstsze naruszenie tej klasy w listach warunkowych.
    otworz(BEZ_PUNKTOW);

    const naruszenia = await axeViolations(okno());
    expect(summarize(naruszenia)).toBe("");
  });
});

describe("CareerRoleDialog - dwujęzyczność", () => {
  it("nagłówki sekcji, przyciski i fasety przychodzą ze słownika EN", async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    const en = realT("en");
    // Bramka przed testem, który „przechodzi" na polskim fallbacku.
    expect(en("careers.roles.dialog.responsibilities")).not.toBe(
      pl("careers.roles.dialog.responsibilities"),
    );
    expect(en("careers.location.warsaw")).not.toBe(pl("careers.location.warsaw"));

    otworz(ANALITYK);

    expect(chipy()).toEqual([
      en("careers.location.warsaw"),
      en("careers.engagement.full_time"),
      en("careers.seniority.senior"),
      en("careers.departments.analysis"),
    ]);
    expect(
      within(okno())
        .getAllByRole("heading", { level: 3 })
        .map((h) => h.textContent),
    ).toEqual([
      en("careers.roles.dialog.overview"),
      en("careers.roles.dialog.responsibilities"),
      en("careers.roles.dialog.requirements"),
    ]);
    expect(within(okno()).getByRole("button", { name: en("careers.roles.apply") })).toBeTruthy();
    expect(within(okno()).getByText(en("careers.roles.dialog.meta"))).toBeTruthy();
    // Ani jeden polski napis nie został po przełączeniu języka.
    expect(okno().textContent).not.toContain(pl("careers.roles.dialog.responsibilities"));
    expect(okno().textContent).not.toContain(pl("careers.roles.dialog.close"));
  });

  it("w oknie nie ma surowego klucza i18n - w PL i w EN", async () => {
    // Klucz na ekranie („careers.roles.dialog.close") to typowy skutek
    // literówki albo słownika, który nie dojechał do chunku trasy.
    otworz(ANALITYK);
    expect(okno().textContent).not.toMatch(/careers\.[a-z]/i);
    cleanup();

    await act(async () => {
      await i18n.changeLanguage("en");
    });
    otworz(ANALITYK);
    expect(okno().textContent).not.toMatch(/careers\.[a-z]/i);
  });
});
