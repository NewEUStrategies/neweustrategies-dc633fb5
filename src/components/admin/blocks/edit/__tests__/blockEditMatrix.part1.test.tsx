// Kawałek „part1" tabeli edytorów bloków: AffiliateBlock, ArchivesBlock, AudioBlock, ButtonBlock, ButtonsBlock, CalendarBlock, CalloutBlock, CategoriesListBlock, CodeBlock, ColumnsBlock, CompareBlock, PostTitleBlock, PostDateBlock, PostAuthorBlock, PostExcerptBlock, PostFeaturedImageBlock, PostTermsBlock.
//
// Cała logika przejazdu (cztery przypadki na edytor, atrapy granic, fixture'y
// wartości ekstremalnych i niepoprawnych) siedzi w `blockEditMatrix.shared.tsx`
// - tu jest wyłącznie wybór podzbioru. PO CO PODZIAŁ i skąd budżet pamięci na
// plik: patrz nagłówek tamtego modułu.
//
// Import modułu wspólnego MUSI być pierwszy: to on niesie fabryki `vi.mock`.
import { defineBlockEditMatrix, editorsOf } from "./blockEditMatrix.shared";

defineBlockEditMatrix(editorsOf("part1"));
