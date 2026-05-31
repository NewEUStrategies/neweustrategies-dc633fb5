import { createFileRoute } from "@tanstack/react-router";
import { AppearanceBuilderPane } from "@/components/admin/AppearanceBuilderPane";

export const Route = createFileRoute("/admin/appearance/menu")({
  component: () => <AppearanceBuilderPane settingsKey="menu_primary" title="Menu główne" scope="menu" />,
});
