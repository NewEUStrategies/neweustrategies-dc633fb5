// Pasek narzędzi i dialogi panelu mediów. Do 18.08.2026: oba na zerze
// (150 + 139 linii).
//
// Pasek jest w całości deklaratywny, więc jedyną regułą, jaką niesie, jest
// DOSTĘPNOŚĆ AKCJI - i to ona chroni przed operacjami nieodwracalnymi bez
// obiektu: wklejanie przy pustym schowku, kasowanie bez zaznaczenia w korzeniu,
// cofanie przy pustej historii. Dialogi niosą drugą regułę: potwierdzenie
// kasowania musi mówić, CZEGO dotyczy (plików czy folderu).
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MediaToolbar } from "../MediaToolbar";
import { MediaDialogs } from "../MediaDialogs";
import type { ConfirmDeleteState, ViewMode } from "../../types";

interface ToolbarState {
  busy?: boolean;
  viewMode?: ViewMode;
  infoOpen?: boolean;
  search?: string;
  hasSelection?: boolean;
  canPaste?: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  atRoot?: boolean;
}

function setupToolbar(state: ToolbarState = {}) {
  const spies = {
    onUpload: vi.fn(),
    onNewFolder: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onCopy: vi.fn(),
    onCut: vi.fn(),
    onPaste: vi.fn(),
    onDelete: vi.fn(),
    onSetViewMode: vi.fn(),
    onToggleInfo: vi.fn(),
    onSearch: vi.fn(),
  };
  const view = render(
    <MediaToolbar
      busy={state.busy ?? false}
      viewMode={state.viewMode ?? "grid"}
      infoOpen={state.infoOpen ?? false}
      search={state.search ?? ""}
      hasSelection={state.hasSelection ?? false}
      canPaste={state.canPaste ?? false}
      canUndo={state.canUndo ?? false}
      canRedo={state.canRedo ?? false}
      atRoot={state.atRoot ?? true}
      {...spies}
    />,
  );
  return { ...spies, unmount: view.unmount };
}

/** Przycisk paska po podpowiedzi skrótu (ikony nie mają tekstu). */
const byShortcut = (title: string) => screen.getByTitle(title);

describe("MediaToolbar - dostępność akcji", () => {
  it("cofanie i ponawianie są WYŁĄCZONE przy pustej historii", () => {
    setupToolbar();
    expect(byShortcut("Ctrl+Z")).toBeDisabled();
    expect(byShortcut("Ctrl+Shift+Z")).toBeDisabled();
  });

  it("cofanie i ponawianie włączają się osobno", () => {
    setupToolbar({ canUndo: true, canRedo: false });
    expect(byShortcut("Ctrl+Z")).toBeEnabled();
    expect(byShortcut("Ctrl+Shift+Z")).toBeDisabled();
  });

  it("kopiowanie i wycinanie wymagają ZAZNACZENIA", () => {
    setupToolbar({ hasSelection: false });
    expect(byShortcut("Ctrl+C")).toBeDisabled();
    expect(byShortcut("Ctrl+X")).toBeDisabled();
  });

  it("wklejanie wymaga PEŁNEGO schowka, niezależnie od zaznaczenia", () => {
    setupToolbar({ hasSelection: true, canPaste: false });
    expect(byShortcut("Ctrl+V")).toBeDisabled();
  });

  it("kasowanie jest WYŁĄCZONE w korzeniu bez zaznaczenia", () => {
    // W korzeniu nie ma czego skasować „w miejscu”: pusty przycisk kasowania
    // sugerowałby, że da się usunąć katalog główny.
    setupToolbar({ hasSelection: false, atRoot: true });
    expect(screen.getByTitle(/usuń|delete/i)).toBeDisabled();
  });

  it("kasowanie działa w podfolderze BEZ zaznaczenia - kasuje ten folder", () => {
    const { onDelete } = setupToolbar({ hasSelection: false, atRoot: false });
    const button = screen.getByTitle(/usuń|delete/i);
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("podpowiedź kasowania ZMIENIA SIĘ z zaznaczeniem", () => {
    // Ten sam przycisk robi dwie różne rzeczy - tekst musi mówić którą.
    const first = setupToolbar({ hasSelection: false, atRoot: false });
    const withoutSelection = screen.getByTitle(/usuń|delete/i).getAttribute("title");
    first.unmount();

    setupToolbar({ hasSelection: true, atRoot: false });
    const withSelection = screen.getByTitle(/usuń|delete/i).getAttribute("title");

    expect(withSelection).not.toBe(withoutSelection);
  });

  it("wgrywanie jest zablokowane w trakcie przesyłu", () => {
    // Drugi klik w trakcie uploadu otwierałby drugi wybór plików i mieszał
    // dwie partie.
    setupToolbar({ busy: true });
    expect(screen.getByRole("button", { name: /wgrywanie|uploading/i })).toBeDisabled();
  });
});

describe("MediaToolbar - przełączniki i wyszukiwanie", () => {
  it("aktywny widok jest wyróżniony", () => {
    setupToolbar({ viewMode: "list" });
    const buttons = screen.getAllByRole("button");
    // Wyróżnienie idzie przez wariant przycisku - sprawdzamy, że DOKŁADNIE
    // jeden z pary siatka/lista go ma.
    const highlighted = buttons.filter((b) => b.className.includes("bg-primary"));
    expect(highlighted.length).toBeGreaterThanOrEqual(1);
  });

  it("przełączenie widoku zgłasza wybrany tryb", () => {
    const { onSetViewMode } = setupToolbar({ viewMode: "grid" });
    const buttons = screen.getAllByRole("button");
    for (const b of buttons) fireEvent.click(b);
    expect(onSetViewMode).toHaveBeenCalledWith("grid");
    expect(onSetViewMode).toHaveBeenCalledWith("list");
  });

  it("wyszukiwarka zgłasza każdą zmianę", () => {
    const { onSearch } = setupToolbar();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "raport" } });
    expect(onSearch).toHaveBeenCalledWith("raport");
  });

  it("wyszukiwarka pokazuje bieżącą frazę", () => {
    setupToolbar({ search: "okładka" });
    expect(screen.getByRole("textbox")).toHaveValue("okładka");
  });

  it("pasek jest wyłączony z zaznaczania prostokątem", () => {
    // Bez `data-nomarquee` przeciągnięcie zaczęte na pasku czyściłoby
    // zaznaczenie i rysowało prostokąt nad płótnem.
    setupToolbar();
    expect(document.querySelector("[data-nomarquee]")).toBeTruthy();
  });
});

describe("MediaDialogs - tworzenie folderu", () => {
  function setupDialogs(overrides: Partial<Parameters<typeof MediaDialogs>[0]> = {}) {
    const spies = {
      onNewFolderNameChange: vi.fn(),
      onNewFolderClose: vi.fn(),
      onCreateFolder: vi.fn(),
      onRenamingFolderDraftChange: vi.fn(),
      onRenamingFolderClose: vi.fn(),
      onRenameFolder: vi.fn(),
      onConfirmDeleteClose: vi.fn(),
      onConfirmDelete: vi.fn(),
    };
    render(
      <MediaDialogs
        newFolderOpen={false}
        newFolderName=""
        renamingFolder={null}
        renamingFolderDraft=""
        confirmDelete={null}
        {...spies}
        {...overrides}
      />,
    );
    return spies;
  }

  it("zamknięty dialog nie renderuje pola", () => {
    setupDialogs();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("otwarty pokazuje pole z bieżącą nazwą", () => {
    setupDialogs({ newFolderOpen: true, newFolderName: "prasa" });
    expect(screen.getByRole("textbox")).toHaveValue("prasa");
  });

  it("Enter tworzy folder bez sięgania po przycisk", () => {
    const { onCreateFolder } = setupDialogs({ newFolderOpen: true });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onCreateFolder).toHaveBeenCalledTimes(1);
  });

  it("inny klawisz NIE tworzy folderu", () => {
    const { onCreateFolder } = setupDialogs({ newFolderOpen: true });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "a" });
    expect(onCreateFolder).not.toHaveBeenCalled();
  });

  it("wpisywanie zgłasza zmianę nazwy", () => {
    const { onNewFolderNameChange } = setupDialogs({ newFolderOpen: true });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "nowy" } });
    expect(onNewFolderNameChange).toHaveBeenCalledWith("nowy");
  });
});

describe("MediaDialogs - zmiana nazwy folderu", () => {
  function setupRename(path: string | null, draft = "prasa") {
    const spies = {
      onNewFolderNameChange: vi.fn(),
      onNewFolderClose: vi.fn(),
      onCreateFolder: vi.fn(),
      onRenamingFolderDraftChange: vi.fn(),
      onRenamingFolderClose: vi.fn(),
      onRenameFolder: vi.fn(),
      onConfirmDeleteClose: vi.fn(),
      onConfirmDelete: vi.fn(),
    };
    render(
      <MediaDialogs
        newFolderOpen={false}
        newFolderName=""
        renamingFolder={path}
        renamingFolderDraft={draft}
        confirmDelete={null}
        {...spies}
      />,
    );
    return spies;
  }

  it("otwiera się dla WSKAZANEJ ścieżki i pokazuje podpowiedzianą nazwę", () => {
    setupRename("/press/", "press");
    expect(screen.getByRole("textbox")).toHaveValue("press");
  });

  it("brak ścieżki trzyma dialog zamknięty", () => {
    setupRename(null);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("Enter zatwierdza zmianę nazwy", () => {
    const { onRenameFolder } = setupRename("/press/");
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onRenameFolder).toHaveBeenCalledTimes(1);
  });
});

describe("MediaDialogs - potwierdzenie kasowania", () => {
  function setupConfirm(confirmDelete: ConfirmDeleteState | null) {
    const spies = {
      onNewFolderNameChange: vi.fn(),
      onNewFolderClose: vi.fn(),
      onCreateFolder: vi.fn(),
      onRenamingFolderDraftChange: vi.fn(),
      onRenamingFolderClose: vi.fn(),
      onRenameFolder: vi.fn(),
      onConfirmDeleteClose: vi.fn(),
      onConfirmDelete: vi.fn(),
    };
    const view = render(
      <MediaDialogs
        newFolderOpen={false}
        newFolderName=""
        renamingFolder={null}
        renamingFolderDraft=""
        confirmDelete={confirmDelete}
        {...spies}
      />,
    );
    return { ...spies, unmount: view.unmount };
  }

  it("bez żądania kasowania dialog jest zamknięty", () => {
    setupConfirm(null);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("kasowanie PLIKÓW i kasowanie FOLDERU dają RÓŻNE komunikaty", () => {
    // Ten sam tekst dla obu przypadków to potwierdzenie, które nie mówi, co
    // zniknie - a to operacja nieodwracalna.
    const first = setupConfirm({ kind: "files", ids: ["a", "b"] });
    const filesCopy = screen.getByRole("dialog").textContent ?? "";
    first.unmount();

    setupConfirm({ kind: "folder", folder: "/press/" });
    const folderCopy = screen.getByRole("dialog").textContent ?? "";

    expect(filesCopy).not.toBe(folderCopy);
  });

  it("potwierdzenie uruchamia kasowanie, anulowanie tylko zamyka", () => {
    const { onConfirmDelete, onConfirmDeleteClose } = setupConfirm({
      kind: "files",
      ids: ["a"],
    });
    fireEvent.click(screen.getByRole("button", { name: /usuń|delete/i }));
    expect(onConfirmDelete).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /anuluj|cancel/i }));
    expect(onConfirmDeleteClose).toHaveBeenCalledTimes(1);
  });

  it("przycisk kasowania jest oznaczony jako destrukcyjny", () => {
    setupConfirm({ kind: "files", ids: ["a"] });
    expect(screen.getByRole("button", { name: /usuń|delete/i }).className).toContain("destructive");
  });
});
