import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import type { Selection } from "../organisms/builder";
import { flushChartGridAt } from "@/components/admin/charts/gridKeyboard";

interface Params {
  selection: Selection;
  setSelection: (s: Selection) => void;
  undo: () => void;
  redo: () => void;
  copySelection: () => void;
  cutSelection: () => void;
  pasteFromClipboard: () => void;
  duplicateSection: (id: string) => void;
  duplicateColumn: (id: string) => void;
  duplicateWidget: (id: string) => void;
  askRemoveSection: (id: string) => void;
  askRemoveColumn: (id: string) => void;
  askRemoveWidget: (id: string) => void;
  moveSection: (id: string, dir: -1 | 1) => void;
  onSave?: () => void;
  onToggleNavigator?: () => void;
  // Bulk selection (multi-widget). When `multiSelection.size > 0` the bulk
  // shortcuts take precedence over their single-selection counterparts.
  multiSelection?: ReadonlySet<string>;
  onBulkDelete?: () => void;
  onBulkDuplicate?: () => void;
  onClearMulti?: () => void;
}

export function useBuilderShortcuts(p: Params) {
  const {
    selection,
    setSelection,
    undo,
    redo,
    copySelection,
    cutSelection,
    pasteFromClipboard,
    duplicateSection,
    duplicateColumn,
    duplicateWidget,
    askRemoveSection,
    askRemoveColumn,
    askRemoveWidget,
    moveSection,
    onSave,
    onToggleNavigator,
    multiSelection,
    onBulkDelete,
    onBulkDuplicate,
    onClearMulti,
  } = p;
  const multiSize = multiSelection?.size ?? 0;
  // Cofnięcie i ponowienie z NAJŚWIEŻSZEGO renderu - po opróżnieniu arkusza
  // wykresu (niżej) domknięcie z chwili wciśnięcia klawisza nie widzi kroku,
  // który właśnie wszedł do historii.
  const latest = useRef({ undo, redo });
  latest.current = { undo, redo };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isEditable =
        tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;
      const k = (e.key ?? "").toLowerCase();
      if (!k) return;

      // Undo/redo/save always work, even inside property inputs.
      //
      // Arkusz danych wykresu odkłada zapis pisanej etykiety o kilkadziesiąt
      // milisekund; Ctrl+Z wciśnięty w tym oknie cofnąłby zmianę SPRZED niej,
      // a odłożony zapis wróciłby zaraz potem. Dlatego przed cofnięciem
      // (i ponowieniem) siatka, w której stoi fokus, wysyła zapis od razu.
      //
      // Zapis wysłany TERAZ trafia do historii przez stan Reacta, więc
      // `undo` z tego renderu go nie widzi: przy pierwszej edycji `canUndo`
      // było jeszcze fałszem (Ctrl+Z tylko zapisywał etykietę), a etykieta
      // komunikatu należała do kroku wcześniejszego. `flushSync` przerysowuje
      // builder od razu, a cofnięcie bierze funkcję z tego nowego renderu.
      const poOproznieniu = (run: () => void, pick: () => () => void) => {
        let wyslano = false;
        flushSync(() => {
          wyslano = flushChartGridAt(e.target);
        });
        if (wyslano) pick()();
        else run();
      };
      if (mod && k === "z" && !e.shiftKey) {
        e.preventDefault();
        poOproznieniu(undo, () => latest.current.undo);
        return;
      }
      if (mod && (k === "y" || (e.shiftKey && k === "z"))) {
        e.preventDefault();
        poOproznieniu(redo, () => latest.current.redo);
        return;
      }
      if (mod && k === "s" && onSave) {
        e.preventDefault();
        onSave();
        return;
      }

      // Remaining shortcuts must not hijack normal text editing inside inputs.
      if (isEditable) return;

      // Bulk-selection shortcuts. When multi has entries these fire first and
      // completely bypass single-selection paths so Delete never removes only
      // the "focused" widget when the visible bar shows N > 1.
      if (multiSize > 0) {
        if ((e.key === "Delete" || e.key === "Backspace") && onBulkDelete) {
          e.preventDefault();
          onBulkDelete();
          return;
        }
        if (mod && k === "d" && onBulkDuplicate) {
          e.preventDefault();
          onBulkDuplicate();
          return;
        }
        if (e.key === "Escape" && onClearMulti) {
          onClearMulti();
          return;
        }
      }

      if (mod && k === "c") {
        copySelection();
        return;
      }
      if (mod && k === "x") {
        e.preventDefault();
        cutSelection();
        return;
      }
      if (mod && k === "v") {
        e.preventDefault();
        pasteFromClipboard();
        return;
      }
      if (mod && k === "d" && selection.id) {
        e.preventDefault();
        if (selection.kind === "section") duplicateSection(selection.id);
        else if (selection.kind === "column") duplicateColumn(selection.id);
        else if (selection.kind === "widget") duplicateWidget(selection.id);
        return;
      }
      if (mod && e.shiftKey && k === "n" && onToggleNavigator) {
        e.preventDefault();
        onToggleNavigator();
        return;
      }
      if (
        e.altKey &&
        (k === "arrowup" || k === "arrowdown") &&
        selection.kind === "section" &&
        selection.id
      ) {
        e.preventDefault();
        moveSection(selection.id, k === "arrowup" ? -1 : 1);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selection.id) {
        e.preventDefault();
        if (selection.kind === "section") askRemoveSection(selection.id);
        else if (selection.kind === "column") askRemoveColumn(selection.id);
        else if (selection.kind === "widget") askRemoveWidget(selection.id);
        return;
      }
      if (e.key === "Escape") setSelection({ kind: null, id: null });
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    undo,
    redo,
    copySelection,
    cutSelection,
    pasteFromClipboard,
    selection,
    setSelection,
    duplicateSection,
    duplicateColumn,
    duplicateWidget,
    askRemoveSection,
    askRemoveColumn,
    askRemoveWidget,
    moveSection,
    onSave,
    onToggleNavigator,
    multiSize,
    onBulkDelete,
    onBulkDuplicate,
    onClearMulti,
  ]);
}
