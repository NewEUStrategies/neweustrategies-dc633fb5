// UNIWERSALNY PASEK WIDGETU (`GenericWidgetToolbar`) - pasek, ktory dostaje
// KAZDY blok spoza `OWN_TOOLBAR_TYPES` (BlockEditRenderer.tsx:117 wyklucza
// akapit, naglowek, obraz, wideo i audio, bo te maja wlasne paski). Czyli:
// cytat, galeria, tabela, wykres, callout, embed - cala reszta katalogu.
//
// DLACZEGO OSOBNY PLIK. Ten pasek nie mial dotad wlasnego testu. Jedyny plik,
// ktory go importowal - `quotePreviewParity.test.tsx` - dowodzi INNEJ tezy
// (parytet podgladu cytatu z publicznym rendererem) i dotyka paska jednym
// przypadkiem o jego responsywnosci; ten przypadek zostaje tam, gdzie jest.
// Konwencja katalogu to jeden plik na pasek (`mediaWidgetToolbar`,
// `wordStyleToolbar`) - ten domyka trojke.
//
// CO MA TU DOWOD
//   * KAZDY przycisk paska ma nazwe dostepna ze SLOWNIKA, nie z kodu. Pasek to
//     same ikony; przycisk bez etykiety jest dla czytnika ekranu nierozrozninalny
//     od sasiada, a przycisk stojacy na zapasowym tekscie renderuje polszczyzne
//     w wersji angielskiej,
//   * kazda mutacja idzie przez jedno domkniecie `set()` i oddaje NOWY obiekt
//     bloku z ZACHOWANYMI polami, ktorych pasek wlasnie nie dotyka. Gdyby
//     `set()` podmienialo caly `data`, ustawienie wyrownania kasowaloby tresc
//     cytatu,
//   * `aria-pressed` odpowiada STANOWI DANYCH, a nie historii klikniec -
//     redaktor widzi, ktore wyrownanie, szerokosc i odstep sa wlaczone,
//   * kolorystyka pojawia sie WARUNKOWO (`hasBlockPalette`, dzis wylacznie
//     cytat). Pokazanie jej przy galerii zapisywaloby `colorPalette` do bloku,
//     ktorego publiczny renderer tego pola nigdy nie odczyta - cicha strata,
//   * oba popovery (tlo, kolorystyka) startuja ZWINIETE i rozwijaja sie
//     dopiero na klikniecie - inaczej pasek zaslanialby blok pod soba,
//   * kotwica idzie przez PRAWDZIWY magazyn dialogow: anulowanie (`null`) NIE
//     zapisuje nic, a pusta odpowiedz JEST zapisem czyszczacym. To ta granica,
//     na ktorej „Escape" zamiast cofniecia potrafi wyczyscic redaktorowi id,
//   * pasek nie kradnie zaznaczenia (`preventDefault` na `mousedown`) ani nie
//     przelacza aktywnego bloku (`stopPropagation` na `click`). Bez tego kazde
//     ustawienie z paska gasiloby karetke albo przy okazji klikalo w kanwe.
//
// CZEGO TU NIE MA
//   * atrapy dialogow. `promptDialog` to prawdziwy modulowy magazyn
//     `lib/appDialogs`; test go SUBSKRYBUJE i odpowiada na oczekujace
//     zapytanie, tak jak zrobilby to uzytkownik w hoscie dialogu. Zadnego
//     `vi.mock` w tym pliku nie ma,
//   * montazu przez `BlockCanvas`/`PostBlockEditor`. Pasek nie czyta zadnego
//     kontekstu poza `useTranslation()`, wiec montuje sie wprost - atrapa
//     Supabase, QueryClienta czy routera byla by tu martwym kodem,
//   * asercji na geometrie. Pasek jest pozycjonowany absolutnie, a happy-dom
//     nie ma silnika layoutu - asercje ida na klasy i obecnosc w drzewie.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { GenericWidgetToolbar } from "../GenericWidgetToolbar";
import { subscribeAppDialog, type PendingDialog } from "@/lib/appDialogs";
import { BLOCK_PALETTE_KEYS, BLOCK_PALETTE_VAR } from "@/lib/blocks/variants";
import { resolveBlockAnchors } from "@/lib/blocks/anchors";
import { slugifyAnchor } from "@/lib/content/anchorSlug";
import type { Block, Json } from "@/lib/blocks/types";
import { realT } from "@/test/i18nReal";
import { axeViolations, summarize } from "@/test/axe";
import "@/lib/i18n-admin-blocks";

const t = realT("pl");

/** Etykiety paska - jedno miejsce, zeby literowka w kluczu byla widoczna raz. */
const TB = (k: string) => t(`blocks.toolbar.${k}`);
const KOLORYSTYKA = t("blocks.settings.colorPalette");
const BARWA = (k: string) => t(`blocks.settings.palette.${k}`);

let oczekujacy: PendingDialog | null = null;
let odsubskrybuj: (() => void) | null = null;

beforeEach(() => {
  odsubskrybuj = subscribeAppDialog((p) => {
    oczekujacy = p;
  });
});

afterEach(() => {
  // Wiszacy dialog przeciekłby do nastepnego testu (magazyn jest modulowy).
  if (oczekujacy) act(() => oczekujacy?.resolve(null));
  odsubskrybuj?.();
  odsubskrybuj = null;
});

/** Odpowiada na oczekujace zapytanie dialogu - jak uzytkownik w hoscie dialogu. */
async function odpowiedz(wartosc: string | null): Promise<PendingDialog["request"]> {
  await waitFor(() => expect(oczekujacy).not.toBeNull());
  const zapytanie = oczekujacy!.request;
  await act(async () => {
    oczekujacy!.resolve(wartosc);
  });
  return zapytanie;
}

/**
 * Cytat ma kolorystyke (`hasBlockPalette`), galeria jej nie ma - to jedyna
 * roznica miedzy typami, jaka ten pasek zna. Blok podaje sie literalem
 * `as Block`, tak jak w `quotePreviewParity.test.tsx`.
 *
 * Oddaje takze `unmount` - potrzebny tam, gdzie JEDEN test porownuje DWA stany
 * danych: bez odmontowania poprzedniego paska `getByRole` trafialby w dwa
 * przyciski o tej samej nazwie dostepnej.
 */
function zamontuj(type: string, data: Record<string, Json> = {}) {
  const onChange = vi.fn<(next: Block) => void>();
  const block = {
    id: "b1",
    type,
    data: { text: "Europa potrzebuje strategii, nie deklaracji.", ...data },
  } as Block;
  const { container, unmount } = render(<GenericWidgetToolbar block={block} onChange={onChange} />);
  return { onChange, container, block, unmount };
}

function btn(nazwa: string): HTMLElement {
  return screen.getByRole("button", { name: nazwa });
}

/** Ostatnia wersja danych bloku, jaka pasek oddal wolajacemu. */
function ostatnieDane(onChange: { mock: { calls: Array<[Block]> } }): Record<string, unknown> {
  const ostatnia = onChange.mock.calls.at(-1);
  if (!ostatnia) throw new Error("pasek nie zglosil zadnej zmiany");
  return ostatnia[0].data as Record<string, unknown>;
}

/**
 * Wejscie koloru tla. `getByLabelText` jest tu SLEPY: `aria-label` wejscia i
 * `title` przycisku otwierajacego to ten sam napis („Kolor tla"), wiec zapytanie
 * po nazwie trafialoby w dwa elementy. Do tego happy-dom nie mapuje roli ARIA
 * dla `input[type=color]`, wiec `getByRole` tez odpada.
 */
function wejscieKoloru(container: HTMLElement): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>('input[type="color"]');
}

/**
 * Separatory paska (`<Divider />`). Filtr po klasie jest konieczny, bo probka
 * koloru wewnatrz przycisku kolorystyki tez jest `span[aria-hidden]` - bez
 * filtru licznik mylilby separator z probka.
 */
function separatory(container: HTMLElement): Element[] {
  return [...container.querySelectorAll("span[aria-hidden]")].filter((s) =>
    s.className.includes("w-px"),
  );
}

describe("GenericWidgetToolbar - paleta przyciskow i etykiety", () => {
  it("pasek pokazuje wszystkie wspolne akcje pod polskimi nazwami ze slownika", () => {
    zamontuj("gallery");
    for (const klucz of [
      "alignLeft",
      "alignCenter",
      "alignRight",
      "widthNarrow",
      "widthWide",
      "widthFull",
      "padY_sm",
      "padY_md",
      "padY_lg",
      "bg",
      "anchor",
    ]) {
      // Nazwa rowna kluczowi oznaczalaby brak liscia w slowniku, a nie etykiete.
      expect(TB(klucz)).not.toBe(`blocks.toolbar.${klucz}`);
      expect(btn(TB(klucz))).toBeInTheDocument();
    }
  });

  it("blok BEZ kolorystyki (galeria) nie pokazuje przycisku kolorystyki", () => {
    // Pokazanie go tutaj zapisywaloby `colorPalette` do bloku, ktorego publiczny
    // renderer tego pola nie czyta - ustawienie ginelo by po cichu.
    zamontuj("gallery");
    expect(screen.queryByRole("button", { name: KOLORYSTYKA })).toBeNull();
  });

  it("blok Z kolorystyka (cytat) pokazuje ja i ma JEDEN separator wiecej", () => {
    const galeria = zamontuj("gallery");
    const bezPalety = separatory(galeria.container).length;
    galeria.unmount();
    const cytat = zamontuj("quote");
    expect(btn(KOLORYSTYKA)).toBeInTheDocument();
    expect(separatory(cytat.container)).toHaveLength(bezPalety + 1);
  });

  it("pasek z OBOMA rozwinietymi popoverami nie ma naruszen dostepnosci", async () => {
    // Ikonowy przycisk bez nazwy dostepnej i probka koloru bez etykiety byly by
    // dla czytnika ekranu nierozroznialne od siebie.
    const { container } = zamontuj("quote");
    fireEvent.click(btn(TB("bg")));
    fireEvent.click(btn(KOLORYSTYKA));
    expect(summarize(await axeViolations(container))).toBe("");
  });
});

describe("GenericWidgetToolbar - wyrownanie, szerokosc, odstep", () => {
  it.each([
    ["alignLeft", "left"],
    ["alignCenter", "center"],
    ["alignRight", "right"],
  ])("%s zapisuje wyrownanie i ZACHOWUJE pozostale dane bloku", (klucz, wartosc) => {
    const { onChange } = zamontuj("quote");
    fireEvent.click(btn(TB(klucz)));
    expect(ostatnieDane(onChange)).toMatchObject({
      align: wartosc,
      text: "Europa potrzebuje strategii, nie deklaracji.",
    });
  });

  it.each([
    ["widthNarrow", "narrow"],
    ["widthWide", "wide"],
    ["widthFull", "full"],
  ])("%s zapisuje tryb szerokosci", (klucz, wartosc) => {
    const { onChange } = zamontuj("gallery");
    fireEvent.click(btn(TB(klucz)));
    expect(ostatnieDane(onChange).width).toBe(wartosc);
  });

  it.each(["sm", "md", "lg"] as const)("odstep %s zapisuje padY", (rozmiar) => {
    const { onChange } = zamontuj("gallery");
    fireEvent.click(btn(TB(`padY_${rozmiar}`)));
    expect(ostatnieDane(onChange).padY).toBe(rozmiar);
  });

  it("aria-pressed pokazuje STAN DANYCH, nie historie klikow", () => {
    zamontuj("gallery", { align: "center", width: "wide", padY: "lg" });
    expect(btn(TB("alignCenter"))).toHaveAttribute("aria-pressed", "true");
    expect(btn(TB("widthWide"))).toHaveAttribute("aria-pressed", "true");
    expect(btn(TB("padY_lg"))).toHaveAttribute("aria-pressed", "true");
    // Niewcisniety przycisk NIE MA atrybutu w ogole (`active ? true : undefined`),
    // wiec czytnik nie oglasza go jako przelacznika w stanie wylaczonym.
    expect(btn(TB("alignLeft"))).not.toHaveAttribute("aria-pressed");
    expect(btn(TB("widthNarrow"))).not.toHaveAttribute("aria-pressed");
    expect(btn(TB("padY_sm"))).not.toHaveAttribute("aria-pressed");
  });

  it("wcisniete klasy podswietlenia idzie w parze z aria-pressed", () => {
    zamontuj("gallery", { align: "right" });
    expect(btn(TB("alignRight")).className).toContain("bg-foreground/10");
    expect(btn(TB("alignLeft")).className).not.toContain("bg-foreground/10");
  });

  it("na pustych danych wcisniete sa: do lewej i odstep MD, a ZADNA szerokosc", () => {
    // Domyslna szerokosc to „default" - tryb, ktory celowo nie ma przycisku,
    // wiec pasek nie moze udawac, ze redaktor wybral „waski".
    const { container } = zamontuj("gallery");
    expect(btn(TB("alignLeft"))).toHaveAttribute("aria-pressed", "true");
    expect(btn(TB("padY_md"))).toHaveAttribute("aria-pressed", "true");
    for (const klucz of ["widthNarrow", "widthWide", "widthFull"]) {
      expect(btn(TB(klucz))).not.toHaveAttribute("aria-pressed");
    }
    expect(container.querySelector('[data-widget-toolbar="generic"]')).not.toBeNull();
  });

  it("pasek oddaje NOWY obiekt bloku i nie mutuje wejscia", () => {
    const { onChange, block } = zamontuj("gallery");
    fireEvent.click(btn(TB("alignCenter")));
    const nastepny = onChange.mock.calls.at(-1)![0];
    expect(nastepny).not.toBe(block);
    expect(nastepny.data).not.toBe(block.data);
    expect(block.data.align).toBeUndefined();
  });

  it("blok BEZ pola data nie wywraca paska, a zapis tworzy dane od zera", () => {
    // Rzutowanie `as unknown as Block`, bo `data` jest w typie WYMAGANE - a po
    // migracjach tresci do runtime'u trafiaja bloki, ktore tego pola nie maja.
    const onChange = vi.fn<(next: Block) => void>();
    const block = { id: "b1", type: "gallery" } as unknown as Block;
    render(<GenericWidgetToolbar block={block} onChange={onChange} />);
    fireEvent.click(btn(TB("alignLeft")));
    expect(ostatnieDane(onChange)).toEqual({ align: "left" });
  });
});

describe("GenericWidgetToolbar - popover koloru tla", () => {
  it("popover tla jest ZWINIETY, dopoki nikt nie kliknie ikony", () => {
    const { container } = zamontuj("gallery");
    expect(wejscieKoloru(container)).toBeNull();
  });

  it("klikniecie ikony rozwija wybor koloru", () => {
    const { container } = zamontuj("gallery");
    fireEvent.click(btn(TB("bg")));
    expect(wejscieKoloru(container)).not.toBeNull();
  });

  it("bez ustawionego tla wejscie startuje z bieli", () => {
    const { container } = zamontuj("gallery");
    fireEvent.click(btn(TB("bg")));
    expect(wejscieKoloru(container)?.value).toBe("#ffffff");
  });

  it("z ustawionym tlem wejscie pokazuje ZAPISANY kolor", () => {
    const { container } = zamontuj("gallery", { bg: "#112233" });
    fireEvent.click(btn(TB("bg")));
    expect(wejscieKoloru(container)?.value).toBe("#112233");
  });

  it("wybor koloru zapisuje go do danych bloku", () => {
    const { container, onChange } = zamontuj("gallery");
    fireEvent.click(btn(TB("bg")));
    fireEvent.change(wejscieKoloru(container)!, { target: { value: "#0d5eaf" } });
    expect(ostatnieDane(onChange).bg).toBe("#0d5eaf");
  });

  it("ikona tla jest wcisnieta TYLKO wtedy, gdy tlo jest ustawione", () => {
    const bezTla = zamontuj("gallery");
    expect(btn(TB("bg"))).not.toHaveAttribute("aria-pressed");
    bezTla.unmount();
    zamontuj("gallery", { bg: "#112233" });
    expect(btn(TB("bg"))).toHaveAttribute("aria-pressed", "true");
  });

  it("Wyczysc kasuje kolor I zwija popover jednym klikniecem", () => {
    // Sprzezenie „zamkniecie = wyczyszczenie" jest tu ZAPISANE, bo to jedyne
    // wyjscie z popovera poza ponownym klikniecem ikony (zob. DEFEKT nizej).
    const { container, onChange } = zamontuj("gallery", { bg: "#112233" });
    fireEvent.click(btn(TB("bg")));
    fireEvent.click(btn(TB("clear")));
    expect(ostatnieDane(onChange).bg).toBe("");
    expect(wejscieKoloru(container)).toBeNull();
  });

  it("ponowne klikniecie ikony zwija popover bez kasowania koloru", () => {
    const { container, onChange } = zamontuj("gallery", { bg: "#112233" });
    fireEvent.click(btn(TB("bg")));
    fireEvent.click(btn(TB("bg")));
    expect(wejscieKoloru(container)).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("tlo zapisane jako LICZBA (dane po imporcie) nie trafia do wejscia koloru", () => {
    // Import WordPressa potrafi wniesc `bg` jako liczbe; `input[type=color]` z
    // wartoscia „16711680" jest niepoprawny i przegladarka i tak spadlaby na
    // czern. Pasek odrzuca wartosc nie-tekstowa i pokazuje biel.
    const { container } = zamontuj("gallery", { bg: 16711680 });
    expect(btn(TB("bg"))).not.toHaveAttribute("aria-pressed");
    fireEvent.click(btn(TB("bg")));
    expect(wejscieKoloru(container)?.value).toBe("#ffffff");
  });
});

describe("GenericWidgetToolbar - kolorystyka widgetu", () => {
  it("lista barw jest ZWINIETA, dopoki nikt nie kliknie probki", () => {
    zamontuj("quote");
    expect(screen.queryByRole("button", { name: BARWA("brand") })).toBeNull();
  });

  it("klikniecie probki rozwija WSZYSTKIE siedem barw pod nazwami ze slownika", () => {
    zamontuj("quote");
    fireEvent.click(btn(KOLORYSTYKA));
    for (const p of BLOCK_PALETTE_KEYS) {
      expect(BARWA(p)).not.toBe(`blocks.settings.palette.${p}`);
      expect(btn(BARWA(p))).toBeInTheDocument();
    }
  });

  it.each([...BLOCK_PALETTE_KEYS])("wybor barwy %s zapisuje colorPalette i zwija liste", (p) => {
    const { onChange } = zamontuj("quote");
    fireEvent.click(btn(KOLORYSTYKA));
    fireEvent.click(btn(BARWA(p)));
    expect(ostatnieDane(onChange).colorPalette).toBe(p);
    expect(screen.queryByRole("button", { name: BARWA(p) })).toBeNull();
  });

  it("wcisnieta jest DOKLADNIE ta barwa, ktora jest w danych", () => {
    // Tu, inaczej niz w przyciskach paska, `aria-pressed` jest ZAWSZE obecne -
    // probki tworza grupe wyboru, wiec czytnik musi widziec takze te niewybrane.
    zamontuj("quote", { colorPalette: "warning" });
    fireEvent.click(btn(KOLORYSTYKA));
    expect(btn(BARWA("warning"))).toHaveAttribute("aria-pressed", "true");
    expect(btn(BARWA("neutral"))).toHaveAttribute("aria-pressed", "false");
    expect(btn(BARWA("warning")).className).toContain("border-foreground");
    expect(btn(BARWA("neutral")).className).not.toContain("border-foreground");
  });

  it("ikona kolorystyki jest wcisnieta dopiero przy barwie INNEJ niz neutralna", () => {
    const neutralny = zamontuj("quote");
    expect(btn(KOLORYSTYKA)).not.toHaveAttribute("aria-pressed");
    neutralny.unmount();
    zamontuj("quote", { colorPalette: "brand" });
    expect(btn(KOLORYSTYKA)).toHaveAttribute("aria-pressed", "true");
  });

  it("NIEZNANA barwa z danych spada na neutralna, a nie na pusty styl", () => {
    // Bez `?? BLOCK_PALETTE_VAR.neutral` probka bloku po imporcie z obcego CMS-a
    // byla by przezroczystym kwadratem - redaktor nie wiedzialby, co ma ustawione.
    const nieznana = zamontuj("quote", { colorPalette: "burgund" });
    const probkaNieznanej = nieznana.container.querySelector<HTMLElement>(
      'button[aria-label="' + KOLORYSTYKA + '"] span[aria-hidden]',
    );
    expect(probkaNieznanej?.getAttribute("style")).toContain(BLOCK_PALETTE_VAR.neutral);
  });
});

describe("GenericWidgetToolbar - kotwica bloku", () => {
  it("kotwica idzie przez dialog aplikacji i podpowiada wartosc biezaca", async () => {
    const { onChange } = zamontuj("quote", { anchor: "stara-kotwica" });
    fireEvent.click(btn(TB("anchor")));
    const zapytanie = await odpowiedz("nowa-sekcja");
    expect(zapytanie).toMatchObject({
      kind: "prompt",
      title: TB("anchor"),
      label: "id-bloku",
      defaultValue: "stara-kotwica",
      confirmLabel: TB("apply"),
    });
    expect(ostatnieDane(onChange).anchor).toBe("nowa-sekcja");
  });

  it("wpisana kotwica jest normalizowana: spacje na dywizy, male litery", async () => {
    const { onChange } = zamontuj("quote");
    fireEvent.click(btn(TB("anchor")));
    await odpowiedz("  Nowa   Sekcja  ");
    expect(ostatnieDane(onChange).anchor).toBe("nowa-sekcja");
  });

  it("ANULOWANIE dialogu NIE kasuje istniejacej kotwicy", async () => {
    // To jest ta granica, na ktorej „Escape" zamiast cofniecia potrafi wyczyscic
    // redaktorowi id, do ktorego prowadza juz opublikowane linki `#`.
    const { onChange } = zamontuj("quote", { anchor: "stara-kotwica" });
    fireEvent.click(btn(TB("anchor")));
    await odpowiedz(null);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("PUSTA odpowiedz JEST zapisem - swiadomie czysci kotwice", async () => {
    const { onChange } = zamontuj("quote", { anchor: "stara-kotwica" });
    fireEvent.click(btn(TB("anchor")));
    await odpowiedz("");
    expect(ostatnieDane(onChange).anchor).toBe("");
  });

  it("przycisk kotwicy jest wcisniety tylko wtedy, gdy kotwica istnieje", async () => {
    const bezKotwicy = zamontuj("gallery");
    expect(btn(TB("anchor"))).not.toHaveAttribute("aria-pressed");
    fireEvent.click(btn(TB("anchor")));
    // Dialog otwarty na bloku BEZ kotwicy podpowiada pusty napis, a nie „undefined".
    const zapytanie = await odpowiedz(null);
    expect(zapytanie).toMatchObject({ defaultValue: "" });
    bezKotwicy.unmount();
    zamontuj("gallery", { anchor: "moja-sekcja" });
    expect(btn(TB("anchor"))).toHaveAttribute("aria-pressed", "true");
  });

  // DEFEKT: PASEK MA SZOSTA, NAJSLABSZA IMPLEMENTACJE SLUGIFIKATORA KOTWIC.
  //
  // WEJSCIE: redaktor wpisuje w dialogu kotwicy „Sekcja Laczna" z polskimi
  //   znakami diakrytycznymi (tu: „Sekcja Łączna").
  // CO PSUJE: GenericWidgetToolbar.tsx:235 normalizuje wartosc wlasnym
  //   wyrazeniem `v.trim().replace(/\s+/g, "-").toLowerCase()`. To ani nie
  //   transliteruje liter atomowych (`ł` nie ma rozkladu kanonicznego), ani nie
  //   przycina do 80 znakow, ani nie ma fallbacku, ani nie usuwa znakow
  //   niedozwolonych - `#`, `/`, `?`, kropka i cudzyslow przechodza nietkniete.
  //   Repo ma na to JEDNO zrodlo prawdy: `slugifyAnchor`
  //   (src/lib/content/anchorSlug.ts, naglowek 1-31 opisuje, dlaczego piec
  //   niezaleznych implementacji bylo bledem). Ta linia jest szosta.
  // KONSEKWENCJA: ten sam napis dostaje INNY identyfikator w pasku
  //   („sekcja-łączna") niz w silniku naglowkow („sekcja-laczna"). Fragment ze
  //   znakiem spoza ASCII albo ze znakiem `#` w srodku nie daje sie uzyc ani w
  //   `href="#..."`, ani w `querySelector` - link glęboki trafia w pustke.
  //   Ten sam defekt jest skopiowany w HeadingWidgetToolbar.tsx:254, gdzie wazy
  //   jeszcze wiecej, bo tam kotwica NAPRAWDE trafia do `id` w HTML.
  // WYMAGANA POPRAWKA: `set({ anchor: slugifyAnchor(v) })` - identycznie po obu
  //   stronach, zeby migracja tresci bloki<->richtext nie ruszala kotwic.
  it.fails("DEFEKT: kotwica z polskimi znakami MUSI byc slugowana kanonicznie", async () => {
    const { onChange } = zamontuj("quote");
    fireEvent.click(btn(TB("anchor")));
    await odpowiedz("Sekcja Łączna");
    expect(ostatnieDane(onChange).anchor).toBe(slugifyAnchor("Sekcja Łączna"));
  });

  // DEFEKT: KOTWICA USTAWIONA Z TEGO PASKA NIGDY NIE TRAFIA DO HTML.
  //
  // WEJSCIE: blok cytatu z `data.anchor = "moj-cytat"` - dokladnie to, co pasek
  //   zapisuje po zatwierdzeniu dialogu kotwicy.
  // CO PSUJE: jedyny konsument `block.data.anchor` w silniku publicznym to
  //   `resolveBlockAnchors` (src/lib/blocks/anchors.ts:63-80). Odrzuca kazdy
  //   blok, dla ktorego `block.type !== "heading"` - `headingText` zwraca pusty
  //   napis (anchors.ts:45-46), a petla robi `continue`, wiec wpis nie powstaje.
  //   Tymczasem ten pasek renderuje sie WYLACZNIE dla blokow spoza
  //   `OWN_TOOLBAR_TYPES` (BlockEditRenderer.tsx:117), a wiec NIGDY dla
  //   naglowka - te dwa zbiory sa rozlaczne.
  // KONSEKWENCJA: przycisk kotwicy na cytacie, galerii, tabeli czy wykresie
  //   przyjmuje wartosc, zapisuje ja do dokumentu i zapala `aria-pressed`,
  //   czyli POTWIERDZA redaktorowi ustawienie, ktorego zaden element HTML nie
  //   dostanie. Redaktor buduje spis tresci albo linkuje `#moj-cytat` i dostaje
  //   martwy odnosnik, bez zadnego komunikatu.
  // WYMAGANA POPRAWKA: albo opakowanie DOWOLNEGO bloku emituje `id` z
  //   `data.anchor` w publicznym rendererze, albo przycisk kotwicy znika z
  //   paska generycznego i zostaje wylacznie w HeadingWidgetToolbar.
  it.fails("DEFEKT: kotwica bloku nie-naglowkowego MUSI dawac id w silniku publicznym", () => {
    const blok = { id: "q1", type: "quote", data: { text: "Cytat", anchor: "moj-cytat" } } as Block;
    expect(resolveBlockAnchors([blok]).get("q1")?.id).toBe("moj-cytat");
  });
});

describe("GenericWidgetToolbar - pasek nie kradnie zaznaczenia ani kliknięcia", () => {
  it("wcisniecie przycisku NIE gasi zaznaczenia w edytorze", () => {
    // Bez `preventDefault` na `mousedown` przegladarka przenosi fokus na przycisk
    // i gasi zaznaczenie ZANIM dojdzie `click` - komenda paska dziala wtedy na
    // pustym zakresie.
    zamontuj("gallery");
    const zdarzenie = new Event("mousedown", { bubbles: true, cancelable: true });
    fireEvent(btn(TB("alignLeft")), zdarzenie);
    expect(zdarzenie.defaultPrevented).toBe(true);
  });

  it("wcisniecie TLA paska (obok przyciskow) tez nie gasi zaznaczenia", () => {
    const { container } = zamontuj("gallery");
    const pasek = container.querySelector<HTMLElement>('[data-widget-toolbar="generic"]')!;
    const zdarzenie = new Event("mousedown", { bubbles: true, cancelable: true });
    fireEvent(pasek, zdarzenie);
    expect(zdarzenie.defaultPrevented).toBe(true);
  });

  it("klikniecie w pasek NIE dociera do kanwy pod spodem", () => {
    // Bez `stopPropagation` kazde ustawienie z paska przy okazji klikaloby w
    // kanwe, czyli przelaczaloby aktywny blok w trakcie edycji.
    const onKanwa = vi.fn();
    const onChange = vi.fn<(next: Block) => void>();
    const blok = { id: "b1", type: "gallery", data: {} } as Block;
    render(
      <div onClick={onKanwa}>
        <GenericWidgetToolbar block={blok} onChange={onChange} />
      </div>,
    );
    fireEvent.click(btn(TB("alignCenter")));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onKanwa).not.toHaveBeenCalled();
  });
});

describe("GenericWidgetToolbar - i18n PL/EN", () => {
  it("etykiety paska istnieja w OBU slownikach, a EN nie jest kopia PL", () => {
    const pl = realT("pl");
    const en = realT("en");
    const klucze = [
      "blocks.toolbar.alignLeft",
      "blocks.toolbar.alignCenter",
      "blocks.toolbar.alignRight",
      "blocks.toolbar.widthNarrow",
      "blocks.toolbar.widthWide",
      "blocks.toolbar.widthFull",
      "blocks.toolbar.padY_sm",
      "blocks.toolbar.padY_md",
      "blocks.toolbar.padY_lg",
      "blocks.toolbar.bg",
      "blocks.toolbar.clear",
      "blocks.toolbar.anchor",
      "blocks.toolbar.apply",
      "blocks.settings.colorPalette",
      ...BLOCK_PALETTE_KEYS.map((p) => `blocks.settings.palette.${p}`),
    ];
    for (const klucz of klucze) {
      // Echo klucza = liscia nie ma w slowniku, a napis stoi na kodzie.
      expect(pl(klucz)).not.toBe(klucz);
      expect(en(klucz)).not.toBe(klucz);
    }
    const rozne = klucze.filter((k) => pl(k) !== en(k));
    expect(rozne.length).toBeGreaterThan(klucze.length / 2);
  });
});
