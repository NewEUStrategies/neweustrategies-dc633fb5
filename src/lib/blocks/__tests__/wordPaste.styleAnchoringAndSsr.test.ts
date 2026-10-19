import { afterEach, describe, expect, it, vi } from "vitest";
import { parseWordHtml, parseWordInlineHtml } from "@/lib/blocks/wordPaste";

// Formatowanie inline z wklejki Worda jest czytane ze stylu elementu. Word
// wypisuje obok zwykłych własności CSS ich warianty `mso-bidi-*` (krój pism
// złożonych, NIE łacińskiego) - np. pogrubiony tekst dostaje
// `<b style='mso-bidi-font-weight:normal'>`. Wzorce bez kotwicy brały
// `font-weight:normal` z wnętrza `mso-bidi-font-weight:normal` i zdejmowały
// pogrubienie (naprawione 2026-10-18). Ten plik dowodzi kontraktu w OBIE strony:
// warianty `mso-*` nie dodają ani nie zdejmują formatowania, a zwykła
// własność działa tak samo na początku stylu, po `;` i po spacji.
//
// Drugi temat: SSR. Parser potrzebuje `DOMParser`; na serwerze go nie ma, więc
// obie funkcje muszą zwrócić wynik pusty zamiast wyjątku (wklejka jest akcją
// przeglądarki, ale moduł bywa importowany przez kod renderowany na serwerze).
// Granica środowiska jest podmieniana `vi.stubGlobal`, nic innego nie jest
// mockowane - parser działa na DOM-ie happy-dom.

describe("parseWordHtml - własności CSS czytane od granicy deklaracji", () => {
  it.each([
    ["<b style='mso-bidi-font-weight:normal'>x</b>", "<strong>x</strong>"],
    ["<strong style='mso-bidi-font-weight:400'>x</strong>", "<strong>x</strong>"],
    ["<i style='mso-bidi-font-style:normal'>x</i>", "<em>x</em>"],
  ])("wariant mso-bidi NIE zdejmuje formatowania: %s", (inline, expected) => {
    const [block] = parseWordHtml(`<p>a ${inline} b</p>`);
    expect(block.data.html).toBe(`a ${expected} b`);
  });

  it.each([
    ['<b style="font-weight:normal">x</b>', "a x b"],
    ['<b style="font-size:11pt;font-weight:normal">x</b>', "a x b"],
    ['<b style="color:red; font-weight: 400">x</b>', "a x b"],
    ['<i style="mso-bidi-font-style:italic;font-style:normal">x</i>', "a x b"],
  ])("zwykła własność nadal zdejmuje atrapę formatowania: %s", (inline, expected) => {
    const [block] = parseWordHtml(`<p>a ${inline} b</p>`);
    expect(block.data.html).toBe(expected);
  });

  it.each([
    ["<span style='mso-bidi-font-weight:bold'>x</span>", "a x b"],
    ["<span style='mso-bidi-font-style:italic'>x</span>", "a x b"],
    ["<span style='mso-ansi-vertical-align:super'>x</span>", "a x b"],
  ])("wariant mso-* NIE dodaje formatowania: %s", (inline, expected) => {
    const [block] = parseWordHtml(`<p>a ${inline} b</p>`);
    expect(block.data.html).toBe(expected);
  });

  it.each([
    ['<span style="color:red;font-weight:700">x</span>', "a <strong>x</strong> b"],
    ['<span style="color:red; font-style: italic">x</span>', "a <em>x</em> b"],
    ['<span style="font-size:9pt;vertical-align:super">x</span>', "a <sup>x</sup> b"],
  ])("własność po `;` lub spacji dodaje formatowanie: %s", (inline, expected) => {
    const [block] = parseWordHtml(`<p>a ${inline} b</p>`);
    expect(block.data.html).toBe(expected);
  });

  it("komórki z samym mso-bidi-font-weight:bold NIE robią wiersza nagłówka tabeli", () => {
    const [block] = parseWordHtml(
      "<table><tr><td style='mso-bidi-font-weight:bold'>A</td>" +
        "<td style='mso-bidi-font-weight:bold'>B</td></tr><tr><td>1</td><td>2</td></tr></table>",
    );
    expect(block.type).toBe("table");
    expect(block.data.header).toBe(false);
    expect(block.data.rows).toEqual([
      ["A", "B"],
      ["1", "2"],
    ]);
  });

  it("komórki pogrubione zwykłą własnością nadal robią wiersz nagłówka", () => {
    const [block] = parseWordHtml(
      "<table><tr><td style='padding:0;font-weight:bold'>A</td></tr><tr><td>1</td></tr></table>",
    );
    expect(block.data.header).toBe(true);
  });
});

describe("parseWordInlineHtml - fragment bez elementów blokowych", () => {
  it("same węzły inline oddaje jako jeden fragment, z formatowaniem", () => {
    expect(parseWordInlineHtml("tekst <b>gruby</b> i <a href='/x'>link</a>")).toBe(
      'tekst <strong>gruby</strong> i <a href="/x">link</a>',
    );
  });

  it("puste bloki są pomijane przy sklejaniu fragmentów", () => {
    expect(parseWordInlineHtml("<p>a</p><p> </p><p>b</p>")).toBe("a<br>b");
  });
});

describe("SSR - brak DOMParser", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parseWordHtml zwraca pustą listę bloków zamiast rzucać", () => {
    vi.stubGlobal("DOMParser", undefined);
    expect(parseWordHtml("<p>treść</p>")).toEqual([]);
  });

  it("parseWordInlineHtml zwraca pusty fragment zamiast rzucać", () => {
    vi.stubGlobal("DOMParser", undefined);
    expect(parseWordInlineHtml("<p>treść</p>")).toBe("");
  });
});
