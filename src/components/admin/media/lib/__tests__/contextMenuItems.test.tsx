// Dostępność akcji w menu kontekstowym per typ celu: plik, folder, puste
// płótno - i osobno per KSZTAŁT ZAZNACZENIA (pojedynczy plik vs zaznaczenie
// wielokrotne). Reguła siedziała w ciele `MediaManager.tsx`, w funkcji
// zagnieżdżonej PO `return`, więc stała na zerze razem z całym organizmem.
//
// Najważniejszy przypadek to `disabled` przy zmianie nazwy: prawym na jeden z
// pięciu zaznaczonych plików nie może otwierać pola „nowa nazwa”, bo jednej
// nazwy nie da się nadać pięciu plikom. Regresja tej gałęzi nie wywala nic -
// daje po cichu pięć plików o tej samej nazwie.
import { describe, expect, it, vi } from "vitest";
import { buildContextMenuItems, type ContextMenuDeps } from "../contextMenuItems";
import type { ContextMenuItem, ContextMenuState, MediaRow } from "../../types";

function row(id: string): MediaRow {
  return {
    id,
    tenant_id: "t1",
    storage_path: `t1/u/${id}.png`,
    public_url: `https://cdn.example/${id}.png`,
    filename: `${id}.png`,
    mime_type: "image/png",
    size_bytes: 10,
    uploader_id: "u",
    created_at: "2026-01-01T00:00:00.000Z",
    folder_path: "/",
    alt_text: null,
  };
}

const MEDIA = [row("a"), row("b"), row("c")];

function deps(overrides: Partial<ContextMenuDeps> = {}) {
  const spies = {
    openFile: vi.fn(),
    copyUrl: vi.fn(),
    download: vi.fn(),
    beginRename: vi.fn(),
    showInfo: vi.fn(),
    requestDeleteFiles: vi.fn(),
    copy: vi.fn(),
    cut: vi.fn(),
    openFolder: vi.fn(),
    beginRenameFolder: vi.fn(),
    requestDeleteFolder: vi.fn(),
    newFolder: vi.fn(),
    uploadFiles: vi.fn(),
    paste: vi.fn(),
    selectAll: vi.fn(),
  };
  const full: ContextMenuDeps = {
    t: (key: string) => key,
    media: MEDIA,
    selectedIds: new Set<string>(),
    canPaste: false,
    ...spies,
    ...overrides,
  };
  return { full, spies };
}

function at(x: number, y: number, target: ContextMenuState["target"], targetId?: string) {
  return { x, y, target, targetId } satisfies ContextMenuState;
}

/** Etykiety pozycji z pominięciem separatorów. */
function labels(items: ContextMenuItem[]): string[] {
  return items.filter((i) => !i.separator).map((i) => i.label ?? "");
}

function find(items: ContextMenuItem[], label: string): ContextMenuItem {
  const item = items.find((i) => i.label === label);
  if (!item) throw new Error(`brak pozycji „${label}” w menu: ${labels(items).join(", ")}`);
  return item;
}

describe("buildContextMenuItems - menu PLIKU", () => {
  it("oferuje pełny zestaw akcji pliku w ustalonej kolejności", () => {
    const { full } = deps({ selectedIds: new Set(["a"]) });
    expect(labels(buildContextMenuItems(at(0, 0, "file", "a"), full))).toEqual([
      "admin.media.open",
      "admin.media.rename",
      "admin.media.getInfo",
      "admin.media.copyUrl",
      "admin.media.download",
      "admin.media.copy",
      "admin.media.cutAction",
      "admin.delete",
    ]);
  });

  it("kasowanie jest oznaczone jako destrukcyjne", () => {
    const { full } = deps();
    expect(find(buildContextMenuItems(at(0, 0, "file", "a"), full), "admin.delete").danger).toBe(
      true,
    );
  });

  it("otwarcie, kopiowanie adresu i pobranie dostają WŁAŚCIWY wiersz", () => {
    const { full, spies } = deps();
    const items = buildContextMenuItems(at(0, 0, "file", "b"), full);
    find(items, "admin.media.open").onSelect?.();
    find(items, "admin.media.copyUrl").onSelect?.();
    find(items, "admin.media.download").onSelect?.();

    expect(spies.openFile).toHaveBeenCalledWith(MEDIA[1]);
    expect(spies.copyUrl).toHaveBeenCalledWith(MEDIA[1]);
    expect(spies.download).toHaveBeenCalledWith(MEDIA[1]);
  });

  it("akcje wierszowe MILCZĄ, gdy plik zniknął z listy", () => {
    // Menu bywa otwarte, gdy w tle wraca odświeżenie listy. Bez strażnika
    // `if (row)` te akcje wywróciłyby panel na `undefined`.
    const { full, spies } = deps();
    const items = buildContextMenuItems(at(0, 0, "file", "nieistnieje"), full);
    expect(() => {
      find(items, "admin.media.open").onSelect?.();
      find(items, "admin.media.copyUrl").onSelect?.();
      find(items, "admin.media.download").onSelect?.();
    }).not.toThrow();
    expect(spies.openFile).not.toHaveBeenCalled();
  });

  it("podgląd informacji zawęża zaznaczenie do klikniętego pliku", () => {
    const { full, spies } = deps({ selectedIds: new Set(["a", "b"]) });
    find(buildContextMenuItems(at(0, 0, "file", "a"), full), "admin.media.getInfo").onSelect?.();
    expect(spies.showInfo).toHaveBeenCalledWith("a");
  });
});

describe("buildContextMenuItems - kształt zaznaczenia", () => {
  it("przy POJEDYNCZYM pliku zmiana nazwy jest dostępna", () => {
    const { full } = deps({ selectedIds: new Set(["a"]) });
    expect(
      find(buildContextMenuItems(at(0, 0, "file", "a"), full), "admin.media.rename").disabled,
    ).toBe(false);
  });

  it("przy zaznaczeniu WIELOKROTNYM zmiana nazwy jest WYŁĄCZONA", () => {
    // Jednej nazwy nie da się nadać pięciu plikom - bez tej gałęzi panel
    // po cichu nadałby wszystkim tę samą.
    const { full } = deps({ selectedIds: new Set(["a", "b"]) });
    expect(
      find(buildContextMenuItems(at(0, 0, "file", "a"), full), "admin.media.rename").disabled,
    ).toBe(true);
  });

  it("kliknięcie pliku NALEŻĄCEGO do zaznaczenia działa na CAŁYM zaznaczeniu", () => {
    const { full, spies } = deps({ selectedIds: new Set(["a", "b"]) });
    const items = buildContextMenuItems(at(0, 0, "file", "a"), full);
    find(items, "admin.media.copy").onSelect?.();
    find(items, "admin.delete").onSelect?.();

    expect(new Set(spies.copy.mock.calls[0][0] as string[])).toEqual(new Set(["a", "b"]));
    expect(new Set(spies.requestDeleteFiles.mock.calls[0][0] as string[])).toEqual(
      new Set(["a", "b"]),
    );
  });

  it("kliknięcie pliku SPOZA zaznaczenia działa TYLKO na nim", () => {
    // Inaczej prawym na niezaznaczony plik kasowałoby cudzy, wcześniejszy wybór
    // - operacja nieodwracalna na zbiorze, którego użytkownik nie wskazał.
    const { full, spies } = deps({ selectedIds: new Set(["a", "b"]) });
    const items = buildContextMenuItems(at(0, 0, "file", "c"), full);
    find(items, "admin.delete").onSelect?.();
    expect(spies.requestDeleteFiles).toHaveBeenCalledWith(["c"]);
  });

  it("pojedyncze zaznaczenie NIE jest traktowane jak wielokrotne", () => {
    const { full, spies } = deps({ selectedIds: new Set(["a"]) });
    find(buildContextMenuItems(at(0, 0, "file", "a"), full), "admin.media.cutAction").onSelect?.();
    expect(spies.cut).toHaveBeenCalledWith(["a"]);
  });

  it("puste zaznaczenie działa na klikniętym pliku", () => {
    const { full, spies } = deps({ selectedIds: new Set<string>() });
    find(buildContextMenuItems(at(0, 0, "file", "b"), full), "admin.media.copy").onSelect?.();
    expect(spies.copy).toHaveBeenCalledWith(["b"]);
  });
});

describe("buildContextMenuItems - menu FOLDERU", () => {
  it("oferuje otwarcie, zmianę nazwy i kasowanie - bez akcji plikowych", () => {
    const { full } = deps();
    const items = buildContextMenuItems(at(0, 0, "folder", "/press/2026/"), full);
    expect(labels(items)).toEqual(["admin.media.open", "admin.media.rename", "admin.delete"]);
    // Schowek i pobieranie nie mają sensu dla folderu wirtualnego.
    expect(labels(items)).not.toContain("admin.media.copy");
    expect(labels(items)).not.toContain("admin.media.download");
  });

  it("otwarcie folderu przechodzi do jego ścieżki", () => {
    const { full, spies } = deps();
    find(
      buildContextMenuItems(at(0, 0, "folder", "/press/2026/"), full),
      "admin.media.open",
    ).onSelect?.();
    expect(spies.openFolder).toHaveBeenCalledWith("/press/2026/");
  });

  it("zmiana nazwy podpowiada OSTATNI segment ścieżki, nie całą ścieżkę", () => {
    // Wstawienie całej ścieżki do pola zamieniłoby zmianę nazwy w przeniesienie.
    const { full, spies } = deps();
    find(
      buildContextMenuItems(at(0, 0, "folder", "/press/2026/"), full),
      "admin.media.rename",
    ).onSelect?.();
    expect(spies.beginRenameFolder).toHaveBeenCalledWith("/press/2026/", "2026");
  });

  it("zmiana nazwy folderu NIE jest wyłączana przez zaznaczenie plików", () => {
    const { full } = deps({ selectedIds: new Set(["a", "b"]) });
    expect(
      find(buildContextMenuItems(at(0, 0, "folder", "/press/"), full), "admin.media.rename")
        .disabled,
    ).toBeUndefined();
  });

  it("kasowanie folderu prosi o potwierdzenie dla jego ścieżki", () => {
    const { full, spies } = deps();
    find(buildContextMenuItems(at(0, 0, "folder", "/press/"), full), "admin.delete").onSelect?.();
    expect(spies.requestDeleteFolder).toHaveBeenCalledWith("/press/");
  });
});

describe("buildContextMenuItems - menu PUSTEGO płótna", () => {
  it("oferuje wyłącznie akcje kontekstu, nie akcje zaznaczenia", () => {
    const { full } = deps();
    expect(labels(buildContextMenuItems(at(0, 0, "empty"), full))).toEqual([
      "admin.media.newFolder",
      "admin.media.uploadFiles",
      "admin.media.paste",
      "admin.media.selectAll",
    ]);
  });

  it("wklejanie jest WYŁĄCZONE przy pustym schowku, ale WIDOCZNE", () => {
    // Ukrycie pozycji zabrałoby użytkownikowi informację, że taka akcja istnieje.
    const { full } = deps({ canPaste: false });
    const item = find(buildContextMenuItems(at(0, 0, "empty"), full), "admin.media.paste");
    expect(item.disabled).toBe(true);
    expect(item.shortcut).toBe("⌘V");
  });

  it("wklejanie jest dostępne przy pełnym schowku", () => {
    const { full, spies } = deps({ canPaste: true });
    const item = find(buildContextMenuItems(at(0, 0, "empty"), full), "admin.media.paste");
    expect(item.disabled).toBe(false);
    item.onSelect?.();
    expect(spies.paste).toHaveBeenCalledTimes(1);
  });

  it("nowy folder, wgrywanie i zaznacz wszystko trafiają we właściwe akcje", () => {
    const { full, spies } = deps();
    const items = buildContextMenuItems(at(0, 0, "empty"), full);
    find(items, "admin.media.newFolder").onSelect?.();
    find(items, "admin.media.uploadFiles").onSelect?.();
    find(items, "admin.media.selectAll").onSelect?.();

    expect(spies.newFolder).toHaveBeenCalledTimes(1);
    expect(spies.uploadFiles).toHaveBeenCalledTimes(1);
    expect(spies.selectAll).toHaveBeenCalledTimes(1);
  });

  it("cel „plik” BEZ identyfikatora spada do menu płótna", () => {
    // Gałąź obronna: stan menu bez `targetId` nie może dać pustej listy, bo
    // użytkownik zobaczyłby puste okienko bez wyjścia.
    const { full } = deps();
    expect(labels(buildContextMenuItems(at(0, 0, "file"), full))[0]).toBe("admin.media.newFolder");
    expect(labels(buildContextMenuItems(at(0, 0, "folder"), full))[0]).toBe(
      "admin.media.newFolder",
    );
  });
});

describe("buildContextMenuItems - separatory", () => {
  it("menu pliku ma trzy separatory grupujące akcje", () => {
    const { full } = deps();
    const items = buildContextMenuItems(at(0, 0, "file", "a"), full);
    expect(items.filter((i) => i.separator)).toHaveLength(3);
    // Separator nigdy nie jest pozycją klikalną.
    for (const sep of items.filter((i) => i.separator)) {
      expect(sep.label).toBeUndefined();
      expect(sep.onSelect).toBeUndefined();
    }
  });

  it("menu folderu i płótna mają po jednym separatorze", () => {
    const { full } = deps();
    expect(
      buildContextMenuItems(at(0, 0, "folder", "/press/"), full).filter((i) => i.separator),
    ).toHaveLength(1);
    expect(buildContextMenuItems(at(0, 0, "empty"), full).filter((i) => i.separator)).toHaveLength(
      1,
    );
  });

  it("każda pozycja klikalna ma etykietę", () => {
    const { full } = deps();
    for (const cm of [
      at(0, 0, "file", "a"),
      at(0, 0, "folder", "/press/"),
      at(0, 0, "empty"),
    ] as const) {
      for (const item of buildContextMenuItems(cm, full)) {
        if (item.separator) continue;
        expect(item.label).toBeTruthy();
        expect(item.onSelect).toBeTypeOf("function");
      }
    }
  });
});
