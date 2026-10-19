// EDYTORY PROSTYCH BLOKÓW TEKSTOWYCH - cytaty, kod, tekst sformatowany,
// przycisk, callout, szczegóły, spoiler, „czytaj dalej" i skrót markdown
// akapitu. CO DOKŁADNIE TRAFIA DO DOKUMENTU.
//
// CO MA TU DOWÓD. Każdy z tych edytorów to kilka pól i jeden wzorzec zapisu
// `onChange({ ...block, data: { ...block.data, klucz: wartość } })`. Defekt
// tej rodziny to nie „pole nie działa", tylko „wpis idzie pod ZŁY klucz" albo
// „edycja gubi resztę danych" (wariant i kolorystykę ustawione z paska
// narzędzi, adres przycisku, język kodu). Dlatego każdy przypadek asertuje
// CAŁY blok oddany przez `onChange` - z `id`, `type` i pozostałymi kluczami -
// a jedna zmiana pola ma dać DOKŁADNIE jeden zapis (render niczego nie pisze).
//
// NAPRAWIONE 2026-10-18 (wcześniej bez testu, defekty wykryte tym plikiem):
//  * pola czytały `String(x ?? "")`, więc wartość-obiekt z importu
//    (`{ pl: "…" }`) stała w polu jako „[object Object]", a pierwszy wpisany
//    znak utrwalał ten śmieć w dokumencie. Teraz idą przez `readText`
//    (`dataVizShared.tsx`) - ten sam strażnik, co w reszcie katalogu `edit/`,
//  * wariant cytatu i flagi czytane są TAK, JAK CZYTA JE STRONA
//    (`str`/`bool` z `renderer/data.ts`): pusty wariant to `default`, a napis
//    „tak" nie jest prawdą (strona bierze wtedy wartość domyślną),
//  * kod BEZ języka pokazywał w polu „ts" i zieloną kropkę „podświetlanie
//    aktywne", choć strona rysowała go bez kolorów (renderer czyta pusty
//    `lang`, a `highlightCode(code, "")` zwraca zwykły tekst),
//  * „Czytaj dalej" wpisane NA SZTYWNO po polsku jako WARTOŚĆ pola - w panelu
//    angielskim redaktor widział polski napis. Teraz to podpowiedź ze słownika
//    (`blocks.editors.readMore.textPh`), a pole bez tekstu jest puste.
//
// GRANICE. Fabryki `vi.mock` (sonner, Radix, `<Link>` routera, Supabase,
// `fetch`) niesie moduł wspólny tabeli - jego import jest PIERWSZY. i18n jest
// PRAWDZIWE (`realT`): zniknięcie klucza ze słownika oblewa test.
import { renderEditor, type BlockEditor } from "./blockEditMatrix.shared";

import { afterEach, describe, expect, it, vi } from "vitest";
import { createEvent, fireEvent } from "@testing-library/react";

import i18n from "@/lib/i18n";
import { realT } from "@/test/i18nReal";
import type { Block, BlockType, Json } from "@/lib/blocks/types";
import { BLOCK_PALETTE_VAR } from "@/lib/blocks/variants";
import { ButtonBlock } from "../Button";
import { CalloutBlock } from "../Callout";
import { CodeBlock } from "../Code";
import { DetailsBlock } from "../Details";
import { ParagraphBlock } from "../Paragraph";
import { PreformattedBlock } from "../Preformatted";
import { PullquoteBlock } from "../Pullquote";
import { QuoteBlock } from "../Quote";
import { ReadMoreBlock } from "../ReadMore";
import { SpoilerBlock } from "../Spoiler";
import { VerseBlock } from "../Verse";
import { XQuoteBlock } from "../XQuote";

const t = realT("pl");
const ed = (grupa: string, klucz: string) => t(`blocks.editors.${grupa}.${klucz}`);

function blok(type: BlockType, data: Record<string, Json>): Block {
  return { id: `blk-${type}`, type, data };
}

/** Blok po zapisie: ten sam `id` i `type`, reszta danych nietknięta. */
function poZapisie(start: Block, patch: Record<string, Json>): Block {
  return { ...start, data: { ...start.data, ...patch } };
}

function pole(container: HTMLElement, placeholder: string): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>(`[placeholder="${placeholder}"]`);
  if (!el) throw new Error(`brak pola z podpowiedzią „${placeholder}"`);
  return el;
}

afterEach(async () => {
  await i18n.changeLanguage("pl");
});

describe("cytat (`quote`) - treść, podpis i stan z paska narzędzi", () => {
  const start = blok("quote", {
    text: "Stara treść",
    cite: "Anna",
    variant: "card",
    colorPalette: "brand",
  });

  it("wpis treści zapisuje `text`, a wariant i kolorystyka przeżywają edycję", () => {
    const { container, changes } = renderEditor(QuoteBlock, start);
    fireEvent.change(pole(container, ed("quote", "textPh")), { target: { value: "Nowa" } });
    expect(changes).toEqual([poZapisie(start, { text: "Nowa" })]);
  });

  it("wpis podpisu zapisuje `cite` i nie rusza treści", () => {
    const { container, changes } = renderEditor(QuoteBlock, start);
    fireEvent.change(pole(container, ed("quote", "citePh")), { target: { value: "Jan" } });
    expect(changes).toEqual([poZapisie(start, { cite: "Jan" })]);
  });

  it.each([[""], [7]] as const)(
    "wariant %j rysuje się jako `default` - tak samo jak strona publiczna",
    (variant) => {
      // Renderer czyta `str(data, "variant") || "default"`; podgląd w kanwie
      // ma dać ten sam wariant, inaczej redaktor widzi cytat bez ramki, który
      // na stronie ma ramkę.
      const { container } = renderEditor(QuoteBlock, blok("quote", { text: "a", variant }));
      const cytat = container.querySelector("blockquote");
      expect(cytat?.getAttribute("data-quote-variant")).toBe("default");
      expect(cytat?.getAttribute("style")).toContain(BLOCK_PALETTE_VAR.neutral);
    },
  );

  it("nieznana kolorystyka spada na neutralną, a znana barwi ramkę", () => {
    const nieznana = renderEditor(QuoteBlock, blok("quote", { colorPalette: "fioletowa" }));
    expect(nieznana.container.querySelector("blockquote")?.getAttribute("style")).toContain(
      BLOCK_PALETTE_VAR.neutral,
    );
    const znana = renderEditor(QuoteBlock, blok("quote", { colorPalette: "danger" }));
    expect(znana.container.querySelector("blockquote")?.getAttribute("style")).toContain(
      BLOCK_PALETTE_VAR.danger,
    );
  });

  it("wariant `plain` dokłada ozdobny cudzysłów UKRYTY przed czytnikiem ekranu", () => {
    const plain = renderEditor(QuoteBlock, blok("quote", { variant: "plain" }));
    expect(plain.container.querySelector("blockquote")?.getAttribute("data-quote-variant")).toBe(
      "plain",
    );
    expect(plain.container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    const domyslny = renderEditor(QuoteBlock, blok("quote", { variant: "minimal" }));
    expect(domyslny.container.querySelector("svg")).toBeNull();
  });
});

describe("wyróżniony cytat, X Quote i callout - pola i liczniki", () => {
  it("wyróżniony cytat zapisuje treść i źródło pod własnymi kluczami", () => {
    const start = blok("pullquote", { text: "Teza", cite: "Źródło" });
    const { container, changes } = renderEditor(PullquoteBlock, start);
    fireEvent.change(pole(container, ed("pullquote", "textPh")), { target: { value: "Nowa" } });
    fireEvent.change(pole(container, ed("pullquote", "citePh")), { target: { value: "Jan" } });
    expect(changes).toEqual([
      poZapisie(start, { text: "Nowa" }),
      poZapisie(start, { cite: "Jan" }),
    ]);
  });

  it("X Quote: licznik pokazuje długość wobec limitu X, a pole trzyma limit 280 znaków", () => {
    const { container, getByText } = renderEditor(
      XQuoteBlock,
      blok("xquote", { text: "Dwanaście zn" }),
    );
    expect(getByText("12 / 280")).toBeTruthy();
    expect(pole(container, ed("xquote", "textPh")).maxLength).toBe(280);
  });

  it("X Quote: „via” zapisuje się BEZ wiodącego @, a hashtagi dosłownie", () => {
    // Link udostępnienia doklada `via=` sam - „@" w danych dałby „@@nazwa".
    const start = blok("xquote", { text: "Cytat", via: "", hashtags: "" });
    const { container, changes } = renderEditor(XQuoteBlock, start);
    fireEvent.change(pole(container, t("blocks.fields.via")), { target: { value: "@nes_eu" } });
    fireEvent.change(pole(container, t("blocks.fields.hashtags")), {
      target: { value: "UE,polityka" },
    });
    expect(changes).toEqual([
      poZapisie(start, { via: "nes_eu" }),
      poZapisie(start, { hashtags: "UE,polityka" }),
    ]);
  });

  it("callout: wpis zapisuje `text` z zachowaniem wariantu, a pole rośnie z liczbą linii", () => {
    const start = blok("callout", { variant: "warning", text: "a\nb\nc" });
    const { container, changes } = renderEditor(CalloutBlock, start);
    const tekst = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(tekst.getAttribute("rows")).toBe("3");
    fireEvent.change(tekst, { target: { value: "Uwaga" } });
    expect(changes).toEqual([poZapisie(start, { text: "Uwaga" })]);
  });
});

describe("tekst sformatowany, wiersz, szczegóły i spoiler", () => {
  it("tekst sformatowany pokazuje co najmniej 3 wiersze, a dłuższy tekst - wszystkie", () => {
    const krotki = renderEditor(PreformattedBlock, blok("preformatted", {}));
    expect(krotki.container.querySelector("textarea")?.getAttribute("rows")).toBe("3");
    const start = blok("preformatted", { text: "1\n2\n3\n4\n5" });
    const { container, changes } = renderEditor(PreformattedBlock, start);
    const tekst = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(tekst.getAttribute("rows")).toBe("5");
    fireEvent.change(tekst, { target: { value: "  wcięcie\n" } });
    // Spacje i entery to cała treść tego bloku - zapis ich nie przycina.
    expect(changes).toEqual([poZapisie(start, { text: "  wcięcie\n" })]);
  });

  it("wiersz pokazuje co najmniej 4 linie i zapisuje tekst pod `text`", () => {
    const start = blok("verse", { text: "zwrotka" });
    const { container, changes } = renderEditor(VerseBlock, start);
    const tekst = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(tekst.getAttribute("rows")).toBe("4");
    fireEvent.change(tekst, { target: { value: "a\nb" } });
    expect(changes).toEqual([poZapisie(start, { text: "a\nb" })]);
  });

  it("szczegóły zapisują tytuł pod `summary`, a treść pod `body`", () => {
    const start = blok("details", { summary: "Tytuł", body: "Treść" });
    const { container, changes } = renderEditor(DetailsBlock, start);
    fireEvent.change(pole(container, ed("details", "summaryPh")), { target: { value: "Nowy" } });
    fireEvent.change(pole(container, ed("details", "contentPh")), { target: { value: "Inna" } });
    expect(changes).toEqual([
      poZapisie(start, { summary: "Nowy" }),
      poZapisie(start, { body: "Inna" }),
    ]);
  });

  it("klik w pole tytułu szczegółów jest ANULOWANY - przeglądarka nie zwinie bloku", () => {
    // NAPRAWIONE 2026-10-18: pole tytułu siedzi wewnątrz `<summary>`, a klik
    // w nie uruchamia AKTYWACJĘ summary (zwinięcie `<details>` i schowanie
    // edytowanej treści). Aktywację zatrzymuje wyłącznie anulowanie domyślnej
    // akcji - samo `stopPropagation`, które tu stało, jej nie dotyka.
    // Asercja patrzy na zdarzenie oddane przeglądarce, a nie na `open`:
    // happy-dom przełącza `<details>` w trakcie bąbelkowania, ZANIM zdarzenie
    // dojdzie do korzenia, na którym React woła obsługę - inaczej niż
    // przeglądarka, w której aktywacja biegnie po całym przejściu zdarzenia.
    const { container } = renderEditor(DetailsBlock, blok("details", { summary: "T" }));
    const klik = createEvent.click(pole(container, ed("details", "summaryPh")));
    fireEvent(pole(container, ed("details", "summaryPh")), klik);
    expect(klik.defaultPrevented).toBe(true);
  });

  it("spoiler zapisuje tytuł, ukrytą treść i flagę otwarcia jako wartość logiczną", () => {
    const start = blok("spoiler", { summary: "S", html: "<p>x</p>", defaultOpen: false });
    const { container, changes, getByLabelText } = renderEditor(SpoilerBlock, start);
    fireEvent.change(pole(container, ed("spoiler", "summaryPh")), { target: { value: "Pokaż" } });
    fireEvent.change(pole(container, ed("spoiler", "hiddenHtmlPh")), {
      target: { value: "<b>sekret</b>" },
    });
    fireEvent.click(getByLabelText(t("blocks.editors.spoiler.defaultOpen")));
    expect(changes).toEqual([
      poZapisie(start, { summary: "Pokaż" }),
      poZapisie(start, { html: "<b>sekret</b>" }),
      poZapisie(start, { defaultOpen: true }),
    ]);
  });

  it("spoiler z flagą-NAPISEM „tak” pokazuje się zamknięty - tak jak na stronie", () => {
    // NAPRAWIONE 2026-10-18: `Boolean("tak")` zaznaczało pole, a renderer
    // (`bool(data, "defaultOpen", false)`) rysuje spoiler ZAMKNIĘTY. Redaktor
    // widział „otwarty domyślnie", a pierwszy klik zapisywał `false`.
    const { getByLabelText } = renderEditor(SpoilerBlock, blok("spoiler", { defaultOpen: "tak" }));
    expect(
      (getByLabelText(t("blocks.editors.spoiler.defaultOpen")) as HTMLInputElement).checked,
    ).toBe(false);
  });
});

describe("kod - treść, język i sygnał podświetlania", () => {
  it("wpis kodu zapisuje `code` z zachowaniem języka, a licznik pokazuje liczbę znaków", () => {
    const start = blok("code", { code: "const a = 1;", lang: "ts" });
    const { container, changes, getByText } = renderEditor(CodeBlock, start);
    expect(getByText(t("blocks.editors.code.charCount", { n: 12 }))).toBeTruthy();
    fireEvent.change(pole(container, ed("code", "codePh")), { target: { value: "let b;" } });
    expect(changes).toEqual([poZapisie(start, { code: "let b;" })]);
  });

  it("zmiana języka zapisuje `lang` i przełącza sygnał podświetlania", () => {
    const start = blok("code", { code: "x", lang: "ts" });
    const { container, changes, getByTitle } = renderEditor(CodeBlock, start);
    expect(getByTitle(t("blocks.editors.code.highlightOn"))).toBeTruthy();
    fireEvent.change(pole(container, "ts"), { target: { value: "brainfuck" } });
    expect(changes).toEqual([poZapisie(start, { lang: "brainfuck" })]);

    const bezGramatyki = renderEditor(CodeBlock, blok("code", { code: "x", lang: "brainfuck" }));
    expect(bezGramatyki.getByTitle(t("blocks.editors.code.highlightOff"))).toBeTruthy();
  });

  it("kod BEZ języka ma puste pole języka i sygnał „bez kolorów” - jak strona", () => {
    // NAPRAWIONE 2026-10-18: pole pokazywało „ts" (wartość, nie podpowiedź)
    // i zieloną kropkę, a strona rysowała ten kod BEZ podświetlania.
    const { container, getByTitle } = renderEditor(CodeBlock, blok("code", { code: "x" }));
    expect(pole(container, "ts").value).toBe("");
    expect(getByTitle(t("blocks.editors.code.highlightOff"))).toBeTruthy();
  });
});

describe("przycisk i „czytaj dalej”", () => {
  it("wpis etykiety przycisku zapisuje `label`, a adres i wariant zostają", () => {
    const start = blok("button", { label: "Stara", href: "/kontakt", variant: "outline" });
    const { container, changes } = renderEditor(ButtonBlock, start);
    fireEvent.change(pole(container, ed("button", "labelPh")), { target: { value: "Napisz" } });
    expect(changes).toEqual([poZapisie(start, { label: "Napisz" })]);
  });

  it("„czytaj dalej” zapisuje wpisany tekst pod `text`", () => {
    const start = blok("read-more", { text: "Więcej" });
    const { container, changes } = renderEditor(ReadMoreBlock, start);
    fireEvent.change(container.querySelector("input") as HTMLInputElement, {
      target: { value: "Dalej" },
    });
    expect(changes).toEqual([poZapisie(start, { text: "Dalej" })]);
  });

  it.each([
    ["pl", "Czytaj dalej"],
    ["en", "Read more"],
  ] as const)(
    "%s: „czytaj dalej” bez tekstu ma PUSTE pole z podpowiedzią w języku panelu",
    async (lang, podpowiedz) => {
      // NAPRAWIONE 2026-10-18: domyślne „Czytaj dalej" było WARTOŚCIĄ pola
      // wpisaną na sztywno po polsku - panel angielski pokazywał polski napis.
      await i18n.changeLanguage(lang);
      const { container } = renderEditor(ReadMoreBlock, blok("read-more", {}));
      const input = container.querySelector("input") as HTMLInputElement;
      expect(input.value).toBe("");
      expect(input.placeholder).toBe(podpowiedz);
    },
  );
});

describe("wartość-OBIEKT w polu tekstowym - koercja, a nie „[object Object]”", () => {
  // NAPRAWIONE 2026-10-18: `String({ pl: "…" })` to „[object Object]" w polu,
  // a pierwszy znak dopisany przez redaktora utrwalał śmieć w dokumencie.
  // Strona publiczna czyta te klucze przez `str()` i pokazuje PUSTKĘ - edytor
  // ma pokazać to samo i zapisać wyłącznie to, co wpisał redaktor.
  const OBIEKT: Json = { pl: "Tekst", en: "Text" };
  // [typ bloku, klucz danych, edytor, grupa słownika, klucz podpowiedzi pola]
  const przypadki: [BlockType, string, BlockEditor, string, string][] = [
    ["quote", "text", QuoteBlock, "quote", "textPh"],
    ["pullquote", "cite", PullquoteBlock, "pullquote", "citePh"],
    ["xquote", "text", XQuoteBlock, "xquote", "textPh"],
    ["callout", "text", CalloutBlock, "callout", "textPh"],
    ["preformatted", "text", PreformattedBlock, "preformatted", "textPh"],
    ["verse", "text", VerseBlock, "verse", "textPh"],
    ["details", "body", DetailsBlock, "details", "contentPh"],
    ["spoiler", "summary", SpoilerBlock, "spoiler", "summaryPh"],
    ["code", "code", CodeBlock, "code", "codePh"],
    ["button", "label", ButtonBlock, "button", "labelPh"],
  ];

  it.each(przypadki)(
    "%s.%s jako obiekt daje puste pole, a wpis zapisuje sam tekst redaktora",
    (type, klucz, Editor, grupa, podpowiedz) => {
      const start = blok(type, { [klucz]: OBIEKT });
      const { container, changes } = renderEditor(Editor, start);
      expect(container.textContent).not.toContain("[object Object]");
      const input = pole(container, ed(grupa, podpowiedz));
      expect(input.value).toBe("");
      fireEvent.change(input, { target: { value: "Wpis" } });
      expect(changes).toEqual([poZapisie(start, { [klucz]: "Wpis" })]);
    },
  );
});

describe("akapit - skrót markdown wpisany w treść", () => {
  /** Tekst wchodzi przez `onUpdate` TipTapa - tą samą drogą, co pisanie. */
  function wpisz(el: HTMLElement, tekst: string): void {
    fireEvent.paste(el, {
      clipboardData: {
        getData: (typ: string) => (typ === "text/html" ? `<p>${tekst}</p>` : tekst),
        files: [],
        types: ["text/html", "text/plain"],
        items: [],
      },
    });
  }

  it("„---” w pustym akapicie zamienia blok w separator liniowy", () => {
    const onTransform = vi.fn();
    const { container } = renderEditor(
      (props) => <ParagraphBlock {...props} onTransform={onTransform} />,
      blok("paragraph", { html: "" }),
    );
    wpisz(container.querySelector('[contenteditable="true"]') as HTMLElement, "---");
    expect(onTransform).toHaveBeenCalledTimes(1);
    const [zamiana] = onTransform.mock.calls[0] as [Block[]];
    expect(zamiana).toHaveLength(1);
    expect(zamiana[0]).toMatchObject({ type: "separator", data: { variant: "line" } });
    expect(zamiana[0].id).toBeTruthy();
  });

  it("zwykły tekst NIE uruchamia przekształcenia", () => {
    const onTransform = vi.fn();
    const { container } = renderEditor(
      (props) => <ParagraphBlock {...props} onTransform={onTransform} />,
      blok("paragraph", { html: "" }),
    );
    wpisz(container.querySelector('[contenteditable="true"]') as HTMLElement, "Ala ma kota");
    expect(onTransform).not.toHaveBeenCalled();
  });
});
