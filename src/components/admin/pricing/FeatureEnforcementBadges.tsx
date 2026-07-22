// Podgląd egzekwowania flag warstwy: parsuje `features` (obiekt lub string JSON)
// i pokazuje, które flagi mają realną bramkę (Egzekwowana), a które są dziś
// czystą deklaracją marketingową (Dekoracyjna). Źródło prawdy: rejestr
// capabilities (lib/billing/capabilities). Cel: admin od razu widzi rozjazd
// między obietnicą na karcie a faktyczną bramką.
import { useTranslation } from "react-i18next";
import { Check, Info } from "lucide-react";
import { capabilityMeta, enabledFeatureKeys } from "@/lib/billing/capabilities";
import { ensureI18n as ensureAdminPricingI18n } from "@/lib/i18n-admin-pricing";

function parseFeatures(features: unknown): Record<string, unknown> {
  if (typeof features === "string") {
    try {
      const parsed: unknown = JSON.parse(features || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  if (features && typeof features === "object" && !Array.isArray(features)) {
    return features as Record<string, unknown>;
  }
  return {};
}

export function FeatureEnforcementBadges({ features }: { features: unknown }) {
  ensureAdminPricingI18n();
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const keys = enabledFeatureKeys(parseFeatures(features));
  if (keys.length === 0) return null;

  return (
    <ul className="mt-1.5 flex flex-wrap gap-1.5">
      {keys.map((key) => {
        const meta = capabilityMeta(key);
        const enforced = meta?.enforced ?? false;
        const where = meta ? (lang === "en" ? meta.where_en : meta.where_pl) : undefined;
        return (
          <li
            key={key}
            title={where}
            className={
              enforced
                ? "inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
                : "inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
            }
          >
            {enforced ? (
              <Check className="h-3 w-3" aria-hidden="true" />
            ) : (
              <Info className="h-3 w-3" aria-hidden="true" />
            )}
            <span className="font-mono">{key}</span>
            <span className="opacity-70">
              {enforced
                ? t("adminPricing.capabilities.enforced")
                : t("adminPricing.capabilities.decorative")}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
