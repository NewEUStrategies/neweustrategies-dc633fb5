// Zunifikowane centrum prywatności (audyt M15: "Zunifikować zgody w
// /profile/privacy"). Jedna powierzchnia dla WSZYSTKICH zgód zalogowanego
// użytkownika:
// - kategorie cookie CMP (dwukierunkowo spięte z banerem przez ConsentsPanel),
// - zgody komunikacji/produktu/analityki z katalogu,
// - niezmienna historia decyzji z rejestru RODO (data, wersja, źródło).
// Każda zmiana przechodzi przez audytowaną ścieżkę: CMP -> registryBridge ->
// set_user_consent (IP/UA czytane serwerowo), albo wprost set_user_consent.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Cookie, ShieldCheck } from "lucide-react";
import { ConsentsPanel } from "@/components/notifications/ConsentsPanel";
import { OPEN_PREFS_EVENT } from "@/lib/ads/consent";

export const Route = createFileRoute("/profile/privacy")({
  component: PrivacyPage,
});

function PrivacyPage() {
  const { t } = useTranslation();

  const openBannerPreferences = () => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(OPEN_PREFS_EVENT));
    }
  };

  return (
    <div className="max-w-3xl">
      <h2 className="font-display text-2xl font-bold mb-2">{t("profile.privacy.title")}</h2>
      <p className="text-sm text-muted-foreground mb-4">{t("profile.privacy.hint")}</p>

      <div className="mb-6 flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <span
            aria-hidden
            className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
          >
            <ShieldCheck className="h-4 w-4" />
          </span>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("profile.privacy.registryNote")}
          </p>
        </div>
        <button
          type="button"
          onClick={openBannerPreferences}
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
        >
          <Cookie className="h-3.5 w-3.5" aria-hidden />
          {t("profile.privacy.openBanner")}
        </button>
      </div>

      <ConsentsPanel source="profile_privacy" />
    </div>
  );
}
