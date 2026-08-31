// WKLEJANIE TRESCI Z OBCYM FORMATOWANIEM - pierwsza z czterech operacji
// groznych dla tresci redaktora, wymieniona w zadaniu wprost.
//
// CO MA TU DOWOD
// Przedmiotem dowodu jest UZYCIE parserow przez edytor, a nie same parsery
// (`lib/blocks/wordPaste`, `lib/blocks/clipboard` maja wlasne testy i wysokie
// pokrycie). Dowodzimy KOLEJNOSCI PROB i skutkow w dokumencie:
//
//   sentinel wlasny -> markup Gutenberga -> pliki graficzne -> Word/HTML
//   -> zwykly tekst
//
// oraz tego, ze:
//   * wklejka z Worda traci calkowicie obce formatowanie (klasy `Mso*`, style
//     `mso-*`, `font-family`, `<o:p>`), a zachowuje STRUKTURE (naglowek zostaje
//     naglowkiem, lista lista) - czyli redaktor nie wnosi do CMS-a stylow Worda,
//   * wklejka wlasnych blokow dostaje SWIEZE id. To nie kosmetyka: dwa bloki
//     o tym samym id sa dla `replaceBlock` (mapowanie po id) jednym blokiem,
//     wiec edycja jednego nadpisalaby drugi - cicha utrata tresci,
//   * zwykly tekst jest ESCAPOWANY (`<script>` nie staje sie markupem),
//   * wklejenie na ZAZNACZENIE WIELOKROTNE podmienia zaznaczone bloki dokladnie
//     w ich miejscu (nie na koncu dokumentu),
//   * zdarzenie w polu edytowalnym NIE JEST przejmowane - tam wklejanie nalezy
//     do TipTapa; przejecie oznaczaloby podwojna wklejke.
//
// CZEGO TU NIE MA
//   * atrap warstw wlasnych: kanwa renderuje prawdziwe `BlockEditRenderer`,
//     `SortableBlockItem` i prawdziwe edytory blokow, hook schowka jest
//     prawdziwy. Mockowany jest wylacznie `sonner` (toasty - granica UI),
//   * prawdziwego `ClipboardEvent` przegladarki: jsdom nie ma konstruktora
//     `DataTransfer`, wiec `clipboardData` jest doklejane do zdarzenia
//     `Event("paste")`. To granica przegladarki, nie warstwa aplikacji,
//   * zmiany srodowiska: `parseWordHtml` potrzebuje `DOMParser`, ktory happy-dom
//     dostarcza (tak samo dziala `lib/blocks/__tests__/wordPaste.test.ts`),
//     wiec plik zostaje na domyslnym srodowisku suity.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import type { Block, BlocksDoc } from "@/lib/blocks/types";
import { serializeBlocksForClipboard } from "@/lib/blocks/clipboard";

const toasty = vi.hoisted(() => ({
  success: vi.fn<(msg: string) => void>(),
  error: vi.fn<(msg: string) => void>(),
}));
vi.mock("sonner", () => ({ toast: toasty }));

const { BlockCanvas } = await import("../BlockCanvas");

function akapit(id: string, tekst: string): Block {
  return { id, type: "paragraph", data: { html: `<p>${tekst}</p>` } } as Block;
}

function dokument(): BlocksDoc {
  return {
    version: 1,
    blocks: [akapit("p1", "pierwszy"), akapit("p2", "drugi"), akapit("p3", "trzeci")],
  } as BlocksDoc;
}

interface Schowek {
  html?: string;
  plain?: string;
  files?: readonly File[];
}

/** Minimalny `clipboardData` - dokladnie to, co czyta hook schowka. */
function dane(s: Schowek) {
  const zapisane: Array<[string, string]> = [];
  return {
    obiekt: {
      getData: (typ: string) => (typ === "text/html" ? (s.html ?? "") : (s.plain ?? "")),
      setData: (typ: string, wartosc: string) => {
        zapisane.push([typ, wartosc]);
      },
      files: s.files ?? [],
    },
    zapisane,
  };
}

function zdarzenie(typ: "paste" | "copy" | "cut", cel: Element, s: Schowek) {
  const ev = new Event(typ, { bubbles: true, cancelable: true });
  const { obiekt, zapisane } = dane(s);
  Object.defineProperty(ev, "clipboardData", { value: obiekt, configurable: true });
  act(() => {
    cel.dispatchEvent(ev);
  });
  return { ev, zapisane };
}

/** Blok akapitu z wklejki, po fragmencie treści - bez zgadywania indeksu. */
function wklejonyAkapit(
  onChange: { mock: { calls: Array<[BlocksDoc, (boolean | undefined)?]> } },
  fragment: string,
): Block {
  const blok = onChange.mock.calls[0][0].blocks.find(
    (b) => b.type === "paragraph" && String(b.data.html ?? "").includes(fragment),
  );
  if (!blok) throw new Error(`brak wklejonego akapitu z fragmentem "${fragment}"`);
  return blok;
}

function kanwa(): HTMLElement {
  const el = document.querySelector("[data-block-canvas]");
  if (!(el instanceof HTMLElement)) throw new Error("brak korzenia kanwy");
  return el;
}

function zamontuj(opts: { selectedIds?: readonly string[]; activeId?: string | null } = {}) {
  const onChange = vi.fn<(next: BlocksDoc, immediate?: boolean) => void>();
  const onSelect = vi.fn();
  const onSelectedIdsChange = vi.fn();
  // `??` byłoby tu błędem: test „bez aktywnego bloku" przekazuje JAWNE `null`.
  const activeId = "activeId" in opts ? (opts.activeId ?? null) : "p1";
  render(
    <BlockCanvas
      doc={dokument()}
      activeId={activeId}
      onSelect={onSelect}
      onChange={onChange}
      selectedIds={opts.selectedIds ?? []}
      onSelectedIdsChange={onSelectedIdsChange}
    />,
  );
  return { onChange, onSelect, onSelectedIdsChange };
}

/** HTML dokladnie w kształcie, jaki Word 365 kładzie do schowka. */
const WORD_HTML = `
<html xmlns:o="urn:schemas-microsoft-com:office:office">
<head><style><!-- p.MsoNormal { mso-style-parent:""; font-family:"Calibri",sans-serif; } --></style></head>
<body lang=PL>
<!--StartFragment-->
<h2 class=MsoNormal style='mso-outline-level:2;font-family:"Cambria",serif'><span lang=PL>Rozszerzenie Unii</span></h2>
<p class=MsoNormal style='margin-bottom:0cm;mso-layout-grid-align:none'><span
style='font-size:11.0pt;font-family:"Calibri",sans-serif;mso-fareast-font-family:
Calibri'>Negocjacje <b style='mso-bidi-font-weight:normal'>przyspieszyly</b> w 2026 roku.</span><o:p></o:p></p>
<ul style='margin-bottom:0cm' type=disc>
 <li class=MsoListParagraph style='mso-list:l0 level1 lfo1'><span lang=PL>Pierwszy punkt</span></li>
 <li class=MsoListParagraph style='mso-list:l0 level1 lfo1'><span lang=PL>Drugi punkt</span></li>
</ul>
<!--EndFragment-->
</body></html>`;

describe("BlockCanvas - wklejanie tresci z obcym formatowaniem (Word)", () => {
  beforeEach(() => {
    toasty.success.mockClear();
    toasty.error.mockClear();
  });

  it("wklejka z Worda zachowuje STRUKTURĘ dokumentu (nagłówek, akapit, lista)", () => {
    const { onChange } = zamontuj();
    zdarzenie("paste", kanwa(), { html: WORD_HTML, plain: "Rozszerzenie Unii" });
    expect(onChange).toHaveBeenCalledTimes(1);
    const wklejone = onChange.mock.calls[0][0].blocks.slice(1, -2);
    expect(wklejone.map((b) => b.type)).toEqual(["heading", "paragraph", "list"]);
  });

  it("wklejka z Worda NIE wnosi do dokumentu ani jednej klasy/stylu Worda", () => {
    const { onChange } = zamontuj();
    zdarzenie("paste", kanwa(), { html: WORD_HTML, plain: "x" });
    const serializacja = JSON.stringify(onChange.mock.calls[0][0]);
    for (const smiec of ["MsoNormal", "MsoListParagraph", "mso-", "Calibri", "Cambria", "o:p"]) {
      expect(serializacja).not.toContain(smiec);
    }
    // A treść jednak dojechała - inaczej "brak śmieci" byłby dowodem na to,
    // że wklejka po prostu nic nie wniosła.
    expect(serializacja).toContain("Rozszerzenie Unii");
    expect(serializacja).toContain("Drugi punkt");
  });

  it("wklejka HTML zamienia <b> na semantyczne <strong> i zdejmuje style", () => {
    const { onChange } = zamontuj();
    zdarzenie("paste", kanwa(), {
      html: "<p>Negocjacje <b style='font-size:11.0pt'>przyspieszyly</b> w 2026 roku.</p>",
      plain: "x",
    });
    const html = String(wklejonyAkapit(onChange, "przyspieszyly").data.html);
    expect(html).toContain("<strong>przyspieszyly</strong>");
    expect(html).not.toContain("style=");
  });

  // ── DEFEKT: WKLEJKA Z WORDA GUBI POGRUBIENIE ────────────────────────────
  // Word 365 wypisuje pogrubiony fragment jako
  //   <b style='mso-bidi-font-weight:normal'>tekst</b>
  // i robi to dla tekstu REALNIE pogrubionego. `mso-bidi-font-weight` opisuje
  // grubość dla pism dwukierunkowych/złożonych, a NIE grubość łacińskiego
  // kroju - dla Worda te dwie własności są rozłączne, więc „bidi normal" nie
  // znaczy „nie pogrubione".
  //
  // Sanitizer czyta to inaczej. `src/lib/blocks/wordPaste.ts:334`
  //   if (tag === "strong") return /font-weight\s*:\s*(normal|[1-5]00)\b/.test(style);
  // dopasowuje się do PODCIĄGU `font-weight:normal` wewnątrz
  // `mso-bidi-font-weight:normal` (brak zakotwiczenia z lewej), uznaje znacznik
  // za atrapę Google Docs i go usuwa. Skutek: cały pogrubiony tekst wklejony
  // z Worda wchodzi do CMS-a jako zwykły - formatowanie autora przepada bez
  // ostrzeżenia i bez śladu w dokumencie.
  //
  // ZWERYFIKOWANE: test padał NA TEJ asercji (treść dojeżdża, blok jest
  // akapitem, brakuje wyłącznie znacznika), a nie po drodze na setupie.
  //
  // NIE NAPRAWIAM: poprawka to zakotwiczenie wzorca (np. `(?:^|[;\s])font-weight`)
  // w `lib/blocks/wordPaste.ts`, czyli ZMIANA ZACHOWANIA PRODUKCYJNEGO w warstwie
  // spoza tego obszaru - a tej gałęzi tego nie wolno.
  it.fails("POWINNA zachować pogrubienie z Worda (dziś gubi je przez mso-bidi-font-weight)", () => {
    const { onChange } = zamontuj();
    zdarzenie("paste", kanwa(), { html: WORD_HTML, plain: "x" });
    const html = String(wklejonyAkapit(onChange, "przyspieszyly").data.html);
    expect(html).toContain("<strong>przyspieszyly</strong>");
  });

  it("dziś pogrubienie z Worda przepada, a sama treść dojeżdża (stan faktyczny)", () => {
    // Dokumentacja stanu obok `it.fails` wyżej - regresja w drugą stronę
    // (utrata CAŁEGO akapitu) też ma być widoczna.
    const { onChange } = zamontuj();
    zdarzenie("paste", kanwa(), { html: WORD_HTML, plain: "x" });
    const html = String(wklejonyAkapit(onChange, "przyspieszyly").data.html);
    expect(html).toBe("Negocjacje przyspieszyly w 2026 roku.");
  });

  it("wklejka Word wstawia bloki ZA aktywnym blokiem, a nie na końcu dokumentu", () => {
    const { onChange } = zamontuj({ activeId: "p2" });
    zdarzenie("paste", kanwa(), { html: WORD_HTML, plain: "x" });
    const idy = onChange.mock.calls[0][0].blocks.map((b) => b.id);
    expect(idy[0]).toBe("p1");
    expect(idy[1]).toBe("p2");
    expect(idy.at(-1)).toBe("p3");
  });

  it("wklejka blokuje domyślne zachowanie przeglądarki (preventDefault)", () => {
    zamontuj();
    const { ev } = zdarzenie("paste", kanwa(), { html: WORD_HTML, plain: "x" });
    expect(ev.defaultPrevented).toBe(true);
  });
});

describe("BlockCanvas - wklejanie wlasnych blokow i zwyklego tekstu", () => {
  beforeEach(() => {
    toasty.success.mockClear();
  });

  it("wklejka własnych bloków dostaje ŚWIEŻE id (dwa bloki nie mogą dzielić id)", () => {
    const { onChange } = zamontuj();
    const payload = serializeBlocksForClipboard([akapit("p1", "pierwszy")]);
    zdarzenie("paste", kanwa(), { html: payload.html, plain: payload.text });
    const blocks = onChange.mock.calls[0][0].blocks;
    expect(blocks).toHaveLength(4);
    const idy = blocks.map((b) => b.id);
    expect(new Set(idy).size).toBe(idy.length);
    // Kopia niesie tę samą treść, ale inne id niż oryginał.
    expect(blocks[1].data.html).toBe("<p>pierwszy</p>");
    expect(blocks[1].id).not.toBe("p1");
  });

  it("zwykły tekst rozbija się na akapity po pustej linii", () => {
    const { onChange } = zamontuj();
    zdarzenie("paste", kanwa(), { plain: "Pierwszy akapit\n\nDrugi akapit" });
    const wklejone = onChange.mock.calls[0][0].blocks.slice(1, 3);
    expect(wklejone.map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
    expect(wklejone[0].data.html).toBe("Pierwszy akapit");
    expect(wklejone[1].data.html).toBe("Drugi akapit");
  });

  it("zwykły tekst jest ESCAPOWANY - wklejka nie wstrzykuje markupu", () => {
    const { onChange } = zamontuj();
    zdarzenie("paste", kanwa(), { plain: '<script>alert("x")</script> & <b>tekst</b>' });
    const html = String(onChange.mock.calls[0][0].blocks[1].data.html);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
  });

  it("wklejka na ZAZNACZENIE WIELOKROTNE podmienia zaznaczone bloki w ich miejscu", () => {
    const { onChange, onSelectedIdsChange } = zamontuj({ selectedIds: ["p2", "p3"] });
    zdarzenie("paste", kanwa(), { plain: "Zamiennik" });
    const blocks = onChange.mock.calls[0][0].blocks;
    expect(blocks).toHaveLength(2);
    expect(blocks[0].id).toBe("p1");
    expect(blocks[1].data.html).toBe("Zamiennik");
    // Zaznaczenie zostaje wyczyszczone - bloki, których dotyczyło, już nie istnieją.
    expect(onSelectedIdsChange).toHaveBeenCalledWith([]);
  });

  it("wklejka pustego schowka nie zmienia dokumentu", () => {
    const { onChange } = zamontuj();
    const { ev } = zdarzenie("paste", kanwa(), { html: "", plain: "   " });
    expect(onChange).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });

  it("wklejka w TREŚCI bloku nie tworzy nowych bloków - należy do edytora inline", () => {
    const { onChange } = zamontuj();
    const pole = kanwa().querySelector('[contenteditable="true"]');
    expect(pole).not.toBeNull();
    zdarzenie("paste", pole as Element, { plain: "Cokolwiek" });
    // Hook schowka odpuszcza (`isEditableTarget`), więc liczba bloków nie
    // rośnie. Jeśli TipTap wpisze tekst do bieżącego akapitu i wywoła
    // `onChange`, to jest OCZEKIWANE - nie wolno mu tylko dołożyć bloku.
    for (const [next] of onChange.mock.calls) {
      expect(next.blocks).toHaveLength(3);
    }
  });

  it("zdarzenie SPOZA kanwy nie jest przejmowane, gdy leży w innej kanwie", () => {
    const { onChange } = zamontuj();
    const obca = document.createElement("div");
    obca.setAttribute("data-block-canvas", "");
    document.body.appendChild(obca);
    const { ev } = zdarzenie("paste", obca, { plain: "Cokolwiek" });
    expect(onChange).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
    obca.remove();
  });
});

describe("BlockCanvas - wklejanie PLIKOW graficznych", () => {
  /** Prawdziwy `File` z zawartoscia PNG - `FileReader` da z niego `data:image/png`. */
  function plikPng(nazwa: string): File {
    // Minimalny naglowek PNG; tresc nie ma znaczenia, typ MIME ma.
    const bajty = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return new File([bajty], nazwa, { type: "image/png" });
  }

  it("wklejony plik graficzny staje się blokiem obrazu z altem z nazwy pliku", async () => {
    const { onChange } = zamontuj({ activeId: "p1" });
    const { ev } = zdarzenie("paste", kanwa(), { files: [plikPng("mapa-europy.png")] });
    expect(ev.defaultPrevented).toBe(true);
    // Odczyt pliku jest asynchroniczny (`FileReader`).
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const blocks = onChange.mock.calls[0][0].blocks;
    const obraz = blocks.find((b) => b.type === "image");
    expect(obraz).toBeDefined();
    expect(String(obraz!.data.url)).toMatch(/^data:image\/png/);
    expect(obraz!.data.alt).toBe("mapa-europy");
  });

  it("plik NIEgraficzny nie jest wklejany jako obraz", () => {
    const { onChange } = zamontuj();
    const dokument = new File(["tekst"], "notatka.txt", { type: "text/plain" });
    const { ev } = zdarzenie("paste", kanwa(), { files: [dokument] });
    expect(onChange).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });

  it("schowek BEZ danych (clipboardData === null) nie wysadza kanwy", () => {
    const { onChange } = zamontuj();
    const ev = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "clipboardData", { value: null, configurable: true });
    act(() => {
      kanwa().dispatchEvent(ev);
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });
});

describe("BlockCanvas - kopiowanie i wycinanie blokow", () => {
  beforeEach(() => {
    toasty.success.mockClear();
  });

  it("kopiowanie kładzie do schowka sentinel oraz wersję tekstową", () => {
    zamontuj({ activeId: "p2" });
    const { zapisane, ev } = zdarzenie("copy", kanwa(), {});
    expect(ev.defaultPrevented).toBe(true);
    const mapa = new Map(zapisane);
    expect(mapa.get("text/html")).toContain("nes:blocks");
    expect(mapa.get("text/plain")).toBe("drugi");
    expect(toasty.success).toHaveBeenCalledTimes(1);
  });

  it("wycinanie usuwa blok z dokumentu i czyści aktywny wybór", () => {
    const { onChange, onSelect } = zamontuj({ activeId: "p2" });
    zdarzenie("cut", kanwa(), {});
    const idy = onChange.mock.calls[0][0].blocks.map((b) => b.id);
    expect(idy).toEqual(["p1", "p3"]);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("wycinanie zaznaczenia wielokrotnego usuwa WSZYSTKIE zaznaczone bloki", () => {
    const { onChange } = zamontuj({ selectedIds: ["p1", "p3"] });
    zdarzenie("cut", kanwa(), {});
    expect(onChange.mock.calls[0][0].blocks.map((b) => b.id)).toEqual(["p2"]);
  });

  it("kopiowanie przy NIEZWINIĘTEJ selekcji tekstowej zostaje natywne", () => {
    zamontuj({ activeId: "p2" });
    const zaznaczenie = window.getSelection();
    const wezel = kanwa().querySelector('[contenteditable="true"]');
    if (zaznaczenie && wezel) {
      const zakres = document.createRange();
      zakres.selectNodeContents(wezel);
      zaznaczenie.removeAllRanges();
      zaznaczenie.addRange(zakres);
    }
    const { zapisane, ev } = zdarzenie("copy", kanwa(), {});
    expect(zapisane).toEqual([]);
    expect(ev.defaultPrevented).toBe(false);
    zaznaczenie?.removeAllRanges();
  });

  it("kopiowanie bez aktywnego bloku i bez zaznaczenia nie rusza schowka", () => {
    zamontuj({ activeId: null });
    const { zapisane, ev } = zdarzenie("copy", kanwa(), {});
    expect(zapisane).toEqual([]);
    expect(ev.defaultPrevented).toBe(false);
  });
});
