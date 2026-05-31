import { createFileRoute } from "@tanstack/react-router";
import { AppearanceBuilderPane } from "@/components/admin/AppearanceBuilderPane";

export const Route = createFileRoute("/admin/appearance/header")({
  component: () => <AppearanceBuilderPane settingsKey="header" title="Nagłówek" />,
});
