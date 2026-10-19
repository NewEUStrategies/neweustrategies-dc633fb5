// EDYTORY OSADZEŃ I ODNOŚNIKÓW - osadzenie (`embed`), surowy HTML (podgląd),
// plik, wyszukiwarka, newsletter, kalendarz i okładka. CO WIDZI REDAKTOR
// I CO TRAFIA DO DOKUMENTU.
//
// CO MA TU DOWÓD
//  * osadzenie: rozpoznany dostawca daje PODGLĄD w ramce z adresem
//    odtwarzacza, nierozpoznany - komunikat, że na stronie będzie zwykły link,
//    pusty - podpowiedź; to te same gałęzie, co w rendererze (`parseEmbedUrl`
//    + `isIframeEmbed`), więc podgląd nie obiecuje odtwarzacza, którego strona
//    nie narysuje,
//  * HTML: kanwa pokazuje WYŁĄCZNIE oczyszczony podgląd (`sanitizeHtml`) -
//    skrypt i atrybut `on*` z dokumentu nie mogą wykonać się w panelu
//    redaktora, który ma sesję administratora,
//  * pola pozostałych edytorów piszą pod własny klucz i nie gubią reszty
//    danych (pełny blok w asercji), a render niczego nie zapisuje.
//
// NAPRAWIONE 2026-10-18 (wcześniej bez testu, defekty wykryte tym plikiem):
//  * wartość-obiekt z importu (`{ pl: "…" }`) stała w polach jako
//    „[object Object]" - w osadzeniu dawała komunikat „nie rozpoznano
//    dostawcy" zamiast podpowiedzi, w okładce uchodziła za adres obrazu
//    i chowała pole adresu; teraz pola idą przez `readText`,
//  * akcja wyszukiwarki czytana jak w rendererze (`str(data, "action",
//    "/search")`): nie-napis to `/search`, a nie „[object Object]",
//  * pusty blok HTML mówił do redaktora po polsku także w panelu
//    angielskim (napis wpisany na sztywno) - teraz `blocks.editors.html.emptyHint`.
//
// GRANICE. Fabryki `vi.mock` niesie moduł wspólny tabeli - jego import jest
// PIERWSZY. i18n PRAWDZIWE (`realT`), sanityzacja i parser osadzeń PRAWDZIWE -
// to one są przedmiotem dowodu, nie atrapa.
import { renderEditor } from "./blockEditMatrix.shared";

import { afterEach, describe, expect, it } from "vitest";
import { fireEvent } from "@testing-library/react";

import i18n from "@/lib/i18n";
import { realT } from "@/test/i18nReal";
import type { Block, BlockType, Json } from "@/lib/blocks/types";
import { CalendarBlock } from "../Calendar";
import { CoverBlock } from "../Cover";
import { EmbedBlock } from "../Embed";
import { FileBlock } from "../File";
import { HtmlBlock } from "../Html";
import { NewsletterBlock } from "../Newsletter";
import { SearchBlock } from "../Search";

const t = realT("pl");
const ed = (grupa: string, klucz: string) => t(`blocks.editors.${grupa}.${klucz}`);

function blok(type: BlockType, data: Record<string, Json>): Block {
  return { id: `blk-${type}`, type, data };
}

function poZapisie(start: Block, patch: Record<string, Json>): Block {
  return { ...start, data: { ...start.data, ...patch } };
}

function pole(container: HTMLElement, placeholder: string): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>(`[placeholder="${placeholder}"]`);
  if (!el) throw new Error(`brak pola z podpowiedzią „${placeholder}"`);
  return el;
}

const OBIEKT: Json = { pl: "Tekst", en: "Text" };

afterEach(async () => {
  await i18n.changeLanguage("pl");
});

describe("osadzenie (`embed`) - podgląd tylko dla dostawców, których strona osadzi", () => {
  it("pusty adres: podpowiedź wklejenia i żadnej ramki", () => {
    const { container, getByText } = renderEditor(EmbedBlock, blok("embed", {}));
    expect(getByText(ed("embed", "pasteHint"))).toBeTruthy();
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("adres YouTube daje ramkę odtwarzacza w trybie bez ciasteczek, nazwaną dostawcą", () => {
    const { container } = renderEditor(
      EmbedBlock,
      blok("embed", { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }),
    );
    const ramka = container.querySelector("iframe");
    expect(ramka?.getAttribute("src")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(ramka?.getAttribute("title")).toBe("youtube");
  });

  it("nierozpoznany adres zapowiada zwykły link zamiast ramki", () => {
    const { container, getByText } = renderEditor(
      EmbedBlock,
      blok("embed", { url: "https://example.org/artykul" }),
    );
    expect(getByText(ed("embed", "noProvider"))).toBeTruthy();
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("wpis adresu zapisuje `url`, a pozostałe dane bloku zostają", () => {
    const start = blok("embed", { url: "", caption: "Podpis" });
    const { container, changes } = renderEditor(EmbedBlock, start);
    fireEvent.change(pole(container, ed("embed", "urlPh")), {
      target: { value: "https://vimeo.com/76979871" },
    });
    expect(changes).toEqual([poZapisie(start, { url: "https://vimeo.com/76979871" })]);
  });

  it("adres-OBIEKT to brak adresu: puste pole i podpowiedź, nie „nie rozpoznano”", () => {
    const { container, getByText } = renderEditor(EmbedBlock, blok("embed", { url: OBIEKT }));
    expect(pole(container, ed("embed", "urlPh")).value).toBe("");
    expect(getByText(ed("embed", "pasteHint"))).toBeTruthy();
  });
});

describe("HTML (`html`) - kanwa to wyłącznie OCZYSZCZONY podgląd", () => {
  it("skrypt i obsługa zdarzeń z dokumentu nie trafiają do panelu, treść tak", () => {
    // Skrypt stoi ZA obrazkiem świadomie: DOMPurify pod happy-dom pomija węzeł
    // następujący po usuniętym `<script>` (iterator węzłów happy-dom nie
    // przestawia się po usunięciu), więc odwrotna kolejność mierzyłaby
    // środowisko testowe, a nie edytor - patrz raport pakietu.
    const { container, getByText, changes } = renderEditor(
      HtmlBlock,
      blok("html", {
        html: '<p>Treść <b>ważna</b></p><img src="x.png" onerror="alert(1)"><script>window.__x = 1</script>',
      }),
    );
    expect(getByText("ważna").tagName).toBe("B");
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")?.hasAttribute("onerror")).toBe(false);
    // Podgląd nie ma pól - surowy HTML edytuje się w panelu „Blok".
    expect(container.querySelector("input, textarea")).toBeNull();
    expect(changes).toEqual([]);
  });

  it.each([
    ["pl", "pusty", ""],
    ["en", "same spacje", "   \n"],
    ["pl", "obiekt", OBIEKT],
  ] as const)("%s: blok HTML %s pokazuje podpowiedź ze słownika", async (lang, _opis, html) => {
    await i18n.changeLanguage(lang);
    const { container } = renderEditor(HtmlBlock, blok("html", { html }));
    expect(container.textContent).toBe(realT(lang)("blocks.editors.html.emptyHint"));
  });
});

describe("plik, wyszukiwarka i newsletter - pola piszą pod własny klucz", () => {
  it("plik: nazwa i adres zapisują się osobno, a przycisk pobierania jest domyślnie włączony", () => {
    const start = blok("file", { url: "https://cdn.example.com/raport.pdf", label: "Raport" });
    const { container, changes, getByLabelText } = renderEditor(FileBlock, start);
    const przycisk = getByLabelText(ed("file", "showButton")) as HTMLInputElement;
    expect(przycisk.checked).toBe(true);
    fireEvent.change(pole(container, ed("file", "label")), { target: { value: "Raport 2026" } });
    fireEvent.change(pole(container, ed("file", "url")), { target: { value: "/r.pdf" } });
    fireEvent.click(przycisk);
    expect(changes).toEqual([
      poZapisie(start, { label: "Raport 2026" }),
      poZapisie(start, { url: "/r.pdf" }),
      poZapisie(start, { showButton: false }),
    ]);
  });

  it("plik: nazwa-OBIEKT daje puste pole, nie „[object Object]”", () => {
    const { container } = renderEditor(FileBlock, blok("file", { label: OBIEKT, url: OBIEKT }));
    expect(pole(container, ed("file", "label")).value).toBe("");
    expect(pole(container, ed("file", "url")).value).toBe("");
  });

  it("wyszukiwarka: bez akcji pokazuje `/search`, a pola zapisują swoje klucze", () => {
    const start = blok("search", { placeholder: "Szukaj", buttonLabel: "Szukaj" });
    const { container, changes } = renderEditor(SearchBlock, start);
    const akcja = pole(container, ed("searchWidget", "actionPh"));
    expect(akcja.value).toBe("/search");
    fireEvent.change(pole(container, ed("searchWidget", "placeholderPh")), {
      target: { value: "Fraza…" },
    });
    fireEvent.change(pole(container, ed("searchWidget", "buttonLabelPh")), {
      target: { value: "Znajdź" },
    });
    fireEvent.change(akcja, { target: { value: "/szukaj" } });
    expect(changes).toEqual([
      poZapisie(start, { placeholder: "Fraza…" }),
      poZapisie(start, { buttonLabel: "Znajdź" }),
      poZapisie(start, { action: "/szukaj" }),
    ]);
  });

  it("wyszukiwarka: akcja nie-napisowa to `/search` - tam wyśle formularz strona", () => {
    const { container } = renderEditor(
      SearchBlock,
      blok("search", { action: OBIEKT, placeholder: OBIEKT }),
    );
    expect(pole(container, ed("searchWidget", "actionPh")).value).toBe("/search");
    expect(pole(container, ed("searchWidget", "placeholderPh")).value).toBe("");
  });

  it("newsletter: wariant z listy, tytuł i opis zapisują się pod własne klucze", () => {
    const start = blok("newsletter", { title: "Zapisz się", description: "Co tydzień" });
    const { container, changes } = renderEditor(NewsletterBlock, start);
    const wariant = container.querySelector("select") as HTMLSelectElement;
    expect(wariant.value).toBe("card");
    fireEvent.change(wariant, { target: { value: "inline" } });
    fireEvent.change(pole(container, ed("newsletter", "titlePh")), { target: { value: "Bądź" } });
    fireEvent.change(pole(container, t("blocks.fields.description")), {
      target: { value: "Raz w miesiącu" },
    });
    expect(changes).toEqual([
      poZapisie(start, { variant: "inline" }),
      poZapisie(start, { title: "Bądź" }),
      poZapisie(start, { description: "Raz w miesiącu" }),
    ]);
  });

  it("newsletter: nieznany wariant pokazuje „Karta” - taki narysuje strona", () => {
    const { container } = renderEditor(
      NewsletterBlock,
      blok("newsletter", { variant: "pelny-ekran", title: OBIEKT }),
    );
    expect((container.querySelector("select") as HTMLSelectElement).value).toBe("card");
    expect(pole(container, ed("newsletter", "titlePh")).value).toBe("");
  });
});

describe("kalendarz i okładka", () => {
  it("kalendarz bez miesiąca ma puste pole (bieżący miesiąc), a wybór zapisuje `month`", () => {
    const start = blok("calendar", {});
    const { container, changes } = renderEditor(CalendarBlock, start);
    const miesiac = container.querySelector('input[type="month"]') as HTMLInputElement;
    expect(miesiac.value).toBe("");
    fireEvent.change(miesiac, { target: { value: "2026-09" } });
    expect(changes).toEqual([poZapisie(start, { month: "2026-09" })]);
  });

  it("okładka z adresem-OBIEKTEM to okładka BEZ obrazu: pokazuje pole adresu tła", () => {
    // Renderer czyta adres przez `str()` i nie rysuje takiej okładki wcale;
    // edytor nie może udawać podglądu z obrazem „[object Object]".
    const { container } = renderEditor(CoverBlock, blok("cover", { url: OBIEKT }));
    expect(pole(container, ed("cover", "bgUrl"))).toBeTruthy();
    expect(container.innerHTML).not.toContain("[object Object]");
  });

  it("okładka z obrazem i tytułem-OBIEKTEM daje puste pole tytułu", () => {
    const { container } = renderEditor(
      CoverBlock,
      blok("cover", { url: "https://cdn.example.com/t.jpg", title: OBIEKT }),
    );
    expect(pole(container, ed("cover", "titlePh")).value).toBe("");
  });
});
