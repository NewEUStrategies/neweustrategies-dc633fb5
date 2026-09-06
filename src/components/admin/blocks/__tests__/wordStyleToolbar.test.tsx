// PLYWAJACY PASEK FORMATOWANIA (`WordStyleToolbar`) - pasek "wordowy" edytora
// akapitu.
//
// SPOSOB DOWODZENIA. Pasek przyjmuje w propsie instancje edytora TipTapa.
// Podanie mu atrapy edytora byloby dowodem na to, ze pasek wola metody atrapy,
// czyli na nic - a przy okazji zamrozilaby kontrakt @tiptap w tescie. Dlatego
// pasek jest tu montowany TAK, JAK W PANELU: przez PRAWDZIWY `ParagraphBlock`
// z prawdziwa instancja TipTapa i prawdziwym zestawem rozszerzen. Asercje idą
// wiec na HTML, ktory edytor oddaje przez `onChange` - to znaczy na tresc,
// ktora naprawde zapisze sie do dokumentu.
//
// CO MA TU DOWOD
//   * pasek pokazuje sie WYLACZNIE dla bloku aktywnego (nieaktywny akapit nie
//     ma zaslaniac tresci sasiadow),
//   * formatowanie znakow (pogrubienie, kursywa, podkreslenie, przekreslenie,
//     indeksy, kod) trafia do tresci jako SEMANTYCZNY znacznik, a nie jako styl
//     inline - to jest granica miedzy trescia CMS-a a wygladem motywu,
//   * `aria-pressed` odpowiada stanowi karetki w edytorze,
//   * cofanie/ponawianie paska jest wylaczone, dopoki edytor nie ma historii -
//     przycisk, ktory nic nie robi, jest gorszy niz jego brak - a gdy historia
//     JEST, oba przyciski realnie cofaja i przywracaja tresc,
//   * paleta koloru/wyroznienia otwiera sie jako `role="dialog"`, zamyka sie po
//     wyborze i po klikniciu na zewnatrz,
//   * ODMOWA BARWY, czyli obie drogi ZDJECIA jej z tekstu: guzik `⌫` w kazdej
//     palecie oraz swatch przezroczystosci w palecie wyroznienia. Bez nich
//     redaktor nie ma jak wrocic do koloru motywu i zostaje z barwa wpisana
//     w tresc na zawsze,
//   * pasek nie kradnie zaznaczenia: `mousedown` jest anulowany i na przycisku,
//     i na tle paska, i w otwartej palecie,
//   * dialog linku: potwierdzenie zaklada `<a href>`, PUSTA wartosc zdejmuje
//     link (a nie zaklada linku do pustego adresu), anulowanie nie robi nic,
//   * WSTAWIANIE PRZYPISU dokleja marker `[fn]…[/fn]` OBOK zaznaczonego slowa,
//     nigdy zamiast niego. To jest zapisana w kodzie regresja: podmiana
//     zaznaczenia gubila autorowi slowo, do ktorego podpinal druga note.
//
// CZEGO TU NIE MA
//   * atrap warstw wlasnych ani atrapy TipTapa. Jedyna atrapa to `sonner`
//     (toasty - granica UI); dialogi ida przez PRAWDZIWY magazyn
//     `lib/appDialogs`, na ktory test odpowiada jak uzytkownik,
//   * asercji na pozycjonowanie paska (geometria; happy-dom zwraca zera).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Block } from "@/lib/blocks/types";
import { subscribeAppDialog, type PendingDialog } from "@/lib/appDialogs";
import { ParagraphBlock } from "../edit/Paragraph";
import { realT } from "@/test/i18nReal";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const t = realT("pl");

let oczekujacy: PendingDialog | null = null;
let odsubskrybuj: (() => void) | null = null;

beforeEach(() => {
  odsubskrybuj = subscribeAppDialog((p) => {
    oczekujacy = p;
  });
});

afterEach(() => {
  if (oczekujacy) act(() => oczekujacy?.resolve(null));
  odsubskrybuj?.();
  odsubskrybuj = null;
});

async function odpowiedz(wartosc: string | null): Promise<PendingDialog["request"]> {
  await waitFor(() => expect(oczekujacy).not.toBeNull());
  const zapytanie = oczekujacy!.request;
  await act(async () => {
    oczekujacy!.resolve(wartosc);
  });
  return zapytanie;
}

const NIC = () => undefined;
const FALSZ = () => false;

function zamontuj(html: string, isActive = true) {
  const onChange = vi.fn<(n: Block) => void>();
  const block = { id: "p1", type: "paragraph", data: { html } } as Block;
  const view = render(
    <ParagraphBlock
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
  return { onChange, view };
}

/**
 * Akapit w STEROWANYM rodzicu - tak jak w kanwie, gdzie `BlockCanvas` trzyma
 * dokument w stanie i oddaje bloki z powrotem w propsie. Potrzebne wszędzie,
 * gdzie pasek czyta stan edytora przy renderze (`editor.can()`): `useEditor`
 * z TipTapa 3 NIE przerenderowuje komponentu na każdej transakcji, więc
 * odświeżenie przycisków cofania bierze się z przerenderowania rodzica po
 * zapisie treści. Rodzic nieruchomy (`zamontuj`) zamrażałby te przyciski
 * w stanie z montażu - i mierzyłby atrapę, nie panel.
 */
function AkapitSterowany({
  startHtml,
  onChange,
}: {
  startHtml: string;
  onChange: (n: Block) => void;
}) {
  const [block, setBlock] = useState<Block>(
    () => ({ id: "p1", type: "paragraph", data: { html: startHtml } }) as Block,
  );
  return (
    <ParagraphBlock
      block={block}
      isActive
      onChange={(next) => {
        setBlock(next);
        onChange(next);
      }}
      onTransform={NIC}
      onInsertAfter={NIC}
      onDeleteEmpty={NIC}
      onMergeWithPrevious={FALSZ}
      onFocusPrevious={FALSZ}
      onFocusNext={FALSZ}
      onSelectAllBlocks={NIC}
      onExtendBlockSelection={FALSZ}
    />
  );
}

function zamontujSterowany(html: string) {
  const onChange = vi.fn<(n: Block) => void>();
  const view = render(<AkapitSterowany startHtml={html} onChange={onChange} />);
  return { onChange, view };
}

function btn(nazwa: string): HTMLElement {
  return screen.getByRole("button", { name: nazwa });
}

/** Ostatni HTML, jaki edytor oddał wołającemu - czyli treść, która się zapisze. */
function ostatniHtml(onChange: { mock: { calls: Array<[Block]> } }): string {
  const ostatnia = onChange.mock.calls.at(-1);
  if (!ostatnia) throw new Error("edytor nie zgłosił żadnej zmiany treści");
  return String(ostatnia[0].data.html ?? "");
}

/** Zaznacza CAŁĄ treść akapitu w edytorze - punkt wyjścia dla formatowania. */
function zaznaczCalosc(): void {
  const pole = document.querySelector('[contenteditable="true"]');
  if (!(pole instanceof HTMLElement)) throw new Error("brak pola edycji akapitu");
  act(() => {
    pole.focus();
    const zaznaczenie = window.getSelection();
    const zakres = document.createRange();
    zakres.selectNodeContents(pole);
    zaznaczenie?.removeAllRanges();
    zaznaczenie?.addRange(zakres);
  });
}

describe("WordStyleToolbar - widocznosc", () => {
  it("pasek pokazuje się dla bloku AKTYWNEGO", () => {
    zamontuj("<p>Traktat</p>", true);
    expect(btn("Bold (⌘B)")).toBeInTheDocument();
    expect(btn(t("blocks.toolbar.footnoteInsert"))).toBeInTheDocument();
  });

  it("pasek NIE pokazuje się dla bloku nieaktywnego", () => {
    zamontuj("<p>Traktat</p>", false);
    expect(screen.queryByRole("button", { name: "Bold (⌘B)" })).toBeNull();
  });

  it("cofanie i ponawianie są WYŁĄCZONE, dopóki edytor nie ma historii", () => {
    zamontuj("<p>Traktat</p>");
    expect(btn(t("blocks.toolbar.undo"))).toBeDisabled();
    expect(btn(t("blocks.toolbar.redo"))).toBeDisabled();
  });
});

describe("WordStyleToolbar - cofanie i ponawianie po powstaniu historii", () => {
  it("po zmianie treści cofanie WŁĄCZA się i zdejmuje ostatnią zmianę", () => {
    const { onChange } = zamontujSterowany("<p>Traktat</p>");
    zaznaczCalosc();
    fireEvent.click(btn("Bold (⌘B)"));
    expect(ostatniHtml(onChange)).toMatch(/<strong>/);

    const cofnij = btn(t("blocks.toolbar.undo"));
    expect(cofnij).toBeEnabled();
    fireEvent.click(cofnij);

    const html = ostatniHtml(onChange);
    expect(html).not.toMatch(/<strong>/);
    // Cofnięcie formatowania nie ma prawa zabrać treści.
    expect(html).toContain("Traktat");
  });

  it("ponawianie przywraca cofniętą zmianę, a nie dokłada nowej", () => {
    const { onChange } = zamontujSterowany("<p>Traktat</p>");
    zaznaczCalosc();
    fireEvent.click(btn("Bold (⌘B)"));
    fireEvent.click(btn(t("blocks.toolbar.undo")));
    expect(ostatniHtml(onChange)).not.toMatch(/<strong>/);

    const ponow = btn(t("blocks.toolbar.redo"));
    expect(ponow).toBeEnabled();
    fireEvent.click(ponow);

    const html = ostatniHtml(onChange);
    expect(html).toMatch(/<strong>/);
    expect(html.match(/<strong>/g)).toHaveLength(1);
    expect(html).toContain("Traktat");
  });
});

describe("WordStyleToolbar - formatowanie znakow zapisuje SEMANTYKE", () => {
  const przypadki: ReadonlyArray<readonly [string, RegExp]> = [
    ["Bold (⌘B)", /<strong>/],
    ["Italic (⌘I)", /<em>/],
    ["Strikethrough", /<s>/],
    ["Subscript", /<sub>/],
    ["Superscript", /<sup>/],
    ["Code", /<code>/],
  ];

  it.each(przypadki)("przycisk %s zakłada znacznik %s", (nazwa, wzorzec) => {
    const { onChange } = zamontuj("<p>Traktat</p>");
    zaznaczCalosc();
    fireEvent.click(btn(nazwa));
    const html = ostatniHtml(onChange);
    expect(html).toMatch(wzorzec);
    // Semantyka, nie wygląd: żadnych stylów inline w treści CMS-a.
    expect(html).not.toContain("style=");
    expect(html).toContain("Traktat");
  });

  it("podkreślenie zakłada znacznik <u>", () => {
    const { onChange } = zamontuj("<p>Traktat</p>");
    zaznaczCalosc();
    fireEvent.click(btn("Underline (⌘U)"));
    expect(ostatniHtml(onChange)).toMatch(/<u>/);
  });

  it("powtórny klik ZDEJMUJE formatowanie (przełącznik, nie dokładanie)", () => {
    const { onChange } = zamontuj("<p>Traktat</p>");
    zaznaczCalosc();
    fireEvent.click(btn("Bold (⌘B)"));
    expect(ostatniHtml(onChange)).toMatch(/<strong>/);
    zaznaczCalosc();
    fireEvent.click(btn("Bold (⌘B)"));
    expect(ostatniHtml(onChange)).not.toMatch(/<strong>/);
    expect(ostatniHtml(onChange)).toContain("Traktat");
  });

  it("aria-pressed odpowiada stanowi karetki, nie liczbie klików", () => {
    zamontuj("<p><strong>Traktat</strong></p>");
    zaznaczCalosc();
    // Po zaznaczeniu treści już pogrubionej przycisk ma być wciśnięty.
    expect(btn("Bold (⌘B)")).toHaveAttribute("aria-pressed", "true");
    expect(btn("Italic (⌘I)")).not.toHaveAttribute("aria-pressed");
  });

  it("gumka czyści formatowanie, zostawiając tekst", () => {
    const { onChange } = zamontuj("<p><strong><em>Traktat</em></strong></p>");
    zaznaczCalosc();
    fireEvent.click(btn(t("blocks.toolbar.clearFormatting")));
    const html = ostatniHtml(onChange);
    expect(html).not.toMatch(/<strong>|<em>/);
    expect(html).toContain("Traktat");
  });
});

describe("WordStyleToolbar - drugi wiersz: akapit, naglowki, wyrownanie, listy", () => {
  it("H2 zamienia akapit w nagłówek drugiego poziomu", () => {
    const { onChange } = zamontuj("<p>Traktat</p>");
    zaznaczCalosc();
    fireEvent.click(btn("H2"));
    expect(ostatniHtml(onChange)).toContain("<h2");
  });

  it("H1 i H3 działają tym samym mechanizmem, każdy na swoim poziomie", () => {
    const { onChange } = zamontuj("<p>Traktat</p>");
    zaznaczCalosc();
    fireEvent.click(btn("H1"));
    expect(ostatniHtml(onChange)).toContain("<h1");
    zaznaczCalosc();
    fireEvent.click(btn("H3"));
    expect(ostatniHtml(onChange)).toContain("<h3");
  });

  it("powrót do akapitu zdejmuje nagłówek", () => {
    const { onChange } = zamontuj("<h2>Traktat</h2>");
    zaznaczCalosc();
    fireEvent.click(btn(t("blocks.toolbar.paragraph")));
    const html = ostatniHtml(onChange);
    expect(html).not.toContain("<h2");
    expect(html).toContain("Traktat");
  });

  it("aktywny poziom nagłówka jest wciśnięty", () => {
    zamontuj("<h2>Traktat</h2>");
    zaznaczCalosc();
    expect(btn("H2")).toHaveAttribute("aria-pressed", "true");
    expect(btn("H1")).not.toHaveAttribute("aria-pressed");
  });

  it.each(["alignLeft", "alignCenter", "alignRight", "alignJustify"] as const)(
    "wyrównanie %s zapisuje się w treści",
    (klucz) => {
      const { onChange } = zamontuj("<p>Traktat</p>");
      zaznaczCalosc();
      fireEvent.click(btn(t(`blocks.toolbar.${klucz}`)));
      expect(ostatniHtml(onChange)).toContain("text-align");
    },
  );

  it("lista punktowana zamienia akapit w <ul>", () => {
    const { onChange } = zamontuj("<p>Traktat</p>");
    zaznaczCalosc();
    fireEvent.click(btn(t("blocks.toolbar.bulletList")));
    expect(ostatniHtml(onChange)).toContain("<ul>");
  });

  it("lista numerowana zamienia akapit w <ol>", () => {
    const { onChange } = zamontuj("<p>Traktat</p>");
    zaznaczCalosc();
    fireEvent.click(btn(t("blocks.toolbar.orderedList")));
    expect(ostatniHtml(onChange)).toContain("<ol>");
  });

  it("cytat blokowy zamienia akapit w <blockquote>", () => {
    const { onChange } = zamontuj("<p>Traktat</p>");
    zaznaczCalosc();
    fireEvent.click(btn(t("blocks.toolbar.blockquote")));
    expect(ostatniHtml(onChange)).toContain("<blockquote>");
  });

  it("aktywna lista jest wciśnięta", () => {
    zamontuj("<ul><li><p>Traktat</p></li></ul>");
    zaznaczCalosc();
    expect(btn(t("blocks.toolbar.bulletList"))).toHaveAttribute("aria-pressed", "true");
    expect(btn(t("blocks.toolbar.orderedList"))).not.toHaveAttribute("aria-pressed");
  });
});

describe("WordStyleToolbar - paleta koloru i wyroznienia", () => {
  it("klik w kolor tekstu otwiera paletę jako dialog", () => {
    zamontuj("<p>Traktat</p>");
    fireEvent.click(btn(t("blocks.toolbar.textColor")));
    expect(screen.getByRole("dialog", { name: t("blocks.toolbar.textColor") })).toBeInTheDocument();
  });

  it("wybór barwy zapisuje kolor w treści i zamyka paletę", () => {
    const { onChange } = zamontuj("<p>Traktat</p>");
    zaznaczCalosc();
    fireEvent.click(btn(t("blocks.toolbar.textColor")));
    fireEvent.click(screen.getByRole("button", { name: "#c0392b" }));
    expect(ostatniHtml(onChange)).toContain("#c0392b");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("paleta wyróżnienia ma osobny zestaw barw i osobny dialog", () => {
    zamontuj("<p>Traktat</p>");
    fireEvent.click(btn(t("blocks.toolbar.highlight")));
    const dialog = screen.getByRole("dialog", { name: t("blocks.toolbar.highlight") });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "#fff59d" })).toBeInTheDocument();
    // Barwy tekstu w tej palecie nie występują.
    expect(screen.queryByRole("button", { name: "#c0392b" })).toBeNull();
  });

  it("klik na ZEWNĄTRZ paska zamyka otwartą paletę", () => {
    zamontuj("<p>Traktat</p>");
    fireEvent.click(btn(t("blocks.toolbar.textColor")));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("wybór wyróżnienia zapisuje kolor tła w treści jako <mark>", () => {
    const { onChange } = zamontuj("<p>Traktat</p>");
    zaznaczCalosc();
    fireEvent.click(btn(t("blocks.toolbar.highlight")));
    fireEvent.click(screen.getByRole("button", { name: "#fff59d" }));
    const html = ostatniHtml(onChange);
    expect(html).toContain("<mark");
    expect(html).toContain("#fff59d");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("swatch PRZEZROCZYSTOŚCI w palecie wyróżnienia ZDEJMUJE wyróżnienie", () => {
    // Ostatnia kratka palety wyróżnienia to „brak koloru", nie kolejna barwa -
    // bez niej redaktor nie ma jak odkleić żółtego tła od raz podświetlonego
    // słowa.
    const { onChange } = zamontuj('<p><mark data-color="#fff59d">Traktat</mark></p>');
    zaznaczCalosc();
    fireEvent.click(btn(t("blocks.toolbar.highlight")));
    fireEvent.click(screen.getByRole("button", { name: "transparent" }));
    const html = ostatniHtml(onChange);
    expect(html).not.toContain("<mark");
    expect(html).toContain("Traktat");
  });

  it("guzik ⌫ w palecie koloru zdejmuje kolor tekstu i zamyka paletę", () => {
    const { onChange } = zamontuj('<p><span style="color: #c0392b">Traktat</span></p>');
    zaznaczCalosc();
    fireEvent.click(btn(t("blocks.toolbar.textColor")));
    fireEvent.click(btn("⌫"));
    const html = ostatniHtml(onChange);
    expect(html).not.toContain("#c0392b");
    expect(html).toContain("Traktat");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("guzik ⌫ w palecie wyróżnienia zdejmuje wyróżnienie i zamyka paletę", () => {
    const { onChange } = zamontuj('<p><mark data-color="#90caf9">Traktat</mark></p>');
    zaznaczCalosc();
    fireEvent.click(btn(t("blocks.toolbar.highlight")));
    fireEvent.click(btn("⌫"));
    const html = ostatniHtml(onChange);
    expect(html).not.toContain("<mark");
    expect(html).toContain("Traktat");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("otwarcie palety wyróżnienia ZAMYKA paletę koloru - naraz widać jedną", () => {
    // Dwie rozwinięte palety obok siebie zasłaniałyby akapit pod paskiem.
    zamontuj("<p>Traktat</p>");
    fireEvent.click(btn(t("blocks.toolbar.textColor")));
    expect(screen.getByRole("dialog", { name: t("blocks.toolbar.textColor") })).toBeInTheDocument();
    fireEvent.click(btn(t("blocks.toolbar.highlight")));
    expect(screen.queryByRole("dialog", { name: t("blocks.toolbar.textColor") })).toBeNull();
    expect(screen.getByRole("dialog", { name: t("blocks.toolbar.highlight") })).toBeInTheDocument();
  });
});

describe("WordStyleToolbar - pasek nie kradnie zaznaczenia", () => {
  it("wciśnięcie przycisku NIE gasi zaznaczenia w edytorze", () => {
    // Bez `preventDefault` na `mousedown` przeglądarka przenosi fokus na
    // przycisk i gasi zaznaczenie ZANIM dojdzie `click` - komenda paska
    // działałaby wtedy na pustym zakresie.
    zamontuj("<p>Traktat</p>");
    const zdarzenie = new Event("mousedown", { bubbles: true, cancelable: true });
    fireEvent(btn("Bold (⌘B)"), zdarzenie);
    expect(zdarzenie.defaultPrevented).toBe(true);
  });

  it("wciśnięcie TŁA paska (obok przycisków) też nie gasi zaznaczenia", () => {
    const { view } = zamontuj("<p>Traktat</p>");
    const pasek = view.container.querySelector<HTMLElement>(".flex.flex-col.gap-1");
    expect(pasek).not.toBeNull();
    const zdarzenie = new Event("mousedown", { bubbles: true, cancelable: true });
    fireEvent(pasek!, zdarzenie);
    expect(zdarzenie.defaultPrevented).toBe(true);
  });

  it("wciśnięcie w OTWARTĄ paletę nie gasi zaznaczenia, więc barwa trafia na tekst", () => {
    zamontuj("<p>Traktat</p>");
    fireEvent.click(btn(t("blocks.toolbar.textColor")));
    const zdarzenie = new Event("mousedown", { bubbles: true, cancelable: true });
    fireEvent(screen.getByRole("dialog"), zdarzenie);
    expect(zdarzenie.defaultPrevented).toBe(true);
  });
});

describe("WordStyleToolbar - dialog linku", () => {
  it("potwierdzenie adresu zakłada link na zaznaczeniu", async () => {
    const { onChange } = zamontuj("<p>Traktat</p>");
    zaznaczCalosc();
    fireEvent.click(btn("Link (⌘K)"));
    const zapytanie = await odpowiedz("https://example.org/traktat");
    expect(zapytanie).toMatchObject({ title: "Link", defaultValue: "https://" });
    const html = ostatniHtml(onChange);
    expect(html).toContain('href="https://example.org/traktat"');
    expect(html).toContain("Traktat");
  });

  it("PUSTA wartość ZDEJMUJE link, a nie zakłada linku do pustego adresu", async () => {
    const { onChange } = zamontuj('<p><a href="https://example.org/stary">Traktat</a></p>');
    zaznaczCalosc();
    fireEvent.click(btn("Link (⌘K)"));
    await odpowiedz("");
    const html = ostatniHtml(onChange);
    expect(html).not.toContain("<a");
    expect(html).toContain("Traktat");
  });

  it("anulowanie dialogu nie rusza treści", async () => {
    const { onChange } = zamontuj("<p>Traktat</p>");
    zaznaczCalosc();
    fireEvent.click(btn("Link (⌘K)"));
    await odpowiedz(null);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("przycisk odłączenia linku zdejmuje <a> z treści", () => {
    const { onChange } = zamontuj('<p><a href="https://example.org/stary">Traktat</a></p>');
    zaznaczCalosc();
    fireEvent.click(btn(t("blocks.toolbar.unlink")));
    expect(ostatniHtml(onChange)).not.toContain("<a");
  });
});

describe("WordStyleToolbar - wstawianie przypisu", () => {
  it("marker ląduje OBOK zaznaczonego słowa, nie zamiast niego", async () => {
    // To jest zapisana regresja: podmiana zaznaczenia gubiła autorowi słowo,
    // do którego podpinał notę.
    const { onChange } = zamontuj("<p>Traktat lizboński</p>");
    zaznaczCalosc();
    fireEvent.click(btn(t("blocks.toolbar.footnoteInsert")));
    const zapytanie = await odpowiedz("Dz.U. 2026 poz. 1");
    // Dialog podpowiada zaznaczony tekst jako punkt wyjścia treści noty.
    expect(zapytanie).toMatchObject({ defaultValue: "Traktat lizboński" });
    const html = ostatniHtml(onChange);
    expect(html).toContain("Traktat lizboński");
    expect(html).toContain("[fn]Dz.U. 2026 poz. 1[/fn]");
  });

  it("pusta treść noty nie wstawia markera", async () => {
    const { onChange } = zamontuj("<p>Traktat</p>");
    zaznaczCalosc();
    fireEvent.click(btn(t("blocks.toolbar.footnoteInsert")));
    await odpowiedz("   ");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("anulowanie dialogu przypisu nie wstawia markera", async () => {
    const { onChange } = zamontuj("<p>Traktat</p>");
    zaznaczCalosc();
    fireEvent.click(btn(t("blocks.toolbar.footnoteInsert")));
    await odpowiedz(null);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("przy PUSTYM zaznaczeniu (sama karetka) dialog nie podpowiada nic, a marker ląduje w kursorze", async () => {
    // Druga gałąź `insertFootnote`: bez zaznaczenia nie ma słowa, z którego
    // można by wziąć treść noty, więc pole startuje puste - podpowiedź
    // „undefined" albo cały akapit byłyby tu gorsze niż pustka.
    const { onChange } = zamontuj("<p>Traktat lizboński</p>");
    fireEvent.click(btn(t("blocks.toolbar.footnoteInsert")));
    const zapytanie = await odpowiedz("Dz.U. 2026 poz. 2");
    expect(zapytanie).toMatchObject({ defaultValue: "" });
    const html = ostatniHtml(onChange);
    expect(html).toContain("[fn]Dz.U. 2026 poz. 2[/fn]");
    expect(html).toContain("Traktat lizboński");
  });

  it("DRUGI przypis w tym samym akapicie nie zjada pierwszego", async () => {
    const { onChange } = zamontuj("<p>Traktat[fn]Pierwsza nota[/fn] lizboński</p>");
    zaznaczCalosc();
    fireEvent.click(btn(t("blocks.toolbar.footnoteInsert")));
    await odpowiedz("Druga nota");
    const html = ostatniHtml(onChange);
    expect(html).toContain("[fn]Pierwsza nota[/fn]");
    expect(html).toContain("[fn]Druga nota[/fn]");
  });
});

describe("WordStyleToolbar - i18n PL/EN", () => {
  it("napisy paska istnieją w OBU językach", () => {
    const pl = realT("pl");
    const en = realT("en");
    const klucze = [
      "blocks.toolbar.undo",
      "blocks.toolbar.redo",
      "blocks.toolbar.textColor",
      "blocks.toolbar.highlight",
      "blocks.toolbar.clearFormatting",
      "blocks.toolbar.unlink",
      "blocks.toolbar.footnote",
      "blocks.toolbar.footnoteInsert",
      "blocks.toolbar.footnotePrompt",
      "blocks.toolbar.insert",
      "blocks.toolbar.apply",
      "blocks.toolbar.paragraph",
      "blocks.toolbar.alignLeft",
      "blocks.toolbar.alignCenter",
      "blocks.toolbar.alignRight",
      "blocks.toolbar.alignJustify",
      "blocks.toolbar.bulletList",
      "blocks.toolbar.orderedList",
      "blocks.toolbar.blockquote",
    ];
    for (const klucz of klucze) {
      expect(pl(klucz)).not.toBe(klucz);
      expect(en(klucz)).not.toBe(klucz);
    }
    expect(klucze.filter((k) => pl(k) !== en(k)).length).toBeGreaterThan(klucze.length / 2);
  });
});
