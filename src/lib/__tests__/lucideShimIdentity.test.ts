// `@/lib/lucide-shim` eksportuje WPROST komponenty Lucide (od usunięcia opcji
// Font Awesome, roadmapa §9.6). Ten test przypina tę tożsamość: każdy eksport
// shimu jest DOKŁADNIE tym samym obiektem co eksport `lucide-react` o tej
// nazwie, a aliasy shimu wskazują glif, który wskazywały dotąd - także tam,
// gdzie `lucide-react` ma pod tą samą nazwą INNĄ ikonę (`Redo2`, `Undo2`).
//
// Po co: zapis shimu jako czystych reeksportów (D4, §9.1) zmienia sposób,
// w jaki bundler przypisuje glify do chunków, ale nie może zmienić żadnego
// komponentu - ten sam obiekt to ten sam render na serwerze i w przeglądarce.
import { describe, expect, it } from "vitest";
import * as Lucide from "lucide-react";
import * as Shim from "@/lib/lucide-shim";

// Nazwy shimu, które nie są nazwą ikony w `lucide-react` albo ją przesłaniają.
const SHIM_ALIASES: Readonly<Record<string, string>> = {
  ChevronDownIcon: "ChevronDown",
  ChevronLeftIcon: "ChevronLeft",
  ChevronRightIcon: "ChevronRight",
  Redo2: "Redo",
  Undo2: "Undo",
};

const SHIM = Shim as unknown as Record<string, unknown>;
const LUCIDE = Lucide as unknown as Record<string, unknown>;

describe("lucide-shim: eksporty to komponenty lucide-react", () => {
  it("każdy eksport shimu jest tym samym obiektem co ikona lucide-react", () => {
    const names = Object.keys(Shim);
    expect(names.length).toBe(134);
    for (const name of names) {
      const target = SHIM_ALIASES[name] ?? name;
      expect(LUCIDE[target], `${name} -> ${target}`).toBeDefined();
      expect(SHIM[name], `${name} -> ${target}`).toBe(LUCIDE[target]);
    }
  });

  it("aliasy Redo2/Undo2 zostają przy glifach Redo/Undo, nie przy ikonach lucide o tej nazwie", () => {
    expect(LUCIDE.Redo2).not.toBe(LUCIDE.Redo);
    expect(SHIM.Redo2).toBe(LUCIDE.Redo);
    expect(LUCIDE.Undo2).not.toBe(LUCIDE.Undo);
    expect(SHIM.Undo2).toBe(LUCIDE.Undo);
  });
});
