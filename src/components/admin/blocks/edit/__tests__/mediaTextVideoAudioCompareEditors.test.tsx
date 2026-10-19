// EDYTORY MEDIÓW: `video`, `audio`, `media-text`, `compare` - CO REDAKTOR
// WIDZI I CO ZAPISUJE.
//
// PO CO TEN PLIK. Po zdjęciu przejazdu tabeli (`blockEditMatrix.*`, PR #475)
// te edytory nie miały ani jednego wykonania poza dyspozytorem. Wszystkie
// cztery przełączają widok zależnie od tego, czy jest URL, więc kontrakt
// „co jest URL-em" musi być ten sam co w rendererze publicznym (czytnik
// `str`: liczba czy obiekt to BRAK URL-a, a nie odtwarzacz z `src="7"`).
//
// CO MA TU DOWÓD
//  * pusty stan: pole URL, którego wpis zapisuje się pod `url`; render nie
//    zapisuje niczego,
//  * stan z URL-em: odtwarzacz z flagami z danych, pola podpisu i źródła
//    zapisują się pod WŁASNYMI kluczami; pasek narzędzi mediów tylko dla
//    aktywnego bloku,
//  * obiekt w podpisie nie wycieka jako „[object Object]” (był to zarejestrowany
//    defekt koercji `AudioBlock`/`VideoBlock` z tabeli edytorów),
//  * media i tekst: pozycja mediów ma stan ARIA (`aria-pressed`), a pole URL
//    zostaje na miejscu po wpisaniu pierwszego znaku i po ustawieniu obrazu,
//  * przed/po: podgląd pojawia się dopiero, gdy są OBA obrazy.
//
// GRANICE. Fabryki `vi.mock` niesie moduł wspólny tabeli edytorów (import
// PIERWSZY) - w tym sesję najemcy, której potrzebuje pasek narzędzi mediów.
// i18n PRAWDZIWE (`realT`).
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

import { renderEditor } from "./blockEditMatrix.shared";
import type { Block, BlockType, Json } from "@/lib/blocks/types";
import { realT } from "@/test/i18nReal";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import "@/lib/i18n-admin-blocks";
import { AudioBlock } from "../Audio";
import { CompareBlock } from "../Compare";
import { MediaTextBlock } from "../MediaText";
import { VideoBlock } from "../Video";

const t = realT("pl");
const ed = (group: string, key: string) => t(`blocks.editors.${group}.${key}`) as string;
const PODPIS = ed("image", "caption");
const ZRODLO = t("blocks.toolbar.sourceLabel") as string;
const ZRODLO_URL = "https://…";
const ZAMIEN_URL = t("blocks.toolbar.replaceUrl") as string;

function blok(type: BlockType, data: Record<string, Json>): Block {
  return { id: `blk-${type}`, type, data };
}

function ostatniZapis(changes: Block[]): Block {
  expect(changes.length, "edytor nie zapisał niczego").toBeGreaterThan(0);
  return changes[changes.length - 1];
}

// ---------------------------------------------------------------------------
// Wideo i audio - ten sam kształt danych, ten sam kontrakt
// ---------------------------------------------------------------------------

describe.each([
  ["video", VideoBlock, ed("video", "urlPh"), "video", "https://cdn.example.com/v.mp4"],
  ["audio", AudioBlock, ed("audio", "urlPh"), "audio", "https://cdn.example.com/a.mp3"],
] as const)("%s", (type, Editor, urlPh, tag, url) => {
  it("pusty blok pokazuje pole URL; wpis zapisuje się pod `url`, render niczego nie zapisuje", () => {
    const start = blok(type, { url: "", caption: "" });
    const { container, changes } = renderEditor(Editor, start);
    expect(container.querySelector(tag)).toBeNull();
    expect(screen.queryByPlaceholderText(PODPIS)).toBeNull();
    expect(changes).toEqual([]);

    const pole = screen.getByPlaceholderText(urlPh);
    fireEvent.change(pole, { target: { value: url } });
    // Pisanie to jeszcze szkic - zapis idzie po opuszczeniu pola (albo Enter).
    expect(changes).toEqual([]);
    fireEvent.blur(pole);
    const zapis = ostatniZapis(changes);
    expect(zapis).toMatchObject({ id: start.id, type });
    expect(zapis.data).toEqual({ url, caption: "" });
  });

  it("wpisanie pierwszego znaku URL-a nie zabiera pola spod kursora", () => {
    // NAPRAWIONE 2026-10-19: zapis po pierwszym znaku („h”) dawał niepusty URL,
    // widok przełączał się na odtwarzacz, a pole - razem z fokusem - znikało.
    function Kanwa() {
      const [block, setBlock] = useState(blok(type, { url: "" }));
      return <Editor block={block} onChange={setBlock} />;
    }
    render(<Kanwa />);
    const pole = screen.getByPlaceholderText<HTMLInputElement>(urlPh);
    pole.focus();
    fireEvent.change(pole, { target: { value: "h" } });
    fireEvent.change(pole, { target: { value: url } });
    expect(pole.isConnected).toBe(true);
    expect(document.activeElement).toBe(pole);
    expect(document.querySelector(tag)).toBeNull();
  });

  it("Enter zapisuje adres raz, bez spacji z brzegów; pusty szkic nie zapisuje", () => {
    const { changes } = renderEditor(Editor, blok(type, { url: "" }));
    const pole = screen.getByPlaceholderText(urlPh);
    fireEvent.change(pole, { target: { value: "   " } });
    fireEvent.blur(pole);
    expect(changes).toEqual([]);
    fireEvent.change(pole, { target: { value: `  ${url} ` } });
    fireEvent.keyDown(pole, { key: "Enter" });
    fireEvent.blur(pole);
    expect(changes).toHaveLength(1);
    expect(ostatniZapis(changes).data).toEqual({ url });
  });

  it("z URL-em pokazuje odtwarzacz z flagami z danych", () => {
    const { container } = renderEditor(
      Editor,
      blok(type, { url, autoplay: true, loop: true, muted: false }),
    );
    const odtwarzacz = container.querySelector<HTMLMediaElement>(tag);
    expect(odtwarzacz?.getAttribute("src")).toBe(url);
    expect(odtwarzacz?.autoplay).toBe(true);
    expect(odtwarzacz?.loop).toBe(true);
    expect(odtwarzacz?.muted).toBe(false);
  });

  it.each([
    [PODPIS, "caption", "Wystąpienie otwierające"],
    [ZRODLO, "source", "Archiwum NES"],
    [ZRODLO_URL, "sourceUrl", "https://example.org/archiwum"],
  ])("pole „%s” zapisuje się pod kluczem `%s`", (placeholder, klucz, wartosc) => {
    const start = blok(type, { url, caption: "Stary podpis" });
    const { changes } = renderEditor(Editor, start);
    fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value: wartosc } });
    expect(ostatniZapis(changes).data).toEqual({ ...start.data, [klucz]: wartosc });
  });

  it("pasek narzędzi mediów jest tylko przy AKTYWNYM bloku", () => {
    renderEditor(Editor, blok(type, { url }));
    expect(screen.getByTitle(ZAMIEN_URL)).toBeTruthy();

    const nieaktywny = renderWithQueryClient(
      <Editor block={blok(type, { url })} isActive={false} onChange={() => undefined} />,
    );
    expect(nieaktywny.container.querySelector(`[title="${ZAMIEN_URL}"]`)).toBeNull();
  });

  it("URL-liczba to BRAK URL-a, a podpis-obiekt nie wycieka jako „[object Object]”", () => {
    // NAPRAWIONE 2026-10-18 (zarejestrowany defekt koercji tabeli edytorów):
    // `String(7)` dawało odtwarzacz z `src="7"`, którego strona (czytnik
    // `str`) nigdy nie narysuje, a `String({})` - „[object Object]” w podpisie.
    const pusty = renderEditor(Editor, blok(type, { url: 7 }));
    expect(pusty.container.querySelector(tag)).toBeNull();
    expect(screen.getByPlaceholderText(urlPh)).toBeTruthy();
    pusty.unmount();

    const { container } = renderEditor(Editor, blok(type, { url, caption: {}, source: null }));
    expect(container.textContent).not.toContain("[object Object]");
    expect(screen.getByPlaceholderText<HTMLInputElement>(PODPIS).value).toBe("");
    expect(screen.getByPlaceholderText<HTMLInputElement>(ZRODLO).value).toBe("");
  });
});

describe("video - plakat", () => {
  it("plakat z danych trafia do odtwarzacza; pusty plakat nie daje atrybutu", () => {
    const z = renderEditor(
      VideoBlock,
      blok("video", {
        url: "https://cdn.example.com/v.mp4",
        poster: "https://cdn.example.com/p.jpg",
      }),
    );
    expect(z.container.querySelector("video")?.getAttribute("poster")).toBe(
      "https://cdn.example.com/p.jpg",
    );
    z.unmount();
    const bez = renderEditor(VideoBlock, blok("video", { url: "https://cdn.example.com/v.mp4" }));
    expect(bez.container.querySelector("video")?.hasAttribute("poster")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Media i tekst
// ---------------------------------------------------------------------------

describe("media-text", () => {
  const URL_PH = t("blocks.fields.imageUrl") as string;
  const LEWA = ed("mediaText", "left");
  const PRAWA = ed("mediaText", "right");

  it.each([
    [{}, "true", "false"],
    [{ mediaPosition: "right" }, "false", "true"],
    [{ mediaPosition: "góra" }, "true", "false"],
  ] as const)("pozycja %j ma stan ARIA: lewa %s, prawa %s", (data, lewa, prawa) => {
    // NAPRAWIONE 2026-10-18: wybrana pozycja różniła się od drugiej wyłącznie
    // kolorem tła - czytnik ekranu nie miał jak jej odczytać.
    renderEditor(MediaTextBlock, blok("media-text", data));
    expect(screen.getByRole("button", { name: LEWA }).getAttribute("aria-pressed")).toBe(lewa);
    expect(screen.getByRole("button", { name: PRAWA }).getAttribute("aria-pressed")).toBe(prawa);
  });

  it("pozycja i tekst zapisują się pod własnymi kluczami, render niczego nie zapisuje", () => {
    const start = blok("media-text", { url: "", text: "Wstęp", mediaPosition: "left" });
    const { changes } = renderEditor(MediaTextBlock, start);
    expect(changes).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: PRAWA }));
    expect(ostatniZapis(changes)).toMatchObject({ id: start.id, type: "media-text" });
    expect(ostatniZapis(changes).data).toEqual({ ...start.data, mediaPosition: "right" });
    fireEvent.change(screen.getByPlaceholderText(ed("mediaText", "contentPh")), {
      target: { value: "Rozwinięcie" },
    });
    expect(ostatniZapis(changes).data).toEqual({ ...start.data, text: "Rozwinięcie" });
  });

  it("powrót z prawej na lewą zapisuje `mediaPosition: left`", () => {
    const start = blok("media-text", { mediaPosition: "right" });
    const { changes } = renderEditor(MediaTextBlock, start);
    fireEvent.click(screen.getByRole("button", { name: LEWA }));
    expect(ostatniZapis(changes).data).toEqual({ mediaPosition: "left" });
  });

  it("ustawiony obraz ma podgląd ORAZ pole URL, którym da się go podmienić", () => {
    // NAPRAWIONE 2026-10-18: pole URL istniało tylko w pustym stanie - po
    // ustawieniu obrazu znikało, a blok nie ma paska narzędzi ani pola w
    // panelu bocznym, więc obrazu nie dało się już zmienić.
    const start = blok("media-text", { url: "https://cdn.example.com/1.jpg", text: "" });
    const { container, changes } = renderEditor(MediaTextBlock, start);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://cdn.example.com/1.jpg",
    );
    const pole = screen.getByPlaceholderText<HTMLInputElement>(URL_PH);
    expect(pole.value).toBe("https://cdn.example.com/1.jpg");
    fireEvent.change(pole, { target: { value: "https://cdn.example.com/2.jpg" } });
    expect(ostatniZapis(changes).data).toEqual({
      ...start.data,
      url: "https://cdn.example.com/2.jpg",
    });
  });

  it("wpisanie pierwszego znaku URL-a nie zabiera pola spod kursora", () => {
    // NAPRAWIONE 2026-10-18: zapis po pierwszym znaku („h”) dawał niepusty URL,
    // widok przełączał się na `<img src="h">`, a pole - razem z fokusem -
    // znikało. Adres dało się tylko wkleić w całości.
    function Kanwa() {
      const [block, setBlock] = useState(blok("media-text", { url: "", text: "" }));
      return <MediaTextBlock block={block} onChange={setBlock} />;
    }
    render(<Kanwa />);
    const pole = screen.getByPlaceholderText<HTMLInputElement>(URL_PH);
    pole.focus();
    fireEvent.change(pole, { target: { value: "h" } });
    fireEvent.change(pole, { target: { value: "https://cdn.example.com/3.jpg" } });
    expect(pole.isConnected).toBe(true);
    expect(document.activeElement).toBe(pole);
    expect(pole.value).toBe("https://cdn.example.com/3.jpg");
  });

  it("URL-obiekt to brak obrazu i puste pole, a nie „[object Object]”", () => {
    const { container } = renderEditor(MediaTextBlock, blok("media-text", { url: {}, text: 5 }));
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).not.toContain("[object Object]");
    expect(screen.getByPlaceholderText<HTMLInputElement>(URL_PH).value).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Przed / po
// ---------------------------------------------------------------------------

describe("compare", () => {
  const start = blok("compare", {
    before: "https://cdn.example.com/2010.jpg",
    after: "",
    labelBefore: "2010",
    labelAfter: "2026",
  });

  it.each([
    ["urlBefore", "before", "https://cdn.example.com/2011.jpg"],
    ["urlAfter", "after", "https://cdn.example.com/2026.jpg"],
    ["labelLeft", "labelBefore", "Wtedy"],
    ["labelRight", "labelAfter", "Dziś"],
  ])("pole „%s” zapisuje się pod kluczem `%s`", (klucz, pole, wartosc) => {
    const { changes } = renderEditor(CompareBlock, start);
    fireEvent.change(screen.getByPlaceholderText(ed("compare", klucz)), {
      target: { value: wartosc },
    });
    const zapis = ostatniZapis(changes);
    expect(zapis).toMatchObject({ id: start.id, type: "compare" });
    expect(zapis.data).toEqual({ ...start.data, [pole]: wartosc });
  });

  it("podgląd pojawia się dopiero przy OBU obrazach, z etykietami jako tekstem alternatywnym", () => {
    const { container, changes } = renderEditor(CompareBlock, start);
    expect(container.querySelector("img")).toBeNull();
    expect(changes).toEqual([]);

    renderEditor(CompareBlock, {
      ...start,
      data: { ...start.data, after: "https://cdn.example.com/2026.jpg" },
    });
    expect(screen.getByRole<HTMLImageElement>("img", { name: "2010" }).src).toBe(
      "https://cdn.example.com/2010.jpg",
    );
    expect(screen.getByRole<HTMLImageElement>("img", { name: "2026" }).src).toBe(
      "https://cdn.example.com/2026.jpg",
    );
  });

  it("brak etykiet pokazuje domyślne „Przed”/„Po” z palety; URL-obiekt nie daje podglądu", () => {
    const { container } = renderEditor(
      CompareBlock,
      blok("compare", { before: {}, after: "https://cdn.example.com/b.jpg" }),
    );
    expect(screen.getByPlaceholderText<HTMLInputElement>(ed("compare", "labelLeft")).value).toBe(
      "Przed",
    );
    expect(screen.getByPlaceholderText<HTMLInputElement>(ed("compare", "labelRight")).value).toBe(
      "Po",
    );
    expect(screen.getByPlaceholderText<HTMLInputElement>(ed("compare", "urlBefore")).value).toBe(
      "",
    );
    expect(container.querySelector("img")).toBeNull();
  });
});
