import { describe, expect, it } from "vitest";
import { decorateCmsStatusIcons } from "../cmsInlineIcons";

describe("decorateCmsStatusIcons", () => {
  it("converts supported status emoji in text nodes", () => {
    const html = decorateCmsStatusIcons("<p>✅ Sukces ❌ Błąd ⚠️ Uwaga</p>");
    expect(html).toContain("cms-inline-status-icon--success");
    expect(html).toContain("cms-inline-status-icon--error");
    expect(html).toContain("cms-inline-status-icon--warning");
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(3);
  });

  it("does not inject SVG markup into HTML attributes", () => {
    const html = decorateCmsStatusIcons('<span title="✅">✅ Tekst</span>');
    expect(html).toContain('title="✅"');
    expect(html.match(/<svg/g)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Kontrakt wejścia - część C.
//
// UWAGA DO POMIARU: gałąź `ICONS[emoji] ?? emoji` (cmsInlineIcons.ts:20) jest
// NIEOSIĄGALNA z poziomu publicznego API i takie testy jej nie ruszą.
// `STATUS_EMOJI_RE` (:12) ma dokładnie te trzy alternatywy, które są kluczami
// `ICONS` (:6-10), więc odczyt z mapy nigdy nie daje `undefined`. To martwa
// obrona, nie luka testowa - dlatego poniżej idą przypadki wartościowe
// merytorycznie, a nie próba „dobicia" tej jednej gałęzi.
// ---------------------------------------------------------------------------
describe("decorateCmsStatusIcons - granice dopasowania", () => {
  it("goły znak ostrzeżenia BEZ selektora wariantu emoji zostaje tekstem", () => {
    // U+26A0 bez U+FE0F to inny ciąg znaków niż klucz mapy - i tak ma zostać.
    // Podmiana „prawie pasującego" znaku na SVG zmieniłaby treść redakcyjną.
    const html = decorateCmsStatusIcons("<p>⚠ Uwaga bez selektora</p>");
    expect(html).toBe("<p>⚠ Uwaga bez selektora</p>");
    expect(html).not.toContain("<svg");
  });

  it("pusty napis i tekst bez emoji wracają bez zmian", () => {
    expect(decorateCmsStatusIcons("")).toBe("");
    expect(decorateCmsStatusIcons("<p>Zwykły akapit</p>")).toBe("<p>Zwykły akapit</p>");
  });

  it("to samo emoji powtórzone kilka razy daje tyle samo ikon", () => {
    const html = decorateCmsStatusIcons("✅ raz ✅ dwa ✅ trzy");
    expect(html.match(/<svg/g)).toHaveLength(3);
    expect(html).not.toContain("✅");
  });

  it("emoji w tekście MIĘDZY tagami jest zamieniane, w atrybucie - nie", () => {
    const html = decorateCmsStatusIcons('<a href="/x" data-stan="❌"><span>❌</span></a>');
    expect(html).toContain('data-stan="❌"');
    expect(html.match(/<svg/g)).toHaveLength(1);
    expect(html).toContain("cms-inline-status-icon--error");
  });

  it("jest idempotentne - powtórne przetworzenie nie mnoży ikon", () => {
    const once = decorateCmsStatusIcons("<p>✅ Gotowe</p>");
    expect(decorateCmsStatusIcons(once)).toBe(once);
  });
});
