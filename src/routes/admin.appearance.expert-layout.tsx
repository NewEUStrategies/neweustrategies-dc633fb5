// Globalny (domyślny) layout strony eksperta - edytowany builderem, zapis pod
// site_settings.key = 'expert_profile_layout'. Per-ekspert override żyje
// w author_profiles.layout_template_id + layout_overrides (dostępne w dialogu).
import { createFileRoute } from "@tanstack/react-router";
import { AppearanceBuilderPane } from "@/components/admin/AppearanceBuilderPane";
import { ExpertLayoutSettingsDialog } from "@/components/admin/appearance/ExpertLayoutSettingsDialog";

export const Route = createFileRoute("/admin/appearance/expert-layout")({
  component: ExpertLayoutRoute,
});

function ExpertLayoutRoute() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <ExpertLayoutSettingsDialog />
      </div>
      <AppearanceBuilderPane
        settingsKey="expert_profile_layout"
        title="Layout strony eksperta (domyślny)"
        scope="expert_profile"
      />
    </div>
  );
}
