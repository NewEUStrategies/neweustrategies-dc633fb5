// CO DOWODZI TEN PLIK: podgląd wyniku wyszukiwania w panelu pokazuje TO SAMO,
// co pójdzie do `head()` - ten sam host kanoniczny, te same okruszki ścieżki i
// TĘ SAMĄ obcinkę pikselową (`truncateToPx`), a przy `noindex` przykrywa cały
// snippet nakładką z plakietką. Wszystkie napisy w podglądzie są PRZYPIĘTYMI,
// zmierzonymi wynikami `truncateToPx`, nie przybliżeniami.
//
// DLACZEGO TO WAŻNE DLA UŻYTKOWNIKA. Podgląd jest jedynym miejscem, w którym
// redakcja widzi swój snippet przed publikacją, i jedynym powodem, dla którego
// warto go utrzymywać, jest wierność. Gdy pęknie:
//   * host wzięty z okna przeglądarki („localhost", domena podglądowa hostingu)
//     uczy redakcję, że tak wygląda adres w Google - to jest wprost sens
//     komentarza przy `CANONICAL_HOST` w kodzie komponentu,
//   * brak obcinki (albo obcinka po znakach, nie po pikselach) pozwala
//     zatwierdzić tytuł, który Google urwie w innym miejscu - redakcja
//     dowiaduje się o tym z wyników wyszukiwania, nie z panelu,
//   * brak nakładki `noindex` to najgroźniejszy przypadek: podgląd pokazuje
//     ładny snippet strony, która NIGDY nie trafi do indeksu.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE:
//   * nie liczy szerokości pikselowej ani nie testuje samej funkcji obcinającej
//     w oderwaniu - to kontrakt `src/lib/seo/__tests__/serp.test.ts` („returns
//     short strings unchanged and truncates long ones with ellipsis"); tutaj
//     dowodem jest to, co trafia do DOM podglądu,
//   * nie sprawdza rozwiązywania tytułu/opisu z rekordu (sufiksy, spadek po
//     `excerpt`) - komponent dostaje wartości JUŻ rozwiązane; to warstwa
//     `src/lib/seo/__tests__/meta.test.ts`,
//   * nie dubluje `e2e/seo.spec.ts`. Ten plik NIE sprawdza żadnego znacznika w
//     realnym `<head>` (to robią tam testy „head contract on /", „head contract
//     on /en", „head contract on /blog", „head contract on /qa"), ani dostępu
//     do panelu („/admin/seo is auth-gated (redirects to /auth or /login)").
//     Powierzchnia tego pliku to WYŁĄCZNIE komponent podglądu w panelu, którego
//     e2e nigdy nie renderuje.
import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { axeViolations, summarize } from "@/test/axe";
import { SITE_CANONICAL_ORIGIN, SITE_NAME } from "@/lib/seo/meta";
import { truncateToPx, SERP_DESCRIPTION_LIMIT_PX, SERP_TITLE_LIMIT_PX } from "@/lib/seo/serp";
import { SerpPreview } from "../SerpPreview";

/** Host, który podgląd MUSI pokazać, gdy wywołujący nie podał własnego. */
const CANONICAL_HOST = SITE_CANONICAL_ORIGIN.replace(/^https?:\/\//, "");

const TITLE_SHORT = "Krotki tytul wpisu";
const DESC_SHORT = "Krotki opis wpisu.";
const TITLE_VERY_LONG =
  "Polska prezydencja w Radzie Unii Europejskiej i przyszlosc wspolnej polityki rolnej po 2027 roku - analiza";
const DESC_VERY_LONG =
  "Ten opis jest zdecydowanie zbyt dlugi na wynik wyszukiwania Google, poniewaz zawiera wiele zdan i szczegolow, ktore i tak nie zmieszcza sie w limicie dziewieciuset szescdziesieciu pikseli renderowanej szerokosci, a wiec zostanie obciety wielokropkiem przez podglad panelu redakcyjnego.";
/**
 * Napis dobrany tak, żeby budżet pikselowy skończył się DOKŁADNIE na spacji:
 * 50 znaków „a" (28 jednostek) + spacja (28,42) mieszczą się w budżecie 29
 * jednostek, a następne „W" go przekracza. To jedyny przypadek, w którym
 * `trimEnd()` w `truncateToPx` ma cokolwiek do roboty.
 */
const TITLE_CUT_ON_SPACE = `${"a".repeat(50)} WWWWW`;

interface Snippet {
  container: HTMLElement;
  /** Linia adresu: host + okruszki ścieżki. */
  url: string;
  title: string;
  description: string;
}

/**
 * Podgląd nie ma rólek ARIA (jest imitacją cudzego UI), więc wyciągamy jego
 * trzy linie strukturalnie: nazwa serwisu jest zakotwiczeniem dla linii adresu,
 * a tytuł i opis to dwa jedyne akapity snippetu.
 */
function renderSnippet(props: Parameters<typeof SerpPreview>[0]): Snippet {
  const { container } = render(<SerpPreview {...props} />);
  const paragraphs = container.querySelectorAll("p");
  expect(paragraphs).toHaveLength(2);
  return {
    container,
    url: screen.getByText(SITE_NAME).nextElementSibling?.textContent ?? "",
    title: paragraphs[0].textContent ?? "",
    description: paragraphs[1].textContent ?? "",
  };
}

/**
 * Czy obcięty napis kończy się CAŁYM słowem oryginału? Google urywa snippet na
 * granicy słowa, więc to jest kryterium wierności podglądu.
 */
function lastWordIsWhole(original: string, rendered: string): boolean {
  const kept = rendered.replace(/…$/, "");
  const lastWord = kept.split(" ").pop() ?? "";
  return original.split(" ").includes(lastWord);
}

afterEach(cleanup);

describe("SerpPreview - obcinka pikselowa tytułu i opisu", () => {
  it("krótki tytuł i krótki opis idą do podglądu bez zmian", () => {
    const snippet = renderSnippet({
      title: TITLE_SHORT,
      description: DESC_SHORT,
      path: "blog/wpis",
    });
    expect(snippet.title).toBe(TITLE_SHORT);
    expect(snippet.description).toBe(DESC_SHORT);
    expect(snippet.title).not.toContain("…");
    expect(snippet.description).not.toContain("…");
  });

  it("bardzo długi tytuł jest obcięty wielokropkiem - dokładnie jak w head()", () => {
    const snippet = renderSnippet({
      title: TITLE_VERY_LONG,
      description: DESC_SHORT,
      path: "blog/wpis",
    });
    // Podgląd nie może mieć własnej obcinki: musi zgadzać się ze wspólną funkcją.
    expect(snippet.title).toBe(truncateToPx(TITLE_VERY_LONG, 20, SERP_TITLE_LIMIT_PX));
    expect(snippet.title.endsWith("…")).toBe(true);
    expect(snippet.title.length).toBeLessThan(TITLE_VERY_LONG.length);
  });

  it("długi opis jest obcięty wielokropkiem na własnym budżecie 960px", () => {
    const snippet = renderSnippet({
      title: TITLE_SHORT,
      description: DESC_VERY_LONG,
      path: "blog/wpis",
    });
    expect(snippet.description).toBe(truncateToPx(DESC_VERY_LONG, 14, SERP_DESCRIPTION_LIMIT_PX));
    expect(snippet.description.endsWith("…")).toBe(true);
    // Tytuł nie może dostać budżetu opisu (i odwrotnie) - to osobne limity.
    expect(snippet.title).toBe(TITLE_SHORT);
  });

  it("gdy budżet kończy się na spacji, przed wielokropkiem nie zostaje spacja", () => {
    // Zmierzone zachowanie `trimEnd()`: obcięcie wypada za spacją, a podgląd
    // pokazuje pełne słowo + wielokropek, bez wiszącego odstępu.
    const snippet = renderSnippet({
      title: TITLE_CUT_ON_SPACE,
      description: DESC_SHORT,
      path: "",
    });
    expect(snippet.title).toBe(`${"a".repeat(50)}…`);
    expect(snippet.title).not.toMatch(/ …$/);
    expect(lastWordIsWhole(TITLE_CUT_ON_SPACE, snippet.title)).toBe(true);
  });

  it("ZMIERZONE zachowanie: obcięcie w środku wyrazu, gdy budżet kończy się w słowie", () => {
    // Przypięcie stanu faktycznego (patrz `it.fails` poniżej): `trimEnd()` ucina
    // tylko odstępy, więc kiedy budżet wypada w środku słowa, słowo zostaje
    // rozerwane. Gdy ktoś to naprawi, ten test zapali się jako pierwszy.
    const snippet = renderSnippet({
      title: TITLE_VERY_LONG,
      description: DESC_SHORT,
      path: "",
    });
    expect(snippet.title).toBe("Polska prezydencja w Radzie Unii Europejskiej i przyszlos…");
    expect(lastWordIsWhole(TITLE_VERY_LONG, snippet.title)).toBe(false);
  });

  // DEFEKT: `truncateToPx` obcina po jednostce znaku i tylko `trimEnd()`, więc
  // rozrywa wyraz w połowie („...i przyszlos…" z „przyszlosc"). Google urywa
  // snippet na granicy słowa. KONSEKWENCJA: redakcja widzi w podglądzie inny
  // snippet niż Google - zatwierdza tytuł na podstawie obrazu, który w wynikach
  // wyszukiwania nigdy nie wystąpi, a rozerwany wyraz w panelu bywa czytany
  // jako literówka i „naprawiany" przez skracanie poprawnego tytułu.
  it.fails(
    "DEFEKT: obcięcie tytułu rozrywa wyraz w połowie zamiast cofnąć się do granicy słowa",
    () => {
      const snippet = renderSnippet({
        title: TITLE_VERY_LONG,
        description: DESC_SHORT,
        path: "",
      });
      expect(lastWordIsWhole(TITLE_VERY_LONG, snippet.title)).toBe(true);
    },
  );

  // DEFEKT: ten sam mechanizm dotyczy opisu, który ma szerszy budżet i jest
  // dłuższy, więc rozerwanie wyrazu jest tam jeszcze bardziej widoczne.
  // KONSEKWENCJA: redakcja widzi w podglądzie inny snippet niż Google.
  it.fails("DEFEKT: obcięcie opisu również rozrywa wyraz w połowie", () => {
    const snippet = renderSnippet({
      title: TITLE_SHORT,
      description: DESC_VERY_LONG,
      path: "",
    });
    expect(lastWordIsWhole(DESC_VERY_LONG, snippet.description)).toBe(true);
  });

  it("pusty tytuł: podgląd bierze spadek i pokazuje pustą linię tytułu", () => {
    // ZMIERZONE: `truncateToPx("")` zwraca "", więc komponent NIE podstawia
    // nazwy serwisu ani żadnego zastępnika - i tak ma być, bo prop jest opisany
    // jako tytuł JUŻ rozwiązany; podgląd nie ma prawa upiększać braku.
    const snippet = renderSnippet({ title: "", description: DESC_SHORT, path: "blog/wpis" });
    expect(snippet.title).toBe("");
    expect(snippet.title).not.toContain(SITE_NAME);
    // Nazwa serwisu żyje w linii nad adresem i zostaje na miejscu.
    expect(screen.getByText(SITE_NAME)).toBeTruthy();
    expect(snippet.description).toBe(DESC_SHORT);
  });

  it("pusty opis nie wywraca podglądu ani nie dostaje wielokropka", () => {
    const snippet = renderSnippet({ title: TITLE_SHORT, description: "", path: "" });
    expect(snippet.description).toBe("");
  });
});

describe("SerpPreview - linia adresu", () => {
  it("bez propa host pokazuje host KANONICZNY marki, nie host podglądu", () => {
    const snippet = renderSnippet({ title: TITLE_SHORT, description: DESC_SHORT, path: "" });
    expect(snippet.url).toBe(CANONICAL_HOST);
    // Sens komentarza w kodzie: nigdy localhost ani domena podglądowa hostingu.
    expect(snippet.url).not.toContain("localhost");
    expect(snippet.url).not.toContain("127.0.0.1");
    expect(snippet.url).not.toMatch(/^https?:\/\//);
    expect(snippet.url).toBe("neweuropeanstrategies.com");
  });

  it("podany host wygrywa z kanonicznym", () => {
    const snippet = renderSnippet({
      title: TITLE_SHORT,
      description: DESC_SHORT,
      host: "en.neweuropeanstrategies.com",
      path: "",
    });
    expect(snippet.url).toBe("en.neweuropeanstrategies.com");
    expect(snippet.url).not.toBe(CANONICAL_HOST);
  });

  it("pusty string jako host jest respektowany (to nie jest brak wartości)", () => {
    // `host ?? CANONICAL_HOST` łapie tylko undefined/null - "" przechodzi dalej.
    const snippet = renderSnippet({
      title: TITLE_SHORT,
      description: DESC_SHORT,
      host: "",
      path: "blog",
    });
    expect(snippet.url).toBe(" › blog");
  });

  it("ścieżka wielosegmentowa daje okruszki oddzielone znakiem ›", () => {
    const snippet = renderSnippet({
      title: TITLE_SHORT,
      description: DESC_SHORT,
      path: "blog/kategoria/moj-wpis",
    });
    expect(snippet.url).toBe(`${CANONICAL_HOST} › blog › kategoria › moj-wpis`);
  });

  it("wiodące i podwójne ukośniki nie tworzą pustych okruszków", () => {
    const snippet = renderSnippet({
      title: TITLE_SHORT,
      description: DESC_SHORT,
      path: "/blog//moj-wpis/",
    });
    expect(snippet.url).toBe(`${CANONICAL_HOST} › blog › moj-wpis`);
  });

  it.each([
    ["pusta ścieżka", ""],
    ["sam ukośnik (strona główna)", "/"],
  ])("%s nie daje żadnych okruszków", (_opis, path) => {
    const snippet = renderSnippet({ title: TITLE_SHORT, description: DESC_SHORT, path });
    expect(snippet.url).toBe(CANONICAL_HOST);
    expect(snippet.url).not.toContain("›");
  });
});

describe("SerpPreview - nakładka noindex", () => {
  it("noindex przykrywa snippet nakładką z plakietką", () => {
    renderSnippet({
      title: TITLE_SHORT,
      description: DESC_SHORT,
      path: "blog/wpis",
      noindex: true,
    });
    expect(screen.getByText("noindex")).toBeTruthy();
  });

  it("bez noindex nie ma ani nakładki, ani plakietki", () => {
    renderSnippet({ title: TITLE_SHORT, description: DESC_SHORT, path: "blog/wpis" });
    expect(screen.queryByText("noindex")).toBeNull();
  });

  it("noindex: false traktowane jak brak flagi", () => {
    renderSnippet({
      title: TITLE_SHORT,
      description: DESC_SHORT,
      path: "blog/wpis",
      noindex: false,
    });
    expect(screen.queryByText("noindex")).toBeNull();
  });

  it("nakładka nie usuwa treści snippetu - zasłania ją tylko wizualnie", () => {
    // Gdyby nakładka wycinała snippet z DOM, redaktor po odznaczeniu noindex
    // zobaczyłby pusty podgląd do przeładowania komponentu.
    const snippet = renderSnippet({
      title: TITLE_SHORT,
      description: DESC_SHORT,
      path: "blog/wpis",
      noindex: true,
    });
    expect(snippet.title).toBe(TITLE_SHORT);
    expect(snippet.url).toBe(`${CANONICAL_HOST} › blog › wpis`);
  });
});

describe("SerpPreview - dostępność", () => {
  it.each([
    ["bez noindex", false],
    ["z nakładką noindex", true],
  ])("nie ma naruszeń axe (%s)", async (_opis, noindex) => {
    const { container } = render(
      <SerpPreview
        title={TITLE_VERY_LONG}
        description={DESC_VERY_LONG}
        path="blog/kategoria/moj-wpis"
        noindex={noindex}
      />,
    );
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
