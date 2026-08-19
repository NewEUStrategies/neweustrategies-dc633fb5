// Wiersz dossier: wspólny szkielet KAŻDEJ pozycji strumienia klubu (grzbiet +
// treść + metryki) oraz cztery eksporty, które rozdają kolor rodzaju.
//
// CO TO DOWODZI.
// (1) STRUKTURA WIERSZA. Ton rodzaju jedzie do DOM-u (`data-tone`), metryki są
//     opisane dla czytnika ekranu, a akcje (`footer`) NIE znikają z DOM-u przy
//     braku najazdu - inaczej klawiatura nie mogłaby ich osiągnąć.
// (2) TON RODZAJU JEST INFORMACJĄ, NIE OZDOBĄ. `clubDossierSpineClass`,
//     `clubDossierToneColor` i `clubDossierIconBoxClass` muszą dla KAŻDEGO
//     z 11 tonów zwrócić wartość niepustą i RÓŻNĄ od wartości pozostałych
//     tonów. Gdyby ktoś skleił dwa rodzaje w jeden odcień (albo zgubił wpis
//     w `Record`), pion listy przestałby się skanować wzrokiem i trzeba by go
//     CZYTAĆ - czyli dokładnie to, przed czym broni nagłówek
//     `ClubDossierRow.tsx`. Sam `Record<ClubDossierTone, string>` pilnuje
//     tylko tego, że COŚ tam jest, nie tego, że to COŚ jest odróżnialne.
// (3) DEGRADACJA NIEZNANEGO RODZAJU WĄTKU. `clubThreadTone` dostaje `string`
//     wprost z bazy, więc starszy albo obcy rodzaj musi spaść na neutralny
//     `thread`, a nie wywrócić kolorystykę listy. Tabela jedzie przez wszystkie
//     znane rodzaje oraz `null`, `undefined`, `""` i wartość spoza zbioru -
//     bez rzutowania, bo sygnatura `string | null | undefined` to dopuszcza.
// (4) WARIANTY WIERSZA SĄ ROZŁĄCZNE. `glow="none"` nie wolno dokładać reakcji
//     krawędzi na najazd i fokus, a `aura`/`sweep`/`rim` muszą ją dokładać;
//     `headline` i `inline` to dwa różne tytuły; brak `meta`, `excerpt`,
//     `children`, `footer` i `metrics` nie zostawia po sobie pustych
//     kontenerów (każde jako osobna gałąź, z propem i bez).
// (5) `ClubDossierKind` bierze kolor z `--dossier-tone` ustawionego PRZEZ
//     WIERSZ, więc etykieta rodzaju i grzbiet nie mogą się rozjechać.
// (6) `ClubDossierMetrics` znika CAŁE, gdy nie ma czego pokazać (zero metryk
//     i brak `trailing`), ale zostaje, gdy `trailing` jest podane - prawa
//     kolumna wyrównuje się przez całą listę, więc puste `<div>` przesuwałoby
//     siatkę sąsiednich wierszy.
//
// ZNALEZIONY BŁĄD (oznaczony `it.fails`, produkcji nie ruszamy na tym etapie).
//     `clubThreadTone("constructor")` zwraca FUNKCJĘ z `Object.prototype`,
//     bo `THREAD_TONES[kind] ?? "thread"` czyta też właściwości odziedziczone.
//     Szczegóły i propozycja naprawy - przy samym teście.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// (a) Nie testuje `cn`/`tailwind-merge` ani Tailwinda - to biblioteki i build.
//     Asercje idą na OBECNOŚĆ klasy warunkowej, bo to jest kontrakt
//     komponentu; happy-dom nie liczy CSS, więc samego efektu najazdu ani
//     poświaty nie da się tu zobaczyć i nie udajemy, że się da.
// (b) Nie testuje tonu SPOZA unii `ClubDossierTone` dla trzech funkcji
//     klasowych - wymagałoby rzutowania, którego reguły repozytorium
//     zabraniają. Jedyne wejście przyjmujące surowy `string` to
//     `clubThreadTone` i TAM leży dowód degradacji.
// (c) Nie renderuje wiersza w pętli przez wszystkie 11 tonów: wiersz i
//     eksportowane funkcje czytają TEN SAM `Record`, więc wystarczy dowieść
//     tego raz (test „grzbiet i ikona wiersza pochodzą z tych samych map").
// (d) Nie testuje konsumentów wiersza (lista wątków, strona wątku, feed) ani
//     ich kluczy i18n - ten plik ma zero tłumaczeń, cała treść wchodzi propsem.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  ClubDossierKind,
  ClubDossierMetrics,
  ClubDossierRow,
  clubDossierIconBoxClass,
  clubDossierSpineClass,
  clubDossierToneColor,
  clubThreadTone,
  type ClubDossierGlow,
  type ClubDossierMetric,
  type ClubDossierTone,
} from "@/components/clubs/atoms/ClubDossierRow";

/** Klasy wszystkich elementów w poddrzewie - do sprawdzania gałęzi warunkowych. */
function klasyWszystkich(container: HTMLElement): readonly string[] {
  return Array.from(container.querySelectorAll("*")).map(
    (node) => node.getAttribute("class") ?? "",
  );
}

/** Czy w poddrzewie jest element, którego klasa zawiera dany fragment. */
function maFragmentKlasy(container: HTMLElement, fragment: string): boolean {
  return klasyWszystkich(container).some((klasa) => klasa.includes(fragment));
}

/** Element `<article>` wiersza - brak oznacza, że wiersz się nie wyrenderował. */
function wiersz(container: HTMLElement): HTMLElement {
  const article = container.querySelector("article");
  if (article === null) throw new Error("wiersz dossier nie wyrenderował się");
  return article;
}

/** Rodzic elementu - używane do sprawdzania opakowania tytułu. */
function rodzic(element: HTMLElement): HTMLElement {
  const parent = element.parentElement;
  if (parent === null) throw new Error("element nie ma rodzica");
  return parent;
}

describe("ClubDossierRow", () => {
  it("renderuje ton rodzaju, tytuł, akcje i opisane metryki", () => {
    render(
      <ClubDossierRow
        testId="row"
        tone="thread"
        icon={<span>i</span>}
        meta={<span>Dyskusja</span>}
        title={<h3>Bezpieczeństwo wschodniej flanki</h3>}
        excerpt="Streszczenie wątku"
        metrics={
          <ClubDossierMetrics
            metrics={[{ key: "replies", icon: <span>r</span>, value: 12, label: "12 odpowiedzi" }]}
          />
        }
        footer={<button type="button">Reaguj</button>}
      />,
    );

    const row = screen.getByTestId("row");
    expect(row.getAttribute("data-tone")).toBe("thread");
    expect(screen.getByRole("heading", { name: "Bezpieczeństwo wschodniej flanki" })).toBeTruthy();
    expect(screen.getByText("Streszczenie wątku")).toBeTruthy();
    expect(screen.getByText("12 odpowiedzi")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reaguj" })).toBeTruthy();
  });

  it("oznacza wiersz nieprzeczytany i przypięty bez zmiany struktury", () => {
    render(
      <ClubDossierRow
        testId="row"
        tone="post"
        unread
        pinned
        icon={<span>i</span>}
        meta={<span>Wpis</span>}
        title={<h3>Tytuł</h3>}
      />,
    );
    const row = screen.getByTestId("row");
    expect(row.className).toContain("border-primary/40");
    expect(row.getAttribute("data-tone")).toBe("post");
  });
});

// --- Ton rodzaju wątku -------------------------------------------------------

/**
 * Kanarek KOMPLETNOŚCI unii tonów. Gdy do `ClubDossierTone` dojdzie nowy ton,
 * ten `Record` przestanie się kompilować bez dopisania go tutaj, a test niżej
 * pilnuje, że tablica `WSZYSTKIE_TONY` (po której jadą tabele) zgadza się z tym
 * kompletem. Bez tego „tabela przez wszystkie tony" cicho pomijałaby nowy ton.
 */
const TONY_KOMPLET: Record<ClubDossierTone, true> = {
  thread: true,
  discussion: true,
  question: true,
  position: true,
  resource: true,
  announcement: true,
  poll: true,
  post: true,
  event: true,
  document: true,
  milestone: true,
};

const WSZYSTKIE_TONY: readonly ClubDossierTone[] = [
  "thread",
  "discussion",
  "question",
  "position",
  "resource",
  "announcement",
  "poll",
  "post",
  "event",
  "document",
  "milestone",
];

interface PrzypadekRodzaju {
  readonly etykieta: string;
  readonly kind: string | null | undefined;
  readonly oczekiwany: ClubDossierTone;
}

describe("clubThreadTone", () => {
  const ZNANE_RODZAJE: readonly PrzypadekRodzaju[] = [
    { etykieta: "discussion", kind: "discussion", oczekiwany: "discussion" },
    { etykieta: "question", kind: "question", oczekiwany: "question" },
    { etykieta: "position", kind: "position", oczekiwany: "position" },
    { etykieta: "resource", kind: "resource", oczekiwany: "resource" },
    { etykieta: "announcement", kind: "announcement", oczekiwany: "announcement" },
    { etykieta: "poll", kind: "poll", oczekiwany: "poll" },
  ];

  it.each(ZNANE_RODZAJE)("rodzaj $etykieta dostaje własny ton", ({ kind, oczekiwany }) => {
    expect(clubThreadTone(kind)).toBe(oczekiwany);
  });

  const DEGRADACJA: readonly PrzypadekRodzaju[] = [
    { etykieta: "null (brak kolumny w wierszu)", kind: null, oczekiwany: "thread" },
    { etykieta: "undefined (pole nie przyszło z RPC)", kind: undefined, oczekiwany: "thread" },
    { etykieta: "pusty napis (wartość fałszywa, ale prawidłowa)", kind: "", oczekiwany: "thread" },
    { etykieta: "rodzaj spoza zbioru", kind: "briefing", oczekiwany: "thread" },
    { etykieta: "rodzaj o innej wielkości liter", kind: "Question", oczekiwany: "thread" },
  ];

  it.each(DEGRADACJA)("$etykieta degraduje się do neutralnego `thread`", ({ kind, oczekiwany }) => {
    expect(clubThreadTone(kind)).toBe(oczekiwany);
  });

  // BŁĄD PRODUKCYJNY (etap 2 nie rusza produkcji, więc test jest `it.fails`).
  // `THREAD_TONES[kind] ?? "thread"` czyta też właściwości ODZIEDZICZONE z
  // `Object.prototype`, więc `kind === "constructor"` (albo „toString",
  // „valueOf", „hasOwnProperty") NIE trafia w `??` i funkcja zwraca FUNKCJĘ,
  // mimo że sygnatura obiecuje `ClubDossierTone`. Ta wartość leci dalej jako
  // klucz do `SPINE`/`ICON_BOX`/`TONE_COLOR`, gdzie daje `undefined` w klasie
  // i w `--dossier-tone` - czyli wiersz bez grzbietu i bez koloru. Kolumna
  // `kind` w bazie to zwykły tekst, więc taki wiersz da się zapisać.
  // Naprawa: `Object.hasOwn(THREAD_TONES, kind)` albo `THREAD_TONES` zbudowany
  // przez `Object.create(null)` / `Map`.
  it.fails("nazwa z prototypu obiektu NIE powinna być rodzajem wątku", () => {
    expect(clubThreadTone("constructor")).toBe("thread");
    expect(clubThreadTone("toString")).toBe("thread");
  });

  it("każdy zwrócony ton jest tonem znanym wierszowi", () => {
    // Bez tego `clubThreadTone` mógłby zwrócić ton, dla którego nie ma wpisu
    // w mapach grzbietu i ikony - czyli wiersz bez koloru.
    const zwrocone = [...ZNANE_RODZAJE, ...DEGRADACJA].map((przypadek) =>
      clubThreadTone(przypadek.kind),
    );
    for (const ton of zwrocone) {
      expect(WSZYSTKIE_TONY).toContain(ton);
    }
  });
});

// --- Kolor rodzaju jako klasa i jako wartość ---------------------------------

describe("mapy tonów rodzaju", () => {
  it("tabela testowa pokrywa CAŁĄ unię `ClubDossierTone`", () => {
    expect([...WSZYSTKIE_TONY].sort()).toEqual(Object.keys(TONY_KOMPLET).sort());
    expect(new Set(WSZYSTKIE_TONY).size).toBe(WSZYSTKIE_TONY.length);
  });

  it.each(WSZYSTKIE_TONY)("ton %s ma grzbiet, kolor i kwadrat ikony", (ton) => {
    expect(clubDossierSpineClass(ton).trim()).not.toBe("");
    expect(clubDossierToneColor(ton).trim()).not.toBe("");
    expect(clubDossierIconBoxClass(ton).trim()).not.toBe("");
  });

  it.each(WSZYSTKIE_TONY)("grzbiet tonu %s to klasa tła, a nie dowolny napis", (ton) => {
    expect(clubDossierSpineClass(ton)).toMatch(/^bg-/);
  });

  it.each(WSZYSTKIE_TONY)("kwadrat ikony tonu %s ma krawędź, tło i kolor tekstu", (ton) => {
    const klasa = clubDossierIconBoxClass(ton);
    expect(klasa).toContain("border-");
    expect(klasa).toContain("bg-");
    expect(klasa).toContain("text-");
  });

  it.each(WSZYSTKIE_TONY)("kolor tonu %s jest wartością CSS, nie klasą Tailwinda", (ton) => {
    // Poświata buduje z tego `color-mix`, więc musi to być wartość: token
    // motywu (`var(--…)`) albo konkretny kolor (`oklch(…)`).
    expect(clubDossierToneColor(ton)).toMatch(/^(var\(--|oklch\()/);
  });

  it("ŻADNE dwa tony nie dzielą grzbietu, koloru ani kwadratu ikony", () => {
    // To jest cała teza układu: kolor odpowiada na pytanie „co to jest" BEZ
    // czytania etykiety. Sklejenie dwóch rodzajów w jeden odcień odbiera
    // liście tę własność, a `Record<ClubDossierTone, string>` tego nie łapie.
    const grzbiety = WSZYSTKIE_TONY.map(clubDossierSpineClass);
    const kolory = WSZYSTKIE_TONY.map(clubDossierToneColor);
    const ikony = WSZYSTKIE_TONY.map(clubDossierIconBoxClass);
    expect(new Set(grzbiety).size, "grzbiety muszą być unikalne").toBe(WSZYSTKIE_TONY.length);
    expect(new Set(kolory).size, "kolory rodzaju muszą być unikalne").toBe(WSZYSTKIE_TONY.length);
    expect(new Set(ikony).size, "kwadraty ikony muszą być unikalne").toBe(WSZYSTKIE_TONY.length);
  });

  it("neutralne rodzaje sięgają po tokeny motywu, kolorowe po konkretny odcień", () => {
    // `post`, `document` i `thread` muszą działać w obu trybach, więc nie
    // wolno im wpisać na sztywno jasnego `oklch` - to ich reguła, nie detal.
    expect(clubDossierToneColor("thread")).toBe("var(--primary)");
    expect(clubDossierToneColor("post")).toBe("var(--foreground)");
    expect(clubDossierToneColor("document")).toBe("var(--muted-foreground)");
    expect(clubDossierToneColor("question")).toMatch(/^oklch\(/);
  });
});

// --- Etykieta rodzaju -------------------------------------------------------

describe("ClubDossierKind", () => {
  it("kolor etykiety pochodzi ze zmiennej `--dossier-tone`, nie z własnej palety", () => {
    const { container } = render(<ClubDossierKind>WĄTEK</ClubDossierKind>);
    const etykieta = screen.getByText("WĄTEK");
    expect(etykieta.className).toContain("var(--dossier-tone)");
    expect(etykieta.className).toContain("color-mix");
    expect(maFragmentKlasy(container, "font-semibold")).toBe(true);
    expect(etykieta.className).toContain("uppercase");
  });

  it("bez `className` nie dokłada żadnej klasy z zewnątrz", () => {
    render(<ClubDossierKind>WĄTEK</ClubDossierKind>);
    expect(screen.getByText("WĄTEK").className).not.toContain("underline");
  });

  it("`className` DOKŁADA się do koloru rodzaju, a nie zastępuje go", () => {
    render(<ClubDossierKind className="underline">WĄTEK</ClubDossierKind>);
    const etykieta = screen.getByText("WĄTEK");
    expect(etykieta.className).toContain("underline");
    expect(etykieta.className).toContain("var(--dossier-tone)");
  });

  it("potomek jest renderowany dosłownie, także jako element", () => {
    render(
      <ClubDossierKind>
        <strong>SONDAŻ</strong>
      </ClubDossierKind>,
    );
    const mocny = screen.getByText("SONDAŻ");
    expect(mocny.tagName).toBe("STRONG");
    expect(rodzic(mocny).className).toContain("color-mix");
  });

  it("wewnątrz wiersza czyta ten sam odcień, który wiersz wystawił zmienną", () => {
    const { container } = render(
      <ClubDossierRow
        tone="milestone"
        icon={<span>IK</span>}
        meta={<ClubDossierKind>ETAP</ClubDossierKind>}
        title={<span>TYTUŁ</span>}
      />,
    );
    expect(wiersz(container).style.getPropertyValue("--dossier-tone")).toBe(
      clubDossierToneColor("milestone"),
    );
    expect(screen.getByText("ETAP").className).toContain("var(--dossier-tone)");
  });
});

// --- Kolumna metryk ---------------------------------------------------------

const METRYKA_ODPOWIEDZI: ClubDossierMetric = {
  key: "replies",
  icon: <span>IKR</span>,
  value: 7,
  label: "7 odpowiedzi",
};

const METRYKA_ZERO: ClubDossierMetric = {
  key: "views",
  icon: <span>IKW</span>,
  value: 0,
  label: "brak wyświetleń",
};

describe("ClubDossierMetrics", () => {
  it("bez metryk i bez `trailing` NIE renderuje kontenera", () => {
    const { container } = render(<ClubDossierMetrics metrics={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("puste metryki, ale podany `trailing` - kolumna zostaje", () => {
    const { container } = render(<ClubDossierMetrics metrics={[]} trailing={<span>OGON</span>} />);
    expect(container.firstChild).not.toBeNull();
    expect(screen.getByText("OGON")).toBeTruthy();
    expect(container.querySelectorAll("[data-metric]")).toHaveLength(0);
  });

  it("jawny `null` w `trailing` też zostawia kolumnę - bramka pyta o `undefined`", () => {
    // Rezerwacja prawej kolumny bez treści jest świadoma: siatka wiersza
    // wyrównuje się przez całą listę, więc wywołujący musi móc ją zająć.
    const { container } = render(<ClubDossierMetrics metrics={[]} trailing={null} />);
    expect(container.firstChild).not.toBeNull();
  });

  it("każda metryka ma ikonę, liczbę i pełny opis dla czytnika ekranu", () => {
    const { container } = render(
      <ClubDossierMetrics metrics={[METRYKA_ODPOWIEDZI]} trailing={<span>OGON</span>} />,
    );
    const metryka = container.querySelector("[data-metric='replies']");
    expect(metryka).not.toBeNull();
    expect(metryka?.getAttribute("title")).toBe("7 odpowiedzi");
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByText("7 odpowiedzi").className).toContain("sr-only");
    expect(screen.getByText("IKR")).toBeTruthy();
    expect(screen.getByText("OGON")).toBeTruthy();
  });

  it("wartość 0 jest LICZBĄ do pokazania, nie brakiem metryki", () => {
    const { container } = render(<ClubDossierMetrics metrics={[METRYKA_ZERO]} />);
    expect(container.querySelectorAll("[data-metric]")).toHaveLength(1);
    expect(screen.getByText("0")).toBeTruthy();
    expect(screen.getByText("brak wyświetleń").className).toContain("sr-only");
  });

  it("kolejność metryk jest kolejnością wejścia", () => {
    const { container } = render(
      <ClubDossierMetrics metrics={[METRYKA_ZERO, METRYKA_ODPOWIEDZI]} />,
    );
    const klucze = Array.from(container.querySelectorAll("[data-metric]")).map((element) =>
      element.getAttribute("data-metric"),
    );
    expect(klucze).toEqual(["views", "replies"]);
  });

  it("liczby są tabelaryczne - kolumna ma się czytać jak tabela", () => {
    const { container } = render(<ClubDossierMetrics metrics={[METRYKA_ODPOWIEDZI]} />);
    expect(maFragmentKlasy(container, "tabular-nums")).toBe(true);
  });

  it("bez `className` nie dokłada klasy z zewnątrz", () => {
    const { container } = render(<ClubDossierMetrics metrics={[METRYKA_ODPOWIEDZI]} />);
    expect(maFragmentKlasy(container, "mt-6")).toBe(false);
    expect(maFragmentKlasy(container, "text-xs")).toBe(true);
  });

  it("`className` DOKŁADA się do własnych klas kolumny", () => {
    const { container } = render(
      <ClubDossierMetrics metrics={[METRYKA_ODPOWIEDZI]} className="mt-6" />,
    );
    expect(maFragmentKlasy(container, "mt-6")).toBe(true);
    expect(maFragmentKlasy(container, "text-xs")).toBe(true);
  });
});

// --- Warianty wiersza -------------------------------------------------------

describe("ClubDossierRow - warianty i gałęzie", () => {
  it("bez `testId` nie zostawia atrybutu `data-testid`", () => {
    const { container } = render(
      <ClubDossierRow tone="event" icon={<span>IK</span>} title={<span>TYTUŁ</span>} />,
    );
    expect(wiersz(container).hasAttribute("data-testid")).toBe(false);
  });

  it("grzbiet i kwadrat ikony wiersza pochodzą z TYCH SAMYCH map, co eksporty", () => {
    // Inne powierzchnie (post otwierający wątek) używają eksportowanych
    // funkcji - gdyby wiersz miał własną kopię palety, kolor rodzaju
    // rozjechałby się między feedem a stroną wątku.
    const { container } = render(
      <ClubDossierRow tone="question" icon={<span>IK</span>} title={<span>TYTUŁ</span>} />,
    );
    expect(maFragmentKlasy(container, clubDossierSpineClass("question"))).toBe(true);
    expect(maFragmentKlasy(container, clubDossierIconBoxClass("question"))).toBe(true);
    expect(wiersz(container).style.getPropertyValue("--dossier-tone")).toBe(
      clubDossierToneColor("question"),
    );
    expect(screen.getByText("IK")).toBeTruthy();
  });

  const NAJAZD_WLACZONY: readonly ClubDossierGlow[] = ["aura", "sweep", "rim"];

  it.each(NAJAZD_WLACZONY)("glow=%s podbija krawędź przy najeździe i przy fokusie", (glow) => {
    const { container } = render(
      <ClubDossierRow tone="poll" glow={glow} icon={<span>IK</span>} title={<span>TYTUŁ</span>} />,
    );
    const row = wiersz(container);
    expect(row.getAttribute("data-glow")).toBe(glow);
    expect(row.className).toContain("hover:border-[color-mix");
    expect(row.className).toContain("focus-within:border-[color-mix");
  });

  it("domyślny najazd to `aura` (prop pominięty)", () => {
    const { container } = render(
      <ClubDossierRow tone="poll" icon={<span>IK</span>} title={<span>TYTUŁ</span>} />,
    );
    const row = wiersz(container);
    expect(row.getAttribute("data-glow")).toBe("aura");
    expect(row.className).toContain("hover:border-[color-mix");
  });

  it("glow=none NIE dokłada żadnej reakcji krawędzi na najazd ani fokus", () => {
    const { container } = render(
      <ClubDossierRow tone="poll" glow="none" icon={<span>IK</span>} title={<span>TYTUŁ</span>} />,
    );
    const row = wiersz(container);
    expect(row.getAttribute("data-glow")).toBe("none");
    expect(row.className).not.toContain("hover:border");
    expect(row.className).not.toContain("focus-within:border");
    // Grzbiet i ikona zostają kolorowe - „bez najazdu" nie znaczy „bez tonu".
    expect(maFragmentKlasy(container, clubDossierSpineClass("poll"))).toBe(true);
  });

  it("domyślny tytuł `inline` renderuje treść bez opakowania nagłówkowego", () => {
    render(<ClubDossierRow tone="post" icon={<span>IK</span>} title={<span>TYTUŁ</span>} />);
    const opakowanie = rodzic(screen.getByText("TYTUŁ"));
    expect(opakowanie.className).not.toContain("text-xl");
    expect(opakowanie.className).not.toContain("font-bold");
  });

  it("`titleStyle=headline` daje wyrazisty tytuł i własny odstęp od góry", () => {
    render(
      <ClubDossierRow
        tone="post"
        titleStyle="headline"
        icon={<span>IK</span>}
        title={<span>TYTUŁ</span>}
      />,
    );
    const nagłówek = rodzic(screen.getByText("TYTUŁ"));
    expect(nagłówek.className).toContain("text-xl");
    expect(nagłówek.className).toContain("font-bold");
    // Nawet bez `meta` tytuł nagłówkowy odsuwa się od krawędzi wiersza.
    expect(rodzic(nagłówek).className).toContain("mt-2");
  });

  it("bez `meta` tytuł inline NIE dostaje odstępu po pasku meta", () => {
    render(<ClubDossierRow tone="post" icon={<span>IK</span>} title={<span>TYTUŁ</span>} />);
    expect(rodzic(screen.getByText("TYTUŁ")).className).not.toContain("mt-2");
  });

  it("z `meta` tytuł inline odsuwa się od paska meta", () => {
    render(
      <ClubDossierRow
        tone="post"
        icon={<span>IK</span>}
        meta={<span>META</span>}
        title={<span>TYTUŁ</span>}
      />,
    );
    expect(screen.getByText("META")).toBeTruthy();
    expect(rodzic(screen.getByText("TYTUŁ")).className).toContain("mt-2");
  });

  it("kropka nieprzeczytania żyje w pasku meta i pojawia się tylko z `unread`", () => {
    const zKropka = render(
      <ClubDossierRow
        tone="thread"
        unread
        icon={<span>IK</span>}
        meta={<span>META</span>}
        title={<span>TYTUŁ</span>}
      />,
    );
    expect(maFragmentKlasy(zKropka.container, "h-1.5 w-1.5")).toBe(true);
    expect(wiersz(zKropka.container).className).toContain("bg-primary/[0.03]");

    const bezKropki = render(
      <ClubDossierRow
        tone="thread"
        icon={<span>IK</span>}
        meta={<span>META</span>}
        title={<span>TYTUŁ</span>}
      />,
    );
    expect(maFragmentKlasy(bezKropki.container, "h-1.5 w-1.5")).toBe(false);
    expect(wiersz(bezKropki.container).className).not.toContain("bg-primary/[0.03]");
  });

  it("wiersz nieprzeczytany BEZ paska meta nie pokazuje kropki, ale podbija tło", () => {
    // Kropka jest częścią paska meta (patrz nagłówek komponentu), więc jedyny
    // nośnik „nieprzeczytane" bez meta to tło wiersza. Test pilnuje, żeby ten
    // nośnik nie zniknął przy refaktorze paska meta.
    const { container } = render(
      <ClubDossierRow tone="thread" unread icon={<span>IK</span>} title={<span>TYTUŁ</span>} />,
    );
    expect(maFragmentKlasy(container, "h-1.5 w-1.5")).toBe(false);
    expect(wiersz(container).className).toContain("bg-primary/[0.03]");
  });

  it("domyślnie wiersz nie jest przypięty ani nieprzeczytany", () => {
    const { container } = render(
      <ClubDossierRow tone="document" icon={<span>IK</span>} title={<span>TYTUŁ</span>} />,
    );
    const row = wiersz(container);
    expect(row.className).not.toContain("border-primary/40");
    expect(row.className).not.toContain("bg-primary/[0.03]");
  });

  it("bez `excerpt` nie powstaje puste pudełko zajawki", () => {
    const bez = render(
      <ClubDossierRow tone="post" icon={<span>IK</span>} title={<span>TYTUŁ</span>} />,
    );
    expect(maFragmentKlasy(bez.container, "line-clamp-3")).toBe(false);

    const z = render(
      <ClubDossierRow
        tone="post"
        icon={<span>IK</span>}
        title={<span>TYTUŁ</span>}
        excerpt="ZAJAWKA"
      />,
    );
    expect(maFragmentKlasy(z.container, "line-clamp-3")).toBe(true);
    expect(screen.getByText("ZAJAWKA")).toBeTruthy();
  });

  it("pełna treść (`children`) idzie pod zajawkę i NIE jest przycinana", () => {
    const { container } = render(
      <ClubDossierRow
        tone="post"
        icon={<span>IK</span>}
        title={<span>TYTUŁ</span>}
        excerpt="ZAJAWKA"
      >
        <p>PEŁNA TREŚĆ</p>
      </ClubDossierRow>,
    );
    const tresc = rodzic(screen.getByText("PEŁNA TREŚĆ"));
    expect(tresc.className).not.toContain("line-clamp");
    expect(tresc.className).toContain("mt-3");
    expect(maFragmentKlasy(container, "line-clamp-3")).toBe(true);
  });

  it("bez `children` nie powstaje puste pudełko treści", () => {
    const { container } = render(
      <ClubDossierRow tone="post" icon={<span>IK</span>} title={<span>TYTUŁ</span>} />,
    );
    const kontenerTresci = klasyWszystkich(container).filter((klasa) =>
      klasa.includes("mt-3 min-w-0"),
    );
    expect(kontenerTresci).toEqual([]);
  });

  it("bez `footer` nie powstaje pas akcji", () => {
    const { container } = render(
      <ClubDossierRow tone="post" icon={<span>IK</span>} title={<span>TYTUŁ</span>} />,
    );
    expect(maFragmentKlasy(container, "opacity-70")).toBe(false);
  });

  it("`footer` zostaje w DOM przy braku najazdu - inaczej klawiatura go nie osiągnie", () => {
    const { container } = render(
      <ClubDossierRow
        tone="post"
        icon={<span>IK</span>}
        title={<span>TYTUŁ</span>}
        footer={<button type="button">AKCJA</button>}
      />,
    );
    const pas = rodzic(screen.getByRole("button", { name: "AKCJA" }));
    expect(pas.className).toContain("opacity-70");
    // Widoczność podnosi się przy najeździe I przy fokusie wewnątrz pasa.
    expect(pas.className).toContain("group-hover/dossier:opacity-100");
    expect(pas.className).toContain("focus-within:opacity-100");
    expect(maFragmentKlasy(container, "opacity-70")).toBe(true);
  });

  it("bez `metrics` nie powstaje prawa kolumna", () => {
    const { container } = render(
      <ClubDossierRow tone="post" icon={<span>IK</span>} title={<span>TYTUŁ</span>} />,
    );
    expect(maFragmentKlasy(container, "col-span-2")).toBe(false);
  });

  it("`metrics` trafia do prawej kolumny wyrównanej do góry wiersza", () => {
    const { container } = render(
      <ClubDossierRow
        tone="post"
        icon={<span>IK</span>}
        title={<span>TYTUŁ</span>}
        metrics={<ClubDossierMetrics metrics={[METRYKA_ODPOWIEDZI]} />}
      />,
    );
    const kolumna = container.querySelector("[class*='col-span-2']");
    if (kolumna === null) throw new Error("brak prawej kolumny metryk");
    expect(kolumna.className).toContain("sm:self-start");
    expect(kolumna.querySelector("[data-metric='replies']")).not.toBeNull();
    expect(screen.getByText("7 odpowiedzi").className).toContain("sr-only");
  });

  it("bez `className` nie dokłada klasy z zewnątrz, z `className` dokłada", () => {
    const bez = render(
      <ClubDossierRow tone="post" icon={<span>IK</span>} title={<span>TYTUŁ</span>} />,
    );
    expect(wiersz(bez.container).className).not.toContain("scroll-mt-24");

    const z = render(
      <ClubDossierRow
        tone="post"
        className="scroll-mt-24"
        icon={<span>IK</span>}
        title={<span>TYTUŁ</span>}
      />,
    );
    const row = wiersz(z.container);
    expect(row.className).toContain("scroll-mt-24");
    // Klasa z zewnątrz nie może wywalić szkieletu siatki wiersza.
    expect(row.className).toContain("grid-cols-[auto_minmax(0,1fr)]");
  });

  it("dekoracje wiersza są ukryte przed czytnikiem ekranu", () => {
    // Grzbiet, górny akcent i kwadrat ikony niosą informację KOLOREM, więc dla
    // czytnika ekranu są szumem - treść musi zostać w meta, tytule i metrykach.
    const { container } = render(
      <ClubDossierRow
        tone="resource"
        icon={<span>IK</span>}
        meta={<span>META</span>}
        title={<span>TYTUŁ</span>}
      />,
    );
    const ukryte = container.querySelectorAll("[aria-hidden='true']");
    expect(ukryte.length).toBe(3);
    expect(maFragmentKlasy(container, "w-[3px]")).toBe(true);
  });
});
