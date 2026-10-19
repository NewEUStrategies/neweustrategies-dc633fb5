// WYSPA SEKCJI - `sectionIslandInfo` (spis treści, typy widgetów, kwalifikacja).
//
// ── CO TU MA DOWÓD ─────────────────────────────────────────────────────────
// `SectionsList` pyta tę funkcję o każdą sekcję strumieniowanego renderera:
// * `toc` - sekcja ze spisem treści (widget `toc` ALBO blok `toc` w treści
//   widgetu `rich-text`, w dowolnym języku, także w sekcji zagnieżdżonej)
//   WYŁĄCZA wyspy całego renderera: spis treści czyta nagłówki z DOM-u, którego
//   odwodniona wyspa jeszcze nie ma. Przeoczony blok = spis bez pozycji,
//   fałszywy alarm = strona traci odroczoną hydratację,
// * `widgetTypes` - klucze rejestru chunków wyspy (`islandChunksFor`); typ
//   z sekcji zagnieżdżonej pominięty tu oznacza chunk dociągany dopiero przy
//   hydratacji (opóźniona interakcja), więc lista musi być kompletna i bez
//   powtórzeń,
// * `eligible` - sekcja eksperymentu A/B nie może być wyspą (wariant losuje
//   się po montażu),
// * `fallbackMinHeight` - ta sama rezerwa co szkielet strumienia,
// * odporność na kolumnę jsonb (puste węzły, brak list, typ nie-napis) i
//   pamięć per obiekt sekcji (dokument jest niemutowalny, lista sekcji pyta
//   przy każdym renderze).
//
// ── GRANICE ────────────────────────────────────────────────────────────────
// Czysta funkcja - bez atrap.
import { describe, expect, it } from "vitest";
import type { SectionNode } from "@/lib/builder/types";
import { estimateSectionHeight } from "@/lib/builder/sectionHeightEstimate";
import { sectionIslandInfo } from "@/lib/builder/sectionStreaming";

/** Węzły jak z kolumny jsonb - celowo luźne, bo funkcja czyta je defensywnie. */
const sekcja = (children: unknown[], extra: Record<string, unknown> = {}): SectionNode =>
  ({ id: "s", kind: "section", children, ...extra }) as SectionNode;
const kolumna = (children: unknown) => ({ id: "c", kind: "column", children });
const zagniezdzona = (columns: unknown) => ({ id: "i", kind: "inner-section", columns });
const w = (type: unknown, content: unknown = {}) => ({ id: "w", kind: "widget", type, content });
const richText = (doc: unknown) => w("rich-text", { doc });

describe("sectionIslandInfo - spis treści", () => {
  it("widget `toc` w kolumnie sekcji zagnieżdżonej wyłącza wyspy", () => {
    const info = sectionIslandInfo(
      sekcja([kolumna([w("heading")]), zagniezdzona([kolumna([w("toc")])])]),
    );
    expect(info.toc).toBe(true);
  });

  it("blok `toc` w treści rich-text - w KTÓRYMKOLWIEK języku - wyłącza wyspy", () => {
    const info = sectionIslandInfo(
      sekcja([
        kolumna([
          richText({
            pl: { blocks: [{ type: "paragraph" }] },
            en: { blocks: [{ type: "paragraph" }, { type: "toc" }] },
          }),
        ]),
      ]),
    );
    expect(info.toc).toBe(true);
  });

  it.each([
    ["rich-text bez bloku toc", { pl: { blocks: [{ type: "paragraph" }] } }],
    ["dokument nie-obiekt", "<p>stary HTML</p>"],
    ["język bez listy bloków", { pl: { blocks: "toc" } }],
    ["pusty blok i blok nie-obiekt", { pl: { blocks: [null, "toc"] } }],
    ["język null", { pl: null }],
  ])("ODMOWA: %s nie jest spisem treści", (_opis, doc) => {
    expect(sectionIslandInfo(sekcja([kolumna([richText(doc)])])).toc).toBe(false);
  });

  it("ODMOWA: treść rich-text bez obiektu `doc` nie jest spisem treści", () => {
    expect(sectionIslandInfo(sekcja([kolumna([w("rich-text", null)])])).toc).toBe(false);
  });
});

describe("sectionIslandInfo - typy widgetów i kwalifikacja", () => {
  it("zbiera typy z kolumn i sekcji zagnieżdżonych, bez powtórzeń", () => {
    const info = sectionIslandInfo(
      sekcja([
        kolumna([w("heading"), w("slider")]),
        zagniezdzona([kolumna([w("slider"), w("post-list")]), kolumna([w("heading")])]),
      ]),
    );
    expect([...info.widgetTypes].sort()).toEqual(["heading", "post-list", "slider"]);
    expect(info.toc).toBe(false);
    expect(info.eligible).toBe(true);
  });

  it("sekcja eksperymentu A/B nie może być wyspą", () => {
    const info = sectionIslandInfo(
      sekcja([kolumna([w("heading")])], {
        advanced: { abTest: { experimentId: "e1", variant: "a" } },
      }),
    );
    expect(info.eligible).toBe(false);
  });

  it("węzły jsonb bez kształtu są pomijane, a poprawne obok nich liczone", () => {
    const info = sectionIslandInfo(
      sekcja([
        null,
        "kolumna?",
        kolumna("nie-lista"),
        kolumna([null, w(42), w(undefined), w("heading")]),
        zagniezdzona("nie-lista"),
        zagniezdzona([null, kolumna([w("button")])]),
      ]),
    );
    expect([...info.widgetTypes].sort()).toEqual(["button", "heading"]);
  });

  it("sekcja bez listy dzieci daje pustą listę typów i minimalną rezerwę", () => {
    const s = { id: "pusta", kind: "section" } as SectionNode;
    const info = sectionIslandInfo(s);
    expect(info.widgetTypes).toEqual([]);
    expect(info.fallbackMinHeight).toBe(estimateSectionHeight(s));
  });

  it("rezerwa fallbacku to ta sama liczba co szkielet strumienia", () => {
    const s = sekcja([kolumna([w("post-list"), w("heading")])]);
    expect(sectionIslandInfo(s).fallbackMinHeight).toBe(estimateSectionHeight(s));
  });

  it("wynik jest pamiętany per obiekt sekcji, a nowy obiekt liczy się od nowa", () => {
    const s = sekcja([kolumna([w("heading")])]);
    expect(sectionIslandInfo(s)).toBe(sectionIslandInfo(s));
    const poEdycji = sekcja([kolumna([w("heading"), w("toc")])]);
    expect(sectionIslandInfo(poEdycji)).not.toBe(sectionIslandInfo(s));
    expect(sectionIslandInfo(poEdycji).toc).toBe(true);
  });
});
