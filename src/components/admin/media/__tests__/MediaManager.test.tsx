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
  MediaPreviewDialog: ({ file, onClose }: { file: MediaRow | null; onClose: () => void }) =>
    file ? (
      <div data-testid="podglad">
        {file.filename}
        <button type="button" onClick={onClose}>
          zamknij podgląd
        </button>
      </div>
    ) : null,
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
    // Dialog potwierdzenia jest jedyną bramką - operator już powiedział „tak”.
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
    // Zamiana tych dwóch to przycisk „cofnij”, który idzie do przodu.
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

// POZYCJE MENU KONTEKSTOWEGO. Reguła dostępności (co wolno kliknąć) ma własny
// plik - `lib/__tests__/contextMenuItems.test.tsx`. Tutaj sprawdzane jest
// SPIĘCIE: czy kliknięcie pozycji uruchamia tę akcję, której nazwa obiecuje.
// Podmiana dwóch wywołań zwrotnych w obiekcie `contextMenuDeps` nie daje błędu
// typów (wszystkie mają zgodne sygnatury) - „Pobierz” mogłoby kasować.
/**
 * Panel informacji po prawej. Jest to jedyny `aside` o stałej szerokości `w-72`
 * - drzewo folderów po lewej ma `w-56`.
 */
const infoPanel = () => document.querySelector<HTMLElement>("aside.w-72");

describe("MediaManager - pozycje menu kontekstowego na pliku", () => {
  function openFileMenu(id = "a") {
    setup();
    fireEvent.contextMenu(tile(id));
    return screen.getByRole("menu");
  }

  const item = (name: RegExp) => screen.getByRole("menuitem", { name });

  it("„Otwórz” otwiera publiczny adres pliku w nowej karcie", () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    openFileMenu();
    fireEvent.click(item(/^Otwórz/));

    expect(open).toHaveBeenCalledWith("https://cdn.example/a.png", "_blank");
    vi.unstubAllGlobals();
  });

  it("„Skopiuj URL” wkłada do schowka adres, nie nazwę pliku", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    openFileMenu();
    fireEvent.click(item(/^Skopiuj URL/));

    expect(writeText).toHaveBeenCalledWith("https://cdn.example/a.png");
  });

  it("„Pobierz” celuje w adres pliku i podaje jego nazwę", () => {
    // Pobranie pod złą nazwą zapisuje plik jako „undefined” w katalogu pobrań.
    const clicked: { href: string; download: string }[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreate(tag) as HTMLAnchorElement;
      if (tag === "a") el.click = () => clicked.push({ href: el.href, download: el.download });
      return el;
    });
    openFileMenu();
    fireEvent.click(item(/^Pobierz/));

    expect(clicked).toEqual([{ href: "https://cdn.example/a.png", download: "a.png" }]);
    vi.restoreAllMocks();
  });

  it("„Informacje” zawęża zaznaczenie do TEGO pliku i otwiera panel", () => {
    // Panel pokazujący opis innego pliku pozwala zapisać obcy tekst alternatywny.
    setup();
    fireEvent.click(tile("a"));
    fireEvent.click(tile("b"), { metaKey: true });
    fireEvent.contextMenu(tile("b"));
    fireEvent.click(item(/^Informacje/));

    const panel = infoPanel();
    expect(panel).toBeTruthy();
    expect(panel!.textContent).toContain("b.png");
    expect(panel!.textContent).not.toContain("a.png");
  });

  it("„Zmień nazwę” otwiera edycję z BIEŻĄCĄ nazwą pliku", () => {
    openFileMenu();
    fireEvent.click(item(/^Zmień nazwę/));

    const input = within(tile("a")).getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("a.png");
  });

  it("zatwierdzenie nowej nazwy przekazuje ją przyciętą i zamyka edycję", () => {
    openFileMenu();
    fireEvent.click(item(/^Zmień nazwę/));
    const input = within(tile("a")).getByRole("textbox");
    fireEvent.change(input, { target: { value: "  raport.png  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(h.mutations.doRename).toHaveBeenCalledWith("a", "raport.png");
    expect(within(tile("a")).queryByRole("textbox")).toBeNull();
  });

  it("porzucenie edycji nie zmienia nazwy", () => {
    openFileMenu();
    fireEvent.click(item(/^Zmień nazwę/));
    const input = within(tile("a")).getByRole("textbox");
    fireEvent.change(input, { target: { value: "inna.png" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(h.mutations.doRename).not.toHaveBeenCalled();
    expect(within(tile("a")).queryByRole("textbox")).toBeNull();
  });

  it("„Usuń” pyta o potwierdzenie zamiast kasować od razu", () => {
    // Kasowanie plików jest nieodwracalne - jedno kliknięcie nie może wystarczyć.
    openFileMenu();
    fireEvent.click(item(/^Usuń/));

    expect(h.mutations.doDelete).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog").textContent).toMatch(/usun|potwierdź/i);
  });
});

describe("MediaManager - pozycje menu kontekstowego na folderze i płótnie", () => {
  const canvas = () => document.querySelector<HTMLElement>("section > div.overflow-auto")!;
  const item = (name: RegExp) => screen.getByRole("menuitem", { name });

  /**
   * Kafel folderu w SIATCE. Ten sam atrybut nosi wiersz w drzewie po lewej,
   * ale drzewo celowo blokuje menu kontekstowe (`preventDefault` bez otwarcia),
   * więc adresujemy element klikalny.
   */
  const folderTile = (path: string) =>
    Array.from(document.querySelectorAll<HTMLElement>(`[data-folder-item="${path}"]`)).find(
      (el) => el.tagName === "BUTTON",
    )!;

  it("„Otwórz” na folderze wchodzi do środka", () => {
    setup();
    fireEvent.contextMenu(folderTile("/press/"));
    fireEvent.click(item(/^Otwórz/));

    expect(document.querySelector('[data-media-item="c"]')).not.toBeNull();
    expect(document.querySelector('[data-media-item="a"]')).toBeNull();
  });

  it("klik w KAFEL folderu czyści zaznaczenie razem ze zmianą ścieżki", () => {
    // Zaznaczenie przeniesione do innego folderu obejmuje pliki spoza widoku,
    // a operacja zbiorcza kasuje wtedy nie to, co widać.
    setup();
    fireEvent.click(tile("a"));
    fireEvent.click(folderTile("/press/"));
    fireEvent.keyDown(window, { key: "c", metaKey: true });

    expect(h.mutations.copy).not.toHaveBeenCalled();
  });

  it("DEFEKT: wejście do folderu Z MENU zostawia zaznaczenie z poprzedniego folderu", () => {
    // Kafel folderu woła `openFolder`, które zmienia ścieżkę I czyści
    // zaznaczenie. Pozycja menu „Otwórz” jest podpięta wprost pod
    // `setCurrentPath`, więc zaznaczenie z POPRZEDNIEGO folderu zostaje żywe -
    // a operacja zbiorcza (Cmd+C, Delete) obejmuje wtedy pliki spoza widoku.
    // Przypięte, nie naprawiane tutaj: naprawa zmienia zachowanie.
    setup();
    fireEvent.click(tile("a"));
    fireEvent.contextMenu(folderTile("/press/"));
    fireEvent.click(item(/^Otwórz/));
    fireEvent.keyDown(window, { key: "c", metaKey: true });

    expect(h.mutations.copy).toHaveBeenCalledWith(["a"]);
  });

  it("„Zmień nazwę” na folderze podpowiada jego OSTATNI segment", () => {
    setup();
    fireEvent.contextMenu(folderTile("/press/"));
    fireEvent.click(item(/^Zmień nazwę/));

    expect(screen.getByRole("dialog").querySelector("input")).toHaveValue("press");
  });

  it("„Usuń” na folderze pyta o potwierdzenie", () => {
    setup();
    fireEvent.contextMenu(folderTile("/press/"));
    fireEvent.click(item(/^Usuń/));

    expect(h.mutations.doDeleteFolder).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("„Nowy folder” na płótnie otwiera dialog tworzenia", () => {
    setup();
    fireEvent.contextMenu(canvas());
    fireEvent.click(item(/^Nowy folder/));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("„Wgraj pliki” na płótnie sięga po ukryte pole wyboru plików", () => {
    setup();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const click = vi.fn();
    input.click = click;
    fireEvent.contextMenu(canvas());
    fireEvent.click(item(/^Wgraj pliki/));

    expect(click).toHaveBeenCalled();
  });

  it("„Wklej” idzie przez warstwę akcji, nie przez własną kopię", () => {
    h.mutations.canPaste = true;
    setup();
    fireEvent.contextMenu(canvas());
    fireEvent.click(item(/^Wklej/));

    expect(h.mutations.doPaste).toHaveBeenCalled();
  });

  it("„Zaznacz wszystko” obejmuje pliki BIEŻĄCEGO folderu", () => {
    setup();
    fireEvent.contextMenu(canvas());
    fireEvent.click(item(/^Zaznacz wszystko/));
    fireEvent.contextMenu(tile("a"));
    fireEvent.click(item(/^Kopiuj/));

    expect(new Set(h.mutations.copy.mock.calls.at(-1)?.[0] as string[])).toEqual(
      new Set(["a", "b"]),
    );
  });
});

describe("MediaManager - skróty klawiaturowe", () => {
  const key = (k: string, mods: Record<string, boolean> = {}) =>
    fireEvent.keyDown(window, { key: k, ...mods });

  it("Cmd+A zaznacza wszystko w bieżącym folderze", () => {
    setup();
    key("a", { metaKey: true });
    key("c", { metaKey: true });

    expect(new Set(h.mutations.copy.mock.calls[0][0] as string[])).toEqual(new Set(["a", "b"]));
  });

  it("Cmd+X wycina zaznaczenie", () => {
    setup();
    fireEvent.click(tile("a"));
    key("x", { metaKey: true });

    expect(h.mutations.cut).toHaveBeenCalledWith(["a"]);
  });

  it("Cmd+V wkleja tylko wtedy, gdy schowek ma zawartość", () => {
    setup();
    key("v", { metaKey: true });
    expect(h.mutations.doPaste).not.toHaveBeenCalled();
  });

  it("Cmd+V z pełnym schowkiem idzie przez warstwę akcji", () => {
    h.mutations.canPaste = true;
    setup();
    key("v", { metaKey: true });

    expect(h.mutations.doPaste).toHaveBeenCalledTimes(1);
  });

  it("Cmd+Z cofa, Cmd+Shift+Z ponawia", () => {
    // Podmiana tych dwóch cofa zamiast ponawiać - i odwrotnie.
    setup();
    key("z", { metaKey: true });
    expect(h.mutations.undo).toHaveBeenCalledTimes(1);
    expect(h.mutations.redo).not.toHaveBeenCalled();

    key("z", { metaKey: true, shiftKey: true });
    expect(h.mutations.redo).toHaveBeenCalledTimes(1);
  });

  it("Delete otwiera potwierdzenie, nie kasuje od razu", () => {
    setup();
    fireEvent.click(tile("a"));
    key("Delete");

    expect(h.mutations.doDelete).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("F2 otwiera edycję nazwy JEDYNEGO zaznaczonego pliku", () => {
    setup();
    fireEvent.click(tile("b"));
    key("F2");

    expect(within(tile("b")).getByRole("textbox")).toHaveValue("b.png");
  });

  it("F2 przy zaznaczeniu wielokrotnym nie robi nic", () => {
    // Nie da się nadać jednej nazwy dwóm plikom.
    setup();
    fireEvent.click(tile("a"));
    fireEvent.click(tile("b"), { metaKey: true });
    key("F2");

    expect(document.querySelectorAll('[data-media-item] input[type="text"]')).toHaveLength(0);
  });

  it("Escape zamyka menu kontekstowe i czyści zaznaczenie", () => {
    setup();
    fireEvent.click(tile("a"));
    fireEvent.contextMenu(tile("a"));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    key("Escape");
    expect(screen.queryByRole("menu")).toBeNull();

    key("c", { metaKey: true });
    expect(h.mutations.copy).not.toHaveBeenCalled();
  });
});

describe("MediaManager - panel informacji z paska", () => {
  it("przełącznik otwiera i zamyka panel", () => {
    // DEFEKT (przypięty, nie naprawiany tutaj): przycisk panelu informacji jest
    // wyłącznie ikoną, bez `title` ani `aria-label` - czytnik ekranu odczyta go
    // jako „przycisk". Dlatego test sięga po klasę ikony, a nie po nazwę.
    setup();
    fireEvent.click(tile("a"));
    const toggle = document.querySelector<HTMLElement>("svg.lucide-info")!.closest("button")!;
    expect(infoPanel()).toBeNull();

    fireEvent.click(toggle);
    expect(infoPanel()).toBeTruthy();

    fireEvent.click(toggle);
    expect(infoPanel()).toBeNull();
  });
});

describe("MediaManager - wgrywanie z paska", () => {
  it("przycisk „Wgraj” sięga po ukryte pole wyboru plików", () => {
    // Pole jest ukryte; bez tego spięcia przycisk paska nic nie robi.
    setup();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const click = vi.fn();
    input.click = click;
    fireEvent.click(screen.getByRole("button", { name: /^Wgraj$/ }));

    expect(click).toHaveBeenCalled();
  });
});

describe("MediaManager - zamykanie okien dialogowych", () => {
  const cancel = () => screen.getByRole("button", { name: /^Anuluj$/ });

  it("porzucenie tworzenia folderu nie tworzy niczego", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Nowy folder/ }));
    fireEvent.click(cancel());

    expect(h.mutations.doCreateFolder).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("porzucenie zmiany nazwy folderu nie zmienia nazwy", () => {
    setup();
    fireEvent.contextMenu(
      Array.from(document.querySelectorAll<HTMLElement>('[data-folder-item="/press/"]')).find(
        (el) => el.tagName === "BUTTON",
      )!,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /^Zmień nazwę/ }));
    fireEvent.click(cancel());

    expect(h.mutations.doRenameFolder).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("porzucenie potwierdzenia NIE kasuje - to ostatnia bramka przed utratą plików", () => {
    setup();
    fireEvent.click(tile("a"));
    fireEvent.keyDown(window, { key: "Delete" });
    fireEvent.click(cancel());

    expect(h.mutations.doDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("zamknięcie podglądu wraca do siatki", () => {
    setup();
    fireEvent.doubleClick(tile("a"));
    expect(screen.getByTestId("podglad")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /zamknij podgląd/ }));
    expect(screen.queryByTestId("podglad")).toBeNull();
  });
});

describe("MediaManager - menu kontekstowe w widoku LISTY", () => {
  /** Przełącza na widok tabeli - drugi przycisk widoku w pasku. */
  function listView() {
    setup();
    fireEvent.click(document.querySelector<HTMLElement>("svg.lucide-list")!.closest("button")!);
  }

  it("prawy przycisk na WIERSZU pliku otwiera menu pliku", () => {
    // Widok listy ma własne spięcia menu; skopiowane z siatki potrafią zostać
    // z cudzym argumentem i pokazywać menu folderu nad plikiem.
    listView();
    fireEvent.contextMenu(tile("a"));

    expect(screen.getByRole("menuitem", { name: /^Skopiuj URL/ })).toBeInTheDocument();
  });

  it("prawy przycisk na WIERSZU folderu otwiera menu folderu", () => {
    listView();
    fireEvent.contextMenu(
      Array.from(document.querySelectorAll<HTMLElement>('[data-folder-item="/press/"]')).find(
        (el) => el.closest("table") !== null,
      )!,
    );

    expect(screen.queryByRole("menuitem", { name: /^Skopiuj URL/ })).toBeNull();
    expect(screen.getByRole("menuitem", { name: /^Otwórz/ })).toBeInTheDocument();
  });
});
