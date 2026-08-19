// Widok listy panelu mediów: tabela + wiersz pliku + kafel siatki.
// Do 18.08.2026 wszystkie trzy na zerze (82 + 66 + 79 linii).
//
// Reguły, których złamania NIE widać w warstwie danych:
//   * FOLDERY IDĄ PRZED PLIKAMI - wymieszane, znikają w długiej liście,
//   * wiersze i kafle noszą `data-media-item` / `data-folder-item`, po których
//     rozpoznaje je zaznaczanie prostokątem; brak atrybutu = kliknięcie w plik
//     startuje zaznaczanie zamiast go zaznaczać,
//   * pole zmiany nazwy MUSI zatrzymywać zdarzenia klawiatury i kliknięcia,
//     inaczej Delete w polu nazwy kasuje zaznaczone pliki, a klik w pole
//     przestawia zaznaczenie.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MediaListView } from "../MediaListView";
import { MediaGridItem } from "../../molecules/MediaGridItem";
import type { MediaRow } from "../../types";

function file(id: string, overrides: Partial<MediaRow> = {}): MediaRow {
  return {
    id,
    tenant_id: "t1",
    storage_path: `t1/u/${id}.png`,
    public_url: `https://cdn.example/${id}.png`,
    filename: `${id}.png`,
    mime_type: "image/png",
    size_bytes: 2048,
    uploader_id: "u",
    created_at: "2026-01-15T10:00:00.000Z",
    folder_path: "/",
    alt_text: null,
    ...overrides,
  };
}

function setupList(opts: { folders?: string[]; files?: MediaRow[]; selected?: string[] } = {}) {
  const spies = {
    onOpenFolder: vi.fn(),
    onSelect: vi.fn(),
    onContextFile: vi.fn(),
    onContextFolder: vi.fn(),
    onDragStart: vi.fn(() => vi.fn()),
    onDropFolder: vi.fn(() => vi.fn()),
    onPreviewFile: vi.fn(),
  };
  render(
    <MediaListView
      folders={opts.folders ?? []}
      files={opts.files ?? []}
      selectedIds={new Set(opts.selected ?? [])}
      {...spies}
    />,
  );
  return spies;
}

const row = (id: string) => {
  const el = document.querySelector<HTMLElement>(`[data-media-item="${id}"]`);
  if (!el) throw new Error(`brak wiersza pliku ${id}`);
  return el;
};

describe("MediaListView - kolejność i zawartość", () => {
  it("FOLDERY idą przed plikami", () => {
    // W długiej liście wymieszane foldery są nie do znalezienia.
    setupList({ folders: ["/press/"], files: [file("a")] });
    const items = Array.from(document.querySelectorAll("tbody tr"));
    expect(items[0].getAttribute("data-folder-item")).toBe("/press/");
    expect(items[1].getAttribute("data-media-item")).toBe("a");
  });

  it("pokazuje OSTATNI segment ścieżki folderu, nie całą ścieżkę", () => {
    setupList({ folders: ["/press/2026/"] });
    expect(screen.getByText("2026")).toBeInTheDocument();
  });

  it("folder nie ma rozmiaru ani daty - myślnik zamiast pustej komórki", () => {
    // Pusta komórka wygląda jak brak danych; myślnik mówi „nie dotyczy”.
    setupList({ folders: ["/press/"] });
    const cells = within(
      document.querySelector<HTMLElement>('[data-folder-item="/press/"]')!,
    ).getAllByRole("cell");
    expect(cells[2].textContent).toBe("-");
    expect(cells[3].textContent).toBe("-");
  });

  it("tabela ma nagłówek z czterema kolumnami", () => {
    setupList({ files: [file("a")] });
    expect(screen.getAllByRole("columnheader")).toHaveLength(4);
  });

  it("pusta lista renderuje samą tabelę bez wierszy", () => {
    setupList({});
    expect(document.querySelectorAll("tbody tr")).toHaveLength(0);
    expect(screen.getAllByRole("columnheader")).toHaveLength(4);
  });
});

describe("MediaListView - wiersz pliku", () => {
  it("pokazuje nazwę, typ i sformatowany rozmiar", () => {
    setupList({ files: [file("a")] });
    const cells = within(row("a")).getAllByRole("cell");
    expect(cells[0].textContent).toContain("a.png");
    expect(cells[1].textContent).toBe("image/png");
    expect(cells[2].textContent).toBe("2.0 KB");
  });

  it("OBRAZ dostaje miniaturę, inne pliki - etykietę rozszerzenia", () => {
    setupList({
      files: [file("a"), file("b", { filename: "raport.pdf", mime_type: "application/pdf" })],
    });
    expect(within(row("a")).getByRole("presentation", { hidden: true })).toBeTruthy();
    expect(within(row("b")).getByText("PDF")).toBeInTheDocument();
  });

  it("plik BEZ typu spada na rozszerzenie z nazwy", () => {
    setupList({ files: [file("a", { filename: "dane.csv", mime_type: null })] });
    expect(within(row("a")).getAllByRole("cell")[1].textContent).toBe("CSV");
  });

  it("plik bez typu i bez rozszerzenia pokazuje znak zapytania", () => {
    // Pusta komórka wyglądałaby na błąd renderu.
    setupList({ files: [file("a", { filename: "beznazwy", mime_type: null })] });
    expect(within(row("a")).getByText("?")).toBeInTheDocument();
  });

  it("wyróżnia zaznaczony wiersz", () => {
    setupList({ files: [file("a"), file("b")], selected: ["a"] });
    expect(row("a").className).toContain("bg-brand/10");
    expect(row("b").className).not.toContain("bg-brand/10");
  });

  it("kliknięcie zaznacza, podwójne otwiera podgląd", () => {
    const { onSelect, onPreviewFile } = setupList({ files: [file("a")] });
    fireEvent.click(row("a"));
    expect(onSelect).toHaveBeenCalledWith("a", expect.anything());

    fireEvent.doubleClick(row("a"));
    expect(onPreviewFile).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });

  it("prawy przycisk otwiera menu DLA TEGO pliku", () => {
    const { onContextFile } = setupList({ files: [file("a")] });
    fireEvent.contextMenu(row("a"));
    expect(onContextFile).toHaveBeenCalledWith(expect.anything(), "a");
  });

  it("wiersz jest przeciągalny i niesie swój identyfikator", () => {
    const { onDragStart } = setupList({ files: [file("a")] });
    expect(row("a").getAttribute("draggable")).toBe("true");
    expect(onDragStart).toHaveBeenCalledWith("a");
  });
});

describe("MediaListView - wiersz folderu", () => {
  const folderRow = () => document.querySelector<HTMLElement>('[data-folder-item="/press/"]')!;

  it("kliknięcie i podwójne kliknięcie wchodzą do folderu", () => {
    const { onOpenFolder } = setupList({ folders: ["/press/"] });
    fireEvent.click(folderRow());
    fireEvent.doubleClick(folderRow());
    expect(onOpenFolder).toHaveBeenCalledTimes(2);
    expect(onOpenFolder).toHaveBeenCalledWith("/press/");
  });

  it("prawy przycisk otwiera menu folderu, nie pliku", () => {
    const { onContextFolder, onContextFile } = setupList({
      folders: ["/press/"],
      files: [file("a")],
    });
    fireEvent.contextMenu(folderRow());
    expect(onContextFolder).toHaveBeenCalledWith(expect.anything(), "/press/");
    expect(onContextFile).not.toHaveBeenCalled();
  });

  it("jest celem upuszczenia i przechwytuje przeciąganie", () => {
    const { onDropFolder } = setupList({ folders: ["/press/"] });
    expect(onDropFolder).toHaveBeenCalledWith("/press/");

    const event = new Event("dragover", { bubbles: true, cancelable: true });
    fireEvent(folderRow(), event);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe("MediaGridItem - kafel siatki", () => {
  function setupTile(opts: { selected?: boolean; renaming?: boolean; draft?: string } = {}) {
    const spies = {
      onRenameDraft: vi.fn(),
      onRenameCommit: vi.fn(),
      onRenameCancel: vi.fn(),
      onSelect: vi.fn(),
      onContext: vi.fn(),
      onDragStart: vi.fn(() => vi.fn()),
      onPreview: vi.fn(),
    };
    render(
      <MediaGridItem
        file={file("a")}
        selected={opts.selected ?? false}
        renaming={opts.renaming ?? false}
        renameDraft={opts.draft ?? "a.png"}
        {...spies}
      />,
    );
    return spies;
  }

  it("pokazuje nazwę, rozmiar i rozszerzenie", () => {
    setupTile();
    expect(screen.getByText("a.png")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    expect(screen.getByText("PNG")).toBeInTheDocument();
  });

  it("pełna nazwa jest dostępna w podpowiedzi, bo tekst bywa ucięty", () => {
    setupTile();
    expect(screen.getByText("a.png").getAttribute("title")).toBe("a.png");
  });

  it("zaznaczony kafel dostaje obramowanie i znacznik", () => {
    setupTile({ selected: true });
    expect(row("a").className).toContain("border-brand");
  });

  it("w trybie zmiany nazwy pokazuje POLE zamiast etykiety", () => {
    setupTile({ renaming: true, draft: "nowa.png" });
    expect(screen.getByRole("textbox")).toHaveValue("nowa.png");
    expect(screen.queryByTitle("a.png")).toBeNull();
  });

  it("Enter zatwierdza zmianę nazwy, Escape ją porzuca", () => {
    const { onRenameCommit, onRenameCancel } = setupTile({ renaming: true });
    const input = screen.getByRole("textbox");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRenameCommit).toHaveBeenCalledWith("a");

    fireEvent.keyDown(input, { key: "Escape" });
    expect(onRenameCancel).toHaveBeenCalledTimes(1);
  });

  it("utrata fokusu zatwierdza zmianę nazwy", () => {
    const { onRenameCommit } = setupTile({ renaming: true });
    fireEvent.blur(screen.getByRole("textbox"));
    expect(onRenameCommit).toHaveBeenCalledWith("a");
  });

  it("klawiatura w polu nazwy NIE dochodzi do skrótów panelu", () => {
    // To jest para do wyjątku w `useMediaKeyboardShortcuts`: pole zatrzymuje
    // zdarzenie, żeby Delete kasował znak, a nie zaznaczone pliki.
    setupTile({ renaming: true });
    const event = new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true });
    const stopped = vi.spyOn(event, "stopPropagation");
    screen.getByRole("textbox").dispatchEvent(event);
    expect(stopped).toHaveBeenCalled();
  });

  it("kliknięcie w pole nazwy NIE przestawia zaznaczenia", () => {
    const { onSelect } = setupTile({ renaming: true });
    fireEvent.click(screen.getByRole("textbox"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("wpisywanie zgłasza zmianę wersji roboczej", () => {
    const { onRenameDraft } = setupTile({ renaming: true });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "inna.png" } });
    expect(onRenameDraft).toHaveBeenCalledWith("inna.png");
  });

  it("podwójne kliknięcie otwiera podgląd", () => {
    const { onPreview } = setupTile();
    fireEvent.doubleClick(row("a"));
    expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });
});
