// Kawałek „part2" tabeli edytorów treści widgetów: EventCountdownCardEditor,
// EventCountdownEditor, EventScheduleEditor, ImageEditor, InteractiveCircleEditor.
//
// Cała logika przejazdu (bloki, fixture'y, podmiany) siedzi w
// `editorMatrix.shared.tsx` - tu jest tylko wybór podzbioru edytorów. PO CO
// PODZIAŁ i skąd budżet pamięci na plik: patrz nagłówek tamtego modułu.
//
// Import modułu wspólnego MUSI być pierwszy: to on niesie fabryki `vi.mock`.
import { defineEditorMatrix, editorsOf } from "./editorMatrix.shared";

defineEditorMatrix(editorsOf("part2"));
