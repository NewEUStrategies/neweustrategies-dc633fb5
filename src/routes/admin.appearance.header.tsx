import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AppearanceBuilderPane } from "@/components/admin/AppearanceBuilderPane";
import "@/lib/i18n-admin-appearance-routes";

export const Route = createFileRoute("/admin/appearance/header")({
  component: HeaderAppearance,
});

function HeaderAppearance() {
  const { t } = useTranslation();
  return (
    <AppearanceBuilderPane
      settingsKey="header"
      title={t("adminAppearanceRoutes.header.title")}
      scope="header"
    />
  );
}
