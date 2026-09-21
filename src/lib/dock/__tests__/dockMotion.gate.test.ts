// BRAMKA: LICZBY RUCHU DOKU SĄ TE SAME W TS I W CSS.
//
// PO CO. Czas WYJŚCIA panelu żyje w dwóch miejscach naraz i musi: JS
// (`useDockPresence`) trzyma na jego podstawie zamykany węzeł w drzewie, a CSS
// odgrywa na nim przejście. Gdy obie strony się rozjadą, nie ma błędu ani
// ostrzeżenia - jest wada widoczna tylko okiem: panel wisi niewidoczny
// (JS dłuższy) albo wyjście ucina się w połowie (CSS dłuższy).
//
// Ta bramka czyta `src/styles.css` i porównuje KAŻDY token `--wd-*-ms`
// z wartością z `dockMotion.ts`. Zmiana w jednym miejscu bez drugiego oblewa
// test - i to jest cały mechanizm, bez czytania `getComputedStyle` w czasie
// działania (co byłoby wymuszonym odczytem układu przy każdym otwarciu).
//
// Wzorzec asercji na źródle CSS wzięty z `floatingInputPlaceholder.test.tsx`,
// który tak samo dowodzi obecności reguły wyciszającej ruch.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DOCK_DRAWER_OUT_MS,
  DOCK_MOTION_TOKENS,
  DOCK_PANEL_OUT_MS,
  dockExitMs,
} from "../dockMotion";

const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

describe("tokeny czasu: TS i CSS mówią to samo", () => {
  it.each(Object.entries(DOCK_MOTION_TOKENS))("%s w styles.css niesie %s ms", (token, expected) => {
    const match = css.match(new RegExp(`${token}:\\s*(\\d+)ms`));
    expect(match, `brak deklaracji ${token} w src/styles.css`).not.toBeNull();
    expect(Number(match?.[1])).toBe(expected);
  });

  it("każdy token jest zadeklarowany DOKŁADNIE raz - dwie deklaracje to rozjazd w zapasie", () => {
    for (const token of Object.keys(DOCK_MOTION_TOKENS)) {
      const hits = css.match(new RegExp(`${token}:\\s*\\d+ms`, "g")) ?? [];
      expect(hits.length, `${token} zadeklarowany ${hits.length} razy`).toBe(1);
    }
  });
});

describe("dockExitMs - hak prezencji dostaje właściwy czas", () => {
  it("panel i skrzynka mają OSOBNE czasy wyjścia", () => {
    expect(dockExitMs("panel")).toBe(DOCK_PANEL_OUT_MS);
    expect(dockExitMs("drawer")).toBe(DOCK_DRAWER_OUT_MS);
    // Skrzynka jedzie dłuższą drogę (cała lewa krawędź), więc i dłużej
    // schodzi - gdyby czasy się zrównały, ta rozróżnienie byłoby atrapą.
    expect(DOCK_DRAWER_OUT_MS).toBeGreaterThan(DOCK_PANEL_OUT_MS);
  });
});

describe("warstwa CSS doku: obietnice, które łatwo cofnąć bez zauważenia", () => {
  it("każdy ruch ma wyłącznik przy prefers-reduced-motion", () => {
    // Nie pytamy o pojedynczą regułę, tylko o to, że blok ograniczonego ruchu
    // WYMIENIA klasy doku - inaczej nowa animacja `.wd-*` mogłaby wejść bez
    // wyciszenia i nikt by tego nie zobaczył.
    const reduced = css.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/g) ?? [];
    const dockBlock = reduced.find((block) => block.includes(".wd-tab"));
    expect(dockBlock, "brak bloku prefers-reduced-motion obejmującego klasy .wd-*").toBeDefined();
    for (const selector of [
      ".wd-tab",
      ".wd-tab__label",
      ".wd-panel",
      ".wd-drawer",
      ".wd-bar",
      ".wd-pill",
    ]) {
      expect(dockBlock, `${selector} nie jest wyciszony`).toContain(selector);
    }
  });

  it("pasek wchodzi KLATKĄ, nie atrybutem przestawianym z JS", () => {
    // Wariant `data-enter="false"` w znaczniku zostawiał pasek zepchnięty
    // poza ekran, gdy JS nie dojechał. Ta asercja pilnuje, że nie wróci.
    expect(css).toContain("@keyframes wd-bar-in");
    expect(css).not.toContain(".wd-bar[data-enter");
  });

  it("panel i skrzynka animują SIĘ na transform i opacity, nie na wymiarach", () => {
    const surfaces = css.match(/\.wd-(panel|drawer)\[data-state="[a-z]+"\] \{[^}]*\}/g) ?? [];
    expect(surfaces.length).toBeGreaterThanOrEqual(6);
    for (const rule of surfaces) {
      // `width`/`height`/`top`/`left` w regule stanu znaczyłyby powrót do
      // animowania układu, czyli dokładnie tego, co usunęliśmy z zakładek.
      expect(rule).not.toMatch(/\b(width|height|top|left|right|bottom|margin|padding)\s*:/);
    }
  });

  it("klatka szkieletu istnieje na POZIOMIE GŁÓWNYM, a nie w środku innej", () => {
    // Ta klatka stała zagnieżdżona w `@keyframes vt-fade-out`, czyli
    // w składni nieistniejącej - przeglądarka odrzucała blok wewnętrzny,
    // więc opóźnienie 140 ms nie działało i szkielet migał przy każdym,
    // nawet natychmiastowym, otwarciu.
    expect(css).toMatch(/\n@keyframes route-skeleton-in \{/);
    const fadeOut = css.match(/@keyframes vt-fade-out \{[^}]*\}[^}]*\}/);
    expect(fadeOut?.[0] ?? "").not.toContain("route-skeleton-in");
  });

  it("pasek doku ma nazwany snapshot View Transitions z wyłączoną animacją", () => {
    // Bez tego pasek wchodzi do migawki korzenia i jest przenikany przy
    // KAŻDEJ nawigacji, choć jest nakładką, która się nie zmienia.
    expect(css).toContain("::view-transition-old(workspace-dock)");
    expect(css).toContain("::view-transition-new(workspace-dock)");
  });

  it("rezerwacja dolnej krawędzi NIE jest zawężona do telefonu", () => {
    // Pasek jest `fixed` na każdej szerokości i ma osobny rząd desktopowy,
    // więc rezerwacja za punktem przełamania oznaczała zasłoniętą stopkę
    // od 768 px w górę.
    const reserve = css.match(/html\[data-mbb="on"\] \{[^}]*\}/);
    expect(reserve, "brak reguły html[data-mbb=on]").not.toBeNull();
    const before = css.slice(0, css.indexOf(reserve?.[0] ?? ""));
    // Ostatnie otwarte `@media` przed regułą musi być już zamknięte -
    // sprawdzamy to licząc nawiasy w tekście poprzedzającym.
    const opens = (before.match(/@media[^{]*\{/g) ?? []).length;
    const closes = (before.match(/\}/g) ?? []).length;
    expect(closes).toBeGreaterThanOrEqual(opens);
  });

  it("bezpieczny obszar iOS jest liczony DOKŁADNIE raz", () => {
    // `--mbb-space` to `offsetHeight` węzła, który ma
    // `padding-bottom: env(safe-area-inset-bottom)`, więc wcięcie JEST już
    // w środku. Dodanie `env(...)` po raz drugi dawało na iPhonie
    // z wcięciem ~34 px martwego pasa nad paskiem.
    const reserve = css.match(/--mbb-reserve:\s*calc\([^;]+\);/)?.[0] ?? "";
    expect(reserve).not.toBe("");
    expect(reserve).not.toContain("safe-area-inset-bottom");
    expect(reserve).toContain("--mbb-space");
  });
});
