// Globalny (domyślny) layout strony eksperta - edytowany builderem, zapis pod
// site_settings.key = 'expert_profile_layout'. Per-ekspert override żyje
// w author_profiles.layout_template_id + layout_overrides.
import { createFileRoute } from "@tanstack/react-router";
import { AppearanceBuilderPane } from "@/components/admin/AppearanceBuilderPane";

export const Route = createFileRoute("/admin/appearance/expert-layout")({
  component: () => (
    <AppearanceBuilderPane
      settingsKey="expert_profile_layout"
      title="Layout strony eksperta (domyślny)"
      scope="expert_profile"
    />
  ),
});
