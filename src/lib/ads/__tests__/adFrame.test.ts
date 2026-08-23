// Kontrakt izolacji kreacji reklamowej: atrybut `sandbox` i dokument `srcdoc`.
// RYZYKO: treść slotu wpisuje redakcja w panelu, więc z punktu widzenia
// przeglądarki jest to dowolny, NIEZAUFANY HTML/JS. Jedyne, co dzieli go od
// sesji czytelnika (cookies, localStorage, DOM strony), to brak jednego tokenu
// w atrybucie `sandbox`.
//
// CO TEN PLIK DOWODZI.
//   1. `allow-same-origin` NIE MA na liście i nie ma go tam mieć. To asercja
//      obronna: dopisanie tego tokenu "żeby kreacja mogła coś odczytać"
//      przechodzi przez tsc i przez recenzję bez mrugnięcia okiem, a otwiera
//      stored XSS z panelu reklam prosto do sesji czytelnika.
//   2. Trzy tokeny, które MUSZĄ zostać, bo bez nich kreacja przestaje działać:
//      skrypty i wyjście linków do nowej karty.
//   3. Markup trafia do `<body>` DOSŁOWNIE - bez escapowania, razem z
//      `<script>` i cudzysłowami. To jest zamierzone (kreacja ma się wykonać),
//      i dlatego punkt 1. jest jedyną realną barierą.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Tego, że komponent te wartości faktycznie
// wystawia na elemencie `<iframe>`, dowodzi
// `src/components/ads/atoms/__tests__/SandboxedAdFrame.test.tsx`.
import { describe, expect, it } from "vitest";
import { AD_FRAME_SANDBOX, buildAdFrameSrcDoc } from "@/lib/ads/adFrame";

describe("adFrame - atrybut sandbox", () => {
  it("NIE zawiera allow-same-origin - kreacja zostaje w opaque origin", () => {
    expect(AD_FRAME_SANDBOX).not.toContain("allow-same-origin");
  });

  it("zawiera dokładnie trzy uprawnienia potrzebne kreacji i ani jednego więcej", () => {
    expect(AD_FRAME_SANDBOX.split(" ").filter(Boolean).sort()).toEqual([
      "allow-popups",
      "allow-popups-to-escape-sandbox",
      "allow-scripts",
    ]);
  });

  it("nie przyznaje uprawnień, które wyprowadziłyby kreację poza ramkę", () => {
    for (const forbidden of [
      "allow-same-origin",
      "allow-top-navigation",
      "allow-modals",
      "allow-forms",
      "allow-pointer-lock",
      "allow-presentation",
    ]) {
      expect(AD_FRAME_SANDBOX).not.toContain(forbidden);
    }
  });
});

describe("adFrame - dokument srcdoc", () => {
  it("osadza markup DOSŁOWNIE w body, bez escapowania cudzysłowów", () => {
    const markup = "<div class=\"promo\" data-x='1'>Kup &amp; czytaj</div>";
    expect(buildAdFrameSrcDoc(markup)).toContain(`<body>${markup}</body>`);
  });

  it("przepuszcza <script> nietknięty - kreacja ma się wykonać, ale w cudzym originie", () => {
    const doc = buildAdFrameSrcDoc('<script>window.top.location="/phish"</script>');
    expect(doc).toContain('<script>window.top.location="/phish"</script>');
  });

  it('ustawia <base target="_blank">, żeby linki kreacji wychodziły do nowej karty', () => {
    expect(buildAdFrameSrcDoc("")).toContain('<base target="_blank">');
  });

  it("deklaruje utf-8 - polskie znaki w kreacji nie mają się rozjechać", () => {
    expect(buildAdFrameSrcDoc("Zażółć gęślą jaźń")).toContain('<meta charset="utf-8">');
    expect(buildAdFrameSrcDoc("Zażółć gęślą jaźń")).toContain("Zażółć gęślą jaźń");
  });

  it("pusty markup daje poprawny, pusty dokument (a nie 'undefined' w body)", () => {
    expect(buildAdFrameSrcDoc("")).toBe(
      '<!doctype html><html><head><meta charset="utf-8"><base target="_blank">' +
        "<style>html,body{margin:0;padding:0;height:100%}" +
        "body{display:flex;align-items:center;justify-content:center;overflow:hidden}</style>" +
        "</head><body></body></html>",
    );
  });

  it("centruje i odcina przewijanie - kreacja nie rozpycha zarezerwowanego pudełka", () => {
    const doc = buildAdFrameSrcDoc("<span>x</span>");
    expect(doc).toContain("html,body{margin:0;padding:0;height:100%}");
    expect(doc).toContain(
      "body{display:flex;align-items:center;justify-content:center;overflow:hidden}",
    );
  });
});
