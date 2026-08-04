// Ikony social: KANWA BUILDERA I STRONA PUBLICZNA MUSZĄ WYGLĄDAĆ IDENTYCZNIE.
//
// Zgłoszenie redakcji: w widgecie CMS ikony wychodziły jasnopomarańczowe, a na
// publicznej stronie kontaktu - ciemne. Mechanizm winny: stan podstawowy ikony
// szedł przez token liczony `color-mix` (`--sb-icon` / `--sb-off-tone`)
// definiowany klasą narzędziową na kontenerze. Taki zapis jest UWARUNKOWANY
// kontekstem: gdy token nie rozwiąże się w danym drzewie (inny wariant motywu,
// inny arkusz, brak `--brand`), `color: var(--sb-icon)` cicho degraduje do
// koloru dziedziczonego - jeden widok robi się pomarańczowy, drugi czarny, a nic
// nie wybucha.
//
// Bramka niżej odbiera tej klasie defektów drogę powrotną: stan spoczynku ikony
// jest albo BRAKIEM koloru (dziedziczy atrament motywu, czyli `text-foreground`
// kontenera - dokładnie jak front), albo kolorem WPROST. Nigdy tokenem, który
// definiuje sam widget.
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { WidgetContent, WidgetNode } from "@/lib/builder/types";
import { renderSimpleWidget } from "../SimpleWidgets";
import { SB_CHIP } from "../socialHover";

const LINKS: WidgetContent = {
  facebook: "https://facebook.com/nes",
  youtube: "https://youtube.com/@nes",
  linkedin: "https://linkedin.com/company/nes",
};

/** Ten sam widget raz jak w kanwie buildera, raz jak na stronie publicznej. */
function paint(content: WidgetContent, editable: boolean): HTMLElement {
  const node: WidgetNode = { id: "soc-parity", kind: "widget", type: "social-icons", content };
  return render(<>{renderSimpleWidget(node, "pl", undefined, editable)}</>).container;
}

/** Kolory kafelków ikon w kolejności renderowania. */
function iconColors(container: HTMLElement): string[] {
  const chips = container.querySelectorAll(`.${SB_CHIP}`);
  const nodes = chips.length ? chips : container.querySelectorAll("a, span[aria-label]");
  return [...nodes].map((n) => (n as HTMLElement).style.color);
}

const COLOR_MODES = ["inherit", "brand", "official", "custom", "dark", "light"] as const;
const BG_MODES = ["none", "subtle", "brand", "official", "contrast", "custom"] as const;
const LAYOUTS = ["row", "list"] as const;

describe("social-icons - kanwa buildera == strona publiczna", () => {
  for (const layout of LAYOUTS) {
    for (const colorMode of COLOR_MODES) {
      it(`renderuje te same kolory ikon w obu widokach (${layout} / ${colorMode})`, () => {
        const content: WidgetContent = {
          ...LINKS,
          layout,
          colorMode,
          customColor: "#123456",
          showEmpty: "show",
        };
        expect(iconColors(paint(content, true))).toEqual(iconColors(paint(content, false)));
      });
    }
  }

  it("renderuje te same kolory tła kafelków w obu widokach", () => {
    for (const bgMode of BG_MODES) {
      const content: WidgetContent = {
        ...LINKS,
        layout: "list",
        bgMode,
        customBgColor: "#001122",
      };
      const canvas = [...paint(content, true).querySelectorAll(`.${SB_CHIP}`)].map(
        (n) => (n as HTMLElement).style.backgroundColor,
      );
      const front = [...paint(content, false).querySelectorAll(`.${SB_CHIP}`)].map(
        (n) => (n as HTMLElement).style.backgroundColor,
      );
      expect(canvas).toEqual(front);
    }
  });
});

describe("social-icons - stan spoczynku nie zależy od tokenu widgetu", () => {
  it.each(LAYOUTS)("nie wstawia w kolor ikony żadnego var(--sb-*) (%s)", (layout) => {
    for (const colorMode of COLOR_MODES) {
      const container = paint(
        { ...LINKS, layout, colorMode, customColor: "#123456", showEmpty: "show" },
        false,
      );
      for (const color of iconColors(container)) {
        // `--sb-*` to tokeny, które widget definiuje SAM (dziś już tylko dla
        // hovera). W stanie spoczynku nie mogą decydować o kolorze, bo to one
        // rozjechały kanwę ze stroną publiczną.
        expect(color).not.toContain("--sb-");
      }
    }
  });

  it("bez jawnego colorMode ikona dziedziczy atrament motywu", () => {
    // Brak inline `color` = `text-foreground` kontenera: ciemny w light mode,
    // biały w dark mode. Jedno źródło prawdy dla obu widoków I obu motywów.
    for (const layout of LAYOUTS) {
      const container = paint({ ...LINKS, layout }, false);
      expect(iconColors(container).every((c) => c === "")).toBe(true);
      expect(container.className || container.innerHTML).toContain("text-foreground");
    }
  });
});
