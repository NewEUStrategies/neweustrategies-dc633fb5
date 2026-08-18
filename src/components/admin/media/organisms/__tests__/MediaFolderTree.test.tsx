// Drzewo folderów panelu mediów: organizm + wiersz. Do 18.08.2026 oba na zerze.
//
// Trzy reguły, które decydują, czy operator w ogóle trafi tam, gdzie chce:
//   1. KORZEŃ zawsze istnieje, także gdy tabela folderów jest pusta - inaczej
//      po skasowaniu ostatniego folderu nie ma z czego wyjść,
//   2. wiersz korzenia NIE ma akcji zmiany nazwy i kasowania (kasowanie korzenia
//      jest odrzucane po stronie serwera - przycisk obiecywałby niemożliwe),
//   3. kliknięcie akcji NIE może jednocześnie wejść do folderu; bez
//      `stopPropagation` „zmień nazwę” zmieniałoby też bieżącą ścieżkę.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MediaFolderTree } from "../MediaFolderTree";
import type { FolderRow } from "../../types";

function folder(path: string, id = path): FolderRow {
  return { id, path, created_at: "2026-01-01T00:00:00.000Z" };
}

function setup(folders: FolderRow[], currentPath = "/") {
  const onSelect = vi.fn();
  const onRename = vi.fn();
  const onDelete = vi.fn();
  const onDropFolder = vi.fn(() => vi.fn());
  const view = render(
    <MediaFolderTree
      folders={folders}
      currentPath={currentPath}
      onSelect={onSelect}
      onRename={onRename}
      onDelete={onDelete}
      onDropFolder={onDropFolder}
    />,
  );
  return { view, onSelect, onRename, onDelete, onDropFolder };
}

/** Wiersz drzewa po ścieżce folderu. */
function rowFor(path: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-folder-item="${path}"]`);
  if (!el) throw new Error(`brak wiersza dla ścieżki ${path}`);
  return el;
}

const TREE = [folder("/press/"), folder("/press/2026/"), folder("/archiwum/")];

describe("MediaFolderTree - zawartość drzewa", () => {
  it("KORZEŃ jest zawsze obecny, nawet przy pustej liście folderów", () => {
    setup([]);
    expect(rowFor("/")).toBeInTheDocument();
  });

  it("renderuje wszystkie znane foldery obok korzenia", () => {
    setup(TREE);
    for (const path of ["/", "/press/", "/press/2026/", "/archiwum/"]) {
      expect(rowFor(path)).toBeInTheDocument();
    }
  });

  it("DEDUPLIKUJE korzeń podany także w danych", () => {
    // Wiersz z bazy o ścieżce „/" nie może dać drugiego korzenia w drzewie.
    setup([folder("/"), folder("/press/")]);
    expect(document.querySelectorAll('[data-folder-item="/"]')).toHaveLength(1);
  });

  it("sortuje ścieżki leksykalnie - kolejność nie zależy od kolejności z bazy", () => {
    setup([folder("/zebra/"), folder("/alfa/"), folder("/mid/")]);
    const paths = Array.from(document.querySelectorAll("[data-folder-item]")).map((el) =>
      el.getAttribute("data-folder-item"),
    );
    expect(paths).toEqual([...paths].sort());
    expect(paths[0]).toBe("/");
  });

  it("pokazuje OSTATNI segment ścieżki jako etykietę, nie całą ścieżkę", () => {
    // Pełna ścieżka w drzewie z wcięciami byłaby powtórzeniem hierarchii,
    // którą i tak widać po wcięciu.
    setup(TREE);
    expect(within(rowFor("/press/2026/")).getByText("2026")).toBeInTheDocument();
  });

  it("wcina wiersze proporcjonalnie do zagnieżdżenia", () => {
    setup(TREE);
    const pad = (path: string) => rowFor(path).style.paddingLeft;
    expect(pad("/")).toBe("8px");
    expect(pad("/press/")).toBe("20px");
    expect(pad("/press/2026/")).toBe("32px");
  });
});

describe("MediaFolderTree - stan aktywny", () => {
  it("wyróżnia folder, w którym stoi operator", () => {
    setup(TREE, "/press/");
    expect(rowFor("/press/").className).toContain("font-semibold");
    expect(rowFor("/archiwum/").className).not.toContain("font-semibold");
  });

  it("korzeń bywa aktywny jak każdy inny folder", () => {
    setup(TREE, "/");
    expect(rowFor("/").className).toContain("font-semibold");
  });

  it("aktywny folder ma OTWARTĄ ikonę, pozostałe zamkniętą", () => {
    setup(TREE, "/press/");
    // Rozróżnienie jest wizualne i jedyne - obie ikony to svg, więc test
    // porównuje ich klasy koloru (marka vs wyszarzenie).
    expect(rowFor("/press/").querySelector("svg")?.getAttribute("class")).toContain("text-brand");
    expect(rowFor("/archiwum/").querySelector("svg")?.getAttribute("class")).toContain(
      "text-muted-foreground",
    );
  });
});

describe("MediaFolderTree - akcje wiersza", () => {
  it("KORZEŃ nie ma akcji zmiany nazwy ani kasowania", () => {
    // Serwer odrzuca obie operacje na korzeniu, więc przycisk obiecywałby
    // coś, czego nie da się zrobić.
    setup(TREE);
    expect(within(rowFor("/")).queryAllByRole("button")).toHaveLength(0);
  });

  it("każdy inny folder ma obie akcje", () => {
    setup(TREE);
    expect(within(rowFor("/press/")).getAllByRole("button")).toHaveLength(2);
  });

  it("kliknięcie wiersza wchodzi do folderu", () => {
    const { onSelect } = setup(TREE);
    fireEvent.click(rowFor("/press/"));
    expect(onSelect).toHaveBeenCalledWith("/press/");
  });

  it("zmiana nazwy NIE wchodzi jednocześnie do folderu", () => {
    // Bez `stopPropagation` operator dostawałby dialog zmiany nazwy i zmianę
    // bieżącej ścieżki naraz.
    const { onRename, onSelect } = setup(TREE);
    const [rename] = within(rowFor("/press/")).getAllByRole("button");
    fireEvent.click(rename);

    expect(onRename).toHaveBeenCalledWith("/press/");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("kasowanie NIE wchodzi jednocześnie do folderu", () => {
    const { onDelete, onSelect } = setup(TREE);
    const [, remove] = within(rowFor("/press/")).getAllByRole("button");
    fireEvent.click(remove);

    expect(onDelete).toHaveBeenCalledWith("/press/");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("akcje mają dostępne nazwy dla czytnika ekranu", () => {
    // Same ikony bez etykiety to dwa nienazwane przyciski obok siebie.
    setup(TREE);
    for (const button of within(rowFor("/press/")).getAllByRole("button")) {
      expect(button.getAttribute("aria-label")).toBeTruthy();
    }
  });
});

describe("MediaFolderTree - upuszczanie plików", () => {
  it("każdy wiersz jest celem upuszczenia dla SWOJEJ ścieżki", () => {
    const { onDropFolder } = setup(TREE);
    expect(onDropFolder).toHaveBeenCalledWith("/");
    expect(onDropFolder).toHaveBeenCalledWith("/press/");
    expect(onDropFolder).toHaveBeenCalledWith("/archiwum/");
  });

  it("przeciąganie nad wierszem jest przechwytywane", () => {
    // Bez `preventDefault` na `dragover` przeglądarka nie zezwoli na upuszczenie
    // i przenoszenie plików do folderu przestaje działać.
    setup(TREE);
    const event = new Event("dragover", { bubbles: true, cancelable: true });
    fireEvent(rowFor("/press/"), event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("menu kontekstowe przeglądarki nie przykrywa własnego menu panelu", () => {
    setup(TREE);
    const event = new Event("contextmenu", { bubbles: true, cancelable: true });
    fireEvent(rowFor("/press/"), event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("wiersze są oznaczone atrybutem, po którym rozpoznaje je zaznaczanie prostokątem", () => {
    // `useMarqueeSelection` pomija wciśnięcia na `[data-folder-item]`; brak
    // atrybutu sprawiłby, że kliknięcie w drzewo startuje zaznaczanie.
    setup(TREE);
    expect(document.querySelectorAll("[data-folder-item]").length).toBe(4);
  });
});
