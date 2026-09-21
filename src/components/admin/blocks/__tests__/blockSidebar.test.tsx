// PANEL BOCZNY EDYTORA WPISU (`BlockSidebar`) - inspektor bloku i dokumentu.
//
// To JEDYNE miejsce w edytorze wpisu, w ktorym redaktor ustawia to, czego nie
// da sie wpisac w kanwie: poziom nagłowka, alt obrazu, wariant callouta,
// wyrownanie, marginesy i ukrycie bloku na opublikowanej stronie. Kanwa edytuje
// TRESC, panel boczny edytuje METADANE bloku - a te metadane jada prosto do
// dokumentu zapisywanego w bazie i czytanego przez publiczny renderer.
//
// CO TU JEST NAPRAWDE DO OBRONY
//
// 1. KAZDA KONTROLKA PISZE POD SWOJ KLUCZ I NIE KASUJE SASIADOW. Panel nie
//    oddaje rodzicowi "zmiany", tylko CALY nowy blok
//    (`onChange({ ...block, data: { ...block.data, [key]: value } })`). Pomylka
//    w rozlozeniu spreadu nie daje bledu - daje cicha utrate pola, ktore
//    redaktor ustawil minute wczesniej. Dlatego asercje ida na to, co ZOSTALO
//    w bloku, a nie tylko na to, co sie zmienilo.
// 2. GRANICA `data` / `style`. Wyrownanie, marginesy i ukrycie naleza do
//    `style`, cala reszta do `data`. Przeciek w jedna strone psuje serializacje
//    Gutenberga, w druga - publiczny renderer, ktory czyta `style` osobno
//    (`BlocksRenderer.tsx:80`).
// 3. SEKCJA UKLADU DLA KAZDEGO TYPU. Wlasne kontrolki dostaje 11 typow
//    z `HANDLED_TYPES` (BlockSidebar.tsx:177-189), ale WSZYSTKIE pozostale
//    (rejestr ma ich grubo ponad setke) musza dostac pelna sekcje ukladu plus
//    podpowiedz "edytuj w kanwie" - zamiast panelu z samotna lista wyrownania,
//    ktory wyglada na zepsuty. To jest opisane wprost w komentarzu produkcyjnym
//    (linie 173-176) jako naprawiony regres, wiec ma byc przypiete.
// 4. DWA STANY OBUDOWY. Zwiniety panel to szyna trzech ikon; skrot "Blok" jest
//    WYLACZONY bez zaznaczenia, a rozwiniecie skrotem ma wejsc na TE zakladke,
//    ktora redaktor wskazal ikona - inaczej klik w "Blok" rozwija "Dokument".
//
// GRANICA DOWODU
//  * Radixowy `Select` i `Switch` nie otwieraja listy ani nie przelaczaja sie
//    pod happy-dom (potrzebuja zdarzen wskaznika i pomiarow ukladu), wiec stoja
//    tu repo-we atrapy `radixSelectStub` / `radixSwitchStub` - natywny
//    `<select>` i `<input type="checkbox" role="switch">`. Warstwa rozwijana
//    Radiksa nie ma tu wiec zadnego dowodu; ma go WYBOR wartosci, czyli to, co
//    faktycznie laduje w dokumencie, i PELNA oferta opcji.
//  * ZAKLADKI zostaja PRAWDZIWE (Radix przelacza panel od `mouseDown`), bo od
//    nich zalezy atrybut `disabled` zakladki "Blok" - repo-wa atrapa zakladek
//    tego atrybutu nie przekazuje i zjadlaby caly ten dowod.
//  * DnD listy blokow nie jest tu dowodzone - `BlockListView` to osobna
//    powierzchnia; tutaj sprawdzamy wylacznie, ze panel podaje jej dokument
//    i przepuszcza zaznaczenie do rodzica.
//  * Tooltipy Radiksa zostaja nieotwarte (potrzebuja hoveru i pomiarow), wiec
//    nazwy przyciskow szyny czytamy z `aria-label`, tak jak czytnik ekranu.
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import i18n from "@/lib/i18n";
import { realT } from "@/test/i18nReal";
import type { Block, BlockStyle, BlockType, BlocksDoc, Json } from "@/lib/blocks/types";

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});

vi.mock("@/components/ui/switch", async () => {
  const React = await import("react");
  const { radixSwitchStub } = await import("@/test/reactStubs");
  return radixSwitchStub(React);
});

const { BlockSidebar } = await import("../BlockSidebar");

const t = realT("pl");
const tEn = realT("en");

// --- fixture'y --------------------------------------------------------------

function blok(type: BlockType, data: Record<string, Json> = {}, style?: BlockStyle): Block {
  return style ? { id: "b1", type, data, style } : { id: "b1", type, data };
}

function dokument(...bloki: Block[]): BlocksDoc {
  return { version: 1, blocks: bloki };
}

// --- montaz -----------------------------------------------------------------

interface OpcjeMontazu {
  /** Blok "zaznaczony w kanwie" - rodzic podaje go z zewnatrz. */
  aktywny?: Block | null;
  doc?: BlocksDoc;
  /** Panel startuje zwiniety (tak jak po odswiezeniu z zapamietanym stanem). */
  zwiniety?: boolean;
  /**
   * Rodzic BEZ obslugi zwijania - `collapsed`/`onToggleCollapse` sa opcjonalne,
   * a `RichTextEditor` w Visual Builderze montuje edytor wlasnie tak.
   */
  bezZwijania?: boolean;
}

/**
 * Gospodarz w ksztalcie, w jakim panel dostaje props z `PostBlockEditor`:
 * trzyma aktywny blok w stanie i ODDAJE Z POWROTEM to, co panel przysle.
 * Bez tego echa druga zmiana tego samego bloku pisalaby po starej wartosci
 * i test nie zobaczylby, czy pola sie kumuluja, czy kasuja.
 */
function zamontuj(opcje: OpcjeMontazu = {}) {
  const zmiany: Block[] = [];
  const wybrane: Array<string | null> = [];
  const zaznaczenia: Array<readonly string[]> = [];
  const przestawienia: Array<[number, number]> = [];
  let ustawZZewnatrz: ((next: Block | null) => void) | null = null;

  function Gospodarz() {
    const [aktywny, setAktywny] = useState<Block | null>(opcje.aktywny ?? null);
    const [zwiniety, setZwiniety] = useState<boolean>(opcje.zwiniety ?? false);
    ustawZZewnatrz = setAktywny;
    return (
      <BlockSidebar
        doc={opcje.doc ?? dokument()}
        activeBlock={aktywny}
        activeId={aktywny?.id ?? null}
        onSelect={(id) => wybrane.push(id)}
        onChangeBlock={(next) => {
          zmiany.push(next);
          setAktywny(next);
        }}
        selectedIds={[]}
        onSelectedIdsChange={(ids) => zaznaczenia.push(ids)}
        onReorder={(from, to) => przestawienia.push([from, to])}
        documentPane={<div data-testid="panel-dokumentu" />}
        collapsed={opcje.bezZwijania ? undefined : zwiniety}
        onToggleCollapse={opcje.bezZwijania ? undefined : () => setZwiniety((v) => !v)}
      />
    );
  }

  render(<Gospodarz />);
  return {
    zmiany,
    wybrane,
    zaznaczenia,
    przestawienia,
    /** Zaznaczenie bloku PRZEZ RODZICA - tak robi klik w kanwie. */
    zaznaczWKanwie(next: Block | null) {
      act(() => ustawZZewnatrz?.(next));
    },
  };
}

// --- odczyt panelu ----------------------------------------------------------

function przycisk(nazwa: string): HTMLElement {
  return screen.getByRole("button", { name: nazwa });
}

function zakladka(nazwa: string): HTMLElement {
  return screen.getByRole("tab", { name: nazwa });
}

/** Wejscie na zakladke "Blok" - Radix przelacza panel od `mouseDown`. */
function otworzZakladkeBloku(): void {
  fireEvent.mouseDown(zakladka(t("blocks.sidebar.block")));
}

/**
 * Lista wyboru rozpoznana po PELNYM zbiorze swoich opcji.
 *
 * Kontrolki panelu nie maja `aria-label` ani `htmlFor` - etykieta stoi OBOK
 * listy, wiec nie da sie ich znalezc nazwa dostepna. Indeks bylby kruchy (panel
 * pokazuje do czterech list naraz), a pojedyncza opcja nie wystarcza:
 * wartosc "wide" wystepuje i w wariantach separatora, i w wyrownaniu. Dopiero
 * caly zbior opcji jest jednoznaczny - i przy okazji asercja na niego jest
 * asercja na PELNA oferte wyboru.
 */
function listaOpcji(...wartosci: string[]): HTMLSelectElement {
  const oczekiwany = wartosci.join("|");
  const pasujace = Array.from(document.querySelectorAll("select")).filter(
    (select) =>
      Array.from(select.options)
        .map((o) => o.value)
        .join("|") === oczekiwany,
  );
  if (pasujace.length !== 1) {
    throw new Error(
      `test: oczekiwano DOKLADNIE jednej listy o opcjach [${oczekiwany}], znaleziono ${pasujace.length}`,
    );
  }
  return pasujace[0];
}

const OPCJE_WYROWNANIA = ["left", "center", "right", "wide", "full"] as const;

function listaWyrownania(): HTMLSelectElement {
  return listaOpcji(...OPCJE_WYROWNANIA);
}

/** Oba pola odstepu - `<input type="number">` ma role `spinbutton`. */
function polaOdstepu(): HTMLElement[] {
  return screen.getAllByRole("spinbutton");
}

function przelacznikUkrycia(): HTMLElement {
  return screen.getByRole("switch");
}

function ostatniaZmiana(zmiany: Block[]): Block {
  const ostatnia = zmiany.at(-1);
  if (!ostatnia) throw new Error("test: panel nie oddal ani jednej zmiany bloku");
  return ostatnia;
}

/** Skrot: montuje panel z aktywnym blokiem i od razu wchodzi na jego zakladke. */
function zInspektorem(aktywny: Block, doc?: BlocksDoc) {
  const harness = zamontuj({ aktywny, doc });
  otworzZakladkeBloku();
  return harness;
}

// ── OBUDOWA: ZWINIETA SZYNA IKON ────────────────────────────────────────────

describe("BlockSidebar - zwinieta szyna ikon", () => {
  it("zwiniety panel oddaje trzy skroty i chowa caly inspektor", () => {
    zamontuj({ zwiniety: true, aktywny: blok("heading", { level: 2 }) });

    expect(przycisk(t("blocks.sidebar.expand"))).toBeInTheDocument();
    expect(przycisk(t("blocks.sidebar.block"))).toBeInTheDocument();
    expect(przycisk(t("blocks.sidebar.document"))).toBeInTheDocument();
    // Zwiniety panel nie renderuje ani zakladek, ani kontrolek bloku - inaczej
    // szerokosc szyny (w-8) obcinalaby dzialajacy formularz.
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(document.querySelectorAll("select")).toHaveLength(0);
  });

  it("skrot „Blok” jest WYLACZONY, dopoki redaktor niczego nie zaznaczyl", () => {
    zamontuj({ zwiniety: true });

    expect(przycisk(t("blocks.sidebar.block"))).toBeDisabled();
    expect(przycisk(t("blocks.sidebar.document"))).toBeEnabled();
  });

  it("skrot „Blok” odblokowuje sie, gdy rodzic poda zaznaczony blok", () => {
    const { zaznaczWKanwie } = zamontuj({ zwiniety: true });
    expect(przycisk(t("blocks.sidebar.block"))).toBeDisabled();

    zaznaczWKanwie(blok("quote", { cite: "Instytut Testowy" }));

    expect(przycisk(t("blocks.sidebar.block"))).toBeEnabled();
  });

  it("strzalka rozwijajaca wraca do panelu z zakladkami", () => {
    zamontuj({ zwiniety: true });

    fireEvent.click(przycisk(t("blocks.sidebar.expand")));

    expect(zakladka(t("blocks.sidebar.document"))).toBeInTheDocument();
    expect(screen.queryByLabelText(t("blocks.sidebar.expand"))).not.toBeInTheDocument();
  });

  it("skrot „Blok” rozwija panel WLASNIE na zakladce bloku, a nie na dokumencie", () => {
    zamontuj({ zwiniety: true, aktywny: blok("code", { lang: "ts" }) });

    fireEvent.click(przycisk(t("blocks.sidebar.block")));

    expect(zakladka(t("blocks.sidebar.block"))).toHaveAttribute("data-state", "active");
    expect(screen.queryByTestId("panel-dokumentu")).not.toBeInTheDocument();
  });

  it("skrot „Dokument” rozwija panel na zakladce dokumentu nawet z zaznaczonym blokiem", () => {
    zamontuj({ zwiniety: true, aktywny: blok("code", { lang: "ts" }) });

    fireEvent.click(przycisk(t("blocks.sidebar.document")));

    expect(zakladka(t("blocks.sidebar.document"))).toHaveAttribute("data-state", "active");
    expect(screen.getByTestId("panel-dokumentu")).toBeInTheDocument();
  });

  it("wybor zakladki ze zwinietej szyny PRZEZYWA kolejne zwiniecie i rozwiniecie", () => {
    zamontuj({ zwiniety: true, aktywny: blok("code", { lang: "ts" }) });

    fireEvent.click(przycisk(t("blocks.sidebar.block")));
    fireEvent.click(przycisk(t("blocks.sidebar.collapse")));
    fireEvent.click(przycisk(t("blocks.sidebar.expand")));

    // Stan zakladki mieszka w komponencie, nie w rodzicu - zwiniecie nie moze
    // go resetowac, bo redaktor wracalby za kazdym razem na "Dokument".
    expect(zakladka(t("blocks.sidebar.block"))).toHaveAttribute("data-state", "active");
  });

  it("rodzic bez obslugi zwijania dostaje panel rozwiniety i klik go nie wywraca", () => {
    // `collapsed`/`onToggleCollapse` sa opcjonalne (Props:34-35), a Visual
    // Builder montuje edytor wpisu wlasnie bez nich. Brak handlera nie moze
    // rzucic - stad `onToggleCollapse?.()` w produkcji.
    zamontuj({ bezZwijania: true, aktywny: blok("quote", { cite: "x" }) });

    expect(zakladka(t("blocks.sidebar.document"))).toBeInTheDocument();
    fireEvent.click(przycisk(t("blocks.sidebar.collapse")));

    expect(zakladka(t("blocks.sidebar.document"))).toBeInTheDocument();
  });
});

// ── OBUDOWA: ZAKLADKI ───────────────────────────────────────────────────────

describe("BlockSidebar - zakladki panelu", () => {
  it("bez zaznaczenia panel stoi na „Dokumencie”, a zakladka „Blok” jest wylaczona", () => {
    zamontuj();

    expect(zakladka(t("blocks.sidebar.document"))).toHaveAttribute("data-state", "active");
    expect(zakladka(t("blocks.sidebar.block"))).toBeDisabled();
  });

  it("zakladka dokumentu pokazuje liste blokow i panel dokumentu pod nia", () => {
    zamontuj({
      doc: dokument(blok("heading", { level: 2, text: "Tytul" }), {
        id: "b2",
        type: "quote",
        data: { text: "cytat" },
      }),
    });

    const drzewo = screen.getByRole("tree", { name: t("blocks.listView.title") });
    expect(within(drzewo).getAllByRole("treeitem")).toHaveLength(2);
    expect(screen.getByTestId("panel-dokumentu")).toBeInTheDocument();
  });

  it("klik w wiersz listy przepuszcza wybor bloku do rodzica", () => {
    const { wybrane, zaznaczenia } = zamontuj({
      doc: dokument(blok("heading", { level: 2 }), { id: "b2", type: "quote", data: {} }),
    });

    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("blocks.types.quote")) }));

    expect(wybrane).toEqual(["b2"]);
    // Pojedynczy klik czysci zaznaczenie wielokrotne - panel tylko je przekazuje.
    expect(zaznaczenia).toEqual([[]]);
  });

  it("po zaznaczeniu bloku zakladka „Blok” daje sie otworzyc i pokazuje inspektor", () => {
    const { zaznaczWKanwie } = zamontuj();
    zaznaczWKanwie(blok("code", { lang: "python" }));

    otworzZakladkeBloku();

    expect(zakladka(t("blocks.sidebar.block"))).toHaveAttribute("data-state", "active");
    expect(screen.getByDisplayValue("python")).toBeInTheDocument();
  });

  it("odznaczenie bloku w kanwie SPYCHA panel z powrotem na zakladke dokumentu", () => {
    const { zaznaczWKanwie } = zamontuj({ aktywny: blok("code", { lang: "python" }) });
    otworzZakladkeBloku();

    zaznaczWKanwie(null);

    // Inspektor bez bloku nie ma czego pokazac, wiec panel nie moze zostac na
    // pustej zakladce - to jest sens `effectiveTab` (BlockSidebar.tsx:55).
    expect(zakladka(t("blocks.sidebar.document"))).toHaveAttribute("data-state", "active");
    expect(screen.getByTestId("panel-dokumentu")).toBeInTheDocument();
  });
});

// ── INSPEKTOR: POLA SPECYFICZNE DLA TYPU ────────────────────────────────────

describe("BlockSidebar - inspektor bloku, kontrolki wlasne typu", () => {
  it("naglowek: lista poziomow oferuje H2-H5 i zapisuje LICZBE, nie napis", () => {
    const { zmiany } = zInspektorem(blok("heading", { level: 2, anchor: "wstep" }));

    const poziomy = listaOpcji("2", "3", "4", "5");
    expect(poziomy).toHaveValue("2");
    fireEvent.change(poziomy, { target: { value: "4" } });

    expect(ostatniaZmiana(zmiany).data.level).toBe(4);
    // Anchor ma przetrwac zmiane poziomu - to ten sam obiekt `data`.
    expect(ostatniaZmiana(zmiany).data.anchor).toBe("wstep");
  });

  it("naglowek bez zapisanego poziomu pokazuje domyslne H2, a nie puste pole", () => {
    // Blok wstawiony z palety niesie `level: 2`, ale dokumenty po migracjach
    // potrafia miec `data` bez tego klucza - `?? 2` w BlockSidebar.tsx:223 jest
    // wtedy jedynym powodem, dla ktorego lista w ogole cos pokazuje.
    zInspektorem(blok("heading", {}));

    expect(listaOpcji("2", "3", "4", "5")).toHaveValue("2");
  });

  it("naglowek: anchor zapisuje sie jako napis i nie rusza poziomu", () => {
    const { zmiany } = zInspektorem(blok("heading", { level: 3, anchor: "" }));

    fireEvent.change(screen.getByPlaceholderText(t("blocks.settings.anchorPh")), {
      target: { value: "sekcja-druga" },
    });

    expect(ostatniaZmiana(zmiany).data).toEqual({ level: 3, anchor: "sekcja-druga" });
  });

  it("obraz: URL, alt i link pisza pod TRZY rozne klucze `data`", () => {
    const { zmiany } = zInspektorem(
      blok("image", {
        url: "https://example.com/zdjecie.jpg",
        alt: "stary opis",
        href: "https://example.com/zrodlo",
      }),
    );

    fireEvent.change(screen.getByDisplayValue("stary opis"), { target: { value: "nowy opis" } });
    fireEvent.change(screen.getByDisplayValue("https://example.com/zdjecie.jpg"), {
      target: { value: "https://example.com/inne.jpg" },
    });
    fireEvent.change(screen.getByDisplayValue("https://example.com/zrodlo"), {
      target: { value: "https://example.com/cel" },
    });

    expect(ostatniaZmiana(zmiany).data).toEqual({
      url: "https://example.com/inne.jpg",
      alt: "nowy opis",
      href: "https://example.com/cel",
    });
  });

  it("obraz z pustymi polami pokazuje trzy pola tekstowe, a nie zadnego `undefined`", () => {
    zInspektorem(blok("image", {}));

    const pola = screen.getAllByRole("textbox");
    expect(pola).toHaveLength(3);
    for (const pole of pola) expect(pole).toHaveValue("");
  });

  it("lista: wybor „numerowana” zapisuje BOOLEAN, a nie napis z listy", () => {
    const { zmiany } = zInspektorem(blok("list", { ordered: false, items: [] }));

    const typListy = listaOpcji("unordered", "ordered");
    expect(typListy).toHaveValue("unordered");
    fireEvent.change(typListy, { target: { value: "ordered" } });

    expect(ostatniaZmiana(zmiany).data.ordered).toBe(true);
  });

  it("lista: powrot na „punktowana” zapisuje `false`, a nie kasuje klucza", () => {
    const { zmiany } = zInspektorem(blok("list", { ordered: true, items: [] }));

    fireEvent.change(listaOpcji("unordered", "ordered"), { target: { value: "unordered" } });

    expect(ostatniaZmiana(zmiany).data.ordered).toBe(false);
  });

  it("cytat: pole `cite` zapisuje zrodlo cytatu", () => {
    const { zmiany } = zInspektorem(blok("quote", { text: "tresc cytatu", cite: "" }));

    fireEvent.change(screen.getByPlaceholderText(t("blocks.settings.citePh")), {
      target: { value: "Instytut Testowy" },
    });

    expect(ostatniaZmiana(zmiany).data).toEqual({ text: "tresc cytatu", cite: "Instytut Testowy" });
  });

  it("embed: pole adresu osadzenia zapisuje URL", () => {
    const { zmiany } = zInspektorem(blok("embed", { url: "" }));

    fireEvent.change(screen.getByPlaceholderText(t("blocks.settings.embedUrlPh")), {
      target: { value: "https://example.com/film" },
    });

    expect(ostatniaZmiana(zmiany).data.url).toBe("https://example.com/film");
  });

  it("wideo: adres pliku i poster to dwa OSOBNE klucze", () => {
    const { zmiany } = zInspektorem(blok("video", { url: "", poster: "" }));

    fireEvent.change(screen.getByPlaceholderText(t("blocks.settings.fileUrlPh")), {
      target: { value: "https://example.com/film.mp4" },
    });
    fireEvent.change(screen.getByPlaceholderText(t("blocks.settings.posterPh")), {
      target: { value: "https://example.com/okladka.jpg" },
    });

    expect(ostatniaZmiana(zmiany).data).toEqual({
      url: "https://example.com/film.mp4",
      poster: "https://example.com/okladka.jpg",
    });
  });

  it("callout: lista wariantow oferuje wszystkie cztery tony i zapisuje wybrany", () => {
    const { zmiany } = zInspektorem(blok("callout", { text: "uwaga" }));

    const warianty = listaOpcji("info", "warning", "success", "danger");
    // Brak `data.variant` musi pokazac domyslne „info", a nie puste pole.
    expect(warianty).toHaveValue("info");
    fireEvent.change(warianty, { target: { value: "danger" } });

    expect(ostatniaZmiana(zmiany).data.variant).toBe("danger");
  });

  it("przycisk: etykieta, href i wariant pisza pod trzy klucze i kumuluja sie", () => {
    const { zmiany } = zInspektorem(blok("button", { label: "Czytaj", href: "", variant: "" }));

    fireEvent.change(screen.getByDisplayValue("Czytaj"), { target: { value: "Pobierz raport" } });
    fireEvent.change(screen.getByPlaceholderText(t("blocks.settings.urlPh")), {
      target: { value: "https://example.com/raport" },
    });
    fireEvent.change(listaOpcji("default", "outline", "ghost"), { target: { value: "outline" } });

    expect(ostatniaZmiana(zmiany).data).toEqual({
      label: "Pobierz raport",
      href: "https://example.com/raport",
      variant: "outline",
    });
  });

  it("przycisk wstawiony z palety ma puste pola i domyslny wariant „wypelniony”", () => {
    // Blok prosto z palety nie niesie zadnego z tych kluczy - panel musi pokazac
    // wlasne wartosci domyslne, a nie napis „undefined" w polu formularza.
    zInspektorem(blok("button", {}));

    const pola = screen.getAllByRole("textbox");
    expect(pola).toHaveLength(2);
    for (const pole of pola) expect(pole).toHaveValue("");
    expect(listaOpcji("default", "outline", "ghost")).toHaveValue("default");
  });

  it("separator: lista wariantow oferuje linie, gradient i kropki", () => {
    const { zmiany } = zInspektorem(blok("separator", {}));

    const warianty = listaOpcji("line", "wide", "dots");
    expect(warianty).toHaveValue("line");
    fireEvent.change(warianty, { target: { value: "dots" } });

    expect(ostatniaZmiana(zmiany).data.variant).toBe("dots");
  });

  it("kod: pole jezyka zapisuje sie jako napis", () => {
    const { zmiany } = zInspektorem(blok("code", { code: "print(1)", lang: "" }));

    fireEvent.change(screen.getByPlaceholderText(t("blocks.settings.codeLangPh")), {
      target: { value: "python" },
    });

    expect(ostatniaZmiana(zmiany).data).toEqual({ code: "print(1)", lang: "python" });
  });

  it("kod bez zapisanego jezyka pokazuje puste pole, a nie „undefined”", () => {
    zInspektorem(blok("code", {}));

    expect(screen.getByPlaceholderText(t("blocks.settings.codeLangPh"))).toHaveValue("");
  });

  it("html bez zapisanego markupu pokazuje pusta ramke, a nie „undefined”", () => {
    zInspektorem(blok("html", {}));

    expect(screen.getByPlaceholderText("<div>…</div>")).toHaveValue("");
  });

  it("html: pole surowego markupu zapisuje tresc i niesie note o sanitizacji", () => {
    const { zmiany } = zInspektorem(blok("html", { html: "" }));

    const pole = screen.getByPlaceholderText("<div>…</div>");
    expect(pole).toHaveAttribute("spellcheck", "false");
    fireEvent.change(pole, { target: { value: "<section>tresc</section>" } });

    expect(ostatniaZmiana(zmiany).data.html).toBe("<section>tresc</section>");
    // Nota jest jedynym miejscem, gdzie redaktor dowiaduje sie, ze wynik
    // przechodzi przez sanitizacje - bez niej wkleja skrypty w dobrej wierze.
    expect(screen.getByText(t("blocks.settings.rawHtmlNote"))).toBeInTheDocument();
  });
});

// ── INSPEKTOR: SEKCJA WSPOLNA ───────────────────────────────────────────────

describe("BlockSidebar - inspektor bloku, wspolna sekcja ukladu", () => {
  // Po jednym typie z kazdej rodziny: wlasne kontrolki (naglowek), typ bez
  // wlasnych kontrolek (akapit) i typ zlozony spoza `HANDLED_TYPES` (galeria).
  const TYPY_DO_PRZEGLADU: BlockType[] = ["heading", "paragraph", "gallery", "table"];

  it.each(TYPY_DO_PRZEGLADU)(
    "typ „%s” dostaje pelna sekcje ukladu: wyrownanie, dwa odstepy i przelacznik ukrycia",
    (typ) => {
      zInspektorem(blok(typ, {}));

      expect(listaWyrownania()).toBeInTheDocument();
      expect(polaOdstepu()).toHaveLength(2);
      expect(przelacznikUkrycia()).toBeInTheDocument();
    },
  );

  it.each(["paragraph", "gallery", "table"] as BlockType[])(
    "typ „%s” bez wlasnych kontrolek dostaje podpowiedz o edycji w kanwie",
    (typ) => {
      zInspektorem(blok(typ, {}));

      expect(screen.getByText(t("blocks.sidebar.canvasEdit"))).toBeInTheDocument();
    },
  );

  it.each(["heading", "image", "list", "quote", "embed", "video"] as BlockType[])(
    "typ „%s” ma wlasne kontrolki, wiec podpowiedzi o kanwie NIE pokazuje",
    (typ) => {
      zInspektorem(blok(typ, {}));

      expect(screen.queryByText(t("blocks.sidebar.canvasEdit"))).not.toBeInTheDocument();
    },
  );

  it("wyrownanie pisze do `style`, nie do `data`, i nie rusza pozostalego stylu", () => {
    const { zmiany } = zInspektorem(
      blok("paragraph", { html: "<p>tekst</p>" }, { marginTop: 24, hidden: true }),
    );

    const wyrownanie = listaWyrownania();
    // Brak `style.align` musi pokazac domyslne „do lewej", a nie puste pole.
    expect(wyrownanie).toHaveValue("left");
    fireEvent.change(wyrownanie, { target: { value: "full" } });

    const po = ostatniaZmiana(zmiany);
    expect(po.style).toEqual({ marginTop: 24, hidden: true, align: "full" });
    expect(po.data).toEqual({ html: "<p>tekst</p>" });
  });

  it("wyrownanie odczytuje wartosc juz zapisana w dokumencie", () => {
    zInspektorem(blok("paragraph", {}, { align: "wide" }));

    expect(listaWyrownania()).toHaveValue("wide");
  });

  it("marginesy zapisuja LICZBE pod wlasciwy klucz i zostawiaja drugi w spokoju", () => {
    const { zmiany } = zInspektorem(blok("paragraph", {}, { align: "center" }));

    const [gora, dol] = polaOdstepu();
    fireEvent.change(gora, { target: { value: "48" } });
    fireEvent.change(dol, { target: { value: "16" } });

    expect(ostatniaZmiana(zmiany).style).toEqual({
      align: "center",
      marginTop: 48,
      marginBottom: 16,
    });
  });

  it("wyczyszczenie pola marginesu USUWA wartosc, zamiast zapisac zero albo NaN", () => {
    const { zmiany } = zInspektorem(blok("paragraph", {}, { marginTop: 64, marginBottom: 8 }));

    const [gora, dol] = polaOdstepu();
    expect(gora).toHaveValue(64);
    fireEvent.change(gora, { target: { value: "" } });

    // `undefined` to jedyna poprawna reprezentacja „bez marginesu": zero jest
    // JAWNYM zerem i nadpisuje odstep z arkusza stylow.
    expect(ostatniaZmiana(zmiany).style?.marginTop).toBeUndefined();
    expect(ostatniaZmiana(zmiany).style?.marginBottom).toBe(8);

    // To samo dla dolnego pola - ma wlasna galaz czyszczenia (linie 491-495).
    fireEvent.change(dol, { target: { value: "" } });

    expect(ostatniaZmiana(zmiany).style?.marginBottom).toBeUndefined();
  });

  it("pole marginesu bez wartosci w dokumencie startuje puste, a nie od zera", () => {
    zInspektorem(blok("paragraph", {}));

    for (const pole of polaOdstepu()) expect(pole).toHaveValue(null);
  });

  it("przelacznik ukrycia zapisuje `style.hidden`, a odznaczenie USUWA ten klucz", () => {
    const { zmiany } = zInspektorem(blok("paragraph", {}, { align: "center" }));

    const przelacznik = przelacznikUkrycia();
    expect(przelacznik).not.toBeChecked();
    fireEvent.click(przelacznik);
    expect(ostatniaZmiana(zmiany).style).toEqual({ align: "center", hidden: true });

    fireEvent.click(przelacznikUkrycia());

    // Odznaczenie ma ZDJAC flage, nie zapisac `hidden: false` - schemat
    // dokumentu trzyma tu wylacznie stan wlaczony (`schema.ts:21`).
    expect(ostatniaZmiana(zmiany).style?.hidden).toBeUndefined();
  });

  it("blok ukryty w dokumencie pokazuje przelacznik wlaczony i pozostaje edytowalny", () => {
    // `hidden` znaczy „niewidoczny NA OPUBLIKOWANEJ stronie, dalej edytowalny
    // w panelu" (`src/lib/blocks/types.ts:136`), wiec inspektor nie ma prawa
    // zablokowac ani jednej kontrolki.
    const { zmiany } = zInspektorem(blok("heading", { level: 2 }, { hidden: true }));

    expect(przelacznikUkrycia()).toBeChecked();
    fireEvent.change(listaOpcji("2", "3", "4", "5"), { target: { value: "5" } });

    expect(ostatniaZmiana(zmiany).data.level).toBe(5);
    expect(ostatniaZmiana(zmiany).style?.hidden).toBe(true);
  });

  it("inspektor nie zapisuje NICZEGO na samym renderze", () => {
    // Zapis bez akcji redaktora robi z kazdego kliku w kanwie „brudna" strone
    // i podbija historie undo o pusty wpis.
    const { zmiany } = zInspektorem(blok("callout", { text: "uwaga" }));

    expect(zmiany).toHaveLength(0);
  });
});

// ── DEFEKTY ─────────────────────────────────────────────────────────────────

describe("BlockSidebar - defekty", () => {
  // DEFEKT: ZAZNACZENIE BLOKU NIE PRZELACZA PANELU NA ZAKLADKE „BLOK".
  //
  // WEJSCIE: panel zamontowany bez zaznaczenia (stoi na „Dokumencie"), redaktor
  //   klika blok w kanwie - rodzic podaje `activeBlock`.
  // CO PSUJE: `BlockSidebar.tsx:54-55` deklaruje w komentarzu
  //   „Auto-switch to 'block' when a block is selected", ale kod robi coś
  //   ODWROTNEGO: `activeBlock ? tab : "document"` wymusza „document" tylko przy
  //   BRAKU bloku, a przy bloku oddaje `tab` - czyli stan poczatkowy
  //   `useState("document")` (linia 52). Auto-przelaczenia nie ma nigdzie.
  // KONSEKWENCJA: redaktor klika blok, zeby zmienic mu poziom albo alt, i widzi
  //   dalej liste blokow. Zakladka „Blok" wlasnie sie odblokowala, ale nic tego
  //   nie sygnalizuje - wiec inspektor uchodzi za pusty i sciezka „zaznacz blok
  //   -> ustaw metadane" wymaga dwoch klikniec zamiast jednego przez cale zycie
  //   sesji. Rozjazd komentarza z kodem jest tu grozniejszy niz sam brak
  //   funkcji: nastepny czytajacy uzna zachowanie za zaimplementowane.
  // WYMAGANA POPRAWKA: `effectiveTab` ma wchodzic na „block" przy PRZEJSCIU
  //   `activeBlock` z `null` na blok (efekt na zmianie `activeBlock`), zamiast
  //   biernie oddawac zapamietana zakladke.
  it.fails("DEFEKT: zaznaczenie bloku w kanwie ma przelaczyc panel na zakladke „Blok”", () => {
    const { zaznaczWKanwie } = zamontuj();

    zaznaczWKanwie(blok("heading", { level: 2, anchor: "wstep" }));

    expect(zakladka(t("blocks.sidebar.block"))).toHaveAttribute("data-state", "active");
  });

  // DEFEKT: KOMUNIKAT „WYBIERZ BLOK" JEST NIEOSIAGALNY, A JEGO KLUCZ MARTWY.
  //
  // WEJSCIE: panel bez zaznaczonego bloku - jedyny stan, w ktorym ten komunikat
  //   mialby sens.
  // CO PSUJE: galaz `BlockSidebar.tsx:147-151` renderuje
  //   `t("blocks.sidebar.selectBlock")` wtedy i tylko wtedy, gdy zakladka „block"
  //   jest AKTYWNA, a bloku NIE MA. Tymczasem `effectiveTab` (linia 55) wymusza
  //   „document" dokladnie w przypadku braku bloku, a `TabsContent` Radiksa
  //   odmontowuje nieaktywna zakladke. Warunek renderowania i warunek aktywnosci
  //   wykluczaja sie wiec wzajemnie - nie ma stanu, w ktorym ten `<p>` powstaje.
  // KONSEKWENCJA: martwa galaz UI plus martwy klucz slownika utrzymywany
  //   w OBU jezykach (`locale/pl.ts:1381`, `locale/en.ts:1372`). Bramki
  //   parytetu i18n licza go jako zywy, przeglad kodu widzi zachete, ktorej
  //   uzytkownik nigdy nie zobaczy, a pokrycie tej galezi nie da sie podniesc
  //   zadnym testem - co maskuje kazdy przyszly regres w tym miejscu.
  // WYMAGANA POPRAWKA: albo `effectiveTab` przestaje wymuszac „document" (wtedy
  //   zachęta jest widoczna, a wylaczona zakladka i tak nie da sie w nia wejsc
  //   myszka), albo galaz i oba klucze slownika znikaja. Stan posredni - kod
  //   i slownik obiecujace komunikat, ktorego nie ma - jest niedopuszczalny.
  it.fails("DEFEKT: zachęta „Wybierz blok…” ma byc dla redaktora osiagalna", () => {
    zamontuj();

    expect(screen.getByText(t("blocks.sidebar.selectBlock"))).toBeInTheDocument();
  });

  // DEFEKT: NAGLOWEK INSPEKTORA NIE PRZECHODZI PRZEZ i18n.
  //
  // WEJSCIE: panel z jezykiem interfejsu ustawionym na angielski i zaznaczonym
  //   blokiem naglowka.
  // CO PSUJE: `BlockSidebar.tsx:193` bierze `spec` z `BLOCK_SPECS` i wypisuje
  //   `spec.label` (linia 209) oraz `spec.description` (linia 210) WPROST.
  //   W rejestrze (`src/lib/blocks/registry.tsx:130-137`) oba pola sa twardymi
  //   polskimi napisami („Nagłówek", „H2, H3 lub H4 z opcjonalnym anchorem.").
  //   Cala reszta repo nazywa typy blokow przez slownik - `BlockInserter.tsx:90`,
  //   `BlockCanvas.tsx:449`, `Paragraph.tsx:100` i sasiadujaca `BlockListView`
  //   (linia 118) wolaja `t("blocks.types.<typ>")`, a klucze istnieja w obu
  //   jezykach. Inspektor jest jedynym miejscem, ktore te sciezke omija.
  // KONSEKWENCJA: w angielskim panelu TEN SAM blok nazywa sie „Heading" na
  //   liscie dokumentu i „Nagłówek" dwa centymetry obok, w naglowku inspektora,
  //   a pod nim stoi pelne polskie zdanie opisu. To nie jest brak tlumaczenia
  //   jednego napisu - to jedyna sciezka, ktora rejestr blokow wystawia
  //   uzytkownikowi bez slownika, wiec rosnie z kazdym nowym typem bloku.
  // WYMAGANA POPRAWKA: `BlockSettings` ma czytac nazwe przez
  //   `t("blocks.types.<typ>")` (klucze juz sa), a dla opisu albo dostac wlasny
  //   klucz `blocks.descriptions.<typ>`, albo przestac go pokazywac.
  it.fails(
    "DEFEKT: naglowek inspektora ma byc tlumaczony tak samo jak nazwa na liscie blokow",
    async () => {
      await i18n.changeLanguage("en");
      try {
        zInspektorem(blok("heading", { level: 2 }), dokument(blok("heading", { level: 2 })));

        expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(
          tEn("blocks.types.heading"),
        );
      } finally {
        // Odmontowanie PRZED powrotem do polskiego: `changeLanguage`
        // przerenderowuje kazdy zamontowany komponent, a ten render nie nalezy
        // juz do zadnego testu.
        cleanup();
        await i18n.changeLanguage("pl");
      }
    },
  );

  // DEFEKT: POLA ODSTEPU PRZYJMUJA WARTOSCI, KTORE SCHEMAT DOKUMENTU ODRZUCA.
  //
  // WEJSCIE: redaktor wpisuje w „Margines gorny" wartosc ujemna, wieksza niz 400
  //   albo ulamkowa - wszystkie trzy przechodza przez `<input type="number">`
  //   bez mrugniecia, bo `min`/`max` w HTML sa walidacja FORMULARZA, a formularza
  //   tu nie ma (`BlockSidebar.tsx:471-479` i :485-496 czytaja `e.target.value`
  //   wprost i wolaja `Number(...)`).
  // CO PSUJE: `BlockStyleSchema` (`src/lib/blocks/schema.ts:20-21`) wymaga
  //   `z.number().int().min(0).max(400)`. Zapisana wartosc jest wiec legalna dla
  //   panelu i NIELEGALNA dla dokumentu.
  // KONSEKWENCJA: nie jest to „brzydki odstep". `safeParseBlocks`
  //   (`schema.ts:149-167`) przy nieudanej walidacji CALEGO dokumentu przechodzi
  //   na tryb ratunkowy i przepuszcza wylacznie bloki, ktore waliduja sie
  //   pojedynczo - blok z `marginTop: -50` odpada. Publiczny renderer
  //   (`BlocksRenderer.tsx:16`) dostaje dokument BEZ tego bloku, wiec akapit
  //   znika z opublikowanej strony, choc w panelu redaktora stoi na swoim
  //   miejscu i wyglada na zapisany. Awaria jest cicha i widoczna wylacznie
  //   dla czytelnika.
  // WYMAGANA POPRAWKA: `setStyle` dla marginesow ma klamrowac wejscie do
  //   `0..400` i zaokraglac do liczby calkowitej (albo odrzucac wartosc spoza
  //   zakresu), tak samo jak robia to edytory z wlasnym klamrowaniem w
  //   `admin/blocks/edit/**`.
  it.fails(
    "DEFEKT: pole odstepu ma odrzucac wartosci, ktorych schemat dokumentu nie przyjmie",
    () => {
      const { zmiany } = zInspektorem(blok("paragraph", { html: "<p>tekst</p>" }));
      const [gora] = polaOdstepu();

      for (const wpisane of ["-50", "900", "12.5"]) {
        fireEvent.change(gora, { target: { value: wpisane } });
        const zapisany = ostatniaZmiana(zmiany).style?.marginTop;
        expect(zapisany).toBeTypeOf("number");
        expect(Number.isInteger(zapisany)).toBe(true);
        expect(zapisany).toBeGreaterThanOrEqual(0);
        expect(zapisany).toBeLessThanOrEqual(400);
      }
    },
  );
});
