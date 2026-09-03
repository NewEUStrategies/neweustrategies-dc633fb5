// SEKCJA WARTOŚCI STRONY KARIERY (/zatrudniamy) I JEJ KAFLE — spotlight zasad,
// siatka benefitów, atom odsłaniania przy scrollu i atom liczby dowodowej.
//
// PO CO TEN PLIK ISTNIEJE. Cała ta powierzchnia wchodziła do kampanii z
// pomiarem: `CareersValues.tsx` 0/27 linii, 0/13 funkcji, 0/13 gałęzi,
// `CareerBenefitTile.tsx` 0/1 linii i 0/1 funkcji, `CareerReveal.tsx` 0/2 linii,
// 0/1 funkcji, 0/3 gałęzi, `CareerStat.tsx` 8/21 linii, 2/5 funkcji, 3/19 gałęzi
// (jedyny dowód CareerStat pochodził z `careersHero.test.tsx`, gdzie
// IntersectionObserver happy-doma nigdy nie strzela, więc efekt odliczania
// kończył się na `if (!inView ...) return` i NIC z animacji nie było zmierzone).
// Zero pokrycia oznacza tu konkretne, ciche defekty, które przechodzą review:
//   * zasady rotują się dalej, gdy sekcja jest poza viewportem, gdy karta
//     przeglądarki jest ukryta albo gdy użytkownik już kliknął — czyli
//     auto-pokaz WALCZY o kursor zamiast zapraszać (regres łatwy do wpuszczenia
//     jedną literówką w tablicy zależności `useEffect`);
//   * `prefers-reduced-motion` przestaje wyłączać animacje i osoba, która
//     wyłączyła ruch w systemie, dostaje migający licznik;
//   * licznik `CareerStat` przy ograniczonym ruchu, przy braku
//     IntersectionObservera (SSR, crawler) albo przy wartości nienumerycznej
//     zostaje na ZERZE zamiast pokazać wartość końcową — „45 osób w zespole"
//     zamienia się w „0 osób w zespole" i strona rekrutacyjna sama sobie
//     zaprzecza. To nie kosmetyka, to dostępność i wiarygodność treści;
//   * kafel benefitu gubi tytuł albo treść i renderuje pustą ramkę.
//
// CO JEST PRZEDMIOTEM DOWODU.
//  1. Treść pochodzi ze SŁOWNIKA (`realT("pl")` + nakładka `@/lib/i18n-careers`),
//     nie z literałów w teście: nagłówki, podtytuł, podpowiedź, etykieta
//     „W praktyce", cztery zasady (title/body/proof) i sześć benefitów
//     (title/body). Usunięcie klucza ze słownika oblewa ten plik.
//  2. Spotlight jest sterowalny myszą I klawiaturą (Radix Tabs, `activationMode
//     ="manual"`): mousedown i Enter zmieniają zasadę, sam focus jej NIE zmienia.
//  3. Auto-rotacja co 5 s biegnie WYŁĄCZNIE gdy: sekcja jest w viewporcie, karta
//     widoczna, kursor poza kartą, użytkownik nie wszedł w interakcję i nie ma
//     `prefers-reduced-motion`. Każdy z tych pięciu warunków ma osobny test na
//     zatrzymanie i (tam, gdzie to stan przemijający) na wznowienie.
//  4. Rotacja zawija się modulo długość listy (czwarta zasada -> pierwsza).
//  5. Interakcja zatrzymuje auto-pokaz NA STAŁE — powrót do viewportu go nie
//     wznawia.
//  6. `CareerReveal` odsłania kafle dopiero po wejściu w viewport, przesuwa
//     start staggeru o `index * 70ms` i PRZYCINA go do ósmego kafla, a bez
//     IntersectionObservera odsłania treść od razu (crawler / brak JS).
//  7. `CareerBenefitTile` renderuje dokładnie to, co dostał (ikona jako
//     `aria-hidden`, tytuł jako nagłówek, treść jako akapit) i scala `className`
//     wywołującego z klasami bazowymi.
//  8. `CareerStat`: przy ograniczonym ruchu, przy braku IntersectionObservera
//     i przy wartości nienumerycznej albo zerowej użytkownik widzi WARTOŚĆ
//     KOŃCOWĄ; przy dostępnej animacji licznik jedzie 0 -> cel przez
//     `easeOutCubic` (klatki liczone ręcznie, więc easing jest sprawdzony
//     liczbą, nie „czy się ruszyło"), sufiks („%", „x") NIE jest animowany,
//     a odmontowanie w trakcie odliczania anuluje zaplanowaną klatkę.
//  9. Brak naruszeń axe na obu powierzchniach (sekcja zasad, atom liczby
//     w rodzicu `<dl>`).
//
// CO JEST ATRAPOWANE I DLACZEGO.
//  * `react-i18next` — atrapa Z PRAWDZIWYM `t` z `@/test/i18nReal`. Fabryka
//    `vi.mock` jest SYNCHRONICZNA i nic nie importuje: udokumentowany skrót
//    `async () => (await import("@/test/i18nReal")).reactI18nextMock("pl")`
//    zakleszcza plik, bo `@/test/i18nReal` -> `@/lib/i18n` -> `react-i18next`,
//    czyli moduł właśnie mockowany (ten sam wniosek stoi w nagłówkach
//    `ConsentsPanel.test.tsx` i `ReputationLevelChip.test.tsx`). Prawdziwy
//    `realT` wjeżdża zwykłym importem i jest wstrzykiwany do atrapy po
//    rozwiązaniu modułów — więc ŻADEN napis w asercjach nie pochodzi z atrapy
//    tłumacza. Granica atrapy = `react-i18next` ma własny dowód u siebie,
//    słownik ma dowód parzystości w `src/lib/careers/__tests__/roles.test.ts`.
//  * `IntersectionObserver` — klasa sterowalna. Powód nie jest wygodą:
//    IntersectionObserver happy-doma NIGDY nie wywołuje callbacku, więc bez
//    tej atrapy `inView` zostaje na `false` i CAŁA logika po wejściu w viewport
//    (rotacja, odsłanianie, odliczanie) jest niemierzalna — dokładnie tak
//    powstało wejściowe 8/21 w `CareerStat`. Test decyduje, KIEDY i z jakim
//    `isIntersecting` obserwator strzela.
//  * `requestAnimationFrame` / `cancelAnimationFrame` — kolejka klatek
//    wykonywana ręcznie z podanym timestampem, plus `performance.now`.
//    Bez tego easing jest niedeterministyczny i test mierzyłby zegar maszyny,
//    a nie funkcję `easeOutCubic`.
//  * `setInterval` / `clearInterval` — tylko w testach auto-rotacji
//    (`controlledIntervals()`), żeby dowieść ISTNIENIA i USUNIĘCIA timera oraz
//    jego okresu (5000 ms), a nie „coś się po chwili zmieniło". Atrapa nie
//    obejmuje testu axe, który korzysta z prawdziwych zegarów.
//  * `window.matchMedia` — jedyne wejście `prefers-reduced-motion`.
//
// CO ZOSTAJE PRAWDZIWE. Prawdziwy React (stan, efekty, sprzątanie), prawdziwy
// Radix Tabs (role `tab`/`tablist`/`tabpanel`, aria-selected, Presence
// odmontowująca nieaktywne panele), prawdziwy `useInView`, prawdziwy
// `parseStatValue`/`easeOutCubic`, prawdziwy `cn`, prawdziwy słownik i prawdziwe
// axe-core. Zaatrapowanie któregokolwiek z nich zamieniłoby ten plik w test
// atrapy: „czy klik zmienia zasadę" jest pytaniem o Radix + stan, a „czy licznik
// dochodzi do 45" pytaniem o `easeOutCubic`, więc oba muszą być prawdziwe.
//
// ŚWIADOMIE POZA ZAKRESEM (i gdzie mieszka tamten dowód).
//  * Parser wartości i krzywa easingu jako funkcje czyste — `src/lib/careers/`
//    (`stats.ts`); tutaj sprawdzamy tylko, że atom ich UŻYWA i z jakim skutkiem.
//  * Reguła CSS `crs-reveal` (`@media (scripting: enabled)` + brak
//    `prefers-reduced-motion`) mieszka w `styles.css`; happy-dom nie liczy
//    kaskady, więc atom dowodzi wyłącznie klas i zmiennej `--crs-delay`.
//  * Kontrast barw — `axeViolations` wyłącza `color-contrast` (brak silnika
//    malowania w happy-dom, patrz `@/test/axe`).
//  * Osadzenie sekcji w trasie i SEO — `src/routes/zatrudniamy.tsx` i jej test.
//  * FAŁSZYWA strona straży `typeof window !== "undefined"` (obie funkcje
//    `prefersReducedMotion`: CareersValues@49, CareerStat@15) i
//    `typeof document !== "undefined"` (interwał rotacji, CareersValues@67).
//    Tych stanów nie da się osiągnąć UCZCIWIE w tej warstwie: środowisko to
//    `happy-dom`, więc `window` i `document` istnieją zawsze, a ich wyzerowanie
//    (`vi.stubGlobal("window", undefined)`) wywróciłoby sam renderer i mierzyło
//    atrapę środowiska, nie komponent. Ich sens (SSR bez `window`) sprawdza
//    render serwerowy trasy, nie test jednostkowy z DOM-em. Nic z pomiaru to
//    nie zabiera: V8 nie wystawia dla tych straży osobnej gałęzi, a ZMIERZONE
//    pokrycie tego wycinka po tym pliku to 51/51 linii, 20/20 funkcji,
//    35/35 gałęzi, 58/58 instrukcji. Odpowiadające im gałęzie, które DA się
//    postawić — `typeof window.matchMedia === "function"` w obie strony
//    i `typeof IntersectionObserver === "undefined"` w obie strony — mają tu
//    własne testy.
//
// ZNALEZISKO (defekt produkcyjny, zachowanie ISTNIEJĄCE zaasertowane niżej).
// `CareerStat` odlicza dokładnie RAZ na cykl życia komponentu: `startedRef`
// nigdy nie wraca do `false`, a `display` trzyma ostatnią wyliczoną liczbę.
// Skutek: zmiana propsa `value` PO pierwszym wejściu w viewport nie odświeża
// liczby — atom pokazuje starą wartość przy nowym sufiksie/etykiecie. Na
// `/zatrudniamy` jest to defekt UŚPIONY, bo wartości pochodzą ze statycznego
// słownika i nie zmieniają się w trakcie życia strony; obudzi się w dniu, w
// którym liczby zaczną płynąć z bazy (np. „otwartych rekrutacji: N" z
// `admin.hiring`). Testy „ZNALEZISKO" niżej przypinają stan istniejący, żeby
// naprawa była widoczna jako zmiana testu, a nie cicha zmiana zachowania.
//
// RODO. Żadnych prawdziwych osób ani treści: wszystkie napisy pochodzą ze
// słownika produktu albo są jawnie zmyślone; nie ma tu adresów e-mail,
// nazwisk ani danych kandydatów (formularz aplikacyjny ma własny plik).
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { LucideIcon } from "lucide-react";

/** Stan atrap trzymany tak, jak w całym repo — hoistowany obiekt. */
const h = vi.hoisted(() => ({
  /** Prawdziwy `getFixedT("pl")`, wstrzyknięty poniżej (fabryka nic nie importuje). */
  t: null as null | (() => unknown),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.t?.(), i18n: { language: "pl" }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));

import { axeViolations, summarize } from "@/test/axe";
import { realT } from "@/test/i18nReal";
// Nakładka słownika rejestruje się efektem ubocznym importu. Komponenty
// sekcji jej NIE importują (robi to trasa), więc plik testu musi ją dociągnąć
// sam — inaczej `realT` zwracałby same klucze i asercje mierzyłyby nic.
import "@/lib/i18n-careers";
import { CareerReveal } from "@/components/careers/atoms/CareerReveal";
import { CareerStat } from "@/components/careers/atoms/CareerStat";
import { CareerBenefitTile } from "@/components/careers/molecules/CareerBenefitTile";
import { CareersValues } from "@/components/careers/organisms/CareersValues";

h.t = () => realT("pl");
const t = realT("pl");

/**
 * Klucze zasad i benefitów WPISANE TU JESZCZE RAZ, a nie zaimportowane
 * z `CareersValues.tsx`. Lista zaczytana z pliku będącego przedmiotem dowodu
 * przechodzi każde jej okrojenie: usunięcie zasady „europe" z komponentu
 * przeszłoby test „renderuje wszystkie zasady", gdyby test pytał komponent
 * o to, ile ich ma być. Kolejność jest znacząca — na niej stoi dowód rotacji.
 */
const VALUE_KEYS = ["evidence", "ownership", "craft", "europe"] as const;
const BENEFIT_KEYS = ["flexible", "remote", "warsaw", "impact", "byline", "network"] as const;
/** Okres auto-pokazu z `CareersValues` (AUTO_ADVANCE_MS). */
const AUTO_ADVANCE_MS = 5000;
/** Czas odliczania z `CareerStat` (COUNT_MS). */
const COUNT_MS = 1400;

// --- Sterowalny IntersectionObserver -----------------------------------------
type IOEntry = { isIntersecting: boolean };
type IOCallback = (entries: IOEntry[]) => void;

const io = {
  callbacks: [] as IOCallback[],
  observed: [] as Element[],
  inits: [] as (IntersectionObserverInit | undefined)[],
  disconnects: 0,
};

class ControlledIO {
  private readonly cb: IOCallback;
  constructor(cb: IntersectionObserverCallback, init?: IntersectionObserverInit) {
    this.cb = cb as unknown as IOCallback;
    io.callbacks.push(this.cb);
    io.inits.push(init);
  }
  observe(node: Element): void {
    io.observed.push(node);
  }
  unobserve(): void {}
  disconnect(): void {
    io.disconnects += 1;
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

function installIO(): void {
  io.callbacks = [];
  io.observed = [];
  io.inits = [];
  io.disconnects = 0;
  vi.stubGlobal("IntersectionObserver", ControlledIO as unknown as typeof IntersectionObserver);
}

/** Strzela WSZYSTKIMI obserwatorami zamontowanego drzewa. */
function intersect(isIntersecting = true): void {
  act(() => {
    for (const cb of [...io.callbacks]) cb([{ isIntersecting }]);
  });
}

// --- Sterowalna kolejka klatek animacji ---------------------------------------
const raf = {
  queue: [] as FrameRequestCallback[],
  requested: 0,
  cancelled: [] as number[],
};

function installRaf(): void {
  raf.queue = [];
  raf.requested = 0;
  raf.cancelled = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    raf.queue.push(cb);
    raf.requested += 1;
    return raf.requested;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    raf.cancelled.push(id);
  });
}

/** Wykonuje zaplanowane klatki z podanym znacznikiem czasu. */
function flushFrame(nowMs: number): void {
  const pending = raf.queue;
  raf.queue = [];
  act(() => {
    for (const cb of pending) cb(nowMs);
  });
}

// --- Sterowalne interwały (auto-rotacja) --------------------------------------
type Registered = { id: number; ms: number; cb: () => void };
const intervals = { registered: [] as Registered[], cleared: [] as number[] };

/**
 * Podmienia `setInterval`/`clearInterval`, żeby okres i sprzątanie timera dały
 * się zaasertować liczbą. ŚWIADOMIE nie jest to `beforeEach`: `waitFor` z RTL
 * i część narzędzi biegnie na prawdziwym `setInterval`, więc atrapa wchodzi
 * tylko do testów, które naprawdę dowodzą timera.
 */
function controlledIntervals(): void {
  intervals.registered = [];
  intervals.cleared = [];
  vi.stubGlobal("setInterval", (cb: () => void, ms: number) => {
    const id = intervals.registered.length + 1;
    intervals.registered.push({ id, ms, cb });
    return id;
  });
  vi.stubGlobal("clearInterval", (id: number) => {
    intervals.cleared.push(id);
  });
}

/** Odpala najnowszy zarejestrowany interwał (jedno „tyknięcie" auto-pokazu). */
function tickInterval(): void {
  const latest = intervals.registered.at(-1);
  if (!latest) throw new Error("Auto-rotacja nie zarejestrowała żadnego interwału");
  act(() => {
    latest.cb();
  });
}

// --- prefers-reduced-motion ---------------------------------------------------
/** `matches` dla zapytania `prefers-reduced-motion`; `null` = brak matchMedia. */
function installMatchMedia(reduced: boolean | null): void {
  if (reduced === null) {
    vi.stubGlobal("matchMedia", undefined);
    return;
  }
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: query.includes("prefers-reduced-motion") ? reduced : false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Nazwa aktualnie wybranej zasady (Radix trzyma jedną `aria-selected`). */
function selectedTabName(): string {
  return screen.getByRole("tab", { selected: true }).textContent ?? "";
}

function renderValues(options: { reduced?: boolean | null } = {}) {
  installIO();
  installMatchMedia(options.reduced ?? false);
  return render(<CareersValues />);
}

describe("CareersValues: treść sekcji zasad i benefitów pochodzi ze słownika", () => {
  it("renderuje nagłówki, podpowiedź i wszystkie cztery zasady jako zakładki", () => {
    renderValues({ reduced: true });

    expect(
      screen.getByRole("heading", { level: 2, name: t("careers.values.title") }),
    ).toBeVisible();
    expect(screen.getByText(t("careers.values.subtitle"))).toBeVisible();
    expect(screen.getByText(t("careers.values.hint"))).toBeVisible();

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(
      VALUE_KEYS.map((key) => t(`careers.values.items.${key}.title`)),
    );
    // Napisy MUSZĄ być tłumaczeniami, nie kluczami — inaczej test przechodziłby
    // także po wypadnięciu nakładki `@/lib/i18n-careers` z importów.
    for (const key of VALUE_KEYS) {
      expect(t(`careers.values.items.${key}.title`)).not.toBe(`careers.values.items.${key}.title`);
    }
  });

  it("pierwsza zasada jest wybrana i pokazuje swój dowód „W praktyce”", () => {
    renderValues({ reduced: true });

    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAttribute("data-state", "active");
    expect(
      screen.getByRole("heading", { level: 3, name: t("careers.values.items.evidence.title") }),
    ).toBeVisible();
    expect(screen.getByText(t("careers.values.items.evidence.body"))).toBeVisible();
    expect(screen.getByText(t("careers.values.proofLabel"))).toBeVisible();
    expect(screen.getByText(t("careers.values.items.evidence.proof"))).toBeVisible();

    // Radix odmontowuje nieaktywne panele — treść pozostałych zasad NIE jest
    // w DOM, więc czytnik ekranu nie czyta czterech manifestów naraz.
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(screen.queryByText(t("careers.values.items.europe.proof"))).toBeNull();
  });

  it("renderuje sześć kafli benefitów z tytułem i treścią ze słownika", () => {
    const { container } = renderValues({ reduced: true });

    expect(
      screen.getByRole("heading", { level: 3, name: t("careers.benefits.title") }),
    ).toBeVisible();
    expect(screen.getByText(t("careers.benefits.subtitle"))).toBeVisible();

    const tiles = container.querySelectorAll("article");
    expect(tiles).toHaveLength(BENEFIT_KEYS.length);
    for (const key of BENEFIT_KEYS) {
      expect(
        screen.getByRole("heading", { level: 3, name: t(`careers.benefits.items.${key}.title`) }),
      ).toBeVisible();
      expect(screen.getByText(t(`careers.benefits.items.${key}.body`))).toBeVisible();
    }
  });

  it("nie ma naruszeń axe (zakładki, panel, siatka kafli)", async () => {
    const { container } = renderValues({ reduced: true });
    intersect(true);
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("CareersValues: wybór zasady myszą i klawiaturą", () => {
  it("mousedown na zakładce podmienia panel na jej treść i dowód", () => {
    renderValues({ reduced: true });

    fireEvent.mouseDown(screen.getByRole("tab", { name: t("careers.values.items.europe.title") }));

    expect(selectedTabName()).toBe(t("careers.values.items.europe.title"));
    expect(screen.getByText(t("careers.values.items.europe.body"))).toBeVisible();
    expect(screen.getByText(t("careers.values.items.europe.proof"))).toBeVisible();
    expect(screen.queryByText(t("careers.values.items.evidence.proof"))).toBeNull();
  });

  it("Enter na zakładce wybiera zasadę (obsługa z klawiatury, bez myszy)", () => {
    renderValues({ reduced: true });

    fireEvent.keyDown(screen.getByRole("tab", { name: t("careers.values.items.craft.title") }), {
      key: "Enter",
    });

    expect(selectedTabName()).toBe(t("careers.values.items.craft.title"));
    expect(screen.getByText(t("careers.values.items.craft.proof"))).toBeVisible();
  });

  it('sam focus NIE zmienia zasady (activationMode="manual")', () => {
    renderValues({ reduced: true });

    fireEvent.focusIn(screen.getByRole("tab", { name: t("careers.values.items.europe.title") }));

    // Przewijanie zakładek strzałkami nie ma prawa przerzucać treści panelu
    // pod czytnikiem ekranu — wybór należy do użytkownika, nie do focusu.
    expect(selectedTabName()).toBe(t("careers.values.items.evidence.title"));
  });
});

describe("CareersValues: auto-pokaz zasad ma zapraszać, nie walczyć o kursor", () => {
  it("poza viewportem nie rejestruje w ogóle timera rotacji", () => {
    controlledIntervals();
    renderValues();

    // Sekcja zamontowana, obserwatory założone (karta spotlightu + sześć
    // kafli), ale żaden nie strzelił — rotacja nie ma prawa biec „w tle"
    // pod nieprzeczytaną sekcją.
    expect(io.observed).toHaveLength(1 + BENEFIT_KEYS.length);
    expect(intervals.registered).toEqual([]);

    // Karta spotlightu ma WŁASNY próg 0,35: rotacja startuje, gdy sekcja jest
    // naprawdę czytana, a nie gdy wjedzie w kadr jednopikselowym paskiem.
    const thresholds = io.inits.map((init) => init?.threshold);
    expect(thresholds.filter((value) => value === 0.35)).toHaveLength(1);
  });

  it("wejście w viewport startuje rotację co 5 s i zawija ją modulo listę", () => {
    controlledIntervals();
    renderValues();
    intersect(true);

    expect(intervals.registered).toHaveLength(1);
    expect(intervals.registered[0].ms).toBe(AUTO_ADVANCE_MS);

    // Cztery tyknięcia = pełne kółko po zasadach i powrót do pierwszej.
    for (const key of ["ownership", "craft", "europe", "evidence"] as const) {
      tickInterval();
      expect(selectedTabName()).toBe(t(`careers.values.items.${key}.title`));
    }
  });

  it("wyjście sekcji z viewportu gasi timer, powrót zakłada nowy", () => {
    controlledIntervals();
    renderValues();
    intersect(true);
    const firstId = intervals.registered[0].id;

    intersect(false);
    expect(intervals.cleared).toContain(firstId);
    expect(intervals.registered).toHaveLength(1);

    intersect(true);
    expect(intervals.registered).toHaveLength(2);
    expect(intervals.registered[1].ms).toBe(AUTO_ADVANCE_MS);
  });

  it("ukryta karta przeglądarki wstrzymuje rotację, powrót ją odwiesza", () => {
    controlledIntervals();
    renderValues();
    intersect(true);

    const original = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState");
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    try {
      tickInterval();
      // Timer tyka dalej (nie ma po co go kasować), ale zasada się NIE zmienia:
      // inaczej wracający użytkownik zastaje sekcję przewiniętą o kilka pozycji.
      expect(selectedTabName()).toBe(t("careers.values.items.evidence.title"));

      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      tickInterval();
      expect(selectedTabName()).toBe(t("careers.values.items.ownership.title"));
    } finally {
      if (original) Object.defineProperty(document, "visibilityState", original);
      else
        Reflect.deleteProperty(document as unknown as Record<string, unknown>, "visibilityState");
    }
  });

  it("kursor na karcie wstrzymuje rotację, zjechanie kursorem ją wznawia", () => {
    controlledIntervals();
    renderValues();
    intersect(true);
    const firstId = intervals.registered[0].id;

    // React wyprowadza `onMouseEnter`/`onMouseLeave` z par mouseover/mouseout,
    // więc gest użytkownika odtwarzamy zdarzeniami, które naprawdę lecą z DOM.
    fireEvent.mouseOver(screen.getByRole("tablist"));
    expect(intervals.cleared).toContain(firstId);
    expect(intervals.registered).toHaveLength(1);

    fireEvent.mouseOut(screen.getByRole("tablist"));
    expect(intervals.registered).toHaveLength(2);
  });

  it("wybór zasady zatrzymuje auto-pokaz NA STAŁE — powrót do viewportu go nie wznawia", () => {
    controlledIntervals();
    renderValues();
    intersect(true);
    const firstId = intervals.registered[0].id;

    fireEvent.mouseDown(screen.getByRole("tab", { name: t("careers.values.items.craft.title") }));
    expect(intervals.cleared).toContain(firstId);
    expect(intervals.registered).toHaveLength(1);

    // Wyjście i powrót sekcji przelicza efekt, ale `interacted` już stoi.
    intersect(false);
    intersect(true);
    expect(intervals.registered).toHaveLength(1);
    expect(selectedTabName()).toBe(t("careers.values.items.craft.title"));
  });

  it("focus w liście zakładek też zatrzymuje auto-pokaz (nawigacja klawiaturą)", () => {
    controlledIntervals();
    renderValues();
    intersect(true);
    const firstId = intervals.registered[0].id;

    fireEvent.focusIn(screen.getByRole("tab", { name: t("careers.values.items.ownership.title") }));

    expect(intervals.cleared).toContain(firstId);
    expect(intervals.registered).toHaveLength(1);
    // Focus nie wybrał zasady, ale zatrzymał rotację: czytający strzałkami
    // nie może stracić panelu pod palcami.
    expect(selectedTabName()).toBe(t("careers.values.items.evidence.title"));
  });

  it("prefers-reduced-motion wyłącza rotację całkowicie", () => {
    controlledIntervals();
    renderValues({ reduced: true });
    intersect(true);

    expect(intervals.registered).toEqual([]);
    // Bez rotacji sekcja NADAL jest w pełni użyteczna — zasada pierwsza
    // widoczna, pozostałe do wyboru.
    expect(selectedTabName()).toBe(t("careers.values.items.evidence.title"));
    expect(screen.getAllByRole("tab")).toHaveLength(VALUE_KEYS.length);
  });

  it("brak window.matchMedia nie jest traktowany jak ograniczony ruch", () => {
    controlledIntervals();
    renderValues({ reduced: null });
    intersect(true);

    expect(intervals.registered).toHaveLength(1);
    tickInterval();
    expect(selectedTabName()).toBe(t("careers.values.items.ownership.title"));
  });
});

describe("CareerReveal: odsłanianie przy scrollu", () => {
  it("poza viewportem ma tylko klasę bazową, wejście dokłada crs-reveal--in", () => {
    installIO();
    const { container } = render(
      <CareerReveal className="h-full">
        <p>Kafel dowodowy</p>
      </CareerReveal>,
    );
    const wrapper = container.firstElementChild as HTMLElement;

    expect(wrapper.className).toContain("crs-reveal");
    expect(wrapper.className).not.toContain("crs-reveal--in");
    // `className` wywołującego nie ginie w scaleniu.
    expect(wrapper.className).toContain("h-full");

    intersect(true);
    expect(wrapper.className).toContain("crs-reveal--in");

    // Atom NIE przekazuje `once`, czyli bierze domyślne `once: true`:
    // obserwator rozłącza się po pierwszym wejściu, więc odsłonięta treść
    // nigdy się nie chowa przy przewijaniu w drugą stronę.
    expect(io.disconnects).toBe(1);
    intersect(false);
    expect(wrapper.className).toContain("crs-reveal--in");
  });

  it("index przesuwa start staggeru o 70 ms i jest przycięty do ósmego kafla", () => {
    installIO();
    const { container } = render(
      <>
        <CareerReveal>
          <p>bez indeksu</p>
        </CareerReveal>
        <CareerReveal index={3}>
          <p>czwarty</p>
        </CareerReveal>
        <CareerReveal index={12}>
          <p>trzynasty</p>
        </CareerReveal>
      </>,
    );

    const delays = [...container.querySelectorAll<HTMLElement>(".crs-reveal")].map((el) =>
      el.style.getPropertyValue("--crs-delay"),
    );
    // Domyślny `index = 0` -> brak opóźnienia; 3 -> 210 ms; 12 -> przycięte do
    // 8 * 70 ms, żeby dwudziesty kafel nie startował po 1,4 s od scrolla.
    expect(delays).toEqual(["0ms", "210ms", "560ms"]);
  });

  it("bez IntersectionObservera treść jest odsłonięta od razu (crawler / brak JS)", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const { container } = render(
      <CareerReveal index={2}>
        <p>Kafel dowodowy</p>
      </CareerReveal>,
    );

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("crs-reveal--in");
    expect(screen.getByText("Kafel dowodowy")).toBeVisible();
  });
});

describe("CareerBenefitTile: kafel renderuje to, co dostał", () => {
  /**
   * Zmyślona ikona — tożsamość ikony jest sprawą wywołującego, nie kafla.
   * Przepuszcza WSZYSTKIE propsy, żeby dało się zaasertować, co kafel jej
   * naprawdę podaje (`aria-hidden`, rozmiar).
   */
  const StubIcon = ((props: Record<string, unknown>) => (
    <svg data-testid="ikona-benefitu" {...props} />
  )) as unknown as LucideIcon;

  it("pokazuje tytuł jako nagłówek, treść jako akapit, a ikonę ukrywa przed czytnikiem", () => {
    const { container } = render(
      <CareerBenefitTile
        icon={StubIcon}
        title="Zdalnie lub hybrydowo"
        body="Godziny ustalasz z zespołem."
        className="h-full"
      />,
    );

    const tile = container.querySelector("article");
    expect(tile).not.toBeNull();
    expect(screen.getByRole("heading", { level: 3, name: "Zdalnie lub hybrydowo" })).toBeVisible();
    expect(screen.getByText("Godziny ustalasz z zespołem.")).toBeVisible();
    // `className` wywołującego scalony z klasami bazowymi (a nie zamiast nich).
    expect(tile?.className).toContain("h-full");
    expect(tile?.className).toContain("border-border/70");
    // Ikona jest dekoracją: nazwa kafla to jego tytuł, nie „obraz".
    const icon = screen.getByTestId("ikona-benefitu");
    expect(icon).toHaveAttribute("aria-hidden");
    expect(icon.getAttribute("class")).toBe("h-[18px] w-[18px]");
  });

  it("nie ma naruszeń axe", async () => {
    const { container } = render(
      <CareerBenefitTile
        icon={StubIcon}
        title="Sieć i wydarzenia"
        body="Dostęp od pierwszego dnia."
      />,
    );
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("CareerStat: liczba dowodowa nigdy nie pokazuje zera zamiast wyniku", () => {
  function renderStat(
    value: string,
    options: { reduced?: boolean | null; noIO?: boolean; label?: string } = {},
  ) {
    installRaf();
    installMatchMedia(options.reduced ?? false);
    if (options.noIO) vi.stubGlobal("IntersectionObserver", undefined);
    else installIO();
    vi.spyOn(performance, "now").mockReturnValue(1000);
    const label = options.label ?? "osób w zespole";
    const utils = render(
      <dl>
        <CareerStat value={value} label={label} />
      </dl>,
    );
    const rerender = (next: string) =>
      utils.rerender(
        <dl>
          <CareerStat value={next} label={label} />
        </dl>,
      );
    return { ...utils, rerender };
  }

  it("prefers-reduced-motion pokazuje WARTOŚĆ KOŃCOWĄ, nie zero", () => {
    renderStat("45", { reduced: true });
    intersect(true);

    // To jest sedno dostępności tego atomu: wyłączony ruch nie może zamienić
    // „45 osób w zespole" w „0 osób w zespole".
    expect(screen.getByText("45")).toBeVisible();
    expect(raf.requested).toBe(0);
  });

  it("brak IntersectionObservera pokazuje wartość końcową od razu (SSR / crawler)", () => {
    renderStat("45", { noIO: true });

    expect(screen.getByText("45")).toBeVisible();
    expect(raf.requested).toBe(0);
  });

  it("w viewporcie odlicza 0 -> cel po krzywej easeOutCubic", () => {
    renderStat("45");

    // Przed wejściem w viewport stoi wartość końcowa (brak animacji = brak
    // regresu treści), dopiero start odliczania zeruje licznik.
    expect(screen.getByText("45")).toBeVisible();

    intersect(true);
    expect(screen.getByText("0")).toBeVisible();
    expect(raf.requested).toBe(1);

    // Połowa czasu: easeOutCubic(0.5) = 0.875 -> round(45 * 0.875) = 39.
    flushFrame(1000 + COUNT_MS / 2);
    expect(screen.getByText("39")).toBeVisible();
    expect(raf.requested).toBe(2);

    // Koniec: progress = 1 -> dokładnie cel i ŻADNEJ kolejnej klatki.
    flushFrame(1000 + COUNT_MS);
    expect(screen.getByText("45")).toBeVisible();
    expect(raf.requested).toBe(2);
    expect(raf.queue).toEqual([]);
  });

  it("sufiks nie jest animowany — „%” stoi przy każdej klatce", () => {
    renderStat("100%", { label: "ról z pracą zdalną" });
    intersect(true);

    expect(screen.getByText("0%")).toBeVisible();
    flushFrame(1000 + COUNT_MS / 2);
    expect(screen.getByText("88%")).toBeVisible();
    flushFrame(1000 + COUNT_MS);
    expect(screen.getByText("100%")).toBeVisible();
  });

  it("brak window.matchMedia nie blokuje odliczania", () => {
    renderStat("3x", { reduced: null, label: "wzrost zespołu" });
    intersect(true);

    expect(screen.getByText("0x")).toBeVisible();
    flushFrame(1000 + COUNT_MS);
    expect(screen.getByText("3x")).toBeVisible();
  });

  it("wartość nienumeryczna renderuje się dosłownie i bez animacji", () => {
    renderStat("wkrótce", { label: "nowe biuro" });
    intersect(true);

    expect(screen.getByText("wkrótce")).toBeVisible();
    expect(raf.requested).toBe(0);
  });

  it("zero nie uruchamia odliczania (nie ma czego odliczać)", () => {
    renderStat("0%", { label: "ról bez pracy zdalnej" });
    intersect(true);

    expect(screen.getByText("0%")).toBeVisible();
    expect(raf.requested).toBe(0);
  });

  it("odmontowanie w trakcie odliczania anuluje zaplanowaną klatkę", () => {
    const { unmount } = renderStat("45");
    intersect(true);
    expect(raf.requested).toBe(1);

    unmount();

    // Bez tego pętla dopisywałaby stan do odmontowanego drzewa przy każdym
    // przejściu użytkownika przez sekcję.
    expect(raf.cancelled).toEqual([1]);
  });

  it("etykieta i liczba tworzą poprawną parę <dt>/<dd>", () => {
    const { container } = renderStat("9", { label: "krajów, z których pracujemy" });

    const dt = container.querySelector("dt");
    const dd = container.querySelector("dd");
    expect(dt?.textContent).toBe("krajów, z których pracujemy");
    expect(dd?.textContent).toBe("9");
  });

  it("nie ma naruszeń axe wewnątrz rodzica <dl>", async () => {
    const { container } = renderStat("45");
    intersect(true);
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("ZNALEZISKO: zmiana wartości po zakończonym odliczaniu NIE odświeża liczby", () => {
    const { rerender } = renderStat("45");
    intersect(true);
    flushFrame(1000 + COUNT_MS);
    expect(screen.getByText("45")).toBeVisible();

    rerender("9");

    // STAN ISTNIEJĄCY (defekt uśpiony, opisany w nagłówku): `startedRef` nie
    // wraca do `false`, a `display` trzyma 45, więc atom pokazuje starą liczbę
    // przy nowym propsie. Zmiana tej asercji będzie oznaczać naprawę.
    expect(screen.getByText("45")).toBeVisible();
    expect(screen.queryByText("9")).toBeNull();
    // Nowa wartość nie zaplanowała ani jednej klatki — efekt wyszedł na
    // `startedRef.current` i nie dotknął już `display`.
    expect(raf.requested).toBe(1);
    expect(raf.queue).toEqual([]);
  });

  it("ZNALEZISKO: przejście z wartości nienumerycznej na liczbę pokazuje cel bez animacji", () => {
    const { rerender } = renderStat("wkrótce", { label: "nowe biuro" });
    intersect(true);
    expect(screen.getByText("wkrótce")).toBeVisible();

    rerender("45");

    // `display` został `null` (nie było czego odliczać), więc render spada na
    // `display ?? target` i pokazuje wartość końcową. Tu brak animacji jest
    // akurat pożądany — ale wynika z tej samej jednorazowości, co defekt wyżej.
    expect(screen.getByText("45")).toBeVisible();
    expect(raf.requested).toBe(0);
  });
});
