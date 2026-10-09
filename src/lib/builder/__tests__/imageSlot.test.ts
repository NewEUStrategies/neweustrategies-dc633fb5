// `sizes` obrazów w kolumnie buildera (P3.2a, LP-7): mobilna część uwzględnia
// margines kolumny, bo telefon PSI (412 px) maluje hero w 348 px, nie w 412.
// Geometrię marginesu (4 warstwy po 8 px z CSS) przypina w prawdziwej
// przeglądarce `e2e/hero-srcset.boot-home.spec.ts`; tu - kontrakt funkcji i ta
// warstwa, która żyje w kodzie (inline padding kontenera sekcji).
import { describe, expect, it } from "vitest";
import {
  MOBILE_COLUMN_GUTTER_PX,
  imageSlotSizes,
  mobileSlotSize,
  type ImageSlot,
} from "@/lib/builder/imageSlot";
import { imageWidgetSizes } from "@/lib/builder/widgetImageSizes";
import { sectionContainerStyle } from "@/lib/builder/sectionStyles";
import type { SectionNode } from "@/lib/builder/types";

const BOXED: ImageSlot = { desktop: { vw: 50, cap: 570 }, tablet: { vw: 100, cap: 1140 } };
const FULL: ImageSlot = { desktop: { vw: 50, cap: Infinity }, tablet: { vw: 50, cap: Infinity } };

describe("imageSlotSizes: telefon z marginesem kolumny", () => {
  it("slot z renderera: mobilnie `calc(100vw - 2 x margines)`, reszta bez zmian", () => {
    expect(imageSlotSizes(FULL)).toBe(
      "(max-width: 767px) calc(100vw - 64px), (max-width: 1023px) 50vw, 50vw",
    );
    expect(imageSlotSizes(BOXED)).toBe(
      "(max-width: 767px) calc(100vw - 64px), (max-width: 1023px) min(100vw, 1140px), min(50vw, 570px)",
    );
  });

  it("margines to 2 x stała (jedno źródło prawdy dla renderu i preloadu)", () => {
    expect(MOBILE_COLUMN_GUTTER_PX).toBe(32);
    expect(mobileSlotSize(FULL)).toBe(`calc(100vw - ${2 * MOBILE_COLUMN_GUTTER_PX}px)`);
  });

  it("bez slotu (render poza rendererem buildera) - dawne wartości", () => {
    expect(mobileSlotSize()).toBe("100vw");
    expect(imageSlotSizes()).toBe("100vw");
    expect(imageSlotSizes(undefined, 2)).toBe("(max-width: 767px) 100vw, 50vw");
  });

  it("kilka kart w rzędzie na telefonie (`mobileColumns > 1`) - bez zmian", () => {
    expect(imageSlotSizes(FULL, 1, 2)).toBe(
      "(max-width: 767px) 50vw, (max-width: 1023px) 50vw, 50vw",
    );
  });

  it("split (2 kolumny na desktopie) zachowuje margines na telefonie", () => {
    expect(imageSlotSizes(FULL, 2)).toBe(
      "(max-width: 767px) calc(100vw - 64px), (max-width: 1023px) 25vw, 25vw",
    );
  });
});

describe("pochodzenie stałej: warstwa marginesu w kodzie", () => {
  // Kontener sekcji ma inline 8 px po bokach w OBU trybach szerokości - to jedna
  // z czterech warstw (pozostałe trzy to reguły `!important` arkusza, mierzone
  // w e2e). Zmiana tej wartości bez zmiany stałej robi test czerwonym.
  it.each(["boxed", "full"] as const)("kontener sekcji `%s`: padding 8 px", (contentWidth) => {
    const node = { id: "s", kind: "section", children: [], layout: { contentWidth } };
    const style = sectionContainerStyle(node as unknown as SectionNode);
    expect(style.paddingLeft).toBe("8px");
    expect(style.paddingRight).toBe("8px");
    expect(MOBILE_COLUMN_GUTTER_PX).toBe(4 * Number.parseInt(String(style.paddingLeft), 10));
  });
});

describe("imageWidgetSizes: limit szerokości z panelu na telefonie", () => {
  it("ze slotem: `min(calc(...), limit)` - dawny `.replace` milczałby tu po cichu", () => {
    const sizes = imageWidgetSizes({ widthPx: 400 }, BOXED);
    expect(sizes).toBe(
      "(max-width: 767px) min(calc(100vw - 64px), 400px), (max-width: 1023px) min(100vw, 400px), min(50vw, 400px)",
    );
  });

  it("bez slotu - zachowanie dzisiejsze `min(100vw, limit)`", () => {
    expect(imageWidgetSizes({ maxWidth: "180px" })).toBe(
      "(max-width: 767px) min(100vw, 180px), (max-width: 1023px) min(100vw, 180px), min(100vw, 180px)",
    );
  });

  it("bez limitu - rozmiar kolumny", () => {
    expect(imageWidgetSizes({}, BOXED)).toBe(imageSlotSizes(BOXED));
    expect(imageWidgetSizes({})).toBe("100vw");
  });
});
