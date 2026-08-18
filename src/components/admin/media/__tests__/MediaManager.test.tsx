// ORKIESTRATOR panelu mediów. Do 18.08.2026: 0% ze 149 instrukcji - największe
// pojedyncze zero w całym module.
//
// Ten komponent nie ma własnej logiki domenowej; spina osiem hooków i dziesięć
// komponentów. Ale spięcie SAMO W SOBIE jest regułą i psuje się po cichu:
// nazwa folderu podpięta pod złe pole dialogu, kasowanie z paska celujące
// w zaznaczenie zamiast w bieżący folder, wejście do folderu bez wyczyszczenia
// zaznaczenia (operacja zbiorcza obejmuje wtedy pliki spoza widoku).
//
// Testy niżej celują wyłącznie w te spięcia. Reguły składowych mają własne
// pliki - tu nie ma ani jednej asercji, która je powtarza.
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FolderRow, MediaRow } from "../types";

const h = vi.hoisted(() => ({
  tenantId: "tenant-1",
  user: { id: "user-1" } as { id: string } | null,
  media: [] as MediaRow[],
  folders: [] as FolderRow[],
  invalidate: vi.fn(),
  mutations: {
    busy: false,
    clipboard: null as unknown,
    canPaste: false,
    canUndo: false,
    canRedo: false,
    copy: vi.fn(),
    cut: vi.fn(),
    clearClipboard: vi.fn(),
    uploadFiles: vi.fn(),
    doMove: vi.fn(),
    doRename: vi.fn(),
    doDelete: vi.fn(),
    doPaste: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    doCreateFolder: vi.fn(),
    doRenameFolder: vi.fn(),
    doDeleteFolder: vi.fn(),
    updateAlt: vi.fn(),
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useRequiredTenant: () => h.tenantId,
  useAuth: () => ({ user: h.user }),
}));
vi.mock("../hooks/useMediaData", () => ({
  useMediaData: () => ({
    foldersQuery: { data: h.folders },
    mediaQuery: { data: h.media },
    invalidate: h.invalidate,
  }),
}));
vi.mock("../hooks/useMediaMutations", () => ({ useMediaMutations: () => h.mutations }));
vi.mock("../organisms/MediaPreviewDialog", () => ({
  MediaPreviewDialog: ({ file }: { file: MediaRow | null }) =>
    file ? <div data-testid="podglad">{file.filename}</div> : null,
}));

import "@/lib/i18n-admin-media";
import { MediaManager } from "../MediaManager";

function file(id: string, overrides: Partial<MediaRow> = {}): MediaRow {
  return {
    id,
    tenant_id: "tenant-1",
    storage_path: `t1/u/${id}.png`,
    public_url: `https://cdn.example/${id}.png`,
    filename: `${id}.png`,
    mime_type: "image/png",
    size_bytes: 1024,
    uploader_id: "u",
    created_at: "2026-01-01T00:00:00.000Z",
    folder_path: "/",
    alt_text: null,
    ...overrides,
  };
}

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function setup() {
  return render(<MediaManager />, { wrapper });
}

const tile = (id: string) => {
  const el = document.querySelector<HTMLElement>(`[data-media-item="${id}"]`);
  if (!el) throw new Error(`brak kafla ${id}`);
  return el;
};

const deleteButton = () => screen.getByTitle(/usuń|delete/i);

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  h.tenantId = "tenant-1";
  h.user = { id: "user-1" };
  h.media = [file("a"), file("b"), file("c", { folder_path: "/press/" })];
  h.folders = [{ id: "f1", path: "/press/", created_at: "2026-01-01T00:00:00.000Z" }];
  Object.assign(h.mutations, {
    busy: false,
    canPaste: false,
    canUndo: false,
    canRedo: false,
  });
  for (const value of Object.values(h.mutations)) {
    if (typeof value === "function") (value as ReturnType<typeof vi.fn>).mockReset();
  }
  h.mutations.doCreateFolder.mockResolvedValue(true);
  h.mutations.doRenameFolder.mockResolvedValue(true);
  h.invalidate.mockReset();
});

describe("MediaManager - zawartość bieżącego folderu", () => {
  it("pokazuje TYLKO pliki z bieżącej ścieżki", () => {
    // Bez filtra po folderze panel byłby płaską listą całej biblioteki,
    // a operacje zbiorcze obejmowałyby pliki spoza widoku.
    setup();
    expect(tile("a")).toBeInTheDocument();
    expect(tile("b")).toBeInTheDocument();
    expect(document.querySelector('[data-media-item="c"]')).toBeNull();
  });

  it("wejście do folderu przełącza zawartość", () => {
    setup();
    fireEvent.click(document.querySelector('[data-folder-item="/press/"]')!);
    expect(tile("c")).toBeInTheDocument();
    expect(document.querySelector('[data-media-item="a"]')).toBeNull();
  });

  it("wyszukiwanie filtruje po NAZWIE w obrębie folderu", () => {
    setup();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "b" } });
    expect(tile("b")).toBeInTheDocument();
    expect(document.querySelector('[data-media-item="a"]')).toBeNull();
  });

  it("pusty folder pokazuje zachętę zamiast pustki", () => {
    h.media = [];
    h.folders = [];
    setup();
    expect(screen.getByText(/Przeciągnij|Drop/i)).toBeInTheDocument();
  });

  it("przełącznik widoku zmienia siatkę na tabelę", () => {
    // Oba widoki renderują te same dane inaczej: siatka kaflami, lista tabelą.
    // Przyciski widoku są ikonowe, więc bierzemy je po pozycji względem
    // rozpoznawalnego sąsiada (przycisk kasowania).
    setup();
    expect(screen.queryByRole("table")).toBeNull();

    const buttons = screen.getAllByRole("button");
    const deleteIndex = buttons.indexOf(deleteButton());
    // Po kasowaniu idą kolejno: siatka, lista, informacje.
    fireEvent.click(buttons[deleteIndex + 2]);
    expect(screen.getByRole("table")).toBeInTheDocument();

    fireEvent.click(buttons[deleteIndex + 1]);
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("MediaManager - kasowanie z paska", () => {
  it("BEZ zaznaczenia w podfolderze celuje w BIEŻĄCY folder", () => {
    // Ten sam przycisk robi dwie rzeczy; pomyłka kasuje folder zamiast plików
    // albo odwrotnie - obie operacje są nieodwracalne.
    setup();
    fireEvent.click(document.querySelector('[data-folder-item="/press/"]')!);
    fireEvent.click(deleteButton());

    fireEvent.click(screen.getByRole("button", { name: /^usuń$|^delete$/i }));
    expect(h.mutations.doDeleteFolder).toHaveBeenCalledWith("/press/", true);
    expect(h.mutations.doDelete).not.toHaveBeenCalled();
  });

  it("Z zaznaczeniem celuje w PLIKI, nie w folder", () => {
    setup();
    fireEvent.click(tile("a"));
    fireEvent.click(deleteButton());

    fireEvent.click(screen.getByRole("button", { name: /^usuń$|^delete$/i }));
    expect(h.mutations.doDelete).toHaveBeenCalledWith(["a"]);
    expect(h.mutations.doDeleteFolder).not.toHaveBeenCalled();
  });

  it("w KORZENIU bez zaznaczenia przycisk jest wyłączony", () => {
    setup();
    expect(deleteButton()).toBeDisabled();
  });

  it("kasowanie folderu z drzewa jest zawsze REKURSYWNE po potwierdzeniu", () => {
    // Dialog potwierdzenia jest jedyną bramką - operator już powiedział „tak".
    setup();
    const row = document.querySelector<HTMLElement>('[data-folder-item="/press/"]')!;
    fireEvent.click(within(row).getAllByRole("button")[1]);
    fireEvent.click(screen.getByRole("button", { name: /^usuń$|^delete$/i }));

    expect(h.mutations.doDeleteFolder).toHaveBeenCalledWith("/press/", true);
  });
});

describe("MediaManager - schowek i historia z paska", () => {
  it("kopiowanie i wycinanie dostają CAŁE zaznaczenie", () => {
    setup();
    fireEvent.click(tile("a"));
    fireEvent.click(tile("b"), { metaKey: true });

    fireEvent.click(screen.getByTitle("Ctrl+C"));
    expect(new Set(h.mutations.copy.mock.calls[0][0] as string[])).toEqual(new Set(["a", "b"]));

    fireEvent.click(screen.getByTitle("Ctrl+X"));
    expect(new Set(h.mutations.cut.mock.calls[0][0] as string[])).toEqual(new Set(["a", "b"]));
  });

  it("cofanie i ponawianie są podpięte do WŁAŚCIWYCH akcji", () => {
    // Zamiana tych dwóch to przycisk „cofnij", który idzie do przodu.
    Object.assign(h.mutations, { canUndo: true, canRedo: true });
    setup();
    fireEvent.click(screen.getByTitle("Ctrl+Z"));
    expect(h.mutations.undo).toHaveBeenCalledTimes(1);
    expect(h.mutations.redo).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTitle("Ctrl+Shift+Z"));
    expect(h.mutations.redo).toHaveBeenCalledTimes(1);
  });

  it("wklejanie idzie do bieżącej ścieżki przez warstwę akcji", () => {
    h.mutations.canPaste = true;
    setup();
    fireEvent.click(screen.getByTitle("Ctrl+V"));
    expect(h.mutations.doPaste).toHaveBeenCalledTimes(1);
  });
});

describe("MediaManager - foldery", () => {
  it("tworzenie folderu przekazuje wpisaną nazwę i ZAMYKA dialog po sukcesie", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /nowy folder|new folder/i }));
    fireEvent.change(screen.getByPlaceholderText(/nazwa folderu|folder name/i), {
      target: { value: "prasa" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^utwórz$|^create$/i }));

    expect(h.mutations.doCreateFolder).toHaveBeenCalledWith("prasa");
    await waitFor(() =>
      expect(screen.queryByPlaceholderText(/nazwa folderu|folder name/i)).toBeNull(),
    );
  });

  it("PORAŻKA tworzenia ZOSTAWIA dialog otwarty z wpisaną nazwą", async () => {
    // Zamknięcie dialogu po błędzie kasuje pracę użytkownika i ukrywa powód.
    h.mutations.doCreateFolder.mockResolvedValue(false);
    setup();
    fireEvent.click(screen.getByRole("button", { name: /nowy folder|new folder/i }));
    fireEvent.change(screen.getByPlaceholderText(/nazwa folderu|folder name/i), {
      target: { value: "prasa" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^utwórz$|^create$/i }));

    await waitFor(() => expect(h.mutations.doCreateFolder).toHaveBeenCalled());
    expect(screen.getByPlaceholderText(/nazwa folderu|folder name/i)).toHaveValue("prasa");
  });

  it("zmiana nazwy folderu PODPOWIADA jego ostatni segment, nie całą ścieżkę", () => {
    // Wstawienie pełnej ścieżki zamieniłoby zmianę nazwy w przeniesienie.
    setup();
    const row = document.querySelector<HTMLElement>('[data-folder-item="/press/"]')!;
    fireEvent.click(within(row).getAllByRole("button")[0]);

    const dialogs = screen.getAllByRole("dialog");
    expect(within(dialogs[dialogs.length - 1]).getByRole("textbox")).toHaveValue("press");
  });

  it("zmiana nazwy folderu przekazuje STARĄ ścieżkę i NOWĄ nazwę", async () => {
    setup();
    const row = document.querySelector<HTMLElement>('[data-folder-item="/press/"]')!;
    fireEvent.click(within(row).getAllByRole("button")[0]);

    const dialogs = screen.getAllByRole("dialog");
    const input = within(dialogs[dialogs.length - 1]).getByRole("textbox");
    fireEvent.change(input, { target: { value: "prasa" } });
    fireEvent.click(screen.getByRole("button", { name: /^zapisz$|^save$/i }));

    await waitFor(() =>
      expect(h.mutations.doRenameFolder).toHaveBeenCalledWith("/press/", "prasa"),
    );
  });
});

describe("MediaManager - wgrywanie i podgląd", () => {
  it("wybór plików trafia do BIEŻĄCEJ ścieżki", () => {
    setup();
    fireEvent.click(document.querySelector('[data-folder-item="/press/"]')!);

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const picked = new File(["x"], "nowy.png", { type: "image/png" });
    Object.defineProperty(input, "files", { value: [picked], configurable: true });
    fireEvent.change(input);

    expect(h.mutations.uploadFiles).toHaveBeenCalledWith([picked], "/press/");
  });

  it("pusty wybór plików nie generuje wgrywania", () => {
    setup();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { value: [], configurable: true });
    fireEvent.change(input);
    expect(h.mutations.uploadFiles).not.toHaveBeenCalled();
  });

  it("podwójne kliknięcie otwiera podgląd TEGO pliku", () => {
    setup();
    fireEvent.doubleClick(tile("b"));
    expect(screen.getByTestId("podglad")).toHaveTextContent("b.png");
  });
});

describe("MediaManager - menu kontekstowe", () => {
  it("prawy przycisk na NIEZAZNACZONYM pliku zawęża zaznaczenie do niego", () => {
    // Inaczej menu działałoby na cudzym, wcześniejszym wyborze.
    setup();
    fireEvent.click(tile("a"));
    fireEvent.contextMenu(tile("b"));

    fireEvent.click(screen.getByRole("menuitem", { name: /^Kopiuj/ }));
    expect(h.mutations.copy).toHaveBeenCalledWith(["b"]);
  });

  it("prawy przycisk na ZAZNACZONYM pliku zachowuje całe zaznaczenie", () => {
    setup();
    fireEvent.click(tile("a"));
    fireEvent.click(tile("b"), { metaKey: true });
    fireEvent.contextMenu(tile("b"));

    fireEvent.click(screen.getByRole("menuitem", { name: /^Kopiuj/ }));
    expect(new Set(h.mutations.copy.mock.calls[0][0] as string[])).toEqual(new Set(["a", "b"]));
  });

  it("menu na pustym płótnie oferuje akcje kontekstu, nie zaznaczenia", () => {
    setup();
    // Menu pustego kontekstu wisi na przewijanym płótnie, a nie na sekcji -
    // i celowo NIE reaguje, gdy zdarzenie przyszło z kafla albo z folderu.
    const canvas = document.querySelector<HTMLElement>("section > div.overflow-auto")!;
    fireEvent.contextMenu(canvas);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Nowy folder/ })).toBeInTheDocument();
  });
});
