// PASEK NAGLOWKA (`HeadingWidgetToolbar`) - pasek, ktory dostaje WYLACZNIE
// blok naglowka (BlockEditRenderer trzyma naglowek w `OWN_TOOLBAR_TYPES`, wiec
// pasek generyczny go nie obejmuje). Piec poziomow, wyrownanie, formatowanie
// inline, kolor, kotwica, obecnosc w spisie tresci i czyszczenie tresci.
//
// DLACZEGO OSOBNY PLIK. Pasek nie mial wlasnego pliku testowego: wykonywaly go
// wylacznie przejazdy `blocks/edit`, ktore montuja naglowek dla INNYCH tez
// (klawiatura, wklejanie, koercja danych) i nie klikaja ani jednego przycisku
// paska. Skutkiem byla luka strukturalna - caly `applyColor`, cala paleta
// i zapis kotwicy nie mialy ani jednego wywolania. Konwencja katalogu to jeden
// plik na pasek (`wordStyleToolbar`, `mediaWidgetToolbar`, `genericWidgetToolbar`);
// ten domyka czworke.
//
// SPOSOB DOWODZENIA. Pasek przyjmuje instancje edytora TipTapa w propsie.
// Podanie mu atrapy edytora dowodzilo by tylko tego, ze pasek wola metody
// atrapy - dlatego sciezki zalezne od edytora montuja PRAWDZIWY `HeadingBlock`
// z prawdziwym TipTapem, a asercje ida na `data.text`, ktore edytor oddaje
// przez `onChange`, czyli na tresc, ktora naprawde sie zapisze. Sciezka BEZ
// edytora (props `editor` pusty - tak pasek zachowuje sie, gdy naglowek jeszcze
// nie zbudowal instancji) montuje sam pasek, bo tam edytora po prostu nie ma.
//
// CO MA TU DOWOD
//   * KATALOG POZIOMOW: piec przyciskow, `aria-pressed` idzie za DANYMI bloku,
//     a nie za historia klikniec; poziom spoza katalogu nie zapala zadnego,
//   * KOLOR MA DWIE ROZLACZNE SCIEZKI: przy niepustym zaznaczeniu barwa idzie
//     w tresc jako mark inline, przy pustym - w `data.color` calego bloku. To
//     nie kosmetyka: renderer publiczny czyta oba miejsca inaczej, wiec
//     pomylenie ich zmienia to, co widzi czytelnik,
//   * ODMOWA I PRZYPADKI BRZEGOWE KOTWICY: anulowanie dialogu nie zapisuje nic,
//     pusta odpowiedz JEST zapisem czyszczacym, a spacje zamieniaja sie na
//     dywizy z mala litera,
//   * SPIS TRESCI: brak pola znaczy „w spisie", wiec przycisk startuje
//     wcisniety, a pierwszy klik WYPISUJE naglowek ze spisu,
//   * pasek nie kradnie zaznaczenia (`preventDefault` na `mousedown`) i nie
//     przelacza aktywnego bloku (`stopPropagation` na `click`),
//   * bez edytora pasek NIE renderuje przyciskow formatowania inline - guzik,
//     ktory nie ma na czym dzialac, jest gorszy niz jego brak.
//
// CZEGO TU NIE MA
//   * atrapy TipTapa ani atrapy dialogow. `promptDialog` idzie przez PRAWDZIWY
//     magazyn `lib/appDialogs`, na ktory test odpowiada jak uzytkownik,
//   * asercji na geometrie paska (pozycjonowanie absolutne; happy-dom nie ma
//     silnika layoutu i zwraca zera).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { HeadingWidgetToolbar } from "../HeadingWidgetToolbar";
import { HeadingBlock } from "../edit/Heading";
import { subscribeAppDialog, type PendingDialog } from "@/lib/appDialogs";
import { resolveBlockAnchors } from "@/lib/blocks/anchors";
import { slugifyAnchor } from "@/lib/content/anchorSlug";
import type { Block, Json } from "@/lib/blocks/types";
import { realT } from "@/test/i18nReal";
import { axeViolations, summarize } from "@/test/axe";
import "@/lib/i18n-admin-blocks";

const t = realT("pl");
const tEn = realT("en");

/** Etykiety paska - jedno miejsce, zeby literowka w kluczu byla widoczna raz. */
const TB = (k: string) => t(`blocks.toolbar.${k}`);

let oczekujacy: PendingDialog | null = null;
let odsubskrybuj: (() => void) | null = null;

beforeEach(() => {
  odsubskrybuj = subscribeAppDialog((p) => {
    oczekujacy = p;
  });
});

afterEach(() => {
  // Wiszacy dialog przeciekłby do nastepnego testu - magazyn jest modulowy.
  if (oczekujacy) act(() => oczekujacy?.resolve(null));
  oczekujacy = null;
  odsubskrybuj?.();
  odsubskrybuj = null;
  cleanup();
});

/** Odpowiada na oczekujacy dialog tak, jak zrobilby to redaktor. */
async function odpowiedz(wartosc: string | null): Promise<PendingDialog["request"]> {
  await waitFor(() => expect(oczekujacy).not.toBeNull());
  const zapytanie = oczekujacy!.request;
  await act(async () => {
    oczekujacy!.resolve(wartosc);
  });
  oczekujacy = null;
  return zapytanie;
}

const NIC = () => undefined;
const FALSZ = () => false;

type Zmiana = ReturnType<typeof vi.fn<(next: Block) => void>>;

/**
 * Montuje PRAWDZIWY naglowek CMS-a (TipTap + pasek). Pasek renderuje sie
 * wylacznie dla bloku aktywnego, wiec `isActive` domyslnie prawdziwe.
 */
function zamontuj(dane: Record<string, Json> = {}, isActive = true) {
  const onChange: Zmiana = vi.fn<(next: Block) => void>();
  // Baza celowo BEZ `level`: brak pola to stan, w ktorym naglowek dopiero
  // powstal, a poziom bierze sie z wartosci domyslnej katalogu. Testy, ktore
  // mowia o konkretnym poziomie, podaja go jawnie.
  const block = {
    id: "h1",
    type: "heading",
    data: { text: "Traktat", ...dane },
  } as Block;
  const view = render(
    <HeadingBlock
      block={block}
      isActive={isActive}
      onChange={onChange}
      onTransform={NIC}
      onInsertAfter={NIC}
      onDeleteEmpty={NIC}
      onMergeWithPrevious={FALSZ}
      onFocusPrevious={FALSZ}
      onFocusNext={FALSZ}
      onSelectAllBlocks={NIC}
      onExtendBlockSelection={FALSZ}
    />,
  );
  return { onChange, block, view };
}

/** Montuje SAM pasek bez edytora - stan, w ktorym naglowek nie ma instancji. */
function zamontujBezEdytora(dane: Record<string, Json> = {}) {
  const onChange: Zmiana = vi.fn<(next: Block) => void>();
  const block = {
    id: "h1",
    type: "heading",
    data: { level: 2, text: "Traktat", ...dane },
  } as Block;
  const view = render(<HeadingWidgetToolbar block={block} onChange={onChange} />);
  return { onChange, block, view };
}

function btn(nazwa: string): HTMLElement {
  return screen.getByRole("button", { name: nazwa });
}

/** Dane bloku z OSTATNIEGO zgloszenia zmiany - czyli to, co sie zapisze. */
function ostatnieDane(onChange: Zmiana): Record<string, Json> {
  const ostatnia = onChange.mock.calls.at(-1);
  if (!ostatnia) throw new Error("pasek nie zglosil zadnej zmiany bloku");
  return ostatnia[0].data;
}

/** Tresc naglowka z ostatniego zgloszenia - inline HTML oddany przez edytor. */
function ostatniTekst(onChange: Zmiana): string {
  return String(ostatnieDane(onChange).text ?? "");
}

/** Zaznacza CALA tresc naglowka - punkt wyjscia dla operacji inline. */
function zaznaczCalosc(): void {
  const pole = document.querySelector('[contenteditable="true"]');
  if (!(pole instanceof HTMLElement)) throw new Error("brak pola edycji naglowka");
  act(() => {
    pole.focus();
    const zaznaczenie = window.getSelection();
    const zakres = document.createRange();
    zakres.selectNodeContents(pole);
    zaznaczenie?.removeAllRanges();
    zaznaczenie?.addRange(zakres);
  });
}

/** Otwiera palete koloru i oddaje jej dialog. */
function otworzPalete(): HTMLElement {
  fireEvent.click(btn(TB("color")));
  return screen.getByRole("dialog", { name: TB("color") });
}

describe("HeadingWidgetToolbar - widocznosc i katalog poziomow", () => {
  it("pasek pokazuje sie WYLACZNIE dla bloku aktywnego", () => {
    zamontuj({}, false);
    expect(screen.queryByRole("button", { name: "H2" })).toBeNull();
  });

  it("pasek daje piec poziomow, a wcisniety jest ten z DANYCH bloku", () => {
    zamontuj({ level: 4 });
    for (const lvl of [1, 2, 3, 4, 5]) expect(btn(`H${lvl}`)).toBeInTheDocument();
    expect(btn("H4")).toHaveAttribute("aria-pressed", "true");
    expect(btn("H2")).not.toHaveAttribute("aria-pressed");
  });

  it("brak poziomu w danych znaczy H2 - domyslna wartosc katalogu", () => {
    zamontuj({});
    expect(btn("H2")).toHaveAttribute("aria-pressed", "true");
  });

  it("poziom zapisany jako NAPIS tez zapala swoj przycisk (koercja przez Number)", () => {
    zamontuj({ level: "3" });
    expect(btn("H3")).toHaveAttribute("aria-pressed", "true");
  });

  it("poziom SPOZA katalogu (9) nie zapala zadnego z pieciu przyciskow", () => {
    // Wartosc brzegowa: dokument po migracji z obcego CMS-a moze miec H6+.
    // Pasek nie ma czego wcisnac i nie wolno mu zgadywac.
    zamontuj({ level: 9 });
    for (const lvl of [1, 2, 3, 4, 5]) {
      expect(btn(`H${lvl}`)).not.toHaveAttribute("aria-pressed");
    }
  });

  it("klik poziomu zapisuje level i ZOSTAWIA pozostale pola bloku", () => {
    const { onChange } = zamontuj({ level: 2, anchor: "moja-sekcja", inToc: false });
    fireEvent.click(btn("H5"));
    const dane = ostatnieDane(onChange);
    expect(dane.level).toBe(5);
    expect(dane.anchor).toBe("moja-sekcja");
    expect(dane.inToc).toBe(false);
    expect(dane.text).toBe("Traktat");
  });
});

describe("HeadingWidgetToolbar - wyrownanie", () => {
  it("brak wyrownania w danych znaczy DO LEWEJ", () => {
    zamontuj({});
    expect(btn(TB("alignLeft"))).toHaveAttribute("aria-pressed", "true");
    expect(btn(TB("alignCenter"))).not.toHaveAttribute("aria-pressed");
  });

  it.each([
    ["alignLeft", "left"],
    ["alignCenter", "center"],
    ["alignRight", "right"],
  ] as const)("klik %s zapisuje align %s", (klucz, wartosc) => {
    const { onChange } = zamontuj({ align: "right" });
    fireEvent.click(btn(TB(klucz)));
    expect(ostatnieDane(onChange).align).toBe(wartosc);
  });

  it("wyrownanie SPOZA katalogu (justify) nie zapala zadnego z trzech przyciskow", () => {
    // Naglowek nie ma justowania - taka wartosc moze przyjsc tylko z importu.
    zamontuj({ align: "justify" });
    for (const klucz of ["alignLeft", "alignCenter", "alignRight"]) {
      expect(btn(TB(klucz))).not.toHaveAttribute("aria-pressed");
    }
  });
});

describe("HeadingWidgetToolbar - kolor: dwie rozlaczne sciezki", () => {
  it("paleta startuje ZWINIETA i rozwija sie na klikniecie", () => {
    zamontuj({});
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(otworzPalete()).toBeInTheDocument();
  });

  it("powtorny klik w przycisk koloru ZWIJA palete", () => {
    zamontuj({});
    otworzPalete();
    fireEvent.click(btn(TB("color")));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("BEZ zaznaczenia barwa z palety idzie w `data.color` CALEGO bloku", () => {
    // Kursor stoi w tresci albo poza nia - kolorowanie dotyczy wtedy bloku,
    // a renderer publiczny czyta to z `data.color`.
    const { onChange } = zamontuj({});
    otworzPalete();
    fireEvent.click(btn("Czerwony"));
    expect(ostatnieDane(onChange).color).toBe("#c0392b");
    // Wybor zamyka palete - inaczej zaslaniala by naglowek pod soba.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("PRZY zaznaczeniu barwa idzie w TRESC jako mark inline, a nie w `data.color`", () => {
    const { onChange } = zamontuj({});
    zaznaczCalosc();
    otworzPalete();
    fireEvent.click(btn("Niebieski"));
    expect(ostatniTekst(onChange)).toContain("#2980b9");
    expect(ostatnieDane(onChange).color ?? "").toBe("");
  });

  it("token motywu z palety zapisuje sie doslownie (`var(--primary)`)", () => {
    // Paleta miesza tokeny motywu z bezpiecznymi kolorami druku; token nie ma
    // prawa zostac przepisany na hex, bo zabralby motywowi warstwe zmiennych.
    const { onChange } = zamontuj({});
    otworzPalete();
    fireEvent.click(btn("Primary"));
    expect(ostatnieDane(onChange).color).toBe("var(--primary)");
  });

  it("wlasny kolor z pola `input[type=color]` idzie ta sama sciezka co paleta", () => {
    const { onChange } = zamontuj({});
    const dialog = otworzPalete();
    const pole = dialog.querySelector<HTMLInputElement>('input[type="color"]');
    expect(pole).not.toBeNull();
    fireEvent.change(pole!, { target: { value: "#123456" } });
    expect(ostatnieDane(onChange).color).toBe("#123456");
  });

  it("pole wlasnego koloru pokazuje kolor bloku, gdy jest szesciocyfrowym hexem", () => {
    zamontuj({ color: "#abcdef" });
    const dialog = otworzPalete();
    expect(dialog.querySelector<HTMLInputElement>('input[type="color"]')!.value).toBe("#abcdef");
  });

  it("pole wlasnego koloru schodzi na czern, gdy kolor bloku jest TOKENEM", () => {
    // `input[type=color]` nie umie pokazac `var(--primary)`, wiec pasek daje
    // wartosc zastepcza zamiast pustki, ktora przegladarka i tak by odrzucila.
    zamontuj({ color: "var(--primary)" });
    const dialog = otworzPalete();
    expect(dialog.querySelector<HTMLInputElement>('input[type="color"]')!.value).toBe("#111111");
  });

  it("BEZ zaznaczenia `Wyczysc kolor` zapisuje PUSTY kolor bloku", () => {
    const { onChange } = zamontuj({ color: "#c0392b" });
    otworzPalete();
    fireEvent.click(btn(TB("colorReset")));
    expect(ostatnieDane(onChange).color).toBe("");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("PRZY zaznaczeniu `Wyczysc kolor` zdejmuje barwe z TRESCI", () => {
    const { onChange } = zamontuj({ text: '<span style="color: #c0392b">Traktat</span>' });
    zaznaczCalosc();
    otworzPalete();
    fireEvent.click(btn(TB("colorReset")));
    expect(ostatniTekst(onChange)).not.toContain("#c0392b");
    expect(ostatniTekst(onChange)).toContain("Traktat");
  });

  it("przycisk koloru jest wcisniety, gdy blok ma BEZPIECZNY kolor", () => {
    zamontuj({ color: "#c0392b" });
    expect(btn(TB("color"))).toHaveAttribute("aria-pressed", "true");
  });

  it("kolor NAZWANY (`red`) nie zapala przycisku - pasek uznaje tylko hex i token", () => {
    // `safeCssColor` przepuszcza wylacznie hex i `var(--...)`. Nazwa koloru nie
    // jest wiec kolorem ani dla paska, ani dla renderera publicznego, wiec
    // pasek nie ma prawa udawac, ze naglowek jest pokolorowany.
    zamontuj({ color: "red" });
    expect(btn(TB("color"))).not.toHaveAttribute("aria-pressed");
  });

  it("otwarta paleta trzyma przycisk koloru wcisniety, nawet gdy kolor jest pusty", () => {
    zamontuj({});
    expect(btn(TB("color"))).not.toHaveAttribute("aria-pressed");
    otworzPalete();
    expect(btn(TB("color"))).toHaveAttribute("aria-pressed", "true");
  });
});

describe("HeadingWidgetToolbar - formatowanie inline i brak edytora", () => {
  it("pogrubienie i kursywa zakladaja SEMANTYCZNE znaczniki w tresci", () => {
    const { onChange } = zamontuj({});
    zaznaczCalosc();
    fireEvent.click(btn(TB("bold")));
    expect(ostatniTekst(onChange)).toMatch(/<strong>/);
    zaznaczCalosc();
    fireEvent.click(btn(TB("italic")));
    expect(ostatniTekst(onChange)).toMatch(/<em>/);
  });

  it("`aria-pressed` pogrubienia idzie za KARETKA, nie za liczba klikniec", () => {
    zamontuj({ text: "<strong>Traktat</strong>" });
    zaznaczCalosc();
    expect(btn(TB("bold"))).toHaveAttribute("aria-pressed", "true");
    expect(btn(TB("italic"))).not.toHaveAttribute("aria-pressed");
  });

  it("`Tekst normalny` zdejmuje i znaczniki, i kolor inline, zostawiajac tresc", () => {
    const { onChange } = zamontuj({
      text: '<strong><span style="color: #c0392b">Traktat</span></strong>',
    });
    zaznaczCalosc();
    fireEvent.click(btn(TB("normalText")));
    const tekst = ostatniTekst(onChange);
    expect(tekst).not.toMatch(/<strong>/);
    expect(tekst).not.toContain("#c0392b");
    expect(tekst).toContain("Traktat");
  });

  it("BEZ edytora pasek nie renderuje przyciskow formatowania inline", () => {
    // Guzik, ktory nie ma na czym dzialac, jest gorszy niz jego brak.
    zamontujBezEdytora({});
    expect(screen.queryByRole("button", { name: TB("bold") })).toBeNull();
    expect(screen.queryByRole("button", { name: TB("italic") })).toBeNull();
    expect(screen.queryByRole("button", { name: TB("normalText") })).toBeNull();
    // Reszta paska dziala dalej - poziomy, kolor, wyrownanie, kotwica.
    expect(btn("H2")).toBeInTheDocument();
    expect(btn(TB("color"))).toBeInTheDocument();
  });

  it("BEZ edytora barwa z palety zapisuje sie do `data.color` bloku", () => {
    const { onChange } = zamontujBezEdytora({});
    otworzPalete();
    fireEvent.click(btn("Zielony"));
    expect(ostatnieDane(onChange).color).toBe("#27ae60");
  });

  it("BEZ edytora `Wyczysc kolor` zapisuje pusty kolor, a nie `null`", () => {
    // `null` w `data` przeszlo by do dokumentu jako wartosc JSON i renderer
    // publiczny musialby ja odsiewac osobno.
    const { onChange } = zamontujBezEdytora({ color: "#c0392b" });
    otworzPalete();
    fireEvent.click(btn(TB("colorReset")));
    expect(ostatnieDane(onChange).color).toBe("");
  });
});

describe("HeadingWidgetToolbar - kotwica i spis tresci", () => {
  it("dialog kotwicy podpowiada obecna wartosc, a zapis normalizuje spacje", async () => {
    const { onChange } = zamontuj({ anchor: "stara-kotwica" });
    fireEvent.click(btn(TB("anchor")));
    const zapytanie = await odpowiedz("  Rozdzial Pierwszy  ");
    expect(zapytanie).toMatchObject({
      title: TB("anchor"),
      defaultValue: "stara-kotwica",
      confirmLabel: TB("apply"),
    });
    expect(ostatnieDane(onChange).anchor).toBe("rozdzial-pierwszy");
  });

  it("ANULOWANIE dialogu kotwicy nie zapisuje NICZEGO", async () => {
    const { onChange } = zamontuj({ anchor: "stara-kotwica" });
    fireEvent.click(btn(TB("anchor")));
    await odpowiedz(null);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("PUSTA odpowiedz JEST zapisem czyszczacym kotwice", async () => {
    // Rozroznienie nosne: „Escape" (null) to rezygnacja, a zatwierdzenie
    // pustego pola to swiadome zdjecie kotwicy.
    const { onChange } = zamontuj({ anchor: "stara-kotwica" });
    fireEvent.click(btn(TB("anchor")));
    await odpowiedz("");
    expect(ostatnieDane(onChange).anchor).toBe("");
  });

  it("blok BEZ kotwicy podpowiada pusty napis, a nie `undefined`", async () => {
    zamontuj({});
    expect(btn(TB("anchor"))).not.toHaveAttribute("aria-pressed");
    fireEvent.click(btn(TB("anchor")));
    const zapytanie = await odpowiedz(null);
    expect(zapytanie).toMatchObject({ defaultValue: "" });
  });

  it("istniejaca kotwica zapala przycisk", () => {
    zamontuj({ anchor: "moja-sekcja" });
    expect(btn(TB("anchor"))).toHaveAttribute("aria-pressed", "true");
  });

  it("BRAK pola `inToc` znaczy obecnosc w spisie tresci - przycisk startuje wcisniety", () => {
    zamontuj({});
    expect(btn(TB("toc"))).toHaveAttribute("aria-pressed", "true");
  });

  it("pierwszy klik WYPISUJE naglowek ze spisu tresci", () => {
    const { onChange } = zamontuj({});
    fireEvent.click(btn(TB("toc")));
    expect(ostatnieDane(onChange).inToc).toBe(false);
  });

  it("klik na naglowku WYPISANYM ze spisu wpisuje go z powrotem", () => {
    const { onChange } = zamontuj({ inToc: false });
    expect(btn(TB("toc"))).not.toHaveAttribute("aria-pressed");
    fireEvent.click(btn(TB("toc")));
    expect(ostatnieDane(onChange).inToc).toBe(true);
  });
});

describe("HeadingWidgetToolbar - czyszczenie tresci", () => {
  it("`Wyczysc` zeruje TRESC, a nie ustawienia naglowka", () => {
    const { onChange } = zamontuj({ level: 3, align: "center", anchor: "moja-sekcja" });
    fireEvent.click(btn(TB("clear")));
    const dane = ostatnieDane(onChange);
    expect(dane.text).toBe("");
    expect(dane.level).toBe(3);
    expect(dane.align).toBe("center");
    expect(dane.anchor).toBe("moja-sekcja");
  });
});

describe("HeadingWidgetToolbar - pasek nie kradnie zaznaczenia ani klikniecia", () => {
  it("wcisniecie przycisku NIE gasi zaznaczenia w edytorze", () => {
    // Bez `preventDefault` na `mousedown` przegladarka przenosi fokus na
    // przycisk i gasi zaznaczenie ZANIM dojdzie `click` - komenda koloru
    // dzialala by wtedy na pustym zakresie.
    zamontuj({});
    const zdarzenie = new Event("mousedown", { bubbles: true, cancelable: true });
    fireEvent(btn("H3"), zdarzenie);
    expect(zdarzenie.defaultPrevented).toBe(true);
  });

  it("wcisniecie TLA paska (obok przyciskow) tez nie gasi zaznaczenia", () => {
    const { view } = zamontuj({});
    const pasek = view.container.querySelector<HTMLElement>(".absolute.-top-\\[38px\\]");
    expect(pasek).not.toBeNull();
    const zdarzenie = new Event("mousedown", { bubbles: true, cancelable: true });
    fireEvent(pasek!, zdarzenie);
    expect(zdarzenie.defaultPrevented).toBe(true);
  });

  it("klikniecie w pasek NIE dociera do kanwy pod spodem", () => {
    // Bez `stopPropagation` kazde ustawienie z paska przy okazji klikalo by
    // w kanwe, czyli przelaczalo aktywny blok w trakcie edycji.
    const onKanwa = vi.fn();
    const onChange: Zmiana = vi.fn<(next: Block) => void>();
    const blok = { id: "h1", type: "heading", data: { level: 2, text: "Traktat" } } as Block;
    render(
      <div onClick={onKanwa}>
        <HeadingWidgetToolbar block={blok} onChange={onChange} />
      </div>,
    );
    fireEvent.click(btn("H4"));
    expect(onChange).toHaveBeenCalled();
    expect(onKanwa).not.toHaveBeenCalled();
  });
});

// ── DEFEKTY TEGO PASKA, ZAREJESTROWANE, NIE NAPRAWIONE ───────────────────────
describe("HeadingWidgetToolbar - defekty zarejestrowane", () => {
  // DEFEKT: KOTWICA NAGLOWKA POWSTAJE SZOSTYM, NAJSLABSZYM SLUGIFIKATOREM.
  //
  // WEJSCIE: redaktor wpisuje w dialogu kotwicy „Sekcja Łączna" - napis
  //   z polska litera atomowa, dokladnie ten z bledu, dla ktorego powstal
  //   `src/lib/content/anchorSlug.ts`.
  // CO PSUJE: HeadingWidgetToolbar.tsx:254 normalizuje wartosc wlasnym
  //   wyrazeniem `v.trim().replace(/\s+/g, "-").toLowerCase()`. Nie
  //   transliteruje liter atomowych (`ł` nie ma rozkladu kanonicznego), nie
  //   przycina do 80 znakow, nie ma fallbacku i NIE usuwa znakow
  //   niedozwolonych w identyfikatorze (`#`, `/`, `?`, kropka, cudzyslow
  //   przechodza nietkniete). Dalej `createAnchorAllocator.allocate`
  //   (anchorSlug.ts:231-233) bierze kotwice JAWNA doslownie - `trimmedExplicit
  //   || slugifyAnchor(text)` - wiec nikt jej po drodze nie naprawi.
  // KONSEKWENCJA: tu wazy to wiecej niz w pasku generycznym, bo kotwica
  //   naglowka NAPRAWDE trafia do atrybutu `id` w HTML. Redaktor dostaje
  //   `<h2 id="sekcja-łączna">`, a spis tresci i linki glebokie licza slug
  //   kanonicznie („sekcja-laczna") - odnosnik trafia w pustke, bez zadnego
  //   komunikatu. Ze znakiem `#` w srodku id nie da sie nawet uzyc
  //   w `querySelector`.
  // WYMAGANA POPRAWKA: `set({ anchor: slugifyAnchor(v) })` - identycznie po
  //   obu stronach, zeby migracja tresci bloki<->richtext nie ruszala kotwic.
  it("STAN DZIS: kotwica z polska litera zostaje w dokumencie NIEZTRANSLITEROWANA", async () => {
    const { onChange } = zamontuj({});
    fireEvent.click(btn(TB("anchor")));
    await odpowiedz("Sekcja Łączna");
    expect(ostatnieDane(onChange).anchor).toBe("sekcja-łączna");
    expect(slugifyAnchor("Sekcja Łączna")).toBe("sekcja-laczna");
  });

  it.fails("DEFEKT: kotwica naglowka MUSI byc slugowana kanonicznie", async () => {
    const { onChange } = zamontuj({});
    fireEvent.click(btn(TB("anchor")));
    await odpowiedz("Sekcja Łączna");
    const anchor = String(ostatnieDane(onChange).anchor ?? "");
    expect(anchor).toBe(slugifyAnchor("Sekcja Łączna"));
    // A skoro taka wartosc idzie prosto do `id`, musi tez wyjsc z silnika
    // kotwic bez zmiany - inaczej `href="#..."` i `id` sie rozjezdzaja.
    const blok = { id: "h1", type: "heading", data: { text: "Traktat", anchor } } as Block;
    expect(resolveBlockAnchors([blok]).get("h1")?.id).toBe(slugifyAnchor("Sekcja Łączna"));
  });

  // DEFEKT: `Wyczysc kolor` PRZY ZAZNACZENIU NIE ZDEJMUJE KOLORU BLOKU.
  //
  // WEJSCIE: naglowek pokolorowany na poziomie bloku (`data.color = "#c0392b"`,
  //   czyli efekt wyboru barwy przy pustym zaznaczeniu), redaktor zaznacza
  //   tresc naglowka - odruch przed kazda operacja na tekscie - i klika
  //   „Wyczysc kolor".
  // CO PSUJE: `applyColor` (HeadingWidgetToolbar.tsx:98-107) rozgalezia sie
  //   WYLACZNIE na obecnosc zaznaczenia: przy niepustym zakresie wola
  //   `unsetColor()` na marku inline i KONCZY (`return`), nie dotykajac
  //   `data.color`. W tresci nie ma zadnego marku koloru, wiec komenda nie
  //   zmienia dokumentu, `onUpdate` nie leci i pasek nie zglasza zmiany.
  // KONSEKWENCJA: naglowek zostaje czerwony, a redaktor dostaje zero
  //   sprzezenia - klika przycisk czyszczacy tyle razy, ile zechce, i za
  //   kazdym razem nic sie nie dzieje. Jedyna droga do zdjecia koloru to
  //   odznaczenie tresci, czego interfejs nigdzie nie komunikuje.
  // WYMAGANA POPRAWKA: `Wyczysc kolor` (`applyColor(null)`) musi czyscic OBA
  //   miejsca - mark inline ORAZ `data.color` - bo etykieta obiecuje redaktorowi
  //   brak koloru, a nie brak jednego z dwoch jego zrodel.
  it("STAN DZIS: przy zaznaczeniu reset koloru nie zglasza ZADNEJ zmiany bloku", () => {
    const { onChange } = zamontuj({ color: "#c0392b" });
    zaznaczCalosc();
    otworzPalete();
    fireEvent.click(btn(TB("colorReset")));
    expect(onChange).not.toHaveBeenCalled();
  });

  it.fails("DEFEKT: reset koloru MUSI zdjac kolor bloku takze przy zaznaczonej tresci", () => {
    const { onChange } = zamontuj({ color: "#c0392b" });
    zaznaczCalosc();
    otworzPalete();
    fireEvent.click(btn(TB("colorReset")));
    const dane = onChange.mock.calls.at(-1)?.[0].data;
    expect(dane && String(dane.color ?? "")).toBe("");
  });
});

describe("HeadingWidgetToolbar - i18n PL/EN i dostepnosc", () => {
  it("napisy paska istnieja w OBU slownikach i sie roznia", () => {
    const klucze = [
      "bold",
      "italic",
      "normalText",
      "color",
      "colorCustom",
      "colorReset",
      "alignLeft",
      "alignCenter",
      "alignRight",
      "anchor",
      "toc",
      "clear",
      "apply",
    ];
    for (const klucz of klucze) {
      const pelny = `blocks.toolbar.${klucz}`;
      expect(t(pelny)).not.toBe(pelny);
      expect(tEn(pelny)).not.toBe(pelny);
    }
    expect(
      klucze.filter((k) => t(`blocks.toolbar.${k}`) !== tEn(`blocks.toolbar.${k}`)).length,
    ).toBeGreaterThan(klucze.length / 2);
  });

  it("pasek z rozwinieta paleta nie wnosi naruszen dostepnosci", async () => {
    const { view } = zamontujBezEdytora({});
    otworzPalete();
    const violations = await axeViolations(view.container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
