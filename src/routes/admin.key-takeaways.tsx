// Trasa panelu globalnych ustawień sekcji „Z tego artykułu dowiesz się…".
//
// Plik trasy trzyma WYŁĄCZNIE rejestrację i kompozycję organizmu - treść panelu
// mieszka w `components/admin/postExperience`, a reguły w
// `lib/keyTakeaways/panelRules` oraz `lib/admin/panelDraft`.
import { createFileRoute } from "@tanstack/react-router";
import { KeyTakeawaysSettingsPanel } from "@/components/admin/postExperience/organisms/KeyTakeawaysSettingsPanel";

export const Route = createFileRoute("/admin/key-takeaways")({
  component: KeyTakeawaysSettingsPanel,
});
