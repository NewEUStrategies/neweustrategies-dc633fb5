// Warstwa akcji menedżera mediów: każdy zapis serwerowy, schowek i historia
// cofania. Do 18.08.2026: 0% - 139 linii bez ani jednego wywołania, mimo że
// stąd wychodzą WSZYSTKIE operacje nieodwracalne panelu.
//
// Trzy rzeczy, których nie widać w teście renderującym panel:
//   1. upload MUSI iść przez `uploadAndRegisterMedia`, bo tylko ta ścieżka
//      SPRZĄTA obiekt ze storage po odrzuconej rejestracji. Wcześniejsza wersja
//      składała upload i rejestrację sama, a na błędzie robiła wyłącznie toast
//      - plik odrzucony przez serwerową allowlistę (np. SVG) zostawał żywy pod
//      publicznym URL-em. Stored XSS mimo czerwonego komunikatu.
//   2. historia cofania trzyma się w refach, a stan „można cofnąć” - w liczniku
//      renderów. Rozjazd między nimi to przyciski, które kłamią.
//   3. porażka zapisu NIE może wywrócić panelu ani zapisać operacji w historii,
//      bo cofanie odtworzyłoby stan, którego nigdy nie było.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { MediaRow } from "../../types";

const h = vi.hoisted(() => ({
  serverFns: {
    registerMediaUpload: vi.fn(),
    bulkDeleteMedia: vi.fn(),
    bulkMoveMedia: vi.fn(),
    duplicateMedia: vi.fn(),
    updateMediaMeta: vi.fn(),
    createMediaFolder: vi.fn(),
    renameMediaFolder: vi.fn(),
    deleteMediaFolder: vi.fn(),
  },
  uploadAndRegisterMedia: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({ useServerFn: <T,>(fn: T) => fn }));
vi.mock("@/lib/media.functions", () => h.serverFns);
vi.mock("@/lib/media/upload", () => ({ uploadAndRegisterMedia: h.uploadAndRegisterMedia }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess } }));
vi.mock("@/lib/toastError", () => ({ toastError: h.toastError }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { useMediaMutations, type UseMediaMutationsArgs } from "../useMediaMutations";

const TENANT = "tenant-1";
const USER = "user-1";

function row(id: string, folder = "/", filename = `${id}.png`): MediaRow {
  return {
    id,
    tenant_id: TENANT,
    storage_path: `${TENANT}/${USER}/${id}.png`,
    public_url: `https://cdn.example/${id}.png`,
    filename,
    mime_type: "image/png",
    size_bytes: 10,
    uploader_id: USER,
    created_at: "2026-01-01T00:00:00.000Z",
    folder_path: folder,
    alt_text: null,
  };
}

const MEDIA = [row("a", "/"), row("b", "/press/"), row("c", "/press/2026/")];

function setup(overrides: Partial<UseMediaMutationsArgs> = {}) {
  const setCurrentPath = vi.fn();
  const invalidate = vi.fn();
  const clearSelection = vi.fn();
  const { result } = renderHook(() =>
    useMediaMutations({
      media: MEDIA,
      tenantId: TENANT,
      userId: USER,
      currentPath: "/",
      setCurrentPath,
      invalidate,
      clearSelection,
      ...overrides,
    }),
  );
  return { result, setCurrentPath, invalidate, clearSelection };
}

beforeEach(() => {
  for (const fn of Object.values(h.serverFns)) fn.mockReset().mockResolvedValue({ ok: true });
  h.uploadAndRegisterMedia.mockReset().mockResolvedValue({ mediaId: "new-1" });
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

describe("useMediaMutations - wgrywanie", () => {
  const file = new File(["x"], "a.png", { type: "image/png" });

  it("idzie przez ścieżkę, która SPRZĄTA obiekt po odrzuconej rejestracji", async () => {
    // Regresja bezpieczeństwa: własna składanka upload + rejestracja zostawiała
    // odrzucony plik żywy pod publicznym adresem.
    const { result, invalidate } = setup();
    await act(async () => result.current.uploadFiles([file], "/"));

    expect(h.uploadAndRegisterMedia).toHaveBeenCalledWith({
      file,
      tenantId: TENANT,
      userId: USER,
      registerMedia: h.serverFns.registerMediaUpload,
    });
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("NIE dopina folderu, gdy celem jest katalog główny", async () => {
    const { result } = setup();
    await act(async () => result.current.uploadFiles([file], "/"));
    expect(h.serverFns.updateMediaMeta).not.toHaveBeenCalled();
  });

  it("przypina wgrany plik do folderu docelowego", async () => {
    const { result } = setup();
    await act(async () => result.current.uploadFiles([file], "press"));
    expect(h.serverFns.updateMediaMeta).toHaveBeenCalledWith({
      data: { mediaId: "new-1", folderPath: "/press/" },
    });
  });

  it("wgrywa wiele plików po kolei", async () => {
    const second = new File(["y"], "b.png", { type: "image/png" });
    const { result } = setup();
    await act(async () => result.current.uploadFiles([file, second], "/"));
    expect(h.uploadAndRegisterMedia).toHaveBeenCalledTimes(2);
  });

  it("nic nie robi bez zalogowanego użytkownika ani przy pustej liście", async () => {
    const anon = setup({ userId: undefined });
    await act(async () => anon.result.current.uploadFiles([file], "/"));
    expect(h.uploadAndRegisterMedia).not.toHaveBeenCalled();

    const empty = setup();
    await act(async () => empty.result.current.uploadFiles([], "/"));
    expect(h.uploadAndRegisterMedia).not.toHaveBeenCalled();
  });

  it("porażka wgrania daje komunikat i NIE unieważnia cache", async () => {
    h.uploadAndRegisterMedia.mockRejectedValue(new Error("odrzucony typ"));
    const { result, invalidate } = setup();
    await act(async () => result.current.uploadFiles([file], "/"));

    expect(h.toastError).toHaveBeenCalledWith(expect.any(Error), "upload");
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("zdejmuje blokadę panelu także po porażce", async () => {
    // Bez `finally` panel zostawał zablokowany na stałe po jednym błędzie.
    h.uploadAndRegisterMedia.mockRejectedValue(new Error("sieć"));
    const { result } = setup();
    await act(async () => result.current.uploadFiles([file], "/"));
    await waitFor(() => expect(result.current.busy).toBe(false));
  });
});

// ---------------------------------------------------------------------------
// Schowek
// ---------------------------------------------------------------------------

describe("useMediaMutations - schowek", () => {
  it("kopiowanie i wycinanie zapamiętują operację oraz identyfikatory", () => {
    const { result } = setup();
    act(() => result.current.copy(["a", "b"]));
    expect(result.current.clipboard).toEqual({ op: "copy", ids: ["a", "b"] });
    expect(result.current.canPaste).toBe(true);

    act(() => result.current.cut(["c"]));
    expect(result.current.clipboard).toEqual({ op: "cut", ids: ["c"] });
  });

  it("pusta lista nie nadpisuje schowka", () => {
    const { result } = setup();
    act(() => result.current.copy(["a"]));
    act(() => result.current.copy([]));
    expect(result.current.clipboard).toEqual({ op: "copy", ids: ["a"] });
  });

  it("czyszczenie zeruje schowek i blokuje wklejanie", () => {
    const { result } = setup();
    act(() => result.current.copy(["a"]));
    act(() => result.current.clearClipboard());
    expect(result.current.clipboard).toBeNull();
    expect(result.current.canPaste).toBe(false);
  });

  it("wklejenie po KOPIOWANIU duplikuje i ZOSTAWIA schowek pełny", async () => {
    // Kopiowanie ma być powtarzalne: jeden Cmd+C, wiele Cmd+V.
    const { result } = setup({ currentPath: "/press/" });
    act(() => result.current.copy(["a"]));
    await act(async () => result.current.doPaste());

    expect(h.serverFns.duplicateMedia).toHaveBeenCalledWith({
      data: { mediaIds: ["a"], folderPath: "/press/" },
    });
    expect(result.current.clipboard).toEqual({ op: "copy", ids: ["a"] });
  });

  it("wklejenie po WYCIĘCIU przenosi i OPRÓŻNIA schowek", async () => {
    // Wycinanie jest jednorazowe - drugie wklejenie nie miałoby czego przenieść.
    const { result } = setup({ currentPath: "/press/" });
    act(() => result.current.cut(["a"]));
    await act(async () => result.current.doPaste());

    expect(h.serverFns.bulkMoveMedia).toHaveBeenCalledWith({
      data: { mediaIds: ["a"], folderPath: "/press/" },
    });
    expect(result.current.clipboard).toBeNull();
  });

  it("wklejenie przy pustym schowku nic nie robi", async () => {
    const { result } = setup();
    await act(async () => result.current.doPaste());
    expect(h.serverFns.duplicateMedia).not.toHaveBeenCalled();
    expect(h.serverFns.bulkMoveMedia).not.toHaveBeenCalled();
  });

  it("porażka duplikowania daje komunikat zamiast wywracać panel", async () => {
    h.serverFns.duplicateMedia.mockRejectedValue(new Error("brak miejsca"));
    const { result } = setup();
    act(() => result.current.copy(["a"]));
    await act(async () => result.current.doPaste());
    expect(h.toastError).toHaveBeenCalledWith(expect.any(Error), "save");
  });
});

// ---------------------------------------------------------------------------
// Przenoszenie, zmiana nazwy, kasowanie
// ---------------------------------------------------------------------------

describe("useMediaMutations - przenoszenie", () => {
  it("przenosi i unieważnia cache", async () => {
    const { result, invalidate } = setup();
    await act(async () => result.current.doMove(["a"], "/press/"));
    expect(h.serverFns.bulkMoveMedia).toHaveBeenCalledWith({
      data: { mediaIds: ["a"], folderPath: "/press/" },
    });
    expect(invalidate).toHaveBeenCalled();
  });

  it("pusta lista nie generuje żądania", async () => {
    const { result } = setup();
    await act(async () => result.current.doMove([], "/press/"));
    expect(h.serverFns.bulkMoveMedia).not.toHaveBeenCalled();
  });

  it("porażka NIE zapisuje operacji w historii", async () => {
    // Inaczej cofnięcie odtwarzałoby stan, którego nigdy nie było.
    h.serverFns.bulkMoveMedia.mockRejectedValue(new Error("odmowa"));
    const { result } = setup();
    await act(async () => result.current.doMove(["a"], "/press/"));

    expect(h.toastError).toHaveBeenCalledWith(expect.any(Error), "save");
    expect(result.current.canUndo).toBe(false);
  });

  it("można przenieść BEZ zapisu w historii", async () => {
    // Tego wariantu używa samo cofanie - inaczej cofnięcie samo trafiałoby na
    // stos i pętla nigdy by się nie skończyła.
    const { result } = setup();
    await act(async () => result.current.doMove(["a"], "/press/", false));
    expect(result.current.canUndo).toBe(false);
  });
});

describe("useMediaMutations - zmiana nazwy", () => {
  it("zmienia nazwę i zapisuje operację w historii", async () => {
    const { result } = setup();
    await act(async () => result.current.doRename("a", "nowa.png"));
    expect(h.serverFns.updateMediaMeta).toHaveBeenCalledWith({
      data: { mediaId: "a", filename: "nowa.png" },
    });
    expect(result.current.canUndo).toBe(true);
  });

  it("ignoruje plik spoza bieżącej listy", async () => {
    const { result } = setup();
    await act(async () => result.current.doRename("nieistnieje", "x.png"));
    expect(h.serverFns.updateMediaMeta).not.toHaveBeenCalled();
  });

  it("ignoruje zmianę na tę samą nazwę", async () => {
    // Pusta operacja w historii kosztowałaby użytkownika jedno „puste” cofnięcie.
    const { result } = setup();
    await act(async () => result.current.doRename("a", "a.png"));
    expect(h.serverFns.updateMediaMeta).not.toHaveBeenCalled();
    expect(result.current.canUndo).toBe(false);
  });

  it("porażka nie zapisuje operacji w historii", async () => {
    h.serverFns.updateMediaMeta.mockRejectedValue(new Error("konflikt"));
    const { result } = setup();
    await act(async () => result.current.doRename("a", "nowa.png"));
    expect(result.current.canUndo).toBe(false);
  });
});

describe("useMediaMutations - kasowanie", () => {
  it("kasuje, czyści zaznaczenie i unieważnia cache", async () => {
    const { result, clearSelection, invalidate } = setup();
    await act(async () => result.current.doDelete(["a", "b"]));

    expect(h.serverFns.bulkDeleteMedia).toHaveBeenCalledWith({ data: { mediaIds: ["a", "b"] } });
    expect(clearSelection).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("kasowanie NIE trafia do historii cofania", async () => {
    // Świadoma asymetria: skasowanego pliku nie da się przywrócić z klienta,
    // więc przycisk „cofnij” nie może obiecywać, że to zrobi.
    const { result } = setup();
    await act(async () => result.current.doDelete(["a"]));
    expect(result.current.canUndo).toBe(false);
  });

  it("pusta lista nie generuje żądania", async () => {
    const { result } = setup();
    await act(async () => result.current.doDelete([]));
    expect(h.serverFns.bulkDeleteMedia).not.toHaveBeenCalled();
  });

  it("porażka nie czyści zaznaczenia - użytkownik może spróbować ponownie", async () => {
    h.serverFns.bulkDeleteMedia.mockRejectedValue(new Error("odmowa"));
    const { result, clearSelection } = setup();
    await act(async () => result.current.doDelete(["a"]));

    expect(h.toastError).toHaveBeenCalledWith(expect.any(Error), "delete");
    expect(clearSelection).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Historia
// ---------------------------------------------------------------------------

describe("useMediaMutations - cofanie i ponawianie", () => {
  it("cofnięcie przeniesienia wraca do folderu ŹRÓDŁOWEGO", async () => {
    const { result } = setup();
    await act(async () => result.current.doMove(["a"], "/press/"));
    h.serverFns.bulkMoveMedia.mockClear();

    await act(async () => result.current.undo());
    expect(h.serverFns.bulkMoveMedia).toHaveBeenCalledWith({
      data: { mediaIds: ["a"], folderPath: "/" },
    });
  });

  it("cofnięcie GRUPUJE pliki po ich pierwotnych folderach", async () => {
    // Zaznaczenie zwykle pochodzi z różnych folderów. Jedno wspólne cofnięcie
    // wrzuciłoby wszystko do jednego miejsca - to nie byłoby cofnięcie.
    const { result } = setup();
    await act(async () => result.current.doMove(["a", "b"], "/archiwum/"));
    h.serverFns.bulkMoveMedia.mockClear();

    await act(async () => result.current.undo());
    const folders = h.serverFns.bulkMoveMedia.mock.calls.map(
      (c) => (c[0] as { data: { folderPath: string } }).data.folderPath,
    );
    expect(new Set(folders)).toEqual(new Set(["/", "/press/"]));
  });

  it("cofnięcie zmiany nazwy przywraca nazwę POPRZEDNIĄ", async () => {
    const { result } = setup();
    await act(async () => result.current.doRename("a", "nowa.png"));
    h.serverFns.updateMediaMeta.mockClear();

    await act(async () => result.current.undo());
    expect(h.serverFns.updateMediaMeta).toHaveBeenCalledWith({
      data: { mediaId: "a", filename: "a.png" },
    });
  });

  it("ponowienie przywraca stan sprzed cofnięcia", async () => {
    const { result } = setup();
    await act(async () => result.current.doRename("a", "nowa.png"));
    await act(async () => result.current.undo());
    h.serverFns.updateMediaMeta.mockClear();

    expect(result.current.canRedo).toBe(true);
    await act(async () => result.current.redo());
    expect(h.serverFns.updateMediaMeta).toHaveBeenCalledWith({
      data: { mediaId: "a", filename: "nowa.png" },
    });
  });

  it("ponowienie przeniesienia wraca do folderu DOCELOWEGO", async () => {
    const { result } = setup();
    await act(async () => result.current.doMove(["a"], "/press/"));
    await act(async () => result.current.undo());
    h.serverFns.bulkMoveMedia.mockClear();

    await act(async () => result.current.redo());
    expect(h.serverFns.bulkMoveMedia).toHaveBeenCalledWith({
      data: { mediaIds: ["a"], folderPath: "/press/" },
    });
  });

  it("NOWA operacja kasuje gałąź ponowienia", async () => {
    // Klasyczna semantyka historii: po cofnięciu i nowej zmianie „naprzód”
    // już nie istnieje. Bez tego przycisk oferowałby stan nie do odtworzenia.
    const { result } = setup();
    await act(async () => result.current.doRename("a", "nowa.png"));
    await act(async () => result.current.undo());
    expect(result.current.canRedo).toBe(true);

    await act(async () => result.current.doRename("b", "inna.png"));
    expect(result.current.canRedo).toBe(false);
  });

  it("cofnięcie i ponowienie na pustym stosie nic nie robią", async () => {
    const { result } = setup();
    await act(async () => result.current.undo());
    await act(async () => result.current.redo());
    expect(h.serverFns.bulkMoveMedia).not.toHaveBeenCalled();
    expect(h.serverFns.updateMediaMeta).not.toHaveBeenCalled();
  });

  it("flagi przycisków nadążają za stosami", async () => {
    // Stosy żyją w refach (brak re-renderu przy push), więc licznik renderów
    // jest jedyną rzeczą, która trzyma przyciski w zgodzie ze stanem.
    const { result } = setup();
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);

    await act(async () => result.current.doRename("a", "nowa.png"));
    expect(result.current.canUndo).toBe(true);

    await act(async () => result.current.undo());
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Foldery
// ---------------------------------------------------------------------------

describe("useMediaMutations - foldery", () => {
  it("tworzy folder WZGLĘDEM bieżącej ścieżki", async () => {
    const { result } = setup({ currentPath: "/press/" });
    let created: boolean | undefined;
    await act(async () => {
      created = await result.current.doCreateFolder("2026");
    });

    expect(h.serverFns.createMediaFolder).toHaveBeenCalledWith({ data: { path: "/press/2026/" } });
    expect(created).toBe(true);
  });

  it("odrzuca pustą nazwę bez żądania", async () => {
    const { result } = setup();
    let created: boolean | undefined;
    await act(async () => {
      created = await result.current.doCreateFolder("   ");
    });

    expect(h.serverFns.createMediaFolder).not.toHaveBeenCalled();
    expect(created).toBe(false);
  });

  it("porażka tworzenia zwraca false, żeby dialog został otwarty", async () => {
    h.serverFns.createMediaFolder.mockRejectedValue(new Error("duplikat"));
    const { result } = setup();
    let created: boolean | undefined;
    await act(async () => {
      created = await result.current.doCreateFolder("2026");
    });
    expect(created).toBe(false);
  });

  it("zmiana nazwy folderu buduje nową ścieżkę względem RODZICA", async () => {
    const { result } = setup();
    await act(async () => result.current.doRenameFolder("/press/2026/", "2027"));
    expect(h.serverFns.renameMediaFolder).toHaveBeenCalledWith({
      data: { oldPath: "/press/2026/", newPath: "/press/2027/" },
    });
  });

  it("przepina PODGLĄD, gdy użytkownik stoi w zmienianym folderze", async () => {
    // Bez tego panel zostaje na ścieżce, której już nie ma - pusta lista bez
    // wyjaśnienia.
    const { result, setCurrentPath } = setup({ currentPath: "/press/2026/q1/" });
    await act(async () => result.current.doRenameFolder("/press/", "prasa"));
    expect(setCurrentPath).toHaveBeenCalledWith("/prasa/2026/q1/");
  });

  it("NIE rusza podglądu, gdy użytkownik stoi gdzie indziej", async () => {
    const { result, setCurrentPath } = setup({ currentPath: "/archiwum/" });
    await act(async () => result.current.doRenameFolder("/press/", "prasa"));
    expect(setCurrentPath).not.toHaveBeenCalled();
  });

  it("odrzuca pustą nazwę przy zmianie nazwy folderu", async () => {
    const { result } = setup();
    let renamed: boolean | undefined;
    await act(async () => {
      renamed = await result.current.doRenameFolder("/press/", "  ");
    });
    expect(h.serverFns.renameMediaFolder).not.toHaveBeenCalled();
    expect(renamed).toBe(false);
  });

  it("porażka zmiany nazwy folderu zwraca false", async () => {
    h.serverFns.renameMediaFolder.mockRejectedValue(new Error("konflikt"));
    const { result } = setup();
    let renamed: boolean | undefined;
    await act(async () => {
      renamed = await result.current.doRenameFolder("/press/", "prasa");
    });
    expect(renamed).toBe(false);
  });

  it("kasowanie folderu przenosi podgląd do RODZICA", async () => {
    const { result, setCurrentPath } = setup({ currentPath: "/press/2026/" });
    await act(async () => result.current.doDeleteFolder("/press/", true));

    expect(h.serverFns.deleteMediaFolder).toHaveBeenCalledWith({
      data: { path: "/press/", recursive: true },
    });
    expect(setCurrentPath).toHaveBeenCalledWith("/");
  });

  it("kasowanie folderu spoza ścieżki podglądu go nie rusza", async () => {
    const { result, setCurrentPath } = setup({ currentPath: "/archiwum/" });
    await act(async () => result.current.doDeleteFolder("/press/", false));
    expect(setCurrentPath).not.toHaveBeenCalled();
  });

  it("porażka kasowania folderu daje komunikat, nie wyjątek", async () => {
    h.serverFns.deleteMediaFolder.mockRejectedValue(new Error("folder niepusty"));
    const { result, setCurrentPath } = setup({ currentPath: "/press/" });
    await act(async () => result.current.doDeleteFolder("/press/", false));

    expect(h.toastError).toHaveBeenCalledWith(expect.any(Error), "delete");
    expect(setCurrentPath).not.toHaveBeenCalled();
  });
});

describe("useMediaMutations - opis alternatywny", () => {
  it("zapisuje alt-tekst i unieważnia cache", async () => {
    const { result, invalidate } = setup();
    await act(async () => result.current.updateAlt("a", "Wykres inflacji"));
    expect(h.serverFns.updateMediaMeta).toHaveBeenCalledWith({
      data: { mediaId: "a", altText: "Wykres inflacji" },
    });
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("porażka zapisu alt-tekstu nie unieważnia cache", async () => {
    h.serverFns.updateMediaMeta.mockRejectedValue(new Error("odmowa"));
    const { result, invalidate } = setup();
    await act(async () => result.current.updateAlt("a", "x"));

    expect(h.toastError).toHaveBeenCalledWith(expect.any(Error), "save");
    expect(invalidate).not.toHaveBeenCalled();
  });
});
