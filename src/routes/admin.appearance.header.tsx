import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AppearanceBuilderPane } from "@/components/admin/AppearanceBuilderPane";
import { ensureI18n as ensureAdminAppearanceRoutesI18n } from "@/lib/i18n-admin-appearance-routes";
export const Route = createFileRoute("/admin/appearance/header")({
  component: HeaderAppearance,
});

function HeaderAppearance() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureAdminAppearanceRoutesI18n();
  const { t } = useTranslation();
  return (
    <AppearanceBuilderPane
      settingsKey="header"
      title={t("adminAppearanceRoutes.header.title")}
      scope="header"
    />
  );
}
