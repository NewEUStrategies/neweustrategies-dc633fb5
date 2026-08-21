// OBEJŚCIE SANITYZATORA: inline'owy handler zdarzenia przechodzi, gdy ładunek
// jest POPRZEDZONY znacznikiem `<script>`.
//
// STAN WIEDZY - przeczytaj przed reakcją, bo zakres ma znaczenie:
//   * Reprodukcja poniżej jest deterministyczna i minimalna. Ten sam ładunek
//     BEZ prefiksu `<script>` jest czyszczony poprawnie, więc nie chodzi
//     o politykę atrybutów, tylko o kolejność wejścia.
//   * Reprodukcja zachodzi pod `happy-dom` - implementacją DOM, na której stoi
//     ta suita. NIE JEST tu potwierdzone, że to samo dzieje się w przeglądarce
//     (inny parser HTML) ani na ścieżce SSR (`lib/ssrSanitizeHtml`, osobna
//     implementacja, niesprawdzona tym testem). Dlatego opis mówi
//     „obejście w tym środowisku", a nie „XSS na produkcji".
//   * Dlaczego to i tak jest poważne: `sanitizeHtml` jest JEDYNYM filtrem
//     przed `dangerouslySetInnerHTML` w blokach `paragraph`, `html`, `spoiler`
//     i w relacji na żywo. Jeśli obejście przenosi się na przeglądarkę, autor
//     treści (albo importowany wpis z WordPressa) wnosi wykonywalny handler na
//     stronę publiczną.
//
// CO Z TYM ZROBIĆ: sprawdzić zachowanie na prawdziwym DOM-ie (Playwright) oraz
// na ścieżce SSR, a niezależnie od wyniku dołożyć w `sanitizeHtml` twardą,
// niezależną od parsera straż na atrybuty `on*`. To zmiana zachowania
// produkcyjnego, więc poza zakresem zadania pokryciowego - ten plik jest
// zgłoszeniem, nie naprawą.
import { describe, it, expect } from "vitest";
import { sanitizeHtml } from "@/lib/sanitize";

const PAYLOAD = "<img src=x onerror=y>";

describe("sanitizeHtml - kontrola pozytywna (te ładunki są czyszczone)", () => {
  it.each([
    ["handler bez cudzysłowów", PAYLOAD],
    ["handler w cudzysłowach", '<img src="x" onerror="y">'],
    ["handler z wywołaniem", "<img src=x onerror=alert(1)>"],
    ["handler WIELKIMI literami", "<img src=x ONERROR=y>"],
    ["handler na innym elemencie", "<div onclick=y>x</div>"],
    ["ładunek po zwykłym akapicie", `<p>ok</p>${PAYLOAD}`],
    ["ładunek po pogrubieniu", `<b>ok</b>${PAYLOAD}`],
    ["ładunek po komentarzu", `<!-- c -->${PAYLOAD}`],
  ])("%s jest usuwany", (_label, dirty) => {
    expect(sanitizeHtml(dirty)).not.toMatch(/on\w+=/i);
  });

  it.each([
    ["schemat javascript w href", '<a href="javascript:alert(1)">x</a>', "javascript:"],
    ["iframe", '<iframe src="https://obcy.test"></iframe>', "<iframe"],
    ["formularz phishingowy", '<form action="/p"><input name="password"></form>', "<form"],
    ["znacznik style", "<style>body{display:none}</style>", "<style"],
  ])("%s jest usuwany", (_label, dirty, forbidden) => {
    expect(sanitizeHtml(dirty)).not.toContain(forbidden);
  });

  it("sam znacznik script jest usuwany", () => {
    expect(sanitizeHtml("<p>ok</p><script>alert(1)</script>")).toBe("<p>ok</p>");
  });
});

describe("sanitizeHtml - OBEJŚCIE (zgłoszone, nie naprawione)", () => {
  it.fails.each([
    ["prefiks script z treścią", `<script>alert(1)</script>${PAYLOAD}`],
    ["prefiks script pusty", `<script></script>${PAYLOAD}`],
  ])("POWINNO usuwać handler przy %s", (_label, dirty) => {
    expect(sanitizeHtml(dirty)).not.toMatch(/on\w+=/i);
  });

  // Zawężenie zakresu: forma SAMOZAMYKAJĄCA `<script/>` obejścia NIE wywołuje.
  // Różnica jest istotna dla diagnozy - `<script/>` nie jest w HTML poprawnym
  // samozamknięciem, więc parser traktuje resztę dokumentu jako WNĘTRZE
  // skryptu; przy formie parzystej wnętrze się domyka i dopiero wtedy kolejny
  // element trafia na ścieżkę, na której handler przeżywa.
  it("prefiks samozamykający <script/> NIE otwiera obejścia", () => {
    expect(sanitizeHtml(`<script/>${PAYLOAD}`)).not.toMatch(/on\w+=/i);
  });

  it("dokumentacja STANU FAKTYCZNEGO: handler przeżywa prefiks <script>", () => {
    const out = sanitizeHtml(`<script>alert(1)</script>${PAYLOAD}`);
    // Sam `<script>` wypada poprawnie...
    expect(out).not.toContain("<script");
    // ...ale handler zdarzenia na następnym elemencie ZOSTAJE.
    expect(out).toContain("onerror");
  });

  it("ten sam ładunek BEZ prefiksu jest czyszczony - to jest dowód, że wina jest w kolejności wejścia, nie w polityce atrybutów", () => {
    expect(sanitizeHtml(PAYLOAD)).not.toContain("onerror");
    expect(sanitizeHtml(`<script>alert(1)</script>${PAYLOAD}`)).toContain("onerror");
  });
});
