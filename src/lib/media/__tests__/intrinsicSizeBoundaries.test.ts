// @vitest-environment node
//
// GRANICE NATURALNEGO ROZMIARU OBRAZU (reguła w AGENTS.md).
//
// Rozmiar pliku trafia do HTML-u serwera wyłącznie jako atrybuty
// `width`/`height`, z danych zapisanych wcześniej przez panel. Dwie rzeczy
// psują to po cichu, bez czerwonego testu zachowania:
//  1. POMIAR W PUBLICZNYM RENDERZE. `measureIntrinsicSize` ładuje plik sondami
//     `<img>` dopinanymi do dokumentu - wciągnięty do komponentu strony dałby
//     atrybut ustawiany dopiero w przeglądarce (HTML serwera różny od strony po
//     hydratacji), dodatkowe pobranie i obce węzły w `<body>`. Moduł pomiaru i
//     lista logo mają zostać w kodzie panelu.
//  2. ROZMIAR PLIKU JAKO PROPORCJA UKŁADU. `width`/`height`/`aspectRatio` atomu
//     `OptimizedImage` dokładają inline `aspect-ratio`; rozmiar pliku podany tą
//     drogą nadpisałby klasy proporcji i utrwalił wartość nieaktualną. Widget
//     obrazu ma go podawać tylko przez `intrinsicSize`.
// Test czyta ŹRÓDŁA, bo oba błędy to krawędź importu albo nazwa propsu, a nie
// zachowanie, które widać w jednym renderze.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const HELPER = "src/lib/media/intrinsicSize.ts";
const IMAGE_WIDGET = "src/components/builder/organisms/widget-view/mediaWidgets.tsx";

/** Moduły renderowane na stronie publicznej, które czytają naturalny rozmiar. */
const PUBLIC_RENDERERS = [
  HELPER,
  "src/lib/brand/headerLogo.ts",
  "src/components/atoms/OptimizedImage.tsx",
  "src/components/Header.tsx",
  "src/components/share/ReadingHeader.tsx",
  IMAGE_WIDGET,
];

// `imageIntrinsicUse` to lustro renderera dla edytora obrazu (kiedy rozmiar z
// treści jest w ogóle używany) - w chunku wejściowym byłoby martwym kodem.
const ADMIN_ONLY_IMPORT =
  /from\s+["']@\/lib\/(media\/measureIntrinsicSize|admin\/logoIntrinsic|admin\/imageIntrinsicUse)["']/;

describe("naturalny rozmiar obrazu - granice modułów", () => {
  it.each(PUBLIC_RENDERERS)("%s nie importuje pomiaru ani listy logo z panelu", (path) => {
    expect(read(path)).not.toMatch(ADMIN_ONLY_IMPORT);
  });

  it("wspólny pomocnik nie ma importów (ląduje w chunku wejściowym)", () => {
    expect(read(HELPER)).not.toMatch(/^\s*import\s/m);
  });

  it("pomiar i lista logo naprawdę importują się wzorcem, którego pilnuje ten test", () => {
    // Kontrola samego wzorca: panel importuje te moduły dokładnie tak.
    const editorDir = "src/components/admin/builder/ui/organisms/widget-properties";
    expect(read("src/components/admin/ThemeOptionsPane.tsx")).toMatch(ADMIN_ONLY_IMPORT);
    expect(read(`${editorDir}/ImageEditor.tsx`)).toMatch(ADMIN_ONLY_IMPORT);
    // Sam pomiar woła hak trzymany przez panel właściwości (nad zakładkami).
    expect(read(`${editorDir}/useImageIntrinsicCapture.ts`)).toMatch(
      /from\s+["']@\/lib\/media\/measureIntrinsicSize["']/,
    );
  });
});

describe("naturalny rozmiar obrazu - widget podaje go tylko przez `intrinsicSize`", () => {
  const tags = read(IMAGE_WIDGET).match(/<OptimizedImage\b[\s\S]*?\/>/g) ?? [];

  it("każdy `<OptimizedImage>` widgetu dostaje `intrinsicSize={sizeOf(...)}`", () => {
    // Para light/dark (dwa obrazy) i gałąź pojedynczego obrazu.
    expect(tags).toHaveLength(3);
    for (const tag of tags) expect(tag).toMatch(/\sintrinsicSize=\{sizeOf\(\w+\)\}/);
  });

  it("żaden nie dostaje `width`, `height` ani `aspectRatio` (wymuszona proporcja układu)", () => {
    for (const tag of tags) expect(tag).not.toMatch(/\s(width|height|aspectRatio)=/);
  });
});
