// CO DOWODZI TEN PLIK: barrel atomów edytora jest JEDYNYM wejściem, z którego
// molekuły i organizmy mają brać atomy (`import { SidebarSection } from
// "../atoms"`). Gdy nowy atom nie zostanie do niego dopisany, nic nie pęka od
// razu - wywołujący po prostu sięga po ścieżkę pliku. Skutek widać dopiero
// później i jest kosztowny: granica warstwy atomic design przestaje istnieć,
// atom da się przenieść/zmienić bez zauważenia wszystkich wywołań, a te same
// wiersze formularza znów zaczynają się mnożyć lokalnie (dokładnie ta klasa
// duplikacji, którą zamyka FieldRow - patrz komentarz w FieldRow.tsx).
//
// Dlatego test nie wylicza nazw z pamięci, a PORÓWNUJE zawartość katalogu
// z zawartością barrela: to bramka na przyszłe pliki, nie zapis stanu.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as atoms from "../index";

// Katalog liczymy od korzenia repo (vitest startuje w korzeniu) - `import.meta.url`
// pod runnerem Vite nie jest adresem pliku.
const ATOMS_DIR = join(process.cwd(), "src/components/admin/post-editor/atoms");

/** Nazwy komponentów eksportowanych przez pliki atomów (bez barrela). */
function componentsInDirectory(): string[] {
  const names: string[] = [];
  for (const file of readdirSync(ATOMS_DIR)) {
    if (!file.endsWith(".tsx")) continue;
    const source = readFileSync(join(ATOMS_DIR, file), "utf8");
    for (const match of source.matchAll(/^export function (\w+)/gm)) names.push(match[1]);
  }
  return names.sort();
}

describe("barrel atomów edytora wpisu", () => {
  it("eksportuje KAŻDY atom z katalogu - żaden nie zostaje bez publicznego wejścia", () => {
    const inDirectory = componentsInDirectory();
    expect(inDirectory.length).toBeGreaterThan(0);
    expect(Object.keys(atoms).sort()).toEqual(inDirectory);
  });

  it("nie eksportuje niczego, czego w katalogu nie ma (martwe re-eksporty)", () => {
    const inDirectory = new Set(componentsInDirectory());
    expect(Object.keys(atoms).filter((name) => !inDirectory.has(name))).toEqual([]);
  });

  it("każdy eksport jest komponentem (funkcją) gotowym do renderu", () => {
    const notComponents = Object.entries(atoms)
      .filter(([, value]) => typeof value !== "function")
      .map(([name]) => name);
    expect(notComponents).toEqual([]);
  });

  it("typ `TriStateLabels` jedzie jako `export type` - nie tworzy wiązania w runtime", () => {
    // Gdyby był eksportowany zwyczajnie, bundler musiałby wciągnąć moduł tylko
    // dla typu, a `verbatimModuleSyntax` zgłosiłby błąd u wywołujących.
    expect(Object.keys(atoms)).not.toContain("TriStateLabels");
  });
});
