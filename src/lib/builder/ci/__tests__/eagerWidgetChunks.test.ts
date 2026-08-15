// Lustro eager (`@/test/eagerWidgetChunks`) musi wystawiać DOKŁADNIE te same
// komponenty co warstwa leniwa. Bez tej asercji dodanie widgetu do
// `lazyWidgets.tsx` cicho wypadałoby z bramki wierności ustawień: mock nie
// eksportowałby nowej nazwy, `WidgetView` dostałby `undefined` i widget
// renderowałby pustkę - czyli "wszystkie ustawienia martwe" albo, gorzej,
// zwolnienie wpisane w listę odstępstw zamiast naprawy.
import { describe, it, expect } from "vitest";
import * as lazyChunks from "@/components/builder/organisms/widget-view/lazyWidgets";
import * as eagerChunks from "@/test/eagerWidgetChunks";

const names = (mod: object): string[] =>
  Object.keys(mod)
    .filter((key) => key !== "default")
    .sort();

describe("eager mirror of lazyWidgets", () => {
  it("exports exactly the same component names", () => {
    expect(names(eagerChunks)).toEqual(names(lazyChunks));
  });

  it("exports real components, not undefined", () => {
    for (const [name, value] of Object.entries(eagerChunks)) {
      expect(["function", "object"], `${name} nie jest komponentem`).toContain(typeof value);
      expect(value, `${name} jest puste`).toBeTruthy();
    }
  });

  it("covers a non-trivial part of the widget surface", () => {
    expect(names(eagerChunks).length).toBeGreaterThanOrEqual(30);
  });
});
