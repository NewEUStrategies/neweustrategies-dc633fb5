// Byline autora w kaskadzie typografii widgetu (szablon HW-2) i dieta stylu
// inline (HW-6) - P2.4.
//
// CO TEN PLIK DOWODZI:
//  1. Żaden węzeł bylinu nie jest łapany przez reguły szablonu typografii
//     (`[data-wt~=…]` w `styles.css`) - rozmiar bylinu ustawia wyłącznie on
//     sam. Selektory bierzemy z reguł szablonu sparsowanych z arkusza, nie z
//     kopii w teście.
//  2. Desktopowe rozmiary bylinu (reguły `@media (min-width: 768px)` w
//     `styles.css`) rozwiązują się do wzoru bylinu - także dla kontraktu
//     domyślnego (12 px nazwiska / 20 px zdjęcia), który NIE powtarza zmiennych
//     desktopowych w stylu inline (HW-6): wtedy pracują wartości zastępcze
//     `var()`, więc muszą być równe wzorowi dla wartości domyślnych.
//  3. Rozmiary spoza kontraktu niosą własne zmienne desktopowe.
//
// Reguły czytamy jako DANE (`@/test/cssRules`), deklaracje rozwiązujemy
// względem stylu inline elementu (jsdom nie liczy `@media` ani `var()`).
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  AuthorByline,
  AUTHOR_BYLINE_DESKTOP_AVATAR_PX,
  AUTHOR_BYLINE_DESKTOP_NAME_PX,
  AUTHOR_BYLINE_INITIAL_RATIO,
} from "../AuthorByline";
import {
  AUTHOR_AVATAR_SIZE_PX_DEFAULT,
  AUTHOR_NAME_SIZE_PX_DEFAULT,
  type AuthorDisplay,
} from "@/lib/builder/authorDisplay";
import { parseCssRules, resolveCssVars } from "@/test/cssRules";

afterEach(cleanup);

const STYLE_RULES = parseCssRules(readFileSync("src/styles.css", "utf8"));

const display = (patch: Partial<AuthorDisplay> = {}): AuthorDisplay => ({
  visible: true,
  showName: true,
  showAvatar: true,
  nameSizePx: AUTHOR_NAME_SIZE_PX_DEFAULT,
  avatarSizePx: AUTHOR_AVATAR_SIZE_PX_DEFAULT,
  avatarRadiusPx: 6,
  labelPrefix: "",
  mode: "avatar",
  ...patch,
});

function renderInFrame(props: Partial<Parameters<typeof AuthorByline>[0]> = {}) {
  return render(
    <div data-builder-renderer data-device="desktop">
      {/* Wszystkie tokeny szablonu naraz - każda jego reguła może tu trafić. */}
      <div data-w-id="byline-frame" data-wt="fs tfs dfs g">
        <AuthorByline name="Jan Kowalski" avatarUrl={null} display={display()} {...props} />
      </div>
    </div>,
  );
}

/** Selektory reguł szablonu HW-2 (bez pseudoelementów, których `matches` nie zna). */
const TEMPLATE_SELECTORS = STYLE_RULES.filter(
  (rule) => rule.context.length === 0 && rule.selectors.some((s) => s.includes("[data-wt~=")),
)
  .flatMap((rule) => rule.selectors)
  .filter((selector) => !selector.includes("::"));

describe("byline - szablon typografii widgetu go nie łapie", () => {
  it("żadna reguła szablonu nie trafia w węzeł bylinu; zwykły akapit w tej ramce - tak", () => {
    const { container } = renderInFrame({ display: display({ labelPrefix: "Autor:" }) });
    expect(TEMPLATE_SELECTORS.length).toBeGreaterThan(4);
    const root = container.querySelector("[data-author-byline]")!;
    const nodes = [root, ...Array.from(root.querySelectorAll("*"))];
    expect(nodes.length).toBeGreaterThan(3);
    for (const node of nodes) {
      const hits = TEMPLATE_SELECTORS.filter((selector) => node.matches(selector));
      expect(hits, node.outerHTML).toEqual([]);
    }
    // Kontrapunkt: zwykły akapit w tej samej ramce szablon łapie.
    const p = document.createElement("p");
    container.querySelector('[data-w-id="byline-frame"]')!.appendChild(p);
    expect(TEMPLATE_SELECTORS.some((selector) => p.matches(selector))).toBe(true);
  });
});

/** Wartość `property` z reguł desktopowych bylinu dla elementu (po `var()`). */
function desktopValue(element: Element, property: string): string {
  const values = STYLE_RULES.filter(
    (rule) =>
      rule.context.length === 1 &&
      /^@media \(min-width: 768px\)$/.test(rule.context[0]) &&
      rule.declarations.has(property) &&
      rule.selectors.some((selector) => element.matches(selector)),
  ).map((rule) => resolveCssVars(rule.declarations.get(property)!, element));
  expect(values.length, `${property} @ ${element.outerHTML}`).toBeGreaterThan(0);
  // Kilka trafień (np. korzeń i nazwisko) musi dawać tę samą wartość.
  expect(new Set(values).size).toBe(1);
  return values[0];
}

/** Wzór bylinu na desktop (te same stałe, z których liczy go komponent). */
const desktopName = (px: number) =>
  Math.round((px * AUTHOR_BYLINE_DESKTOP_NAME_PX) / AUTHOR_NAME_SIZE_PX_DEFAULT);
const desktopAvatar = (px: number) =>
  Math.round((px * AUTHOR_BYLINE_DESKTOP_AVATAR_PX) / AUTHOR_AVATAR_SIZE_PX_DEFAULT);

describe("byline - rozmiary desktopowe (HW-6)", () => {
  it.each([
    ["kontrakt domyślny", AUTHOR_NAME_SIZE_PX_DEFAULT, AUTHOR_AVATAR_SIZE_PX_DEFAULT],
    ["rozmiary spoza kontraktu", 15, 30],
  ])("%s: desktop rozwiązuje się do wzoru bylinu", (_label, nameSizePx, avatarSizePx) => {
    const { container } = renderInFrame({ display: display({ nameSizePx, avatarSizePx }) });
    const root = container.querySelector<HTMLElement>("[data-author-byline]")!;
    const name = container.querySelector<HTMLElement>("[data-author-byline-name]")!;
    const initial = container.querySelector<HTMLElement>("span[data-author-byline-avatar]")!;
    const fontPx = `${desktopName(nameSizePx)}px`;
    const avatarPx = `${desktopAvatar(avatarSizePx)}px`;
    expect(desktopValue(root, "font-size")).toBe(fontPx);
    expect(desktopValue(name, "font-size")).toBe(fontPx);
    for (const property of ["width", "height", "min-width", "max-height"]) {
      expect(desktopValue(initial, property)).toBe(avatarPx);
    }
    expect(desktopValue(initial, "font-size")).toBe(
      `${Math.round(desktopAvatar(avatarSizePx) * AUTHOR_BYLINE_INITIAL_RATIO)}px`,
    );
  });

  it("kontrakt domyślny nie powtarza zmiennych desktopowych w stylu inline", () => {
    const { container } = renderInFrame({ avatarUrl: "https://example.com/a.jpg" });
    const root = container.querySelector<HTMLElement>("[data-author-byline]")!;
    const avatar = container.querySelector<HTMLElement>("[data-author-byline-avatar]")!;
    expect(root.getAttribute("style")).not.toContain("--abl-");
    expect(avatar.getAttribute("style")).not.toContain("--abl-");
    // Domknięcie pudełka zostaje inline (wygrywa z globalnymi regułami obrazów).
    expect(avatar.style.width).toBe(`${AUTHOR_AVATAR_SIZE_PX_DEFAULT}px`);
    expect(avatar.style.maxHeight).toBe(`${AUTHOR_AVATAR_SIZE_PX_DEFAULT}px`);
  });

  it("rozmiary spoza kontraktu niosą własne zmienne desktopowe", () => {
    const { container } = renderInFrame({
      display: display({ nameSizePx: 15, avatarSizePx: 30 }),
    });
    const root = container.querySelector<HTMLElement>("[data-author-byline]")!;
    const avatar = container.querySelector<HTMLElement>("[data-author-byline-avatar]")!;
    expect(root.style.getPropertyValue("--abl-fs-desktop")).toBe(`${desktopName(15)}px`);
    expect(avatar.style.getPropertyValue("--abl-av-desktop")).toBe(`${desktopAvatar(30)}px`);
  });
});
