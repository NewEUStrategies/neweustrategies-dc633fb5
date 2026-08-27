// Kawałek „part4" tabeli edytorów treści widgetów: PricingEditor, ProgressCarouselEditor,
// RatedListEditor, RichTextEditor, SectionLabelEditor.
//
// Cała logika przejazdu (bloki, fixture'y, podmiany) siedzi w
// `editorMatrix.shared.tsx` - tu jest tylko wybór podzbioru edytorów. PO CO
// PODZIAŁ i skąd budżet pamięci na plik: patrz nagłówek tamtego modułu.
//
// Import modułu wspólnego MUSI być pierwszy: to on niesie fabryki `vi.mock`.
import { defineEditorMatrix, editorsOf } from "./editorMatrix.shared";

defineEditorMatrix(editorsOf("part4"));
