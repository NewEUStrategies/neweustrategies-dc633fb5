// Trasa panelu globalnych ustawień spisu treści.
//
// Plik trasy trzyma WYŁĄCZNIE rejestrację i kompozycję organizmu - cała treść
// panelu mieszka w `components/admin/postExperience` (podział atoms/molecules/
// organisms), a reguły w `lib/toc/panelRules` i `lib/admin/panelDraft`.
// Powód: panel wpisany w plik trasy nie ma jak dostać testu komponentowego bez
// stawiania routera, więc czterysta linii formularza stało na zerowym pokryciu.
import { createFileRoute } from "@tanstack/react-router";
import { TocSettingsPanel } from "@/components/admin/postExperience/organisms/TocSettingsPanel";

export const Route = createFileRoute("/admin/toc")({
  component: TocSettingsPanel,
});
