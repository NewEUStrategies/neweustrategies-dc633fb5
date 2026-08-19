// Reguła DOSTĘPNOŚCI AKCJI w menu kontekstowym menedżera mediów.
//
// DLACZEGO OSOBNY MODUŁ. To jest czysta reguła („co wolno zrobić z tym, co
// kliknięto"), która do 18.08.2026 siedziała w ciele `MediaManager.tsx` - w
// funkcji zagnieżdżonej PO instrukcji `return`, czyli za zasięgiem czegokolwiek
// poza wyrenderowaniem całego organizmu z routerem, sesją i react-query.
// Efekt: 149 linii `MediaManager.tsx` stało na zerze, a wraz z nimi reguła
// decydująca m.in. o tym, czy „Zmień nazwę” jest wyłączone przy zaznaczeniu
// wielokrotnym (jest - nie da się nadać jednej nazwy pięciu plikom naraz).
//
// EKSTRAKCJA JEST NEUTRALNA: te same etykiety, ta sama kolejność pozycji, te
// same separatory, ta sama logika `many`/`idsForBatch`.
import type { ReactNode } from "react";
import {
  Pencil,
  Info,
  Copy,
  Scissors,
  Download,
  Trash2,
  FolderPlus,
  Upload,
  ClipboardPaste,
} from "@/lib/lucide-shim";
import type { ContextMenuItem, ContextMenuState, MediaRow } from "../types";
import "@/lib/i18n-admin-media";
import { folderName } from "./mediaPaths";

/** Wszystko, czego reguła potrzebuje od organizmu - żadnego stanu własnego. */
export interface ContextMenuDeps {
  t: (key: string) => string;
  media: readonly MediaRow[];
  selectedIds: ReadonlySet<string>;
  canPaste: boolean;
  /** Otwiera plik w nowej karcie. */
  openFile: (row: MediaRow) => void;
  /** Kopiuje adres publiczny do schowka systemowego. */
  copyUrl: (row: MediaRow) => void;
  /** Pobiera plik na dysk. */
  download: (row: MediaRow) => void;
  beginRename: (id: string) => void;
  showInfo: (id: string) => void;
  requestDeleteFiles: (ids: string[]) => void;
  copy: (ids: string[]) => void;
  cut: (ids: string[]) => void;
  openFolder: (path: string) => void;
  beginRenameFolder: (path: string, suggestedName: string) => void;
  requestDeleteFolder: (path: string) => void;
  newFolder: () => void;
  uploadFiles: () => void;
  paste: () => void;
  selectAll: () => void;
}

const icon = (node: ReactNode): ReactNode => node;

export function buildContextMenuItems(
  cm: ContextMenuState,
  deps: ContextMenuDeps,
): ContextMenuItem[] {
  const { t } = deps;

  if (cm.target === "file" && cm.targetId) {
    const id = cm.targetId;
    const row = deps.media.find((m) => m.id === id);
    // Kliknięcie prawym na plik NALEŻĄCY do zaznaczenia wielokrotnego działa na
    // całym zaznaczeniu; na plik spoza zaznaczenia - tylko na nim.
    const many = deps.selectedIds.size > 1 && deps.selectedIds.has(id);
    const idsForBatch = many ? Array.from(deps.selectedIds) : [id];
    return [
      {
        label: t("admin.media.open"),
        onSelect: () => {
          if (row) deps.openFile(row);
        },
      },
      {
        label: t("admin.media.rename"),
        icon: icon(<Pencil className="w-3.5 h-3.5" />),
        // Jednej nazwy nie da się nadać wielu plikom naraz.
        disabled: many,
        onSelect: () => deps.beginRename(id),
      },
      {
        label: t("admin.media.getInfo"),
        icon: icon(<Info className="w-3.5 h-3.5" />),
        onSelect: () => deps.showInfo(id),
      },
      { separator: true },
      {
        label: t("admin.media.copyUrl"),
        icon: icon(<Copy className="w-3.5 h-3.5" />),
        onSelect: () => {
          if (row) deps.copyUrl(row);
        },
      },
      {
        label: t("admin.media.download"),
        icon: icon(<Download className="w-3.5 h-3.5" />),
        onSelect: () => {
          if (row) deps.download(row);
        },
      },
      { separator: true },
      {
        label: t("admin.media.copy"),
        shortcut: "⌘C",
        onSelect: () => deps.copy(idsForBatch),
      },
      {
        label: t("admin.media.cutAction"),
        icon: icon(<Scissors className="w-3.5 h-3.5" />),
        shortcut: "⌘X",
        onSelect: () => deps.cut(idsForBatch),
      },
      { separator: true },
      {
        label: t("admin.delete"),
        icon: icon(<Trash2 className="w-3.5 h-3.5" />),
        danger: true,
        onSelect: () => deps.requestDeleteFiles(idsForBatch),
      },
    ];
  }

  if (cm.target === "folder" && cm.targetId) {
    const path = cm.targetId;
    return [
      {
        label: t("admin.media.open"),
        onSelect: () => deps.openFolder(path),
      },
      {
        label: t("admin.media.rename"),
        icon: icon(<Pencil className="w-3.5 h-3.5" />),
        onSelect: () => deps.beginRenameFolder(path, folderName(path)),
      },
      { separator: true },
      {
        label: t("admin.delete"),
        icon: icon(<Trash2 className="w-3.5 h-3.5" />),
        danger: true,
        onSelect: () => deps.requestDeleteFolder(path),
      },
    ];
  }

  // Puste płótno.
  return [
    {
      label: t("admin.media.newFolder"),
      icon: icon(<FolderPlus className="w-3.5 h-3.5" />),
      onSelect: deps.newFolder,
    },
    {
      label: t("admin.media.uploadFiles"),
      icon: icon(<Upload className="w-3.5 h-3.5" />),
      onSelect: deps.uploadFiles,
    },
    { separator: true },
    {
      label: t("admin.media.paste"),
      icon: icon(<ClipboardPaste className="w-3.5 h-3.5" />),
      shortcut: "⌘V",
      // Wklejanie przy pustym schowku jest widoczne, ale wyłączone - użytkownik
      // ma wiedzieć, że akcja istnieje.
      disabled: !deps.canPaste,
      onSelect: deps.paste,
    },
    {
      label: t("admin.media.selectAll"),
      shortcut: "⌘A",
      onSelect: deps.selectAll,
    },
  ];
}
