// Kawałek „part2" tabeli edytorów bloków: SiteTitleBlock, SiteTaglineBlock, SiteLogoBlock, StepListBlock, ComparisonTableBlock, BannerImageBlock, VideoHeroBlock, CoverBlock, TeamGridBlock, LogoGridBlock, FeatureGridBlock, AlertBannerBlock, DividerTextBlock, ChartBlock, DataMapBlock, DetailsBlock, EmbedBlock.
//
// Cała logika przejazdu (cztery przypadki na edytor, atrapy granic, fixture'y
// wartości ekstremalnych i niepoprawnych) siedzi w `blockEditMatrix.shared.tsx`
// - tu jest wyłącznie wybór podzbioru. PO CO PODZIAŁ i skąd budżet pamięci na
// plik: patrz nagłówek tamtego modułu.
//
// Import modułu wspólnego MUSI być pierwszy: to on niesie fabryki `vi.mock`.
import { defineBlockEditMatrix, editorsOf } from "./blockEditMatrix.shared";

defineBlockEditMatrix(editorsOf("part2"));
