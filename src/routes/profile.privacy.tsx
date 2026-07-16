// Profile privacy page: zalogowany użytkownik może zmieniać zgody, które są
// synchronizowane z profiles.prefs.consent (admin widzi je w panelu użytkownika).
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useConsent, type ConsentCategory } from "@/lib/ads/consent";

export const Route = createFileRoute("/profile/privacy")({
  component: PrivacyPage,
});

const CATS: {
  key: ConsentCategory;
  labelPl: string;
  labelEn: string;
  descPl: string;
  descEn: string;
}[] = [
  {
    key: "necessary",
    labelPl: "Niezbędne",
    labelEn: "Necessary",
    descPl: "Wymagane do działania serwisu.",
    descEn: "Required for the site to function.",
  },
  {
    key: "functional",
    labelPl: "Funkcjonalne",
    labelEn: "Functional",
    descPl: "Preferencje, personalizacja.",
    descEn: "Preferences, personalization.",
  },
  {
    key: "analytics",
    labelPl: "Analityczne",
    labelEn: "Analytics",
    descPl: "Statystyki ruchu (GA/Plausible).",
    descEn: "Traffic analytics (GA/Plausible).",
  },
  {
    key: "marketing",
    labelPl: "Marketingowe",
    labelEn: "Marketing",
    descPl: "Reklama i remarketing.",
    descEn: "Advertising and remarketing.",
  },
];

function PrivacyPage() {
  const { t, i18n } = useTranslation();
  const { state, save } = useConsent();
  const isEn = i18n.language?.startsWith("en");
  const cats = state?.categories ?? {
    necessary: true,
    functional: false,
    analytics: false,
    marketing: false,
  };

  return (
    <div className="max-w-2xl">
      <h2 className="font-display text-2xl font-bold mb-2">
        {t("profile.privacy.title", {
          defaultValue: isEn ? "Privacy & consent" : "Prywatność i zgody",
        })}
      </h2>
      <p className="text-sm text-muted-foreground mb-6">
        {t("profile.privacy.hint", {
          defaultValue: isEn
            ? "Your choices persist across visits and sync to your profile."
            : "Twoje wybory są zapisywane i synchronizowane z profilem.",
        })}
      </p>
      <div className="space-y-3">
        {CATS.map((c) => (
          <label
            key={c.key}
            className="flex items-start justify-between gap-4 rounded-lg border border-border bg-background p-4"
          >
            <div className="min-w-0">
              <div className="text-sm font-bold text-foreground">
                {isEn ? c.labelEn : c.labelPl}
              </div>
              <div className="text-xs text-muted-foreground">{isEn ? c.descEn : c.descPl}</div>
            </div>
            <input
              type="checkbox"
              className="h-5 w-5 accent-foreground"
              disabled={c.key === "necessary"}
              checked={!!cats[c.key]}
              onChange={(e) => save({ ...cats, [c.key]: e.target.checked })}
            />
          </label>
        ))}
      </div>
    </div>
  );
}
