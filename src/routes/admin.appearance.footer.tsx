import { createFileRoute } from "@tanstack/react-router";
import { AppearanceBuilderPane } from "@/components/admin/AppearanceBuilderPane";

export const Route = createFileRoute("/admin/appearance/footer")({
  component: () => <AppearanceBuilderPane settingsKey="footer" title="Stopka" />,
});
