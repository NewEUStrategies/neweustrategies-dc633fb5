// Byline autora w kaskadzie typografii widgetu (szablon HW-2) i dieta stylu
// inline (HW-6) - P2.4.
//
// CO TEN PLIK DOWODZI:
//  1. Żaden węzeł bylinu nie jest łapany przez reguły szablonu typografii,
//     które respektują `data-typography-exempt` (gałęzie `:is(p, span, ...)`
//     rozmiaru ogólnego i opisu) - rozmiar bylinu ustawia wyłącznie on sam.
//  2. Kontrakt domyślny (12 px nazwiska / 20 px zdjęcia) nie powtarza zmiennych
//     desktopowych w stylu inline: wartości zastępcze reguł `@media` w
//     `styles.css` są dokładnie tym, co byline wyliczyłby sam (16 / 24 / 13 px).
//  3. Rozmiary spoza kontraktu nadal niosą własne zmienne desktopowe.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { AuthorByline } from "../AuthorByline";
import type { AuthorDisplay } from "@/lib/builder/authorDisplay";

afterEach(cleanup);

const STYLES = readFileSync("src/styles.css", "utf8");

const display = (patch: Partial<AuthorDisplay> = {}): AuthorDisplay => ({
  visible: true,
  showName: true,
  showAvatar: true,
  nameSizePx: 12,
  avatarSizePx: 20,
  avatarRadiusPx: 6,
  labelPrefix: "",
  mode: "avatar",
  ...patch,
});

function renderInFrame(props: Partial<Parameters<typeof AuthorByline>[0]> = {}) {
  return render(
    <div data-builder-renderer data-device="desktop">
      <div data-w-id="byline-frame" data-wt="fs tfs dfs">
        <AuthorByline name="Jan Kowalski" avatarUrl={null} display={display()} {...props} />
      </div>
    </div>,
  );
}

describe("byline - szablon typografii widgetu go nie łapie", () => {
  it("gałęzie z wykluczeniem `data-typography-exempt` omijają każdy węzeł bylinu", () => {
    const { container } = renderInFrame({
      display: display({ labelPrefix: "Autor:" }),
    });
    const nodes = Array.from(container.querySelectorAll<HTMLElement>("[data-author-byline] *"));
    expect(nodes.length).toBeGreaterThan(2);
    const generic =
      '[data-wt~="fs"][data-w-id][data-w-id] :is(p,span,a,strong,em,small,li,label,time)' +
      ":not(.cms-post-title):not(.cms-post-excerpt):not([data-typography-exempt])" +
      ":not(.post-list-numbered-index):not(.rl-num)";
    const description =
      '[data-wt~="dfs"][data-w-id][data-w-id] :is(p,li,dd,blockquote,figcaption,small)' +
      ":not(.cms-post-title):not([data-typography-exempt])" +
      ":not(.post-list-numbered-index):not(.rl-num)";
    // Te same wykluczenia stoją w szablonie w `styles.css`.
    expect(STYLES).toContain(
      ":not(.cms-post-title):not(.cms-post-excerpt):not([data-typography-exempt]):not(",
    );
    for (const node of [container.querySelector("[data-author-byline]")!, ...nodes]) {
      expect(node.matches(generic), node.outerHTML).toBe(false);
      expect(node.matches(description), node.outerHTML).toBe(false);
    }
    // Kontrapunkt: zwykły akapit w tej samej ramce reguła łapie.
    const p = document.createElement("p");
    container.querySelector('[data-w-id="byline-frame"]')!.appendChild(p);
    expect(p.matches(generic)).toBe(true);
  });
});

describe("byline - kontrakt domyślny bez zmiennych desktopowych inline (HW-6)", () => {
  it("12 / 20 px: styl inline bez `--abl-*`, a reguła desktopowa ma te same wartości zastępcze", () => {
    const { container } = renderInFrame({ avatarUrl: "https://example.com/a.jpg" });
    const root = container.querySelector<HTMLElement>("[data-author-byline]")!;
    const avatar = container.querySelector<HTMLElement>("[data-author-byline-avatar]")!;
    expect(root.getAttribute("style")).not.toContain("--abl-");
    expect(avatar.getAttribute("style")).not.toContain("--abl-");
    // Domknięcie pudełka zostaje inline (wygrywa z globalnymi regułami obrazów).
    expect(avatar.style.width).toBe("20px");
    expect(avatar.style.maxHeight).toBe("20px");
    expect(STYLES).toContain("font-size: var(--abl-fs-desktop, 16px) !important;");
    expect(STYLES).toContain("width: var(--abl-av-desktop, 24px) !important;");
    expect(STYLES).toContain("font-size: var(--abl-av-fs-desktop, 13px) !important;");
  });

  it("rozmiary spoza kontraktu niosą własne zmienne desktopowe", () => {
    const { container } = renderInFrame({
      display: display({ nameSizePx: 15, avatarSizePx: 30 }),
    });
    const root = container.querySelector<HTMLElement>("[data-author-byline]")!;
    const avatar = container.querySelector<HTMLElement>("[data-author-byline-avatar]")!;
    expect(root.style.getPropertyValue("--abl-fs-desktop")).toBe("20px");
    expect(avatar.style.getPropertyValue("--abl-av-desktop")).toBe("36px");
    expect(avatar.style.getPropertyValue("--abl-av-fs-desktop")).toBe("20px");
  });
});
