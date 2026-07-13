// Public disabled-state screen dla modułów Community, gdy toggle w
// site_settings.community_modules jest wyłączony.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import "@/lib/i18n-community";

export function CommunityDisabled() {
  const { t } = useTranslation();
  return (
    <div className="container mx-auto max-w-2xl px-4 py-24 text-center">
      <h1 className="text-3xl font-bold tracking-tight">{t("community.disabled.title")}</h1>
      <p className="mt-4 text-muted-foreground">{t("community.disabled.body")}</p>
      <Button asChild className="mt-8">
        <Link to="/">{t("community.disabled.cta")}</Link>
      </Button>
    </div>
  );
}
