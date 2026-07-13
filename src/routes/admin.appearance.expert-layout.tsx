// Wygląd → Strona eksperta.
// Globalny (domyślny) layout hubów eksperta - edytowany builderem, zapis pod
// site_settings.key = 'expert_profile_layout'. Per-ekspert override żyje
// w author_profiles.layout_template_id + layout_overrides (dostępne w dialogu
// „Ustawienia per-ekspert"). Treści (bio, funkcje, kontakt, awatar, media
// społecznościowe) synchronizują się automatycznie z formularzem
// /profile/author - to samo źródło danych (profiles + author_profiles).
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AppearanceBuilderPane } from "@/components/admin/AppearanceBuilderPane";
import { ExpertLayoutSettingsDialog } from "@/components/admin/appearance/ExpertLayoutSettingsDialog";
import { Info } from "lucide-react";

export const Route = createFileRoute("/admin/appearance/expert-layout")({
  component: ExpertLayoutRoute,
});

function ExpertLayoutRoute() {
  const { i18n } = useTranslation();
  const lang = i18n.language?.startsWith("en") ? "en" : "pl";
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight">
            {lang === "pl" ? "Strona eksperta" : "Expert page"}
          </h1>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
            {lang === "pl"
              ? "Zaprojektuj domyślny layout hubu eksperta (/author/:slug). Treści (bio, funkcje, kontakt, awatar, social) pochodzą z profilu użytkownika i są edytowane przez samych ekspertów w "
              : "Design the default expert hub layout (/author/:slug). Content (bio, roles, contact, avatar, socials) comes from the user profile and is edited by experts themselves at "}
            <Link to="/profile/author" className="text-brand underline underline-offset-2">
              /profile/author
            </Link>
            {lang === "pl"
              ? " - zmiany synchronizują się automatycznie."
              : " - changes sync automatically."}
          </p>
        </div>
        <ExpertLayoutSettingsDialog />
      </header>

      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <p>
          {lang === "pl"
            ? "Ten layout jest wspólny dla wszystkich ekspertów. Aby przypisać alternatywny szablon dla wybranej osoby, użyj przycisku „Ustawienia per-ekspert"."
            : "This layout is shared across all experts. Use the „Per-expert settings" dialog to assign an alternate template to a specific person."}
        </p>
      </div>

      <AppearanceBuilderPane
        settingsKey="expert_profile_layout"
        title={lang === "pl" ? "Layout strony eksperta (domyślny)" : "Expert page layout (default)"}
        scope="expert_profile"
      />
    </div>
  );
}
