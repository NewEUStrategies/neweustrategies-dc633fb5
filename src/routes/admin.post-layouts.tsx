// Trasa panelu globalnych układów wpisu.
//
// Plik trasy trzyma WYŁĄCZNIE rejestrację i kompozycję organizmu - treść panelu
// mieszka w `components/admin/postExperience`, a reguły w
// `lib/post/layoutPanelRules` oraz `lib/admin/panelDraft`.
import { createFileRoute } from "@tanstack/react-router";
import { PostLayoutsSettingsPanel } from "@/components/admin/postExperience/organisms/PostLayoutsSettingsPanel";

export const Route = createFileRoute("/admin/post-layouts")({
  component: PostLayoutsSettingsPanel,
});
